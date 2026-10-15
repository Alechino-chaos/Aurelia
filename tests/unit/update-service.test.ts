import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateService, type UpdateDriver, type ShutdownSteps } from '../../electron/update-service';

const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(options: { supported?: boolean; version?: string; checkTimeoutMs?: number; failPreferences?: () => boolean } = {}) {
  let now = 100_000_000, downloads = 0, installs = 0, checks = 0, cancelled = false;
  let answer = options.version ?? '0.11.0';
  const pending = deferred<void>();
  let progress: ((data: { percent: number; transferred: number; total: number }) => void) | undefined;
  const driver: UpdateDriver = {
    async check() { checks++; return { version: answer, releaseNotes: '<script>raw notes</script>' }; },
    download(report) { downloads++; progress = report; return { promise: pending.promise, cancel() { cancelled = true; } }; },
    async validateDownloaded() {}, async install() { installs++; },
  };
  const preferences = { autoCheck: true, lastCheckedAt: null as number | null };
  const shutdown: ShutdownSteps = { hasActiveAi: () => false, confirmStopAi: async () => true,
    freeze: () => {}, stopAi: async () => {}, capture: async () => {}, persist: async () => {}, resume: () => {} };
  const service = new UpdateService({ currentVersion: '0.10.0', supported: options.supported ?? true, driver, shutdown,
    preferences, savePreferences: async value => { if (options.failPreferences?.()) throw new Error('preferences denied'); Object.assign(preferences, value); }, now: () => now, checkTimeoutMs: options.checkTimeoutMs });
  return { service, driver, shutdown, pending, preferences, progress: () => progress!, setVersion: (value: string) => { answer = value; },
    advance: (ms: number) => { now += ms; }, counts: () => ({ downloads, installs, checks, cancelled }) };
}
afterEach(() => vi.useRealTimers());
describe('user-controlled update coordinator', () => {
  it('checks without downloading, throttles automatic checks, and bypasses throttle manually', async () => {
    const f = fixture();
    expect((await f.service.check(false)).phase).toBe('available');
    expect(f.counts()).toMatchObject({ checks: 1, downloads: 0 });
    await f.service.check(false); expect(f.counts().checks).toBe(1);
    await f.service.check(true); expect(f.counts().checks).toBe(2);
    f.advance(86_400_000); await f.service.check(false); expect(f.counts().checks).toBe(3);
  });
  it('disables only automatic checks and preserves the persisted preference', async () => {
    const f = fixture(); await f.service.setAutoCheck(false); await f.service.check(false);
    expect(f.counts().checks).toBe(0); expect(f.preferences.autoCheck).toBe(false);
    expect((await f.service.check(true)).phase).toBe('available');
  });
  it('coalesces concurrent checks and reports network failure instead of latest', async () => {
    const f = fixture(), check = deferred<{ version: string }>(); f.driver.check = () => check.promise;
    const first = f.service.check(true), second = f.service.check(true);
    expect(f.service.getState().phase).toBe('checking'); check.reject(new Error('offline'));
    expect((await first).error).toBe('network'); expect((await second).phase).toBe('error');
  });
  it.each(['0.9.9', '0.10.0', '0.11.0-beta.1', 'bad', '1.2.03'])('rejects unsafe/non-newer offered version %s', async version => {
    const f = fixture({ version }); const state = await f.service.check(true);
    expect(state.phase).toBe(version === '0.9.9' || version === '0.10.0' ? 'latest' : 'error');
    expect(state.availableVersion).toBeUndefined(); await f.service.download(); expect(f.counts().downloads).toBe(0);
  });
  it('times out checks and ignores their late completion', async () => {
    vi.useFakeTimers(); const f = fixture({ checkTimeoutMs: 30 }), check = deferred<{ version: string }>(); f.driver.check = () => check.promise;
    const result = f.service.check(true); await vi.advanceTimersByTimeAsync(31);
    expect((await result).error).toBe('timeout'); check.resolve({ version: '0.11.0' }); await Promise.resolve();
    expect(f.service.getState().phase).toBe('error');
  });
  it('downloads only on request, coalesces clicks, and ignores completion/progress after cancel', async () => {
    const f = fixture(); await f.service.check(true);
    const first = f.service.download(), second = f.service.download();
    f.progress()({ percent: 45, transferred: 45, total: 100 }); expect(f.service.getState().percent).toBe(45);
    expect(f.counts().downloads).toBe(1); expect((await f.service.cancelDownload()).phase).toBe('cancelled');
    f.progress()({ percent: 100, transferred: 100, total: 100 }); f.pending.resolve(); await first; await second;
    expect(f.service.getState().phase).toBe('cancelled'); expect(f.counts().cancelled).toBe(true);
  });
  it('keeps download cancellation effective after a failed auto-check preference save', async () => {
    let failPreferences = false; const f = fixture({ failPreferences: () => failPreferences });
    await f.service.check(true); const download = f.service.download(); failPreferences = true;
    const afterSave = await f.service.setAutoCheck(false);
    expect(afterSave.phase).toBe('downloading'); expect(afterSave.error).toBe('preferences');
    f.progress()({ percent: 42, transferred: 42, total: 100 }); expect(f.service.getState().percent).toBe(42);
    expect((await f.service.cancelDownload()).phase).toBe('cancelled'); expect(f.counts().cancelled).toBe(true);
    f.pending.resolve(); await download; f.progress()({ percent: 100, transferred: 100, total: 100 });
    expect(f.service.getState().phase).toBe('cancelled'); expect(f.service.getState().percent).toBeUndefined();
  });
  it('retains the successful download phase and clears stale preference error after persistence recovers', async () => {
    let failPreferences = false; const f = fixture({ failPreferences: () => failPreferences });
    await f.service.check(true); const download = f.service.download(); failPreferences = true;
    await f.service.setAutoCheck(false); f.pending.resolve(); await download;
    expect(f.service.getState().phase).toBe('downloaded'); expect(f.service.getState().error).toBe('preferences');
    failPreferences = false; const state = await f.service.setAutoCheck(false);
    expect(state.phase).toBe('downloaded'); expect(state.error).toBeUndefined();
  });
  it('does not persist a failed toggle later as a side effect of writing a check timestamp', async () => {
    let failPreferences = true; const f = fixture({ failPreferences: () => failPreferences });
    await f.service.setAutoCheck(false); expect(f.service.getState().autoCheck).toBe(true);
    failPreferences = false; await f.service.check(true);
    expect(f.preferences.autoCheck).toBe(true); expect(f.service.getState().autoCheck).toBe(true);
  });
  it('requires a completed, validated download before install and never installs on cancellation of AI prompt', async () => {
    const f = fixture(); await f.service.install(); expect(f.counts().installs).toBe(0);
    await f.service.check(true); const download = f.service.download(); f.pending.resolve(); await download;
    f.shutdown.hasActiveAi = () => true; f.shutdown.confirmStopAi = async () => false;
    expect((await f.service.install()).phase).toBe('downloaded'); expect(f.counts().installs).toBe(0);
  });
  it('waits for AI settlement, capture and durable saves, then installs exactly once', async () => {
    const f = fixture(), order: string[] = [], saving = deferred<void>();
    f.shutdown.freeze = () => order.push('freeze'); f.shutdown.stopAi = async () => { order.push('stop'); };
    f.shutdown.capture = async () => { order.push('capture'); }; f.shutdown.persist = () => { order.push('persist'); return saving.promise; };
    await f.service.check(true); const download = f.service.download(); f.pending.resolve(); await download;
    const first = f.service.install(), second = f.service.install(); await vi.waitFor(() => expect(order).toEqual(['freeze', 'stop', 'capture', 'persist']));
    expect(f.counts().installs).toBe(0); saving.resolve(); await first; await second; expect(f.counts().installs).toBe(1);
  });
  it.each(['stopAi', 'capture', 'persist'] as const)('keeps the app usable and never installs when %s fails', async step => {
    const f = fixture(); let resumed = false; f.shutdown.resume = () => { resumed = true; };
    f.shutdown[step] = async () => { throw new Error('save failed'); };
    await f.service.check(true); const download = f.service.download(); f.pending.resolve(); await download;
    expect((await f.service.install()).error).toBe('save'); expect(resumed).toBe(true); expect(f.counts().installs).toBe(0);
    f.shutdown[step] = async () => {}; await f.service.install(); expect(f.counts().installs).toBe(1);
  });
  it('never invokes the updater for unsupported portable/development copies', async () => {
    const f = fixture({ supported: false }); await f.service.check(true); await f.service.download(); await f.service.install();
    expect(f.service.getState().phase).toBe('unsupported'); expect(f.counts()).toMatchObject({ checks: 0, downloads: 0, installs: 0 });
  });
  it('times out hung saves without launching an installer and restores editing', async () => {
    vi.useFakeTimers(); const f = fixture(); let resumed = false;
    f.shutdown.resume = () => { resumed = true; }; f.shutdown.persist = () => new Promise(() => {});
    await f.service.check(true); const download = f.service.download(); f.pending.resolve(); await download;
    const result = f.service.install(); await vi.advanceTimersByTimeAsync(20_001);
    expect((await result).error).toBe('save'); expect(resumed).toBe(true); expect(f.counts().installs).toBe(0);
  });
});

import type { UpdateState, UpdateError } from './update-types.js';

export interface UpdatePreferences { autoCheck: boolean; lastCheckedAt: number | null }
export interface UpdateOffer { version: string; releaseNotes?: string }
export interface UpdateDriver {
  check(): Promise<UpdateOffer>;
  download(progress: (value: { percent: number; transferred: number; total: number }) => void): { promise: Promise<void>; cancel(): void };
  validateDownloaded(): Promise<void>;
  install(): Promise<void>;
}
export interface ShutdownSteps {
  hasActiveAi(): boolean;
  confirmStopAi(): Promise<boolean>;
  freeze(): void;
  stopAi(): Promise<void>;
  capture(): Promise<void>;
  persist(): Promise<void>;
  resume(): void;
}
interface Options {
  currentVersion: string; supported: boolean; driver: UpdateDriver; shutdown: ShutdownSteps;
  preferences: UpdatePreferences; savePreferences(value: UpdatePreferences): Promise<void>;
  notify?(value: UpdateState): void; now?(): number; checkTimeoutMs?: number;
}
function version(value: string): number[] | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return;
  const parts = match.slice(1, 4).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}
/** Stable-only comparison independent of the updater provider's channel heuristics. */
export function isNewerStable(offered: string, current: string): boolean | undefined {
  const a = version(offered), b = version(current); if (!a || !b) return;
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index];
  return false;
}
export class UpdateService {
  private state: UpdateState;
  private checking?: Promise<UpdateState>;
  private checksPaused = false;
  private interruptCheck?: () => void;
  private downloading?: Promise<UpdateState>;
  private installing?: Promise<UpdateState>;
  private cancel?: () => void;
  private downloadGeneration = 0;
  private downloaded = false;
  private installCommitted = false;
  private preferenceQueue: Promise<unknown> = Promise.resolve();
  private pendingPreferenceSave?: Promise<void>;
  private committedPreferences: UpdatePreferences;
  constructor(private options: Options) {
    this.committedPreferences = { ...options.preferences };
    this.state = { phase: options.supported ? 'idle' : 'unsupported', currentVersion: options.currentVersion,
      supported: options.supported, ...options.preferences };
  }
  getState(): UpdateState { return { ...this.state }; }
  private publish(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch }; this.options.notify?.(this.getState()); return this.getState();
  }
  private fail(error: UpdateError) { return this.publish({ phase: 'error', error }); }
  private preferenceFailure(): UpdateState {
    // Preference persistence is independent of the currently running transfer/save.
    return ['checking', 'downloading', 'downloaded', 'preparing'].includes(this.state.phase)
      ? this.publish({ error: 'preferences' }) : this.fail('preferences');
  }
  private savePreferences(value: Partial<UpdatePreferences>): Promise<void> {
    const patch = { ...value };
    const operation = this.preferenceQueue.then(async () => {
      // Merge only with the last durable preference; a rejected toggle must not
      // reappear later inside an otherwise successful timestamp write.
      const snapshot = { ...this.committedPreferences, ...patch };
      await this.options.savePreferences(snapshot);
      this.committedPreferences = snapshot;
    });
    this.pendingPreferenceSave = operation;
    this.preferenceQueue = operation.catch(() => {}); return operation;
  }
  async flush(): Promise<void> {
    // A pending check can still enqueue its timestamp write; close must wait for that too.
    await this.checking;
    await this.pendingPreferenceSave;
  }
  pauseChecks(): void { this.checksPaused = true; this.interruptCheck?.(); }
  resumeChecks(): void { this.checksPaused = false; }
  async setAutoCheck(input: unknown): Promise<UpdateState> {
    if (typeof input !== 'boolean') return this.preferenceFailure();
    try {
      await this.savePreferences({ autoCheck: input });
      return this.publish({ autoCheck: input, ...(this.state.error === 'preferences' ? { error: undefined,
        ...(this.state.phase === 'error' ? { phase: this.downloaded ? 'downloaded' : this.state.availableVersion ? 'available' : this.state.supported ? 'idle' : 'unsupported' } : {}) } : {}) });
    }
    catch { return this.preferenceFailure(); }
  }
  check(manual = true): Promise<UpdateState> {
    if (this.checksPaused) return Promise.resolve(this.getState());
    if (this.checking) return this.checking;
    if (!this.state.supported || this.downloading || this.installing || this.downloaded) return Promise.resolve(this.getState());
    const now = (this.options.now ?? Date.now)();
    if (!manual && (!this.state.autoCheck || (this.state.lastCheckedAt !== null && now - this.state.lastCheckedAt < 86_400_000))) return Promise.resolve(this.getState());
    this.publish({ phase: 'checking', error: undefined, availableVersion: undefined, releaseNotes: undefined });
    const operation = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let checking = true;
      let interrupted = false;
      try {
        const timed = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.options.checkTimeoutMs ?? 30_000); });
        const cancelled = new Promise<never>((_resolve, reject) => {
          this.interruptCheck = () => { if (checking) { interrupted = true; reject(new Error('closing')); } };
        });
        const offer = await Promise.race([this.options.driver.check(), timed, cancelled]);
        checking = false;
        const newer = isNewerStable(offer.version, this.state.currentVersion);
        this.publish({ lastCheckedAt: now });
        await this.savePreferences({ lastCheckedAt: now });
        if (newer === undefined) return this.fail('invalid-version');
        return this.publish(newer ? { phase: 'available', availableVersion: offer.version, releaseNotes: offer.releaseNotes?.slice(0, 50_000) }
          : { phase: 'latest', availableVersion: undefined, releaseNotes: undefined });
      } catch (error) {
        // Closing may abandon network work, but never an already queued disk write.
        // The late network result cannot enqueue a timestamp after the save drain.
        if (interrupted) return this.publish({ phase: 'idle', error: undefined });
        this.publish({ lastCheckedAt: now });
        await this.savePreferences({ lastCheckedAt: now }).catch(() => {});
        return this.fail(error instanceof Error && error.message === 'timeout' ? 'timeout' : checking ? 'network' : 'preferences');
      } finally { this.interruptCheck = undefined; if (timer) clearTimeout(timer); }
    })();
    this.checking = operation;
    void operation.finally(() => { this.checking = undefined; }); return operation;
  }
  download(): Promise<UpdateState> {
    if (this.downloading) return this.downloading;
    if (!this.state.supported || this.installing || this.downloaded || !this.state.availableVersion || isNewerStable(this.state.availableVersion, this.state.currentVersion) !== true) return Promise.resolve(this.getState());
    const generation = ++this.downloadGeneration;
    this.publish({ phase: 'downloading', percent: 0, transferred: 0, total: 0, error: undefined });
    const operation = (async () => {
      try {
        const task = this.options.driver.download(value => {
          if (generation !== this.downloadGeneration || this.state.phase !== 'downloading') return;
          if (![value.percent, value.transferred, value.total].every(Number.isFinite)) return;
          this.publish({ percent: Math.min(100, Math.max(0, value.percent)), transferred: Math.max(0, value.transferred), total: Math.max(0, value.total) });
        });
        this.cancel = task.cancel;
        await task.promise;
        if (generation !== this.downloadGeneration) return this.getState();
        await this.options.driver.validateDownloaded();
        if (generation !== this.downloadGeneration) return this.getState();
        this.downloaded = true; return this.publish({ phase: 'downloaded', percent: 100 });
      } catch { return generation === this.downloadGeneration ? this.fail('download') : this.getState(); }
      finally { if (generation === this.downloadGeneration) this.cancel = undefined; }
    })();
    this.downloading = operation;
    void operation.finally(() => { if (this.downloading === operation) this.downloading = undefined; }); return operation;
  }
  async cancelDownload(): Promise<UpdateState> {
    if (!this.cancel) return this.getState();
    ++this.downloadGeneration; this.cancel?.(); this.cancel = undefined;
    // Wait for the cancelled driver to settle before permitting another download.
    return this.publish({ phase: 'cancelled', percent: undefined, transferred: undefined, total: undefined });
  }
  install(): Promise<UpdateState> {
    if (this.installing) return this.installing;
    if (!this.state.supported || !this.downloaded || this.installCommitted) return Promise.resolve(this.getState());
    const operation = (async () => {
      const shutdown = this.options.shutdown;
      try { await this.options.driver.validateDownloaded(); } catch { this.downloaded = false; return this.fail('download'); }
      try {
        if (shutdown.hasActiveAi() && !await shutdown.confirmStopAi()) return this.getState();
        this.publish({ phase: 'preparing', error: undefined }); shutdown.freeze();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let ownsPreparation = true;
        try {
          const preparation = (async () => {
            await shutdown.stopAi(); if (!ownsPreparation) return;
            await shutdown.capture(); if (!ownsPreparation) return;
            await shutdown.persist(); if (!ownsPreparation) return;
            await this.flush();
          })();
          await Promise.race([preparation, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Saving timed out')), 20_000);
          })]);
        } finally { ownsPreparation = false; if (timer) clearTimeout(timer); }
      } catch { shutdown.resume(); return this.fail('save'); }
      try { await this.options.driver.install(); this.installCommitted = true; return this.getState(); }
      catch { shutdown.resume(); return this.fail('install'); }
    })();
    this.installing = operation;
    void operation.finally(() => { this.installing = undefined; }); return operation;
  }
}

import { describe, expect, it } from 'vitest';
import { NavigationController } from '../src/navigation/controller';
import { emptyHistory, type NavigationPoint } from '../src/navigation/history';

const start: NavigationPoint = { page: 1, x: -.03, y: .14, zoom: 1.25 };
function harness() {
  let viewport = { ...start };
  const notices: string[] = [];
  const controller = new NavigationController({ capture: () => ({ ...viewport }),
    land: async (point, current) => { if (!current()) return false; viewport = { ...point }; return true; },
    changed: () => {}, notify: message => notices.push(message) }, emptyHistory());
  return { controller, notices, view: () => viewport, scroll: (point: NavigationPoint) => { viewport = point; } };
}
describe('ordered navigation transactions', () => {
  it('captures before asynchronous resolution and restores the actual passively scrolled return location', async () => {
    const h = harness(); let resolve!: (point: NavigationPoint) => void;
    const pending = h.controller.jump(() => new Promise<NavigationPoint>(done => { resolve = done; }));
    h.scroll({ ...start, y: .5 }); resolve({ page: 2, x: .25, y: .25, zoom: 1.25 }); await pending;
    h.scroll({ page: 2, x: .3, y: .4, zoom: 1.5 }); await h.controller.step('back');
    expect(h.view()).toEqual(start); await h.controller.step('forward');
    expect(h.view()).toEqual({ page: 2, x: .3, y: .4, zoom: 1.5 });
  });
  it('allows Back to cancel the first pending jump without moving or recording it', async () => {
    const h = harness(); let resolve!: (point: NavigationPoint) => void;
    const pending = h.controller.jump(() => new Promise<NavigationPoint>(done => { resolve = done; }));
    expect(h.controller.canBack).toBe(true); await h.controller.step('back');
    resolve({ page: 2, x: 0, y: 0, zoom: 1.25 }); await pending;
    expect(h.view()).toEqual(start); expect(h.controller.history).toEqual({ past: [], future: [] });
  });
  it('ignores a stale destination and stale error after a newer jump or disposal', async () => {
    const h = harness(); let reject!: (error: Error) => void;
    const pending = h.controller.jump(() => new Promise<NavigationPoint>((_, failed) => { reject = failed; }));
    await h.controller.jump(() => ({ page: 3, x: .5, y: .25, zoom: 'fit' }));
    reject(new Error('old failure')); await pending;
    expect(h.view().page).toBe(3); expect(h.notices).toEqual([]);
    expect(h.controller.history.past).toEqual([start]);
    let resolve!: (point: NavigationPoint) => void;
    const disposed = h.controller.jump(() => new Promise<NavigationPoint>(done => { resolve = done; }));
    h.controller.cancel(); resolve({ page: 2, x: 0, y: 0, zoom: 1 }); await disposed;
    expect(h.view().page).toBe(3);
  });
  it('does not corrupt the forward branch on a failed or no-op destination', async () => {
    const h = harness(); await h.controller.jump(() => ({ page: 2, x: 0, y: 0, zoom: 1.25 }));
    await h.controller.step('back'); const history = h.controller.history;
    await h.controller.jump(() => { throw new Error('missing destination'); });
    await h.controller.jump(() => ({ ...start }));
    expect(h.controller.history).toBe(history); expect(h.notices).toHaveLength(1);
    expect(h.view()).toEqual(start);
  });
});

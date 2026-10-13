export interface NavigationPoint { page: number; x: number; y: number; zoom: number | 'fit' }
export interface NavigationHistory { past: NavigationPoint[]; future: NavigationPoint[] }
const limit = 100;
// Normalized tolerance is about a tenth of a CSS pixel on a 1000px page.
const tolerance = 0.0001;
function valid(point: NavigationPoint): boolean {
  return Number.isInteger(point.page) && point.page >= 1 && Number.isFinite(point.x) && Number.isFinite(point.y)
    && (point.zoom === 'fit' || (Number.isFinite(point.zoom) && point.zoom > 0));
}
function same(a: NavigationPoint, b: NavigationPoint): boolean {
  return a.page === b.page && Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance
    && (a.zoom === b.zoom || (typeof a.zoom === 'number' && typeof b.zoom === 'number' && Math.abs(a.zoom - b.zoom) <= 1e-6));
}
function append(stack: NavigationPoint[], point: NavigationPoint): NavigationPoint[] {
  return [...stack, { ...point }].slice(-limit);
}
export function emptyHistory(): NavigationHistory { return { past: [], future: [] }; }
export function recordJump(history: NavigationHistory, from: NavigationPoint, to: NavigationPoint): NavigationHistory {
  if (!valid(from) || !valid(to) || same(from, to)) return history;
  const past = history.past.at(-1);
  return { past: past && same(past, from) ? history.past.slice() : append(history.past, from), future: [] };
}
export function stepHistory(history: NavigationHistory, direction: 'back' | 'forward', current: NavigationPoint): { history: NavigationHistory; target: NavigationPoint | null } {
  const source = direction === 'back' ? history.past : history.future;
  const target = source.at(-1);
  if (!valid(current) || !target || !valid(target)) return { history, target: null };
  return {
    history: direction === 'back'
      ? { past: source.slice(0, -1), future: append(history.future, current) }
      : { past: append(history.past, current), future: source.slice(0, -1) },
    target: { ...target },
  };
}

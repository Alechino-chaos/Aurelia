import { emptyHistory, recordJump, stepHistory, type NavigationHistory, type NavigationPoint } from './history';

export type NavigationLanding = NavigationPoint & { marginX?: number; marginY?: number; waitForLayout?: boolean };
type Ports = {
  capture(): NavigationPoint;
  land(point: NavigationLanding, current: () => boolean, restoreZoom: boolean): Promise<boolean>;
  changed(): void;
  notify(message: string): void;
};
/** One authority for explicit moves, including delayed DOM and PDF destinations. */
export class NavigationController {
  history: NavigationHistory;
  private intent: AbortController | null = null;
  constructor(private ports: Ports, initial = emptyHistory()) { this.history = initial; }
  get canBack() { return !!this.intent || this.history.past.length > 0; }
  get canForward() { return this.history.future.length > 0; }
  cancel() { this.intent?.abort(); this.intent = null; }
  private begin() {
    this.cancel(); const intent = new AbortController(); this.intent = intent; this.ports.changed();
    return { signal: intent.signal, current: () => this.intent === intent && !intent.signal.aborted,
      finish: () => { if (this.intent === intent) { this.intent = null; this.ports.changed(); } } };
  }
  async jump(resolve: (signal: AbortSignal, from: NavigationPoint) => NavigationLanding | Promise<NavigationLanding>) {
    const from = this.ports.capture(), transaction = this.begin();
    try {
      const target = await resolve(transaction.signal, from);
      if (!transaction.current() || !await this.ports.land(target, transaction.current, false) || !transaction.current()) return;
      this.history = recordJump(this.history, from, this.ports.capture());
    } catch (reason) {
      if (transaction.current()) this.ports.notify(`无法跳转：${reason instanceof Error ? reason.message : '目标不可用'}`);
    } finally { transaction.finish(); }
  }
  async step(direction: 'back' | 'forward') {
    const current = this.ports.capture(), transaction = this.begin();
    const step = stepHistory(this.history, direction, current);
    try {
      if (step.target && await this.ports.land(step.target, transaction.current, true) && transaction.current()) this.history = step.history;
    } catch (reason) {
      if (transaction.current()) this.ports.notify(`无法恢复位置：${reason instanceof Error ? reason.message : '目标不可用'}`);
    } finally { transaction.finish(); }
  }
}

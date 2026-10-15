export type UpdatePhase = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'cancelled' | 'downloaded' | 'preparing' | 'error' | 'unsupported';
/** Codes are localized by the renderer; remote/provider exception text is never exposed. */
export type UpdateError = 'network' | 'timeout' | 'invalid-version' | 'download' | 'save' | 'install' | 'preferences';
export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  supported: boolean;
  autoCheck: boolean;
  lastCheckedAt: number | null;
  availableVersion?: string;
  releaseNotes?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  error?: UpdateError;
}

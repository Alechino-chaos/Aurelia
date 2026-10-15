// Test-only entry: expose production stores for deterministic disk latency/errors.
// This directory is excluded from packaged application files.
import { SessionStore } from '../../../dist-electron/session-store.js';
globalThis.closeTest = { SessionStore };
await import('../../../dist-electron/main.js');

export const UPDATE_RELEASE_PAGE = 'https://github.com/Alechino-chaos/Aurelia/releases/latest';
export const PRODUCTION_INSTALL_GUID = '8e3b71f6-b014-4f5d-83d9-ea8146edc067';
export const TEST_INSTALL_GUID = '19e4ad96-9090-4c86-ad10-49b0da8b3ed3';
/** Stable across A/B at the same install directory, including shell launches that lose test env. */
export function isolatedUpdateTestProfile(executable: string, commandProfile?: string, environmentProfile?: string): string {
  if (commandProfile && path.isAbsolute(commandProfile)) return commandProfile;
  if (environmentProfile && path.isAbsolute(environmentProfile)) return environmentProfile;
  const key = createHash('sha256').update(path.resolve(path.dirname(executable)).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `aurelia-update-test-${key}`);
}
/** An environment variable alone can never change the official feed. */
export function testFeed(marker: boolean, input: string | undefined): string | undefined {
  if (!marker || !input) return;
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash || url.search) return;
    return url.href;
  } catch { return; }
}
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

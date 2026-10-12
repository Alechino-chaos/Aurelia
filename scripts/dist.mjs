import { build, Platform, Arch } from 'electron-builder';
import path from 'node:path';
import { electronExecutable } from './electron-runtime.mjs';

// Reuse the installed Electron runtime instead of downloading it a second time.
const artifacts = await build({
  targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64),
  config: { electronDist: path.dirname(electronExecutable()) },
  publish: 'never',
});
console.log('Windows artifacts:');
for (const artifact of artifacts) console.log(artifact);

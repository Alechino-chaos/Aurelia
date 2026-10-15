import { build, Platform, Arch } from 'electron-builder';
import path from 'node:path';
import { electronExecutable } from './electron-runtime.mjs';

// Test packages have a separate installer identity and can use a loopback feed.
// Production artifacts never include this marker or accept a custom feed.
const testVersion = process.env.AURELIA_UPDATE_TEST_BUILD;
if (testVersion && !/^\d+\.\d+\.\d+$/.test(testVersion)) throw new Error('Invalid test version');
const artifacts = await build({
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  config: {
    electronDist: path.dirname(electronExecutable()),
    ...(testVersion ? {
      appId: 'com.aurelia.reader.upgrade-test',
      directories: { output: `release/upgrade-test-${testVersion}` },
      extraMetadata: { name: 'aurelia-upgrade-test', version: testVersion, aureliaUpdateTest: true },
      nsis: { guid: '19e4ad96-9090-4c86-ad10-49b0da8b3ed3', shortcutName: 'Aurelia Upgrade Test', createStartMenuShortcut: false, displayLanguageSelector: false },
    } : {}),
  },
  publish: 'never',
});
console.log('Windows artifacts:');
for (const artifact of artifacts) console.log(artifact);

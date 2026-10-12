import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { electronExecutable } from './electron-runtime.mjs';

if (process.platform === 'win32') {
  const temp = path.resolve('tmp/build');
  mkdirSync(temp, { recursive: true });
  process.env.TEMP = temp;
  process.env.TMP = temp;
}
process.env.PAPERDESK_ELECTRON_PATH = electronExecutable();
const task = spawn(process.execPath, process.argv.slice(2), { stdio: 'inherit', env: process.env });
task.on('error', error => { console.error(error.message); process.exitCode = 1; });
task.on('exit', code => process.exit(code ?? 1));
process.on('SIGINT', () => task.kill());
process.on('SIGTERM', () => task.kill());

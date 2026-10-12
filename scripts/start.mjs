import { spawn } from 'node:child_process';
import { electronExecutable } from './electron-runtime.mjs';
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const desktop = spawn(electronExecutable(), ['.'], { stdio: 'inherit', env: environment });
desktop.on('error', error => { console.error(error.message); process.exitCode = 1; });
desktop.on('exit', code => process.exit(code ?? 1));
process.on('SIGINT', () => desktop.kill());
process.on('SIGTERM', () => desktop.kill());

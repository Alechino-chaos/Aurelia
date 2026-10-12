import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { electronExecutable } from './electron-runtime.mjs';
import './prepare-assets.mjs';

const compiler = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json'], { stdio: 'inherit' });
const result = await new Promise(resolve => compiler.on('exit', resolve));
if (result !== 0) process.exit(1);
const server = await createServer();
await server.listen();
server.printUrls();
const environment = { ...process.env, PAPERDESK_DEV_URL: 'http://127.0.0.1:5173' };
delete environment.ELECTRON_RUN_AS_NODE;
const desktop = spawn(electronExecutable(), ['.'], { stdio: 'inherit', env: environment });
desktop.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
process.on('SIGINT', () => desktop.kill());
process.on('SIGTERM', () => desktop.kill());

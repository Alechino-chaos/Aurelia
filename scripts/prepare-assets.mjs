import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public/pdf-assets');
mkdirSync(output, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(path.join(root, 'node_modules/pdfjs-dist', directory), path.join(output, directory), { recursive: true });
}

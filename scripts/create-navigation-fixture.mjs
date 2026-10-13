import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees } from 'pdf-lib';

// Synthetic public test material only. Fixed metadata makes regeneration byte reproducible.
const pdf = await PDFDocument.create();
pdf.setTitle('Aurelia native navigation fixture');
pdf.setAuthor('Aurelia tests');
pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
const font = await pdf.embedFont(StandardFonts.Helvetica);
const pages = Array.from({ length: 3 }, () => pdf.addPage([600, 800]));
pages[2].setCropBox(100, 100, 400, 600);
pages[2].setRotation(degrees(90));
pages[2].node.set(PDFName.of('UserUnit'), pdf.context.obj(2));
const xyz = (page, left, top, zoom = 4) => pdf.context.obj([pages[page].ref, PDFName.of('XYZ'), left, top, zoom]);
const reference = xyz(1, 150, 600);
const rotated = xyz(2, 200, 400);
pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ Dests: { Names: [PDFString.of('invalid'), [99, PDFName.of('Fit')], PDFString.of('reference'), reference, PDFString.of('rotated'), rotated] } }));

const outlineRoot = pdf.context.register(pdf.context.obj({ Type: 'Outlines' }));
const first = pdf.context.register(pdf.context.obj({ Title: PDFString.of('Introduction'), Parent: outlineRoot, Dest: xyz(0, 0, 800), Count: 1 }));
const second = pdf.context.register(pdf.context.obj({ Title: PDFString.of('References'), Parent: outlineRoot, Prev: first, Dest: PDFString.of('reference') }));
const child = pdf.context.register(pdf.context.obj({ Title: PDFString.of('Rotated detail'), Parent: first, Dest: PDFString.of('rotated') }));
pdf.context.lookup(first).set(PDFName.of('Next'), second);
pdf.context.lookup(first).set(PDFName.of('First'), child);
pdf.context.lookup(first).set(PDFName.of('Last'), child);
for (const [key, value] of Object.entries({ First: first, Last: second, Count: pdf.context.obj(3) })) pdf.context.lookup(outlineRoot).set(PDFName.of(key), value);
pdf.catalog.set(PDFName.of('Outlines'), outlineRoot);

function link(page, text, x, y, target, rect = [x, y - 2, x + font.widthOfTextAtSize(text, 14), y + 14]) {
  page.drawText(text, { x, y, size: 14, font });
  const annotation = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], ...target }));
  const annotations = page.node.Annots() ?? pdf.context.obj([]);
  annotations.push(annotation);
  page.node.set(PDFName.of('Annots'), annotations);
}
pages[0].drawText('Introduction: native PDF navigation', { x: 40, y: 740, size: 20, font });
pages[0].drawText('Select and copy this paragraph, including Reference [1].', { x: 40, y: 710, size: 14, font });
link(pages[0], 'Reference [1]', 40, 660, { Dest: PDFString.of('reference') });
link(pages[0], 'Figure 2: rotated detail', 40, 620, { Dest: rotated });
link(pages[0], 'DOI: 10.1234/navigation', 40, 580, { A: { S: 'URI', URI: PDFString.of('https://doi.org/10.1234/navigation') } });
link(pages[0], 'Next page action', 40, 540, { A: { S: 'Named', N: 'NextPage' } });
link(pages[0], 'Invalid native destination', 40, 500, { Dest: PDFString.of('invalid') });
link(pages[0], 'Unsupported remote file', 40, 460, { A: { S: 'GoToR', F: PDFString.of('file:///C:/untrusted.pdf'), D: [0, PDFName.of('Fit')] } });
link(pages[0], 'Unsupported PDF script', 40, 420, { A: { S: 'JavaScript', JS: PDFString.of('app.alert("Never execute")') } });
link(pages[0], 'Script-provided safe browser URL', 40, 380, { A: { S: 'JavaScript', JS: PDFString.of('app.launchURL("https://untrusted.example/script", true)') } });
link(pages[0], 'Remote HTTP browser URL', 40, 340, { A: { S: 'GoToR', F: PDFString.of('https://untrusted.example/remote.pdf'), D: [0, PDFName.of('Fit')] } });
pages[1].drawText('References', { x: 150, y: 600, size: 20, font });
pages[1].drawText('[1] Native navigation returns to the original paragraph.', { x: 150, y: 570, size: 12, font });
link(pages[1], 'Return to introduction', 150, 540, { Dest: xyz(0, 40, 660, 9) });
pages[2].drawText('Rotated cropped detail (UserUnit 2)', { x: 160, y: 500, size: 16, font });
link(pages[2], 'Return [1]', 200, 400, { Dest: reference }, [200, 400, 300, 460]);
const output = fileURLToPath(new URL('../tests/fixtures/navigation.pdf', import.meta.url));
await mkdir(fileURLToPath(new URL('../tests/fixtures/', import.meta.url)), { recursive: true });
await writeFile(output, await pdf.save({ useObjectStreams: false }));
console.log(output);

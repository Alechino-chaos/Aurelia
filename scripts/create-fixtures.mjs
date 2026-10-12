import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';

const pdf = await PDFDocument.create();
pdf.setTitle('Aurelia: A Two-Column Reading Specimen');
pdf.setAuthor('Aurelia');
pdf.setSubject('Synthetic layout fixture. Not a research publication.');
pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
const serif = await pdf.embedFont(StandardFonts.TimesRoman);
const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
const sans = await pdf.embedFont(StandardFonts.Helvetica);
const gray = rgb(.36, .4, .34);
const green = rgb(.27, .4, .28);

for (let pageNumber = 1; pageNumber <= 3; pageNumber++) {
  const page = pdf.addPage([612, 792]);
  const text = (value, x, y, size = 11, font = serif, color = rgb(.14, .17, .13)) => page.drawText(value, { x, y, size, font, color });
  text('AURELIA  /  READING SPECIMEN', 48, 748, 8, sans, green);
  page.drawLine({ start: { x: 48, y: 738 }, end: { x: 564, y: 738 }, thickness: .6, color: rgb(.8, .84, .77) });
  text(pageNumber === 1 ? 'A Quiet Workspace for Reading Papers' : pageNumber === 2 ? 'Selection That Follows the Argument' : 'Keep the Source Within Reach', 48, 702, 22, bold);
  text('Aurelia Design Notes  |  Synthetic PDF for testing  |  2026', 48, 680, 9, sans, gray);
  text('Abstract', 48, 644, 11, bold);
  [
    'This document is a reading and selection specimen. It combines a full-width abstract with two',
    'columns of text. The PDF deliberately stores the left and right lines in alternating order, so a',
    'reader must reconstruct the page layout before offering a useful, continuous text selection.',
  ].forEach((line, i) => text(line, 48, 625 - i * 15));
  const left = [
    `${pageNumber}.1  Reading in context`,
    'LEFT COLUMN: We propose a novel frame-',
    'work for representation learning. The method',
    'preserves the sentence across line breaks.',
    'Selecting these lines should never include',
    'unrelated words from the right-hand column.',
    '',
    'A useful reader keeps the original document',
    'visible while making its text easier to reuse.',
    'The canvas preserves typography, figures,',
    'and spacing. A separate text layer lets the',
    'reader select individual words and sentences.',
    '',
    'Selection is a small but essential interaction.',
    'A sentence often wraps onto another line.',
    'Its logical order should follow the argument,',
    'rather than the sequence of drawing commands.',
    '',
    'Careful copying also preserves uncertainty.',
    'A state-of-the-art method keeps its hyphens.',
    'A visible line-end hyphen is not always safe',
    'to remove. The original remains available',
    'alongside a conservative cleaned preview.',
    '',
    'Try dragging forward and then backward.',
    'Try selecting only a part of this sentence.',
    'Change the zoom and repeat the selection.',
  ];
  const right = [
    `${pageNumber}.2  From selection to understanding`,
    'RIGHT COLUMN: This independent paragraph',
    'belongs to the second column of the page.',
    'It must not interrupt the left-column text.',
    'A full-column selection should reach this',
    'paragraph only after completing the left one.',
    '',
    'A resizable inspector creates space for the',
    'next step. It can show an original quotation',
    'and a cleaned version before either is copied.',
    'The source page stays attached to the text,',
    'allowing the reader to return to its context.',
    '',
    'AI receives text only when you send it.',
    'Translation and discussion can be connected',
    'after rendering and selection are dependable.',
    'No document is uploaded during local reading.',
    '',
    'Complex tables and formulas require care.',
    'The source-order switch offers a fallback',
    'when a page is not a conventional paper.',
    'Scanned pages remain viewable, but optical',
    'character recognition is outside this version.',
    '',
    'Scroll down to continue to the next page.',
    'Use the page field to return to this passage.',
    'Close and reopen the file to resume reading.',
  ];
  // Intentionally interleaved PDF drawing order: L1, R1, L2, R2...
  left.forEach((line, i) => {
    const y = 546 - i * 15;
    if (line) text(line, 48, y, i === 0 ? 11 : 10.5, i === 0 ? bold : serif);
    if (right[i]) text(right[i], 324, y, i === 0 ? 11 : 10.5, i === 0 ? bold : serif);
  });
  page.drawLine({ start: { x: 48, y: 80 }, end: { x: 564, y: 80 }, thickness: .5, color: rgb(.84, .87, .82) });
  text('DEMO DOCUMENT  /  Not a research publication', 48, 62, 8, sans, gray);
  text(String(pageNumber), 556, 62, 9, sans, gray);
}
await mkdir('public/examples', { recursive: true });
await writeFile('public/examples/reading-demo.pdf', await pdf.save());
console.log('Created public/examples/reading-demo.pdf (3 pages, interleaved columns).');

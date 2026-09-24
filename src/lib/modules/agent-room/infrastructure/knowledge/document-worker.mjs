import { Readable } from 'node:stream';
import { extractPdf } from './pdf-extractor.mjs';

process.once('disconnect', () => process.exit(0));
const workerData = await new Promise(resolve => process.once('message', resolve));
const send = (type, result) => { if (process.connected) process.send({ type, result }); };

// No formulas, macros, scripts, remote links or external document resources run here.
const MAX_TEXT = 250_000, MAX_PASSAGES = 200;
const passages = [];
let length = 0, truncated = false;
function append(passage) {
  if (!passage.text.trim()) return;
  if (passages.length >= MAX_PASSAGES || length >= MAX_TEXT) { truncated = true; return; }
  const text = passage.text.slice(0, Math.min(6000, MAX_TEXT - length));
  truncated ||= text.length < passage.text.length;
  length += text.length;
  let remaining = text.length;
  const cells = passage.cells?.flatMap(cell => {
    if (remaining <= 0) return [];
    const value = cell.text.slice(0, remaining);
    remaining -= value.length + cell.address.length + 4;
    return [{ address: cell.address, text: value }];
  });
  passages.push({ ...passage, text, ...(cells ? { cells } : {}) });
}

try {
  const bytes = new Uint8Array(workerData.bytes);
  if (workerData.extension === 'pdf') {
    const result = await extractPdf(bytes, result => send('progress', result), workerData.directory);
    send('complete', result);
  } else {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    if (workerData.extension === 'csv') await workbook.csv.read(Readable.from([Buffer.from(bytes)]));
    else await workbook.xlsx.load(Buffer.from(bytes), { ignoreNodes: ['drawing', 'picture', 'extLst'] });
    truncated = workbook.worksheets.length > 30;
    for (const sheet of workbook.worksheets.slice(0, 30)) {
      for (let row = 1; row <= Math.min(sheet.rowCount, 2000); row++) {
        const cells = [];
        sheet.getRow(row).eachCell((cell, column) => {
          if (column <= 100) cells.push({ address: cell.address, text: String(cell.text ?? '').slice(0, 2000) });
          else truncated = true;
        });
        append({ locator: `${sheet.name}!${row}`, sheet: sheet.name.slice(0, 80), row, cells, text: cells.map(cell => `${cell.address}: ${cell.text}`).join(' | ') });
        if (length >= MAX_TEXT || passages.length >= MAX_PASSAGES) { truncated ||= row < sheet.rowCount; break; }
      }
      truncated ||= sheet.rowCount > 2000;
    }
    send('complete', { passages, truncated, status: passages.length ? 'ready' : 'empty' });
  }
} catch {
  send('complete', { passages: [], truncated: false, status: 'error' });
}

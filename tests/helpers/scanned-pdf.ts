import PDFDocument from 'pdfkit';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

function collect(pdf: InstanceType<typeof PDFDocument>) {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
}

export async function scannedPdf(pages: Array<{ text?: string; header?: string; native?: string; rotation?: number; oversizedImage?: boolean }>, password?: string) {
  const pdf = new PDFDocument({ autoFirstPage: false, ...(password ? { userPassword: password } : {}) });
  const output = collect(pdf);
  for (const page of pages) {
    pdf.addPage({ size: [600, 600], margin: 30 });
    if (page.rotation) (pdf.page.dictionary.data as Record<string, unknown>).Rotate = page.rotation;
    if (page.header) pdf.fontSize(18).text(page.header, 30, 20);
    if (page.native) pdf.fontSize(22).text(page.native, 30, 180);
    if (page.oversizedImage) {
      const canvas = createCanvas(4001, 4000);
      canvas.getContext('2d').fillRect(0, 0, 4001, 4000);
      pdf.image(canvas.toBuffer('image/png'), 30, 100, { width: 540, height: 360 });
      canvas.width = 1; canvas.height = 1;
    }
    if (!page.text) continue;
    const source = new PDFDocument({ size: [540, 360], margin: 20 });
    const sourceBytes = collect(source);
    source.fontSize(24).text(page.text, 20, 40); source.end();
    const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
    const task = getDocument({ data: new Uint8Array(await sourceBytes), useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, standardFontDataUrl: join(root, 'standard_fonts/'), verbosity: 0 });
    try {
      const doc = await task.promise, sourcePage = await doc.getPage(1);
      const viewport = sourcePage.getViewport({ scale: 2 });
      const canvas = createCanvas(viewport.width, viewport.height);
      await sourcePage.render({ canvas: null, canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport }).promise;
      pdf.image(canvas.toBuffer('image/png'), 30, 100, { width: 540, height: 360 });
      canvas.width = 1; canvas.height = 1;
    } finally { await task.destroy(); }
  }
  pdf.end(); return output;
}

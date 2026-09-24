import { copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const MAX_PAGES = 200, MAX_TEXT = 250_000, PAGE_TEXT = 6000;
const MAX_PIXELS = 8_000_000, MAX_SIDE = 4096;
/** @type {['eng', 'por', 'spa']} */
const LANGUAGES = ['eng', 'por', 'spa'];

/** @param {number} width @param {number} height */
export function rasterSize(width, height) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('invalid_page_size');
  const scale = Math.min(3, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
  return { scale, width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** @param {string} text */
const normalize = text => text.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
/** @param {string} native @param {string} recognized */
export function combinePageText(native, recognized) {
  if (!native.trim()) return recognized.trim();
  const known = ` ${normalize(native)} `;
  const extra = recognized.split('\n').filter(line => {
    const key = normalize(line);
    return key && !known.includes(` ${key} `);
  });
  return [native.trim(), ...extra].join('\n');
}

/** @param {string} directory */
async function createOcr(directory) {
  const { createWorker, PSM } = await import('tesseract.js');
  // A private per-job language directory, owned and cleaned by the parent process.
  // Tesseract receives an explicit filesystem path: missing assets cannot fetch a CDN.
  for (const code of LANGUAGES) {
    const root = dirname(require.resolve(`@tesseract.js-data/${code}/package.json`));
    await copyFile(join(root, '4.0.0_best_int', `${code}.traineddata.gz`), join(directory, `${code}.traineddata.gz`));
  }
  const worker = await createWorker(LANGUAGES.join('+'), 1, { langPath: directory, cacheMethod: 'none', errorHandler: () => {} });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
  return worker;
}

/** @param {import('tesseract.js').Worker} worker @param {Buffer} image */
async function recognizePage(worker, image) {
  let { data: best } = await worker.recognize(image, { rotateAuto: true }, { text: true });
  // Auto-rotate corrects skew, not upside-down scans. Retry only uncertain pages.
  for (const angle of [Math.PI, Math.PI / 2, -Math.PI / 2]) {
    if (best.confidence >= 75 && best.text.trim()) break;
    const { data } = await worker.recognize(image, { rotateRadians: angle }, { text: true });
    if (data.text.trim() && data.confidence > best.confidence) best = data;
  }
  return best;
}

/**
 * @param {Uint8Array} bytes
 * @param {(result: import('./DocumentExtractor.js').DocumentExtraction) => void} progress
 * @param {string} directory
 */
export async function extractPdf(bytes, progress, directory) {
  /** @type {Map<number, import('../../domain/knowledge.js').KnowledgePassage & { page: number }>} */
  const passages = new Map();
  /** @type {import('../../domain/knowledge.js').KnowledgeExtraction} */
  const extraction = { engine: 'pdfjs+tesseract-7', languages: LANGUAGES, pages: 0, ocrPages: [], failedPages: [], skippedPages: [] };
  let truncated = false, task, ocr;
  let activePage = 0;
  const warnedPages = new Set();
  const originalWarn = console.warn;
  // PDF.js 6 can resolve a partial operator list before rejecting its promise.
  // In this isolated, single-document process, retain warning provenance without
  // exposing document contents from parser diagnostics in the application log.
  console.warn = () => { if (activePage) warnedPages.add(activePage); else truncated = true; };
  /** @returns {import('./DocumentExtractor.js').DocumentExtraction} */
  const result = () => {
    let remaining = MAX_TEXT;
    const items = [];
    for (const passage of [...passages.values()].sort((a, b) => a.page - b.page)) {
      if (!passage.text.trim()) continue;
      const text = passage.text.slice(0, Math.min(PAGE_TEXT, remaining));
      truncated ||= text.length < passage.text.length;
      remaining -= text.length;
      if (text) items.push({ ...passage, text });
    }
    return { passages: items, extraction: { ...extraction }, truncated: truncated || extraction.skippedPages.length > 0 || extraction.failedPages.length > 0,
      status: items.length ? 'ready' : extraction.issue || extraction.failedPages.length ? 'error' : 'empty' };
  };
  try {
    const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const root = dirname(require.resolve('pdfjs-dist/package.json'));
    task = getDocument({ data: bytes, enableXfa: false, useWorkerFetch: false,
      useSystemFonts: false, disableFontFace: true, verbosity: 1, stopAtErrors: false,
      maxImageSize: 16_000_000, canvasMaxAreaInBytes: MAX_PIXELS * 4,
      standardFontDataUrl: join(root, 'standard_fonts/'), cMapUrl: join(root, 'cmaps/'), cMapPacked: true, wasmUrl: join(root, 'wasm/') });
    const doc = await task.promise;
    extraction.pages = doc.numPages;
    truncated = doc.numPages > MAX_PAGES;
    extraction.skippedPages = Array.from({ length: Math.min(doc.numPages, MAX_PAGES) }, (_, index) => index + 1);
    progress(result());
    const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObjectGroup]);
    // Read embedded text first, so a slow scan never erases the other pages' evidence.
    for (let page = 1; page <= Math.min(doc.numPages, MAX_PAGES); page++) {
      activePage = page;
      let current;
      try {
        current = await doc.getPage(page);
        const content = await current.getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
        truncated ||= text.length > PAGE_TEXT;
        passages.set(page, { locator: `p.${page}`, page, text: text.slice(0, PAGE_TEXT), extraction: 'text' });
        const operators = await current.getOperatorList();
        if (warnedPages.has(page)) throw new Error('incomplete_page');
        if (text.trim() && !operators.fnArray.some(op => imageOps.has(op))) extraction.skippedPages = extraction.skippedPages.filter(value => value !== page);
      } catch {
        extraction.failedPages.push(page);
        extraction.skippedPages = extraction.skippedPages.filter(value => value !== page);
      }
      finally { current?.cleanup(); }
      progress(result());
    }
    for (const page of [...extraction.skippedPages]) {
      activePage = page;
      let current, canvas;
      try {
        current = await doc.getPage(page);
        const base = current.getViewport({ scale: 1 });
        const size = rasterSize(base.width, base.height);
        const { createCanvas } = await import('@napi-rs/canvas');
        canvas = createCanvas(size.width, size.height);
        await current.render({ canvas: null, canvasContext: /** @type {CanvasRenderingContext2D} */ (/** @type {unknown} */ (canvas.getContext('2d'))), viewport: current.getViewport({ scale: size.scale }), background: '#ffffff' }).promise;
        if (warnedPages.has(page)) throw new Error('incomplete_page');
        ocr ??= await createOcr(directory);
        const data = await recognizePage(ocr, canvas.toBuffer('image/png'));
        const native = passages.get(page)?.text ?? '';
        passages.set(page, { locator: `p.${page}`, page, text: combinePageText(native, data.text).slice(0, PAGE_TEXT), extraction: native.trim() ? 'mixed' : 'ocr', confidence: Math.max(0, Math.min(100, Math.round(data.confidence || 0))) });
        truncated ||= combinePageText(native, data.text).length > PAGE_TEXT;
        extraction.ocrPages.push(page);
      } catch { extraction.failedPages.push(page); }
      finally {
        if (canvas) { canvas.width = 1; canvas.height = 1; }
        current?.cleanup();
      }
      extraction.skippedPages = extraction.skippedPages.filter(value => value !== page);
      progress(result());
    }
    if (extraction.failedPages.length) extraction.issue = 'page_error';
  } catch (error) {
    extraction.issue = error instanceof Error && error.name === 'PasswordException' ? 'encrypted' : 'parser_error';
    truncated = true;
  } finally {
    await ocr?.terminate().catch(() => {});
    await task?.destroy().catch(() => {});
    console.warn = originalWarn;
  }
  return result();
}

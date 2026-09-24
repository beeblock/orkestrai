import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { extractKnowledgeDocument, knowledgeParserEnvironment } from '$lib/modules/agent-room/infrastructure/knowledge/DocumentExtractor.js';
import { knowledgeWikiLinks, knowledgeTags, knowledgeTerms } from '$lib/modules/agent-room/domain/knowledge.js';
import { KNOWLEDGE_TOOLS, knowledgeCall } from '../../packages/orkestrai-cli/src/knowledge-reference.js';
import { scannedPdf } from '../helpers/scanned-pdf.js';
import { rasterSize, combinePageText, pdfResourceOptions } from '../../src/lib/modules/agent-room/infrastructure/knowledge/pdf-extractor.mjs';
import { join } from 'node:path';

describe('bounded knowledge extraction', () => {
  it('keeps PDF asset directories as filesystem paths with the required forward slash on every OS', () => {
    for (const root of ['/Applications/Orkestrai.app/PDF assets #1', 'C:\\Program Files\\Orkestrai\\PDF assets #1', '\\\\server\\share\\PDF assets']) {
      expect(pdfResourceOptions(root)).toEqual({
        standardFontDataUrl: join(root, 'standard_fonts') + '/',
        cMapUrl: join(root, 'cmaps') + '/', cMapPacked: true,
        wasmUrl: join(root, 'wasm') + '/',
      });
      for (const value of Object.values(pdfResourceOptions(root))) if (typeof value === 'string') {
        expect(value.endsWith('/')).toBe(true);
        expect(value).not.toMatch(/^file:/);
      }
    }
  });
  it('does not pass application secrets or runtime injection flags to the document parser', () => {
    expect(knowledgeParserEnvironment({ PATH: '/usr/bin', SystemRoot: 'C:\\Windows', APP_KEY: 'private', FAL_KEY: 'private', OPENAI_API_KEY: 'private', NODE_OPTIONS: '--require attacker.cjs', ORKESTRAI_WORKSPACE_TOKEN: 'private' }))
      .toEqual({ PATH: '/usr/bin', SystemRoot: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' });
  });
  it('extracts Markdown with line citations and normalizes search/tags', async () => {
    const result = await extractKnowledgeDocument(Buffer.from('# Budget\nPayment 450 reais. #Finance\n[[Campaign|brief]]'), 'md');
    expect(result.status).toBe('ready');
    expect(result.passages[0].locator).toBe('L1-3');
    expect(knowledgeWikiLinks(result.passages[0].text)).toEqual(['Campaign']);
    expect(knowledgeTags(result.passages[0].text)).toEqual(['finance']);
    expect(knowledgeTerms('Coração coração')).toEqual(['coracao']);
  });
  it('reports unsupported/binary, empty and bounded content explicitly', async () => {
    expect((await extractKnowledgeDocument(Buffer.from('binary'), 'exe')).status).toBe('unsupported');
    expect((await extractKnowledgeDocument(Buffer.from('a\0b'), 'txt')).status).toBe('unsupported');
    expect((await extractKnowledgeDocument(Buffer.from(''), 'txt')).status).toBe('empty');
    const long = await extractKnowledgeDocument(Buffer.from('line\n'.repeat(60_000)), 'txt');
    expect(long.truncated).toBe(true);
    expect(long.passages.length).toBeLessThanOrEqual(200);
    expect((await extractKnowledgeDocument(Buffer.from('x'.repeat(7000)), 'txt')).truncated).toBe(true);
  });
  it('extracts PDF text with real page locators without executing embedded content', async () => {
    const pdf = new PDFDocument({ compress: false });
    const chunks: Buffer[] = [];
    const bytes = new Promise<Buffer>((resolve, reject) => { pdf.on('data', chunk => chunks.push(chunk)); pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.on('error', reject); });
    pdf.addNamedJavaScript('must-not-execute', 'while (true) {}');
    pdf.text('Campaign budget: USD 450.'); pdf.addPage().text('Delivery date: October 10.'); pdf.end();
    const result = await extractKnowledgeDocument(await bytes, 'pdf', { timeoutMs: 5000 });
    expect(result.status).toBe('ready');
    expect(result.passages).toEqual(expect.arrayContaining([expect.objectContaining({ page: 2, locator: 'p.2', text: expect.stringContaining('October 10') })]));
  });
  it('extracts XLSX and CSV cells, retaining formulas as data only', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Budget'); sheet.addRow(['Item', 'Cost']); sheet.addRow(['Campaign', 450]); sheet.getCell('C2').value = { formula: '1+2', result: 3 };
    const result = await extractKnowledgeDocument(new Uint8Array(await workbook.xlsx.writeBuffer()), 'xlsx');
    expect(result.status).toBe('ready');
    expect(result.passages[1]).toMatchObject({ sheet: 'Budget', row: 2, locator: 'Budget!2', text: expect.stringContaining('B2: 450') });
    expect((await extractKnowledgeDocument(Buffer.from('Name,Value\nCampaign,450'), 'csv')).passages[1].text).toContain('450');
  });
  it('reports damaged PDFs and XLSX without crashing the host', async () => {
    for (const extension of ['pdf', 'xlsx']) expect((await extractKnowledgeDocument(Buffer.from('invalid'), extension)).status).toBe('error');
  });
  it('marks oversized page images as incomplete without discarding their native text', async () => {
    const result = await extractKnowledgeDocument(await scannedPdf([{ native: 'Preserve invoice 9264.', oversizedImage: true }]), 'pdf');
    expect(result.status).toBe('ready');
    expect(result.truncated).toBe(true);
    expect(result.extraction).toMatchObject({ failedPages: [1], issue: 'page_error' });
    expect(result.passages[0]?.text).toContain('9264');
  });
  it('reads actual scanned and mixed pages in English, Portuguese and Spanish with citations', async () => {
    const bytes = await scannedPdf([
      { text: 'Campaign budget: USD 450.\nDelivery date: October 10.' },
      { text: 'Orçamento aprovado: 750 reais.\nEntrega na segunda-feira.', header: 'Contrato 2026' },
      { text: 'Presupuesto aprobado: 900 euros.\nEntrega el viernes.' },
      { native: 'Native text stays exact: invoice 123456.' },
      {},
    ]);
    const result = await extractKnowledgeDocument(bytes, 'pdf');
    expect(result.status).toBe('ready');
    expect(result.truncated).toBe(false);
    expect(result.extraction).toMatchObject({ pages: 5, ocrPages: [1, 2, 3, 5], failedPages: [], skippedPages: [] });
    expect(result.passages.find(p => p.page === 1)).toMatchObject({ locator: 'p.1', extraction: 'ocr', text: expect.stringContaining('450') });
    expect(result.passages.find(p => p.page === 2)).toMatchObject({ extraction: 'mixed', text: expect.stringContaining('750') });
    expect(result.passages.find(p => p.page === 2)?.text).toContain('Contrato 2026');
    expect(result.passages.find(p => p.page === 3)?.text).toContain('900');
    expect(result.passages.find(p => p.page === 4)?.extraction).toBe('text');
    expect(result.passages.find(p => p.page === 5)).toBeUndefined();
  }, 60_000);
  it('reports encrypted PDFs and cancels extraction without blocking the next parser', async () => {
    const locked = await extractKnowledgeDocument(await scannedPdf([{ native: 'Private invoice' }], 'secret'), 'pdf');
    expect(locked.status).toBe('error');
    expect(locked.extraction?.issue).toBe('encrypted');
    const bytes = await scannedPdf([{ text: 'A scanned invoice costs 650 reais.' }]);
    const controller = new AbortController();
    const pending = extractKnowledgeDocument(bytes, 'pdf', { signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    expect((await pending).truncated).toBe(true);
    expect((await extractKnowledgeDocument(Buffer.from('Name,Value\nOK,500'), 'csv')).status).toBe('ready');
  }, 15_000);
  it('reads a scan whose PDF page is rotated', async () => {
    for (const rotation of [90, 180, 270]) {
      const result = await extractKnowledgeDocument(await scannedPdf([{ text: 'Invoice 8721. Total amount: 450 dollars.', rotation }]), 'pdf');
      expect(result.passages[0]?.text, `rotation ${rotation}`).toContain('8721');
      expect(result.passages[0]?.text).toContain('450');
    }
  }, 20_000);
  it('retains embedded evidence when the OCR deadline interrupts a long scan', async () => {
    const bytes = await scannedPdf([{ native: 'Evidence that must survive: contract 7825.' }, ...Array.from({ length: 30 }, () => ({ text: 'Scanned invoice. Delivery date: October 10. Total 8921 dollars.' }))]);
    const result = await extractKnowledgeDocument(bytes, 'pdf', { timeoutMs: 2000 });
    expect(result.truncated).toBe(true);
    expect(result.extraction?.issue).toBe('timeout');
    expect(result.passages[0]?.text).toContain('7825');
    expect(result.extraction?.skippedPages.length).toBeGreaterThan(0);
  }, 20_000);
  it('bounds raster allocation, rejects invalid dimensions and removes duplicate native lines', () => {
    for (const [w, h] of [[600, 800], [100_000, 100_000], [500_000, 1]]) {
      const size = rasterSize(w, h);
      expect(size.width * size.height).toBeLessThanOrEqual(8_000_000);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(4096);
    }
    expect(() => rasterSize(Infinity, 5)).toThrow();
    expect(() => rasterSize(0, 5)).toThrow();
    expect(combinePageText('Contrato 2026', 'Contrato 2026\nTotal: 750 reais.')).toBe('Contrato 2026\nTotal: 750 reais.');
  });
  it('exposes typed agent tools and consistent bridge calls', async () => {
    const calls: unknown[] = [];
    const bridge = async (...args: unknown[]) => { calls.push(args); return {}; };
    expect(new Set(KNOWLEDGE_TOOLS.map(tool => tool.name)).size).toBe(9);
    await knowledgeCall('knowledge_search', { query: 'cost 450' }, 'agent', bridge);
    await knowledgeCall('learning_reflect', { taskId: 'task', correction: 'verified' }, 'agent', bridge);
    expect(calls[0]).toEqual(['GET', '/api/agent-room/bridge/knowledge?q=cost+450']);
    expect(calls[1]).toEqual(['POST', '/api/agent-room/bridge/learning', { taskId: 'task', correction: 'verified', nodeId: 'agent', command: 'reflect' }]);
  });
});

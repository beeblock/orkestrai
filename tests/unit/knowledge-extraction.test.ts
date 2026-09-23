import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { extractKnowledgeDocument } from '$lib/modules/agent-room/infrastructure/knowledge/DocumentExtractor.js';
import { knowledgeWikiLinks, knowledgeTags, knowledgeTerms } from '$lib/modules/agent-room/domain/knowledge.js';
import { KNOWLEDGE_TOOLS, knowledgeCall } from '../../packages/orkestrai-cli/src/knowledge-reference.js';

describe('bounded knowledge extraction', () => {
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
    pdf.text('Campaign budget: USD 450.'); pdf.addPage().text('Delivery date: October 10.'); pdf.end();
    const result = await extractKnowledgeDocument(await bytes, 'pdf');
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

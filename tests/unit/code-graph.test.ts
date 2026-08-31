import { describe, expect, it } from 'vitest';
import { CodeGraphParser } from '$lib/modules/agent-room/infrastructure/code-graph/CodeGraphParser.js';
import { CodeGraphResolver } from '$lib/modules/agent-room/infrastructure/code-graph/CodeGraphResolver.js';
import type { ScannedCodeFile } from '$lib/modules/agent-room/infrastructure/code-graph/types.js';

function source(path: string, content: string): ScannedCodeFile {
  const extension = path.split('.').at(-1);
  return {
    absolutePath: `/workspace/${path}`,
    relativePath: path,
    language: extension === 'svelte' ? 'svelte' : extension === 'php' ? 'php' : 'typescript',
    content,
    contentHash: `hash-${path}`,
    byteSize: Buffer.byteLength(content),
    modifiedAt: '2026-08-31T00:00:00.000Z',
    generated: false,
  };
}

describe('CodeGraphParser', () => {
  it('extracts TypeScript declarations and typed relationships', async () => {
    const parser = new CodeGraphParser();
    const parsed = await parser.parse(source('src/orders.ts', `
      import { Money } from './money';
      export interface OrderPort { save(): void }
      export class OrderService implements OrderPort {
        save() { return persistOrder(new Money()); }
      }
    `));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'interface', name: 'OrderPort', exported: true }),
      expect.objectContaining({ kind: 'class', name: 'OrderService', exported: true }),
      expect.objectContaining({ kind: 'method', name: 'save' }),
    ]));
    expect(parsed.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'imports', targetModule: './money' }),
      expect.objectContaining({ kind: 'implements', targetName: 'OrderPort' }),
      expect.objectContaining({ kind: 'calls', targetName: 'persistOrder' }),
      expect.objectContaining({ kind: 'instantiates', targetName: 'Money' }),
    ]));
  });

  it('indexes the bounded docblock attached to a declaration', async () => {
    const parser = new CodeGraphParser();
    const parsed = await parser.parse(source('src/customer.ts', `
      /** Loads the current customer without exposing persistence details. */
      export function loadCustomer() { return fetchCustomer(); }
    `));

    expect(parsed.symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'loadCustomer', documentation: 'Loads the current customer without exposing persistence details.' }),
    ]));
  });

  it('parses Svelte script blocks with source line offsets', async () => {
    const parser = new CodeGraphParser();
    const parsed = await parser.parse(source('src/Card.svelte', `
      <script lang="ts">
        export function formatCard() { return helper(); }
      </script>
      <article>Card</article>
    `));

    expect(parsed.symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'formatCard', kind: 'function', startLine: 3 }),
    ]));
    expect(parsed.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'calls', targetName: 'helper', siteLine: 3 }),
    ]));
  });

  it('extracts PHP namespaces, classes, methods, and calls', async () => {
    const parser = new CodeGraphParser();
    const parsed = await parser.parse(source('app/Services/InvoiceService.php', `<?php
      namespace App\\Services;
      use App\\Contracts\\InvoiceGateway;
      final class InvoiceService implements InvoiceGateway {
        public function issue() { return dispatch_invoice(); }
      }
    `));

    expect(parsed.symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'namespace', qualifiedName: 'App\\Services' }),
      expect.objectContaining({ kind: 'class', name: 'InvoiceService' }),
      expect.objectContaining({ kind: 'method', name: 'issue' }),
    ]));
    expect(parsed.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'imports', targetName: 'InvoiceGateway' }),
      expect.objectContaining({ kind: 'calls', targetName: 'dispatch_invoice' }),
    ]));
  });
});

describe('CodeGraphResolver', () => {
  it('resolves local imports and keeps unknown calls as bounded external symbols', async () => {
    const parser = new CodeGraphParser();
    const files = await Promise.all([
      parser.parse(source('src/money.ts', 'export class Money {}')),
      parser.parse(source('src/order.ts', `
        import { Money } from './money';
        export function total() { unknownMetric(); return new Money(); }
      `)),
    ]);
    const graph = new CodeGraphResolver().resolve(files);
    const moneyModule = graph.symbols.find((symbol) => symbol.kind === 'module' && symbol.name === 'money.ts');
    const unknown = graph.symbols.find((symbol) => symbol.kind === 'external' && symbol.name === 'unknownMetric');

    expect(moneyModule).toBeTruthy();
    expect(unknown).toBeTruthy();
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'imports', targetKey: moneyModule!.key, confidence: 100 }),
      expect.objectContaining({ kind: 'calls', targetKey: unknown!.key }),
    ]));
  });
});

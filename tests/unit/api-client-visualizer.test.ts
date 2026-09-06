import { describe, expect, it } from 'vitest';
import { apiClientVisualizerDocument } from '$lib/modules/agent-room/domain/api-client-visualizer.js';

describe('API Client visualizer document', () => {
  it('resolves relative assets against the request without leaking credentials', () => {
    const document = apiClientVisualizerDocument(
      '<html><head><title>Report</title></head><body><audio src="assets/sfx.wav"></audio></body></html>',
      'https://user:secret@example.test/v1/report?token=private#result',
    );

    expect(document).toContain('<base href="https://example.test/v1/report">');
    expect(document).not.toContain('user:secret');
    expect(document).not.toContain('token=private');
    expect(document).toContain("script-src 'none'");
  });

  it('replaces an untrusted base and keeps relative assets away from Orkestrai', () => {
    const document = apiClientVisualizerDocument(
      '<base href="http://127.0.0.1:4173/"><img src="/asset.png">',
      'not-a-url',
    );

    expect(document).toContain('<base href="about:blank">');
    expect(document).not.toContain('127.0.0.1:4173');
  });

  it('bounds visualizer HTML before it reaches the iframe', () => {
    const document = apiClientVisualizerDocument('x'.repeat(1_100_000), 'https://example.test/');
    expect(document.length).toBeLessThan(1_002_000);
  });
});

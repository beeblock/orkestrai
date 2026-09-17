import { describe, expect, it } from 'vitest';
import { SkillMarketService } from '$lib/modules/agent-room/application/services/SkillMarketService.js';

function fakeFetch(remoteSkills: Array<{ id: string; skillId: string; name?: string; source?: string; installs?: number }>): typeof fetch {
  return (async (url: string | URL) => {
    const href = String(url);
    if (href.includes('/api/search')) {
      return new Response(JSON.stringify({ skills: remoteSkills }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('SkillMarketService', () => {
  it('returns the curated catalog when the query is empty, without hitting the network', async () => {
    let called = false;
    const service = new SkillMarketService((async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch);

    const results = await service.search('');

    expect(results.length).toBeGreaterThan(0);
    expect(results).toEqual(service.curated());
    expect(called).toBe(false);
  });

  it('merges curated results (first) with deduped remote results for a non-empty query', async () => {
    const curated = new SkillMarketService().curated();
    const overlapping = curated[0];
    const service = new SkillMarketService(
      fakeFetch([
        { id: overlapping.id, skillId: overlapping.skillId, name: overlapping.name, installs: 1 },
        { id: 'someone/repo/new-skill', skillId: 'new-skill', name: 'new-skill', source: 'someone/repo', installs: 42 },
      ])
    );

    const results = await service.search('design');

    const ids = results.map((skill) => skill.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(overlapping.id);
    expect(ids).toContain('someone/repo/new-skill');
    expect(results[0].id).toBe(curated.filter((skill) => `${skill.name} ${skill.skillId} ${skill.source}`.toLowerCase().includes('design'))[0]?.id);
  });

  it('falls back to the curated matches when skills.sh is unreachable', async () => {
    const service = new SkillMarketService((async () => {
      throw new Error('network down');
    }) as typeof fetch);
    const expected = service.curated().filter((skill) => skill.skillId.includes('pdf'));

    const results = await service.search('pdf');

    expect(results).toEqual(expected);
    expect(results.length).toBeGreaterThan(0);
  });

  it('bounds and validates untrusted registry results before returning them to the UI', async () => {
    const service = new SkillMarketService(
      fakeFetch([
        { id: 'ignored', skillId: '../unsafe', name: '<script>alert(1)</script>', source: 'someone/repo', installs: 42 },
        { id: 'ignored', skillId: 'safe', name: 'x'.repeat(500), source: 'someone/repo', installs: Number.POSITIVE_INFINITY },
      ])
    );

    const results = await service.search('safe');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'someone/repo/safe', skillId: 'safe', source: 'someone/repo', installs: 0 });
    expect(results[0].name).toHaveLength(120);
  });
  it('matches spaced names against curated hyphenated IDs when the registry is unavailable', async () => {
    const service = new SkillMarketService((async () => { throw new Error('network down'); }) as typeof fetch);
    for (const query of ['web design guidelines', 'WEB-DESIGN-GUIDELINES', 'vercel labs/agent skills']) {
      expect((await service.search(query)).map(skill => skill.id)).toContain('vercel-labs/agent-skills/web-design-guidelines');
    }
  });
});

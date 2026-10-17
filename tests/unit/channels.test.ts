import { describe, expect, it } from 'vitest';
import {
  directChannel,
  directChannelNode,
  isKnownChannel,
  mentionedTitles,
  normalizeQuestionOptions,
  TEAM_CHANNEL,
} from '../../src/lib/modules/agent-room/domain/channels.js';

const NODE = '01a14a44-5d87-7d1c-90e7-7b697f79bf05';

describe('conversation channels', () => {
  it('recognizes the team and direct channels only', () => {
    expect(isKnownChannel(TEAM_CHANNEL)).toBe(true);
    expect(isKnownChannel(directChannel(NODE))).toBe(true);
    expect(directChannelNode(directChannel(NODE))).toBe(NODE);
    expect(isKnownChannel('dm:../../etc')).toBe(false);
    expect(isKnownChannel('general')).toBe(false);
  });

  it('bounds and de-duplicates answer options', () => {
    const options = normalizeQuestionOptions(['  Sim ', 'sim', 'Não', 42, '', 'a'.repeat(200), 'c', 'd', 'e', 'f']);
    expect(options[0]).toBe('Sim');
    expect(options).toHaveLength(6);
    expect(options[2]).toHaveLength(80);
    expect(normalizeQuestionOptions('Sim')).toEqual([]);
  });

  it('finds mentions by whole title, preferring the longest', () => {
    const titles = ['QA', 'QA Upload', 'Codex Lider'];
    expect(mentionedTitles('@QA Upload pode revisar? cc @Codex Lider', titles)).toEqual(['QA Upload', 'Codex Lider']);
    expect(mentionedTitles('fale com @QA.', titles)).toEqual(['QA']);
    expect(mentionedTitles('@QAX não existe', titles)).toEqual([]);
  });
});

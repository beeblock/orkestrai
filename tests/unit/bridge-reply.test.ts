import { describe, expect, it } from 'vitest';
import { hasStructuredReplySession, resolveAgentReplyText } from '$lib/modules/agent-room/application/services/BridgeService.js';

describe('resposta da ponte entre agentes', () => {
  it('sempre prefere o transcript estruturado', () => {
    expect(resolveAgentReplyText('Resposta limpa.', '\u001b[2Jredraw bruto', 'claude', 'Líder')).toBe('Resposta limpa.');
  });

  it('nunca devolve a captura TUI quando a associacao do provider falha', () => {
    expect(() => resolveAgentReplyText(null, '\u001b[2Jredraw bruto', 'claude', 'Líder')).toThrow(/transcript estruturado/i);
  });

  it('mantem o fallback sanitizado apenas para terminais shell', () => {
    expect(resolveAgentReplyText(null, 'linha 1\nlinha 2', null, 'Shell')).toBe('linha 1 linha 2');
  });

  it('aguarda o transcript quando o WSL ainda nao persistiu o id da sessao viva', () => {
    expect(hasStructuredReplySession('claude', null, 'reserved-session-id', null)).toBe(true);
    expect(hasStructuredReplySession('claude', null, null, 'tracked-session-id')).toBe(true);
    expect(hasStructuredReplySession('claude', null, null, null)).toBe(false);
    expect(hasStructuredReplySession(null, null, 'shell-session-id', null)).toBe(false);
  });
});

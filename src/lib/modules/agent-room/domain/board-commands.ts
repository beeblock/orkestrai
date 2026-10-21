/**
 * Plain-speech commands for the board, typed or dictated into the Canvas
 * message bar (pt-BR, English and Spanish). Anything that is not a command
 * stays a message to the team. Pure: the Canvas decides how to run each one.
 */
export type BoardCommand =
  | { kind: 'spawn'; count: number; provider: string | null }
  | { kind: 'handoff'; from: string; to: string }
  | { kind: 'pause'; paused: boolean }
  | { kind: 'open'; target: 'team-map' | 'orchestrator' | 'team-composer' | 'focus' | 'chat' | 'memory' | 'scores' }
  | { kind: 'note'; text: string }
  | { kind: 'group' };

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, one: 1, uno: 1, una: 1,
  dois: 2, duas: 2, two: 2, dos: 2,
  tres: 3, three: 3,
  quatro: 4, four: 4, cuatro: 4,
  cinco: 5, five: 5,
  seis: 6, six: 6,
  sete: 7, seven: 7, siete: 7,
  oito: 8, eight: 8, ocho: 8,
  nove: 9, nine: 9, nueve: 9,
  dez: 10, ten: 10, diez: 10,
  onze: 11, eleven: 11, once: 11,
  doze: 12, twelve: 12, doce: 12,
};

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/[“”"'.!?]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function count(token: string | undefined): number | null {
  if (!token) return null;
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  return NUMBER_WORDS[token] ?? null;
}

/**
 * Parses a sentence into a board command. `providers` are the known CLI ids
 * and display names (e.g. ["claude", "codex", "Claude Code"]); `agents` are the
 * titles on the board, matched longest first for handoffs.
 */
export function parseBoardCommand(input: string, options: { providers: Array<{ id: string; names: string[] }>; agents: string[] }): BoardCommand | null {
  const text = fold(input);
  if (!text || text.length > 200) return null;

  const providerIn = (fragment: string): string | null => {
    for (const provider of options.providers) {
      if (provider.names.some((name) => new RegExp(`(^|\\s)${fold(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(fragment))) return provider.id;
    }
    return null;
  };

  // spawn: "crie 4 agentes claude", "spawn 5 claude code agents", "crea 3 agentes codex"
  const spawn = text.match(/^(?:crie|criar|cria|lance|lancar|abra|spawn|create|launch|start|crea|lanza)\s+(\d+|[a-z]+)\s+(?:novos?\s+|new\s+|nuevos?\s+)?(.*?)(?:agentes?|agents?|consoles?|terminais|terminales?)\b\s*(.*)$/);
  if (spawn) {
    const n = count(spawn[1]);
    if (n) return { kind: 'spawn', count: Math.min(12, n), provider: providerIn(`${spawn[2]} ${spawn[3]}`.trim()) };
  }
  const single = text.match(/^(?:novo agente|crie um agente|new agent|create an agent|nuevo agente|crea un agente)\s*(.*)$/);
  if (single) return { kind: 'spawn', count: 1, provider: providerIn(single[1]) };

  // handoff: "passe a tarefa do X para o Y", "pass X's task to Y", "pasa la tarea de X a Y"
  const agents = [...options.agents].sort((a, b) => b.length - a.length);
  const findAgent = (fragment: string): string | null => agents.find((title) => fragment.includes(fold(title))) ?? null;
  const handoff = text.match(/^(?:passe|passa|passar|transfira|pass|hand|move|pasa|pasar|transfiere)\s+(?:a\s+)?(?:tarefa|task|tarea|the task|la tarea)?\s*(?:do|da|de|from|of)?\s*(.+?)\s+(?:para|pro|pra|to|a)\s+(.+)$/);
  if (handoff) {
    const from = findAgent(handoff[1]);
    const to = findAgent(handoff[2]);
    if (from && to && from !== to) return { kind: 'handoff', from, to };
  }

  // Whole-sentence commands only: "pause the deploy and explain" stays a message.
  if (/^(?:pause|pausar|pausa|pause all|pause everyone|pause todos|pausar todos|pausa todos|pause os agentes|pausar os agentes|pause the agents|pausa a todos|congele todos|freeze all)$/.test(text)) return { kind: 'pause', paused: true };
  if (/^(?:resume all|resume everyone|resume the agents|retome todos|retomar todos|continue todos|retome os agentes|retomar os agentes|reanuda todos|reanudar todos|reanuda a todos)$/.test(text)) return { kind: 'pause', paused: false };

  if (/^(?:abra o |abrir o |abre o |open the |open |abre el |mostre o |show the )?(?:mapa da equipe|team map|mission map|mapa del equipo)$/.test(text)) return { kind: 'open', target: 'team-map' };
  if (/^(?:abra o |abre el |open the |add an? |adicione o |crie o )?(?:orquestrador|orchestrator|orquestador|painel do lider|leader panel|panel del lider)$/.test(text)) return { kind: 'open', target: 'orchestrator' };
  if (/^(?:monte uma equipe|montar equipe|montar uma equipe|build a team|arma un equipo|armar equipo|armar un equipo)$/.test(text)) return { kind: 'open', target: 'team-composer' };
  if (/^(?:abra o |abrir o |open |abre )?(?:foco|focus)$/.test(text)) return { kind: 'open', target: 'focus' };
  if (/^(?:abra a |abrir a |open |abre la )?(?:conversa|chat|conversacion)$/.test(text)) return { kind: 'open', target: 'chat' };
  if (/^(?:abra a |open |abre la )?(?:memoria|memory|segundo cerebro|second brain)$/.test(text)) return { kind: 'open', target: 'memory' };
  if (/^(?:abra as |open |abre las )?(?:partituras|scores)$/.test(text)) return { kind: 'open', target: 'scores' };
  if (/^(?:agrupe|agrupar|group|group these|agrupa)(?:\s+(?:a selecao|selection|la seleccion|isso|these|esto))?$/.test(text)) return { kind: 'group' };

  const note = input.trim().match(/^(?:nota|note|anote|anota|nova nota|new note|nueva nota)\s*[:,-]?\s+(.+)$/iu);
  if (note) return { kind: 'note', text: note[1].trim().slice(0, 2_000) };
  return null;
}

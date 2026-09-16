import type { ComputerAccessibility, ComputerInteraction } from '../../../contracts/schemas/computer.schema.js';
import { conversationIsOpen, conversationRoot, type ConversationIdentity } from './reply-scope.js';

type Control = ComputerInteraction['element'];
type Navigation = {
  read(): Promise<ComputerAccessibility>;
  press(control: Control): Promise<void>;
  search(control: Control, query: string): Promise<void>;
};

const label = (value: string) => value.replace(/[\u200e\u200f]/g, '').trim().toLowerCase();
const searchLabels = new Set(['search', 'search chats', 'search or start a new chat', 'search or start new chat', 'search conversations', 'buscar', 'pesquisar', 'buscar conversas', 'pesquisar conversas']);
const resultLabels = new Set(['search results', 'results', 'contacts', 'chats', 'resultados da pesquisa', 'resultados de pesquisa', 'resultados de busca', 'resultados', 'contatos', 'conversas', 'resultados de busqueda', 'resultados de búsqueda', 'contactos']);

/** Search is navigation only: never choose a header, fuzzy match, message or Send. */
export async function openNativeConversation(identity: ConversationIdentity, io: Navigation): Promise<ComputerAccessibility> {
  const root = conversationRoot(identity);
  const recipient = identity.recipient.name;
  if (!recipient.trim() || recipient.length > 200 || /[\r\n\u0000-\u001f]/.test(recipient)) throw new Error('The approved recipient cannot be used as a bounded search query.');
  const outsideConversation = (id: string) => !id.startsWith(root + '.') && id !== root;
  const read = async () => {
    const tree = await io.read();
    if (!tree.available || tree.truncated) throw new Error('Complete native navigation is unavailable.');
    return tree;
  };
  let tree = await read();
  if (conversationIsOpen(tree, identity)) return tree;
  const result = (tree: ComputerAccessibility) => {
    const groups = tree.elements.filter(e => outsideConversation(e.id) && resultLabels.has(label(e.name)) && /Group|List|Table|Outline/.test(e.role));
    const matches = tree.elements.filter(e => outsideConversation(e.id) && e.name === recipient && e.enabled && !e.protected && e.actions.includes('press') && !e.actions.includes('fill') && groups.some(g => e.id.startsWith(g.id + '.')));
    if (matches.length > 1) throw new Error('The recipient search is ambiguous. No conversation was selected.');
    return matches[0];
  };
  let candidate = result(tree);
  if (!candidate) {
    const controls = tree.elements.filter(e => outsideConversation(e.id) && e.enabled && !e.protected && searchLabels.has(label(e.name)) && (e.actions.includes('press') || e.actions.includes('fill')));
    if (controls.length !== 1) throw new Error('A unique native conversation search control is required.');
    const control = controls[0];
    await io.press({ id: control.id, role: control.role, name: control.name, value: control.value });
    tree = await read();
    if (conversationIsOpen(tree, identity)) return tree;
    const focused = tree.elements.filter(e => outsideConversation(e.id) && e.focused && e.enabled && !e.protected && searchLabels.has(label(e.name)));
    if (focused.length !== 1) throw new Error('The native search field did not receive focus. No query was typed.');
    if (focused[0].value && focused[0].value !== recipient) throw new Error('An existing search query was preserved.');
    if (!focused[0].value) await io.search({ id: focused[0].id, role: focused[0].role, name: focused[0].name, value: '' }, recipient);
    for (let attempt = 0; attempt < 8; attempt++) {
      tree = await read();
      candidate = result(tree);
      if (candidate) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  if (!candidate) throw new Error('The exact approved recipient was not found.');
  await io.press({ id: candidate.id, role: candidate.role, name: candidate.name, value: candidate.value });
  for (let attempt = 0; attempt < 8; attempt++) {
    tree = await read();
    if (conversationIsOpen(tree, identity)) return tree;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('The selected conversation header did not match the approved recipient. Nothing was sent.');
}

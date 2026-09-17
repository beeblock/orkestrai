import type { CreativeBrandDefinition } from '../contracts/schemas/creative-brand.schema.js';
import type { CreativeMediaReference } from './types.js';
export type CreativeBrandSnapshot = { definition: CreativeBrandDefinition; assets: CreativeMediaReference[]; digest: string };
export type CreativeBrandKit = { id: string; workspaceId: string; familyId: string; version: number; revision: number; state: 'draft' | 'locked'; definition: CreativeBrandDefinition; snapshot: CreativeBrandSnapshot | null };
export type CreativeBrandLibraryItem = CreativeBrandKit & { workspaceName: string };
export function brandBrief(kit: CreativeBrandKit) {
  const d = kit.definition;
  return [`# ${d.name} (v${kit.version})`, d.description, d.colors.length ? `Palette: ${d.colors.map(color => `${color.name}: ${color.value}`).join(', ')}` : '', d.tone ? `Communication tone: ${d.tone}` : '', d.rules, ...d.assets.map(asset => `${asset.kind}: ${asset.label} (${asset.path})`), `Approved brand version: ${kit.id}. Fingerprint: ${kit.snapshot?.digest ?? ''}. Preserve the approved logo, product appearance, colors and communication rules.`].filter(Boolean).join('\n\n');
}

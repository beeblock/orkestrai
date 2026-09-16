import { describe, expect, it } from 'vitest';
import { nativeFileControl } from '$lib/modules/agent-room/application/adapters/computers/native-file-controls.js';
import type { ComputerAccessibility } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';

const control = { id: '0.9999.1.2', role: 'AXStaticText', name: 'Approved contact', value: '', enabled: true, protected: false, focused: false, actions: [] } as const;
const tree = (elements: ComputerAccessibility['elements']): ComputerAccessibility => ({ available: true, truncated: false, elements });

describe('Specialized native file-picker binding', () => {
  it('requires two fresh unique semantic identities and changes only the engine-local id', () => {
    const source = tree([{ ...control, actions: [] }]), target = tree([{ ...control, id: '0.1.0', actions: [] }]);
    expect(nativeFileControl(control, source, target)).toEqual({ id: '0.1.0', role: 'AXStaticText', name: 'Approved contact', value: '' });
  });
  it.each(['wrong-recipient', 'ambiguous-target', 'ambiguous-source', 'stale-source-id', 'incomplete', 'protected'])('refuses %s without broadening the contact grant', reason => {
    const source = tree([{ ...control, actions: [] }]), target = tree([{ ...control, id: '0.1.0', actions: [] }]);
    if (reason === 'wrong-recipient') target.elements[0].name = 'Other person';
    if (reason === 'ambiguous-target') target.elements.push({ ...target.elements[0], id: '0.2.0' });
    if (reason === 'ambiguous-source') source.elements.push({ ...source.elements[0], id: '0.9999.1.3' });
    if (reason === 'stale-source-id') source.elements[0].id = '0.9999.1.3';
    if (reason === 'incomplete') target.truncated = true;
    if (reason === 'protected') target.elements[0].protected = true;
    expect(() => nativeFileControl(control, source, target)).toThrow();
  });
});

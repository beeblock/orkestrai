import { describe, expect, it } from 'vitest';
import { resolveDesignNumericInput } from '$lib/modules/agent-room/domain/design-numeric.js';

describe('Design numeric expressions', () => {
  it('supports arithmetic, units, percentages and relative edits', () => {
    expect(resolveDesignNumericInput('10 + 6 * 2', 0)).toBe(22);
    expect(resolveDesignNumericInput('(10 + 6) * 2px', 0)).toBe(32);
    expect(resolveDesignNumericInput('25%', 80, { percentBase: 400 })).toBe(100);
    expect(resolveDesignNumericInput('+12', 48)).toBe(60);
    expect(resolveDesignNumericInput('*1.5', 40)).toBe(60);
  });

  it('bounds results and rejects invalid or dangerous expressions', () => {
    expect(resolveDesignNumericInput('-100', 0, { min: 1 })).toBe(1);
    expect(resolveDesignNumericInput('10000', 0, { max: 500 })).toBe(500);
    expect(() => resolveDesignNumericInput('10 / 0', 0)).toThrow('Division by zero');
    expect(() => resolveDesignNumericInput('globalThis.alert(1)', 0)).toThrow('Invalid numeric expression');
    expect(() => resolveDesignNumericInput('1; process.exit()', 0)).toThrow('Invalid numeric expression');
  });
});

export type DesignNumericOptions = {
  min?: number;
  max?: number;
  percentBase?: number;
};

type Token = { type: 'number'; value: number } | { type: 'operator'; value: '+' | '-' | '*' | '/' | '(' | ')' };

function tokenize(raw: string, percentBase: number): Token[] {
  const source = raw.trim().toLowerCase().replace(/,/g, '.');
  if (!source || source.length > 120) throw new Error('Invalid numeric expression.');
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor += 1;
      continue;
    }
    const operator = source[cursor];
    if ('+-*/()'.includes(operator)) {
      tokens.push({ type: 'operator', value: operator as '+' | '-' | '*' | '/' | '(' | ')' });
      cursor += 1;
      continue;
    }
    const match = source.slice(cursor).match(/^\d+(?:\.\d+)?/);
    if (!match) throw new Error('Invalid numeric expression.');
    cursor += match[0].length;
    let value = Number(match[0]);
    if (source.slice(cursor, cursor + 2) === 'px') cursor += 2;
    else if (source[cursor] === '%') {
      value = percentBase * value / 100;
      cursor += 1;
    }
    tokens.push({ type: 'number', value });
  }
  return tokens;
}

function evaluate(tokens: Token[]): number {
  let cursor = 0;
  const expression = (): number => {
    let value = term();
    while (tokens[cursor]?.type === 'operator' && (tokens[cursor].value === '+' || tokens[cursor].value === '-')) {
      const operator = tokens[cursor++].value;
      const right = term();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const term = (): number => {
    let value = unary();
    while (tokens[cursor]?.type === 'operator' && (tokens[cursor].value === '*' || tokens[cursor].value === '/')) {
      const operator = tokens[cursor++].value;
      const right = unary();
      if (operator === '/' && right === 0) throw new Error('Division by zero.');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };
  const unary = (): number => {
    const token = tokens[cursor];
    if (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
      cursor += 1;
      const value = unary();
      return token.value === '-' ? -value : value;
    }
    if (token?.type === 'operator' && token.value === '(') {
      cursor += 1;
      const value = expression();
      if (tokens[cursor]?.type !== 'operator' || tokens[cursor].value !== ')') throw new Error('Unclosed numeric expression.');
      cursor += 1;
      return value;
    }
    if (token?.type !== 'number') throw new Error('Invalid numeric expression.');
    cursor += 1;
    return token.value;
  };
  const value = expression();
  if (cursor !== tokens.length || !Number.isFinite(value)) throw new Error('Invalid numeric expression.');
  return value;
}

export function resolveDesignNumericInput(raw: string, current: number, options: DesignNumericOptions = {}): number {
  const trimmed = raw.trim();
  const relative = /^[+*/]/.test(trimmed);
  const source = relative ? `${current}${trimmed}` : trimmed;
  const value = evaluate(tokenize(source, options.percentBase ?? current));
  const bounded = Math.min(options.max ?? Number.POSITIVE_INFINITY, Math.max(options.min ?? Number.NEGATIVE_INFINITY, value));
  return Math.round(bounded * 1_000) / 1_000;
}

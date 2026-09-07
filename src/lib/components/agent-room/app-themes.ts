export const APP_THEME_TOKEN_KEYS = [
  'page',
  'canvas',
  'sidebar',
  'surface',
  'surfaceRaised',
  'surfaceSubtle',
  'text',
  'textSoft',
  'textMuted',
  'border',
  'borderStrong',
  'accent',
  'accentSoft',
  'accentContrast',
  'secondary',
  'success',
  'warning',
  'danger',
  'grid',
  'edge',
] as const;

export type AppThemeToken = (typeof APP_THEME_TOKEN_KEYS)[number];
export type AppThemeTokens = Record<AppThemeToken, string>;

export type AppTheme = {
  id: string;
  name: string;
  dark: boolean;
  builtin: boolean;
  tokens: AppThemeTokens;
};

export type CustomAppTheme = Omit<AppTheme, 'builtin'>;

export const DEFAULT_APP_THEME_ID = 'orkestrai-dark';
export const APP_THEME_SETTING = 'appTheme';
export const CUSTOM_APP_THEMES_SETTING = 'customAppThemes';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const BUILTIN_APP_THEMES: AppTheme[] = [
  {
    id: DEFAULT_APP_THEME_ID,
    name: 'Orkestrai Dark',
    dark: true,
    builtin: true,
    tokens: {
      page: '#0d0f12', canvas: '#0a0d10', sidebar: '#111419', surface: '#171b20', surfaceRaised: '#20262d', surfaceSubtle: '#12161b',
      text: '#f4f5f6', textSoft: '#c2c7cd', textMuted: '#85909a', border: '#2a3037', borderStrong: '#404852',
      accent: '#f3c34f', accentSoft: '#302915', accentContrast: '#17130a', secondary: '#63b3d1', success: '#42c990', warning: '#e7b557',
      danger: '#e26670', grid: '#252b31', edge: '#59636e',
    },
  },
  {
    id: 'graphite-dark',
    name: 'Graphite',
    dark: true,
    builtin: true,
    tokens: {
      page: '#111214', canvas: '#151619', sidebar: '#18191d', surface: '#202126', surfaceRaised: '#292b31', surfaceSubtle: '#1b1c20',
      text: '#f2f3f5', textSoft: '#c5c8ce', textMuted: '#898e98', border: '#30333a', borderStrong: '#464a54',
      accent: '#e5e7eb', accentSoft: '#303238', accentContrast: '#151619', secondary: '#65a9ff', success: '#45c992', warning: '#e7b657',
      danger: '#ed6a70', grid: '#303238', edge: '#5d626d',
    },
  },
  {
    id: 'midnight-dark',
    name: 'Midnight',
    dark: true,
    builtin: true,
    tokens: {
      page: '#080d14', canvas: '#07111f', sidebar: '#0b1624', surface: '#122238', surfaceRaised: '#19314f', surfaceSubtle: '#0e1b2d',
      text: '#edf6ff', textSoft: '#b8cadb', textMuted: '#7890a8', border: '#203b5d', borderStrong: '#31587f',
      accent: '#5fb4ff', accentSoft: '#123b61', accentContrast: '#06111f', secondary: '#57d4c7', success: '#45cf91', warning: '#f1be60',
      danger: '#f16d76', grid: '#173251', edge: '#3d6f9d',
    },
  },
  {
    id: 'orkestrai-light',
    name: 'Orkestrai Light',
    dark: false,
    builtin: true,
    tokens: {
      page: '#f5f6f7', canvas: '#edf0f2', sidebar: '#fbfcfd', surface: '#ffffff', surfaceRaised: '#e7ebee', surfaceSubtle: '#f2f4f5',
      text: '#171a1f', textSoft: '#424951', textMuted: '#606a74', border: '#d4d9de', borderStrong: '#adb5bd',
      accent: '#8a6300', accentSoft: '#fff1c7', accentContrast: '#ffffff', secondary: '#116f8f', success: '#167a55', warning: '#8a5c00',
      danger: '#b83440', grid: '#cbd1d6', edge: '#7d8791',
    },
  },
];

function validTokenSet(value: unknown): value is AppThemeTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Record<string, unknown>;
  return APP_THEME_TOKEN_KEYS.every((key) => typeof tokens[key] === 'string' && HEX_COLOR.test(tokens[key] as string));
}

function normalizeCustomTheme(value: unknown): CustomAppTheme | null {
  if (!value || typeof value !== 'object') return null;
  const theme = value as Partial<CustomAppTheme>;
  const id = String(theme.id ?? '').trim();
  const name = String(theme.name ?? '').trim().slice(0, 48);
  if (!/^custom-[a-z0-9-]{6,80}$/i.test(id) || !name || typeof theme.dark !== 'boolean' || !validTokenSet(theme.tokens)) return null;
  return { id, name, dark: theme.dark, tokens: { ...theme.tokens } };
}

export function parseCustomAppThemes(raw: unknown): CustomAppTheme[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((item) => {
      const theme = normalizeCustomTheme(item);
      if (!theme || seen.has(theme.id)) return [];
      seen.add(theme.id);
      return [theme];
    }).slice(0, 24);
  } catch {
    return [];
  }
}

export function serializeCustomAppThemes(themes: CustomAppTheme[]): string {
  return JSON.stringify(themes.flatMap((theme) => normalizeCustomTheme(theme) ?? []).slice(0, 24));
}

export function allAppThemes(settings: Record<string, string>): AppTheme[] {
  return [
    ...BUILTIN_APP_THEMES,
    ...parseCustomAppThemes(settings[CUSTOM_APP_THEMES_SETTING]).map((theme) => ({ ...theme, builtin: false })),
  ];
}

export function resolveAppTheme(settings: Record<string, string>): AppTheme {
  const themes = allAppThemes(settings);
  return themes.find((theme) => theme.id === settings[APP_THEME_SETTING]) ?? themes[0];
}

export function duplicateAppTheme(theme: AppTheme, id = `custom-${crypto.randomUUID()}`): CustomAppTheme {
  return { id, name: `${theme.name} Copy`, dark: theme.dark, tokens: { ...theme.tokens } };
}

/**
 * Tokens derivados: sao usados pela UI mas nunca foram autorais.
 *
 * Ficam FORA de APP_THEME_TOKEN_KEYS de proposito. Aquela lista define o que o
 * editor de temas mostra e o que `validTokenSet` exige em um tema customizado —
 * incluir chaves novas invalidaria todos os temas que o usuario ja salvou.
 */
function derivedThemeVariables(theme: AppTheme): Record<string, string> {
  const token = theme.tokens;
  const ink = theme.dark ? '#000000' : token.text;
  return {
    '--app-hover': `color-mix(in srgb, ${token.text} 8%, transparent)`,
    '--app-info': token.secondary,
    '--app-info-soft': `color-mix(in srgb, ${token.secondary} 16%, transparent)`,
    '--app-danger-soft': `color-mix(in srgb, ${token.danger} 16%, transparent)`,
    '--app-warning-soft': `color-mix(in srgb, ${token.warning} 16%, transparent)`,
    '--app-success-soft': `color-mix(in srgb, ${token.success} 16%, transparent)`,
    '--app-surface-muted': token.surfaceSubtle,
    '--app-code-bg': token.surfaceSubtle,
    '--app-code-text': token.textSoft,
    '--app-ring': token.accent,
    // Escura nos dois temas: os SVGs de provedor sao brancos e sumiriam sobre
    // uma superficie clara. Ver .app-logo-plate em app.css.
    '--app-logo-plate': '#20242c',
    // Elevacao: preta no escuro, tingida com a cor de texto no claro (sombra
    // preta pura vira borrao cinza sobre fundo claro).
    '--app-shadow-card': theme.dark
      ? `0 1px 2px color-mix(in srgb, ${ink} 28%, transparent), 0 10px 28px color-mix(in srgb, ${ink} 24%, transparent)`
      : `0 1px 2px color-mix(in srgb, ${ink} 6%, transparent), 0 8px 24px color-mix(in srgb, ${ink} 7%, transparent)`,
    '--app-shadow-panel': theme.dark
      ? `0 8px 24px color-mix(in srgb, ${ink} 24%, transparent)`
      : `0 8px 24px color-mix(in srgb, ${ink} 9%, transparent)`,
    '--app-shadow-overlay': theme.dark
      ? `0 14px 38px color-mix(in srgb, ${ink} 30%, transparent)`
      : `0 14px 38px color-mix(in srgb, ${ink} 12%, transparent)`,
  };
}

export function appThemeCssVariables(theme: AppTheme): Record<string, string> {
  const token = theme.tokens;
  return {
    ...derivedThemeVariables(theme),
    '--page': token.page,
    '--surface': token.surface,
    '--surface-raised': token.surfaceRaised,
    '--surface-subtle': token.surfaceSubtle,
    '--copy': token.text,
    '--copy-soft': token.textSoft,
    '--copy-muted': token.textMuted,
    '--line': token.border,
    '--line-strong': token.borderStrong,
    '--violet': token.accent,
    '--violet-soft': token.accentSoft,
    '--cyan': token.secondary,
    '--success': token.success,
    '--background': token.page,
    '--foreground': token.text,
    '--card': token.surface,
    '--card-foreground': token.text,
    '--popover': token.surfaceRaised,
    '--popover-foreground': token.text,
    '--primary': token.accent,
    '--primary-foreground': token.accentContrast,
    '--secondary': token.surfaceRaised,
    '--secondary-foreground': token.text,
    '--muted': token.surfaceRaised,
    '--muted-foreground': token.textMuted,
    '--accent': token.accentSoft,
    '--accent-foreground': token.text,
    '--destructive': token.danger,
    '--destructive-foreground': '#ffffff',
    '--border': token.border,
    '--input': token.border,
    '--ring': token.accent,
    '--sidebar': token.sidebar,
    '--sidebar-foreground': token.textSoft,
    '--sidebar-primary': token.accent,
    '--sidebar-primary-foreground': token.accentContrast,
    '--sidebar-accent': token.accentSoft,
    '--sidebar-accent-foreground': token.text,
    '--sidebar-border': token.border,
    '--sidebar-ring': token.accent,
    '--app-page': token.page,
    '--app-canvas': token.canvas,
    '--app-sidebar': token.sidebar,
    '--app-surface': token.surface,
    '--app-surface-raised': token.surfaceRaised,
    '--app-surface-subtle': token.surfaceSubtle,
    '--app-text': token.text,
    '--app-text-soft': token.textSoft,
    '--app-text-muted': token.textMuted,
    '--app-border': token.border,
    '--app-border-strong': token.borderStrong,
    '--app-accent': token.accent,
    '--app-accent-soft': token.accentSoft,
    '--app-accent-contrast': token.accentContrast,
    '--app-secondary': token.secondary,
    '--app-success': token.success,
    '--app-warning': token.warning,
    '--app-danger': token.danger,
    '--app-grid': token.grid,
    '--app-edge': token.edge,
  };
}

/**
 * Chave do cache lido pelo script inline de `src/app.html`.
 *
 * As settings chegam por fetch, entao a primeira pintura acontece antes de
 * sabermos o tema. Sem esse cache as rotas com SSR piscam o tema padrao.
 * Se mudar o formato, suba a versao aqui E no script do app.html.
 */
export const APP_THEME_CACHE_KEY = 'orkestrai.theme.v1';

export function applyAppTheme(settings: Record<string, string>, root?: HTMLElement): AppTheme {
  const theme = resolveAppTheme(settings);
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  if (!target) return theme;
  const variables = appThemeCssVariables(theme);
  target.dataset.appTheme = theme.id;
  // `dark` e o gatilho da variante dark: do Tailwind; `light` da ao tema claro
  // uma casa em CSS (:root.light em app.css) para antes da hidratacao.
  target.classList.toggle('dark', theme.dark);
  target.classList.toggle('light', !theme.dark);
  target.style.colorScheme = theme.dark ? 'dark' : 'light';
  for (const [key, value] of Object.entries(variables)) target.style.setProperty(key, value);
  const themeColor = typeof document !== 'undefined' ? document.querySelector<HTMLMetaElement>('meta[name="theme-color"]') : null;
  if (themeColor) themeColor.content = theme.tokens.page;
  if (!root) cacheAppTheme(theme, variables);
  return theme;
}

/** Guarda o tema resolvido para o bootstrap sincrono da proxima carga. */
function cacheAppTheme(theme: AppTheme, variables: Record<string, string>): void {
  try {
    localStorage.setItem(APP_THEME_CACHE_KEY, JSON.stringify({ id: theme.id, dark: theme.dark, vars: variables }));
  } catch {
    // Storage indisponivel (modo privado, storage bloqueado): so perdemos o
    // anti-flash, o tema continua sendo aplicado na hidratacao.
  }
}

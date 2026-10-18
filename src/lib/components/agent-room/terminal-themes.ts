import type { ITheme } from '@xterm/xterm';

/** Temas xterm persistidos por terminal em payload.theme. */
export type TerminalThemeName =
  | 'dark'
  | 'midnight'
  | 'obsidian'
  | 'dracula'
  | 'nord'
  | 'solarized'
  | 'light'
  | 'tokyo-night'
  | 'catppuccin'
  | 'gruvbox'
  | 'one-dark'
  | 'github-light'
  | 'monokai'
  | 'ayu'
  | 'rose-pine'
  | 'solarized-light';

export type TerminalThemeDefinition = {
  label: string;
  theme: ITheme;
};

export const TERMINAL_THEMES: Record<TerminalThemeName, TerminalThemeDefinition> = {
  // Default: the canvas surface itself, warm ink and gold cursor, so a terminal reads as part of its node.
  dark: {
    label: 'Orkestrai',
    theme: {
      background: '#121110', foreground: '#e9e4db', cursor: '#e8b84a', cursorAccent: '#121110', selectionBackground: '#3d3627',
      black: '#1f1d1a', red: '#f07178', green: '#8fd18b', yellow: '#e8b84a', blue: '#7cb7e6', magenta: '#c9a3f2', cyan: '#7fd3c8', white: '#d9d3c7',
      brightBlack: '#6f685d', brightRed: '#ff8f95', brightGreen: '#a9e3a5', brightYellow: '#f2c86a', brightBlue: '#9ccbf2', brightMagenta: '#dbbcf7', brightCyan: '#9fe2d9', brightWhite: '#fbf7f0',
    },
  },
  midnight: {
    label: 'Midnight',
    theme: {
      background: '#090820', foreground: '#e6e6eb', cursor: '#e6e6eb', selectionBackground: '#35334f',
      black: '#18172d', red: '#ff6b7a', green: '#61e5a7', yellow: '#ffc857', blue: '#58a6ff', magenta: '#d68cff', cyan: '#58d6ff', white: '#d9d9e3',
      brightBlack: '#68677a', brightRed: '#ff8c98', brightGreen: '#84efbc', brightYellow: '#ffd77a', brightBlue: '#80bcff', brightMagenta: '#e2adff', brightCyan: '#83e2ff', brightWhite: '#ffffff',
    },
  },
  obsidian: {
    label: 'Obsidian',
    theme: {
      background: '#000000', foreground: '#f2f2f2', cursor: '#ffffff', selectionBackground: '#2b2b2b',
      black: '#000000', red: '#ff5c57', green: '#5af78e', yellow: '#f3f99d', blue: '#57c7ff', magenta: '#ff6ac1', cyan: '#9aedfe', white: '#f1f1f0',
      brightBlack: '#686868', brightRed: '#ff5c57', brightGreen: '#5af78e', brightYellow: '#f3f99d', brightBlue: '#57c7ff', brightMagenta: '#ff6ac1', brightCyan: '#9aedfe', brightWhite: '#ffffff',
    },
  },
  dracula: {
    label: 'Dracula',
    theme: {
      background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
  },
  nord: {
    label: 'Nord',
    theme: {
      background: '#2e3440', foreground: '#d8dee9', cursor: '#88c0d0', selectionBackground: '#434c5e',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
    },
  },
  solarized: {
    label: 'Solarized Dark',
    theme: {
      background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
  },
  light: {
    label: 'Paper',
    theme: {
      background: '#f7f7f4', foreground: '#202126', cursor: '#202126', selectionBackground: '#c9d4e3',
      black: '#202126', red: '#b4232f', green: '#237a49', yellow: '#8a6100', blue: '#175cd3', magenta: '#8f3db5', cyan: '#087f8c', white: '#e7e7e2',
      brightBlack: '#5f626b', brightRed: '#d92d3a', brightGreen: '#2f9259', brightYellow: '#a87500', brightBlue: '#2970ff', brightMagenta: '#a84ec9', brightCyan: '#0994a3', brightWhite: '#ffffff',
    },
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    theme: {
      background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selectionBackground: '#33467c',
      black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
      brightBlack: '#414868', brightRed: '#ff899d', brightGreen: '#9fe044', brightYellow: '#faba4a', brightBlue: '#8db0ff', brightMagenta: '#c7a9ff', brightCyan: '#a4daff', brightWhite: '#c0caf5',
    },
  },
  catppuccin: {
    label: 'Catppuccin Mocha',
    theme: {
      background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#45475a',
      black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
      brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8',
    },
  },
  gruvbox: {
    label: 'Gruvbox Dark',
    theme: {
      background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: '#504945',
      black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
      brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
    },
  },
  'one-dark': {
    label: 'One Dark',
    theme: {
      background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selectionBackground: '#3e4451',
      black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
      brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
    },
  },
  'github-light': {
    label: 'GitHub Light',
    theme: {
      background: '#ffffff', foreground: '#24292f', cursor: '#0969da', selectionBackground: '#add6ff',
      black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#d0d7de',
      brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#f6f8fa',
    },
  },
  monokai: {
    label: 'Monokai',
    theme: {
      background: '#272822', foreground: '#fdfff1', cursor: '#c0c1b5', selectionBackground: '#57584f',
      black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#e6db74', blue: '#fd971f', magenta: '#ae81ff', cyan: '#66d9ef', white: '#fdfff1',
      brightBlack: '#6e7066', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#e6db74', brightBlue: '#fd971f', brightMagenta: '#ae81ff', brightCyan: '#66d9ef', brightWhite: '#fdfff1',
    },
  },
  ayu: {
    label: 'Ayu Dark',
    theme: {
      background: '#0b0e14', foreground: '#bfbdb6', cursor: '#e6b450', selectionBackground: '#409fff',
      black: '#11151c', red: '#ea6c73', green: '#7fd962', yellow: '#f9af4f', blue: '#53bdfa', magenta: '#cda1fa', cyan: '#90e1c6', white: '#c7c7c7',
      brightBlack: '#686868', brightRed: '#f07178', brightGreen: '#aad94c', brightYellow: '#ffb454', brightBlue: '#59c2ff', brightMagenta: '#d2a6ff', brightCyan: '#95e6cb', brightWhite: '#ffffff',
    },
  },
  'rose-pine': {
    label: 'Rosé Pine',
    theme: {
      background: '#191724', foreground: '#e0def4', cursor: '#e0def4', selectionBackground: '#403d52',
      black: '#26233a', red: '#eb6f92', green: '#31748f', yellow: '#f6c177', blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4',
      brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#31748f', brightYellow: '#f6c177', brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ebbcba', brightWhite: '#e0def4',
    },
  },
  'solarized-light': {
    label: 'Solarized Light',
    theme: {
      background: '#fdf6e3', foreground: '#657b83', cursor: '#657b83', selectionBackground: '#eee8d5',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#bbb5a2',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
  },
};

export const TERMINAL_THEME_ORDER = Object.keys(TERMINAL_THEMES) as TerminalThemeName[];

export function isTerminalThemeName(value: string | undefined): value is TerminalThemeName {
  return Boolean(value && value in TERMINAL_THEMES);
}

export function normalizeTerminalTheme(value: string | undefined): TerminalThemeName {
  return isTerminalThemeName(value) ? value : 'dark';
}

export function nextTerminalTheme(current?: string): TerminalThemeName {
  const normalized = normalizeTerminalTheme(current);
  const index = TERMINAL_THEME_ORDER.indexOf(normalized);
  return TERMINAL_THEME_ORDER[(index + 1) % TERMINAL_THEME_ORDER.length];
}

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'proxyboy-theme';
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: light)';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
type ThemeRoot = {
  classList: {
    toggle: (token: string, force?: boolean) => void;
  };
  style: {
    colorScheme?: string;
  };
};

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

function getStorage(): ThemeStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'light' : 'dark';
}

export function resolveThemePreference(theme: ThemePreference): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function loadThemePreference(): ThemePreference {
  const storage = getStorage();
  if (!storage) {
    return 'system';
  }

  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(value)) {
      return value;
    }
  } catch {
    // Ignore storage failures and keep the renderer usable.
  }

  return 'system';
}

export function persistThemePreference(theme: ThemePreference): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures and keep the renderer usable.
  }
}

export function applyResolvedTheme(
  theme: ResolvedTheme,
  root: ThemeRoot | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!root) {
    return;
  }

  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  root.style.colorScheme = theme;
}

export function applyThemePreference(theme: ThemePreference): ResolvedTheme {
  const resolvedTheme = resolveThemePreference(theme);
  applyResolvedTheme(resolvedTheme);
  return resolvedTheme;
}

export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
  const listener = () => onChange();

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }

  mediaQuery.addListener(listener);
  return () => mediaQuery.removeListener(listener);
}

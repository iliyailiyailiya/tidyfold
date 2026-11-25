export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'tidyfold-theme';

/** Saved choice first, then the OS preference. Browser-only app. */
export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Storage may be unavailable (private mode); fall back to OS preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The `.dark` class is what the Tailwind v4 `@custom-variant dark` hooks into. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Non-fatal: the theme still applies for this session.
  }
}

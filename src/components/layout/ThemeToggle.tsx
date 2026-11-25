import { useLayoutEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyTheme, readTheme, saveTheme, type Theme } from '@/lib/theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useLayoutEffect(() => applyTheme(theme), [theme]);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={() => {
        setTheme(next);
        saveTheme(next);
      }}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

// Apply the appearance settings to the document: light/dark UI theme ('auto'
// follows the OS preference), UI scale, and the diagram renderer choice.
import { useEffect, useState } from 'react';
import { setDiagramRenderer } from '../engine/export/diagramRenderer';
import type { AppSettings } from '../store/settings';

export type ResolvedUiTheme = 'dark' | 'light';

export function useUiAppearance(
  { uiTheme, uiScale, diagramRenderer }: Pick<AppSettings, 'uiTheme' | 'uiScale' | 'diagramRenderer'>,
): ResolvedUiTheme {
  const [resolved, setResolved] = useState<ResolvedUiTheme>('dark');

  useEffect(() => { setDiagramRenderer(diagramRenderer); }, [diagramRenderer]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const next: ResolvedUiTheme =
        uiTheme === 'light' ? 'light' :
        uiTheme === 'dark'  ? 'dark'  :
        mq.matches ? 'dark' : 'light';
      setResolved(next);
      document.documentElement.classList.toggle('theme-light', next === 'light');
    };
    apply();
    if (uiTheme === 'auto') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [uiTheme]);

  // --ui-scale drives `html { zoom }` in global.css.
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  }, [uiScale]);

  return resolved;
}

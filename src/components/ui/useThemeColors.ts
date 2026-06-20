import { useEffect, useState } from 'react';

/** Resolves a list of CSS custom properties on :root to actual computed colors
 * (amCharts needs am5.color()-compatible hex/rgb, not raw CSS var strings),
 * and re-resolves whenever the theme class/attribute on <html> changes. */
export function useThemeColors(varNames: string[]): Record<string, string> {
  const resolve = () => {
    const styles = getComputedStyle(document.documentElement);
    const result: Record<string, string> = {};
    for (const name of varNames) {
      result[name] = styles.getPropertyValue(name).trim() || '#888888';
    }
    return result;
  };

  const [colors, setColors] = useState<Record<string, string>>(resolve);

  useEffect(() => {
    setColors(resolve());
    const observer = new MutationObserver(() => setColors(resolve()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varNames.join(',')]);

  return colors;
}

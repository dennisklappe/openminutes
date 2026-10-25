import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../brand/tokens.css', import.meta.url), 'utf8');

type Theme = Map<string, string>;

function block(selector: string): Theme {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const entries: [string, string][] = [];
  for (const match of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)) {
    entries.push([match[1] ?? '', match[2] ?? '']);
  }
  return new Map(entries);
}

const themes: [string, Theme][] = [
  ['light', block(':root')],
  ['dark', block(":root[data-theme='dark']")],
];

function colour(theme: Theme, key: string): string {
  const value = theme.get(key);
  if (!value) throw new Error(`missing token ${key}`);
  return value;
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hue(hex: string): number {
  const [r = 0, g = 0, b = 0] = channels(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sector =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (sector * 60 + 360) % 360;
}

describe.each(themes)('%s tokens', (_name, theme) => {
  it('keeps the accent readable as text and as a button fill', () => {
    for (const background of ['paper', 'surface', 'accent-soft']) {
      expect(contrast(colour(theme, 'accent'), colour(theme, background))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    expect(contrast(colour(theme, 'accent-ink'), colour(theme, 'accent'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('keeps speaker colours readable on cards and away from the accent hue', () => {
    const accentHue = hue(colour(theme, 'accent'));
    for (let i = 1; i <= 8; i++) {
      const speaker = colour(theme, `spk-${i}`);
      expect(contrast(speaker, colour(theme, 'surface'))).toBeGreaterThanOrEqual(4.5);
      const rgb = channels(speaker);
      if (Math.max(...rgb) - Math.min(...rgb) > 0.3) {
        const distance = Math.abs(hue(speaker) - accentHue);
        expect(Math.min(distance, 360 - distance)).toBeGreaterThan(35);
      }
    }
  });
});

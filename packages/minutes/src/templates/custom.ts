import type { Look } from '../look.js';

const STACKS: Record<string, string> = {
  Arial: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  Georgia: "Georgia, 'Times New Roman', serif",
  'Times New Roman': "'Times New Roman', Times, serif",
  Verdana: 'Verdana, Geneva, sans-serif',
  'Trebuchet MS': "'Trebuchet MS', Tahoma, sans-serif",
};

export function customCss(look: Look): string {
  const centered = look.logo === 'center';
  return `
:root { --accent: ${look.style.accent}; }
@media (prefers-color-scheme: dark) { :root { --accent: ${look.style.accent}; } }
body { font-family: ${STACKS[look.style.font] ?? STACKS['Arial']}; font-size: 15.5px; }
.minutes { max-width: 820px; }
.minutes > header { ${centered ? 'text-align: center; border-bottom: 3px solid var(--accent); padding-bottom: 16px;' : 'border-left: 5px solid var(--accent); padding-left: 18px;'} margin-bottom: 22px; }
.logo { ${centered ? 'margin-left: auto; margin-right: auto;' : ''} }
.org { margin: 0 0 6px; font-weight: 600; color: var(--muted); }
h1 { font-size: 30px; letter-spacing: -0.02em; margin: 0 0 12px; }
.facts { ${centered ? '' : 'display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;'} }
.facts div { ${centered ? 'justify-content: center;' : 'flex-direction: column; gap: 0; background: var(--soft); border-radius: 10px; padding: 10px 14px;'} }
.facts dt { ${centered ? 'min-width: 0;' : ''} font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
section { margin-top: 26px; }
h2 { font-size: 20px; color: var(--accent); margin: 0 0 10px; }
h3 { font-size: 16.5px; margin: 18px 0 6px; }
h4 { font-size: 15px; margin: 14px 0 4px; }
.extra { margin-top: 20px; color: var(--muted); }
.extra p { margin: 0 0 6px; }
`;
}

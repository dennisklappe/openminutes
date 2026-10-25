import type { MinutesTemplate } from './types.js';

export const compact: MinutesTemplate = {
  id: 'compact',
  name: 'Compact',
  description: 'Dense one-page layout with small type, made for long meetings.',
  css: `
body { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 13.5px; line-height: 1.45; }
.minutes { max-width: 900px; padding-top: 24px; }
.minutes > header { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid var(--rule); padding-bottom: 10px; margin-bottom: 10px; }
.logo { margin: 0; max-height: 40px; }
h1 { font-size: 22px; margin: 0; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 2px 24px; }
.facts dt { min-width: 64px; }
section { margin-top: 14px; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 4px; }
h3 { font-size: 14px; margin: 10px 0 2px; }
h4 { font-size: 13.5px; margin: 8px 0 2px; }
p { margin: 0 0 6px; }
.people ul { columns: 2 200px; }
.seg { margin-bottom: 2px; }
`,
};

import type { MinutesTemplate } from './types.js';

export const modern: MinutesTemplate = {
  id: 'modern',
  name: 'Modern',
  description: 'Clean sans-serif layout with an accent colour and soft cards.',
  css: `
body { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 15.5px; }
.minutes { max-width: 820px; }
.minutes > header { border-left: 5px solid var(--accent); padding-left: 18px; margin-bottom: 22px; }
h1 { font-size: 32px; letter-spacing: -0.02em; margin: 0 0 12px; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.facts div { flex-direction: column; gap: 0; background: var(--soft); border-radius: 10px; padding: 10px 14px; }
.facts dt { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
section { margin-top: 28px; }
h2 { font-size: 20px; color: var(--accent); margin: 0 0 10px; }
h3 { font-size: 16.5px; margin: 18px 0 6px; }
h4 { font-size: 15px; margin: 14px 0 4px; }
.people ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.people li { background: var(--soft); border-radius: 999px; padding: 4px 14px; }
.transcript, .chat { background: var(--soft); border-radius: 10px; padding: 8px 18px 14px; }
`,
};

import type { MinutesTemplate } from './types.js';

export const classic: MinutesTemplate = {
  id: 'classic',
  name: 'Classic',
  description: 'Formal serif layout with ruled sections, like a printed record.',
  css: `
body { font-family: Georgia, 'Times New Roman', serif; font-size: 16px; }
.minutes { max-width: 760px; }
.minutes > header { text-align: center; border-bottom: 2px solid var(--fg); padding-bottom: 16px; margin-bottom: 20px; }
.logo { margin-left: auto; margin-right: auto; }
h1 { font-size: 30px; margin: 0; }
.facts div { justify-content: center; }
.facts dt { min-width: 0; }
.facts dt::after { content: ':'; }
section { margin-top: 26px; }
h2 { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 1px solid var(--rule); padding-bottom: 4px; }
h3 { font-size: 17px; margin: 18px 0 6px; }
h4 { font-size: 15px; margin: 14px 0 4px; }
`,
};

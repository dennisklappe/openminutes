import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import rehypeExternalLinks from 'rehype-external-links';
import rehypeMermaid from 'rehype-mermaid';
import { unified } from '@astrojs/markdown-remark';
import { rehypeDocs } from './src/lib/rehype-docs.mjs';

/** Neutral light base. The dark palette is applied in global.css from the site tokens. */
const mermaidTheme = {
  theme: 'base',
  // Measured at build time and drawn in the browser: the same metric compatible stack in both
  // places (global.css repeats it), otherwise boxes are sized for another font than the one shown.
  fontFamily: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  // Plain SVG text: HTML labels sit in fixed size boxes that clip when the font differs.
  htmlLabels: false,
  flowchart: { htmlLabels: false, padding: 14 },
  themeVariables: {
    background: '#ffffff',
    primaryColor: '#ffffff',
    primaryBorderColor: '#d5d8dd',
    primaryTextColor: '#16181d',
    secondaryColor: '#e8f0fa',
    tertiaryColor: '#f1f2f4',
    lineColor: '#646b76',
    textColor: '#16181d',
    noteBkgColor: '#e8f0fa',
    noteTextColor: '#16181d',
  },
};

export default defineConfig({
  site: 'https://openminut.es',
  build: { format: 'file' },
  trailingSlash: 'never',
  compressHTML: false,
  integrations: [
    sitemap({
      serialize(item) {
        item.url = item.url.replace(/\.html$/, '').replace(/\/index$/, '/');
        return item;
      },
    }),
  ],
  markdown: {
    syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] },
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
    processor: unified({
      rehypePlugins: [
        [rehypeMermaid, { strategy: 'inline-svg', mermaidConfig: mermaidTheme }],
        [rehypeDocs, { repo: 'https://github.com/dennisklappe/openminutes' }],
        [rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }],
      ],
    }),
  },
});

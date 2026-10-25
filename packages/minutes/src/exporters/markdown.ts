import type { Exporter } from '../exporter.js';
import { minutesFilename } from '../filename.js';
import { renderMinutesMarkdown } from '../render-markdown.js';

export const markdownExporter: Exporter = {
  id: 'markdown',
  label: 'Markdown',
  description: 'Plain Markdown, ready to paste into notes or a wiki.',
  export: ({ minutes, options }) =>
    Promise.resolve({
      kind: 'file',
      filename: minutesFilename(minutes.title, 'md'),
      contentType: 'text/markdown; charset=utf-8',
      body: renderMinutesMarkdown(minutes, options),
    }),
};

import type { Exporter } from '../exporter.js';
import { minutesFilename } from '../filename.js';
import { renderMinutesHtml } from '../render-html.js';

export const htmlExporter: Exporter = {
  id: 'html',
  label: 'HTML',
  description: 'A single self-contained page that prints cleanly to PDF.',
  export: ({ minutes, options }) =>
    Promise.resolve({
      kind: 'file',
      filename: minutesFilename(minutes.title, 'html'),
      contentType: 'text/html; charset=utf-8',
      body: renderMinutesHtml(minutes, options),
    }),
};

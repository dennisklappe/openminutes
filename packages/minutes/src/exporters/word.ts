import { buildDocx } from '../docx/build.js';
import type { Exporter } from '../exporter.js';
import { minutesFilename } from '../filename.js';

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const wordExporter: Exporter = {
  id: 'word',
  label: 'Word',
  description: 'A .docx file with the minutes and the transcript as a second section.',
  export: ({ minutes, options }) =>
    Promise.resolve({
      kind: 'file',
      filename: minutesFilename(minutes.title, 'docx'),
      contentType: DOCX_TYPE,
      body: buildDocx(minutes, options),
    }),
};

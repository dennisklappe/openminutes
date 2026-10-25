import type { CustomTemplate } from './custom-template.js';
import type { MinutesLogo } from './logo.js';
import type { TemplateId } from './templates/index.js';

export interface LinkEntry {
  label: string;
  url: string;
}

export interface RenderOptions {
  template: TemplateId;
  /** Used when `template` is `custom`. */
  custom?: CustomTemplate | undefined;
  /** The transcript is always a separate part: a tab, a section on a new page or a block after the minutes. */
  includeTranscript: boolean;
  /** Chat goes with the transcript part and is on unless this is false. */
  includeChat?: boolean | undefined;
  /** With the transcript included: also add a Links tab. */
  linksTab?: boolean | undefined;
  /** The share link of these minutes and the exported documents, for the Links tab. */
  links?: LinkEntry[] | undefined;
  logo?: MinutesLogo | undefined;
  timeZone?: string | undefined;
}

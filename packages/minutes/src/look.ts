import {
  customFonts,
  defaultCustomTemplate,
  defaultSectionTitles,
  type CustomLabels,
  type CustomSectionId,
  type CustomTemplate,
} from './custom-template.js';
import { customStyle, documentStyles, type DocumentStyle } from './document-style.js';
import type { TimeOptions } from './format.js';
import type { RenderOptions } from './options.js';

export interface LookSection {
  id: CustomSectionId;
  title: string;
}

export interface Look {
  template: RenderOptions['template'];
  custom: boolean;
  style: DocumentStyle;
  sections: LookSection[];
  logo: 'left' | 'center' | 'none';
  organisation: string;
  extraBefore: string;
  extraAfter: string;
  labels: CustomLabels;
  format: TimeOptions;
}

const builtinSections: LookSection[] = (
  ['details', 'attendees', 'absent', 'summary', 'transcript'] as const
).map((id) => ({ id, title: defaultSectionTitles[id] }));

const safe = (custom: CustomTemplate): CustomTemplate => ({
  ...custom,
  accent: /^#[0-9a-fA-F]{6}$/.test(custom.accent) ? custom.accent : defaultCustomTemplate.accent,
  font: customFonts.includes(custom.font) ? custom.font : defaultCustomTemplate.font,
});

export function resolveLook(options: RenderOptions): Look {
  const base = { timeZone: options.timeZone };
  if (options.template !== 'custom') {
    return {
      template: options.template,
      custom: false,
      style: documentStyles[options.template],
      sections: builtinSections,
      logo: documentStyles[options.template].centered ? 'center' : 'left',
      organisation: '',
      extraBefore: '',
      extraAfter: '',
      labels: defaultCustomTemplate.labels,
      format: base,
    };
  }
  const custom = safe(options.custom ?? defaultCustomTemplate);
  return {
    template: 'custom',
    custom: true,
    style: customStyle(custom),
    sections: custom.sections.filter((s) => s.enabled).map(({ id, title }) => ({ id, title })),
    logo: custom.header.logo,
    organisation: custom.header.organisation,
    extraBefore: custom.extraBefore,
    extraAfter: custom.extraAfter,
    labels: custom.labels,
    format: {
      ...base,
      locale: custom.locale,
      dateStyle: custom.dateFormat,
      hour12: custom.timeFormat === '12h',
      rangeSeparator: ' - ',
    },
  };
}

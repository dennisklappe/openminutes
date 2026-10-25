import type { CustomTemplate } from './custom-template.js';
import type { BuiltinTemplateId } from './templates/types.js';

export interface DocumentStyle {
  font: string;
  codeFont: string;
  bodyPt: number;
  titlePt: number;
  h2Pt: number;
  h3Pt: number;
  accent: string;
  ink: string;
  muted: string;
  centered: boolean;
  h2Rule: boolean;
  gapPt: number;
  accentBar: boolean;
  h2SmallCaps: boolean;
  soft: string;
  rule: string;
}

export const documentStyles: Record<BuiltinTemplateId, DocumentStyle> = {
  classic: {
    font: 'Georgia',
    codeFont: 'Courier New',
    bodyPt: 11,
    titlePt: 24,
    h2Pt: 12,
    h3Pt: 12,
    accent: '#1c1f24',
    ink: '#1c1f24',
    muted: '#5d6572',
    centered: true,
    h2Rule: true,
    gapPt: 6,
    accentBar: false,
    h2SmallCaps: true,
    soft: '#f2f3f5',
    rule: '#c9ced6',
  },
  modern: {
    font: 'Arial',
    codeFont: 'Courier New',
    bodyPt: 11,
    titlePt: 28,
    h2Pt: 16,
    h3Pt: 13,
    accent: '#2760ab',
    ink: '#1c1f24',
    muted: '#5d6572',
    centered: false,
    h2Rule: false,
    gapPt: 8,
    accentBar: true,
    h2SmallCaps: false,
    soft: '#e9f0fa',
    rule: '#d3deee',
  },
  compact: {
    font: 'Arial',
    codeFont: 'Courier New',
    bodyPt: 9.5,
    titlePt: 18,
    h2Pt: 10.5,
    h3Pt: 10,
    accent: '#5d6572',
    ink: '#1c1f24',
    muted: '#5d6572',
    centered: false,
    h2Rule: false,
    gapPt: 3,
    accentBar: false,
    h2SmallCaps: false,
    soft: '#f2f3f5',
    rule: '#d9dde3',
  },
};

export const customStyle = (custom: CustomTemplate): DocumentStyle => ({
  font: custom.font,
  codeFont: 'Courier New',
  bodyPt: 11,
  titlePt: 26,
  h2Pt: 15,
  h3Pt: 12.5,
  accent: custom.accent,
  ink: '#1c1f24',
  muted: '#5d6572',
  centered: custom.header.logo === 'center',
  h2Rule: false,
  gapPt: 7,
  accentBar: custom.header.logo !== 'center',
  h2SmallCaps: false,
  soft: '#f2f3f5',
  rule: '#d9dde3',
});

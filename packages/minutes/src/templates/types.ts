export const builtinTemplateIds = ['classic', 'modern', 'compact'] as const;
export const templateIds = [...builtinTemplateIds, 'custom'] as const;

export type BuiltinTemplateId = (typeof builtinTemplateIds)[number];
export type TemplateId = (typeof templateIds)[number];

export interface MinutesTemplate {
  id: BuiltinTemplateId;
  name: string;
  description: string;
  css: string;
}

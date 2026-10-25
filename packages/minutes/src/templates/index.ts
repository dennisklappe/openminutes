import { classic } from './classic.js';
import { compact } from './compact.js';
import { modern } from './modern.js';
import { templateIds, type MinutesTemplate, type TemplateId } from './types.js';

export { BASE_CSS } from './base.js';
export {
  builtinTemplateIds,
  templateIds,
  type BuiltinTemplateId,
  type MinutesTemplate,
  type TemplateId,
} from './types.js';

export const templates: readonly MinutesTemplate[] = [classic, modern, compact];

export const DEFAULT_TEMPLATE: TemplateId = 'classic';

export const isTemplateId = (value: string): value is TemplateId =>
  (templateIds as readonly string[]).includes(value);

export function findTemplate(id: string): MinutesTemplate {
  return templates.find((template) => template.id === id) ?? classic;
}

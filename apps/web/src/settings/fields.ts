import { z } from 'zod';
import type { ProviderFieldDto } from '../dto.js';

const SECRET_NAME = /key|token|secret|password/i;

export const isSecretField = (name: string) => SECRET_NAME.test(name);

const fieldTypes: Record<string, ProviderFieldDto['type']> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
};

const jsonField = z.object({
  type: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  label: z.string().optional(),
  help: z.string().optional(),
  placeholder: z.string().optional(),
  advanced: z.boolean().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});

function humanize(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function describeFields(schema: z.ZodType): ProviderFieldDto[] {
  const json = z.toJSONSchema(schema, { io: 'input' });
  const required = new Set(Array.isArray(json['required']) ? json['required'] : []);
  const properties = z.record(z.string(), jsonField).parse(json['properties'] ?? {});

  return Object.entries(properties).map(([name, property]): ProviderFieldDto => {
    return {
      name,
      label: property.label ?? humanize(name),
      type: fieldTypes[property.type ?? ''] ?? 'string',
      required: required.has(name),
      secret: isSecretField(name),
      advanced: property.advanced ?? false,
      ...(property.default !== undefined && { default: property.default }),
      ...(property.help && { help: property.help }),
      ...(property.placeholder && { placeholder: property.placeholder }),
      ...(property.options && { options: property.options }),
    };
  });
}

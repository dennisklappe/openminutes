import { openAsBlob } from 'node:fs';
import { basename, extname } from 'node:path';
import { mimeFor } from './mime.js';

export async function audioBlob(path: string): Promise<Blob> {
  return openAsBlob(path, { type: mimeFor(path) });
}

// OpenAI rejects the .opus extension although it is an Ogg container it accepts.
export function uploadName(path: string): string {
  const name = basename(path);
  return extname(name).toLowerCase() === '.opus' ? `${name.slice(0, -5)}.ogg` : name;
}

export async function audioForm(
  path: string,
  fields: Record<string, string | string[] | undefined>,
): Promise<FormData> {
  const form = new FormData();
  form.set('file', await audioBlob(path), uploadName(path));
  for (const [key, value] of Object.entries(fields)) {
    for (const item of [value ?? []].flat()) form.append(key, item);
  }
  return form;
}

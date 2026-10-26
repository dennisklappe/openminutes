import { MAX_CHUNK_BYTES } from '@openminutes/core';
import type { ImportConfigDto } from '../dto.js';

export const DEFAULT_IMPORT_MAX_GB = 10;
export const MAX_IMPORT_FILES = 20_000;

export const loadImportConfig = (maxBytes: number): ImportConfigDto => ({
  maxBytes,
  chunkBytes: MAX_CHUNK_BYTES,
});

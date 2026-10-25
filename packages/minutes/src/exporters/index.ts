import { ExporterRegistry } from '../exporter.js';
import { htmlExporter } from './html.js';
import { markdownExporter } from './markdown.js';
import { wordExporter } from './word.js';

export function createBuiltinExporters(): ExporterRegistry {
  return new ExporterRegistry()
    .register(htmlExporter)
    .register(markdownExporter)
    .register(wordExporter);
}

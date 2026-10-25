import type { RenderOptions } from './options.js';
import type { Minutes } from './types.js';

export interface ExportInput {
  meetingId: string;
  minutes: Minutes;
  options: RenderOptions;
  previous?: ExportReference | undefined;
  origin?: string | undefined;
}

export interface ExportReference {
  ref: string;
  url: string;
}

export type ExportOutcome =
  | { kind: 'file'; filename: string; contentType: string; body: string | Uint8Array }
  | { kind: 'link'; url: string; label: string; ref?: string; note?: string }
  | { kind: 'message'; text: string };

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export interface GrantAccessInput {
  meetingId: string;
  /** The link an earlier export returned. */
  url: string;
  emails: string[];
}

export interface GrantAccessOutcome {
  granted: string[];
  failed: { email: string; reason: string }[];
}

export interface Exporter {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Keeps a living copy (a document or a link) that can be updated. */
  readonly destination?: boolean;
  /** Present when the result can be shared by link. Used as the "Share as" label. */
  readonly shareLabel?: string;
  export(input: ExportInput): Promise<ExportOutcome>;
  /**
   * Optional. Lets the people in `emails` open a document this exporter created, for
   * example by adding them as viewers of a Google Doc. Exporters whose output needs no
   * permission (files, public links) leave it out.
   */
  grantAccess?(input: GrantAccessInput): Promise<GrantAccessOutcome>;
}

export class ExporterRegistry {
  private readonly exporters = new Map<string, Exporter>();

  register(exporter: Exporter): this {
    if (this.exporters.has(exporter.id)) {
      throw new Error(`An exporter with id "${exporter.id}" is already registered`);
    }
    this.exporters.set(exporter.id, exporter);
    return this;
  }

  get(id: string): Exporter | undefined {
    return this.exporters.get(id);
  }

  /** Undefined when the exporter does not exist or cannot change document permissions. */
  grantAccess(id: string, input: GrantAccessInput): Promise<GrantAccessOutcome> | undefined {
    return this.exporters.get(id)?.grantAccess?.(input);
  }

  list(): Exporter[] {
    return [...this.exporters.values()];
  }
}

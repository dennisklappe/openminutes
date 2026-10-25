export type FieldMeta = {
  label: string;
  help?: string;
  placeholder?: string;
  /** Shown under an Advanced disclosure instead of in the main form. */
  advanced?: boolean;
  options?: { value: string; label: string }[];
};

/** The base URL of a hosted service: a constant in code that can be overridden under Advanced. */
export const endpoint = (service: string): FieldMeta => ({
  label: 'Base URL',
  help: `Only change this to reach ${service} through a proxy.`,
  advanced: true,
});

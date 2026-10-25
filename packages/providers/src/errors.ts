export type ProviderErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'server'
  | 'invalid_response'
  | 'invalid_config'
  | 'media';

export class ProviderError extends Error {
  override readonly name = 'ProviderError';

  constructor(
    readonly provider: string,
    readonly code: ProviderErrorCode,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(`${provider}: ${message}`, options);
  }

  get retryable(): boolean {
    return (
      this.code === 'rate_limit' ||
      this.code === 'timeout' ||
      this.code === 'network' ||
      this.code === 'server'
    );
  }
}

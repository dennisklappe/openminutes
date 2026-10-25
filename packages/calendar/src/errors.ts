export class CalendarApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CalendarApiError';
  }
}

export class AuthRevokedError extends Error {
  constructor() {
    super('Access was revoked or expired, connect the account again');
    this.name = 'AuthRevokedError';
  }
}

export class SyncExpiredError extends Error {
  constructor() {
    super('Sync state expired');
    this.name = 'SyncExpiredError';
  }
}

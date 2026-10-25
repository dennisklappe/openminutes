import { describe, expect, it } from 'vitest';
import { endpointsFor } from './endpoints.js';
import { EXPORT_SCOPES, hasExportAccess } from './export-access.js';
import { createGoogleProvider } from './google.js';
import { createMicrosoftProvider } from './microsoft.js';

const credentials = { clientId: 'id', clientSecret: 's' };
const request = { redirectUri: 'https://x/cb', state: 's', codeChallenge: 'c' };

describe('export access', () => {
  it('asks for the document scopes only when export access is requested', () => {
    const google = createGoogleProvider(endpointsFor().google, fetch);
    const plain = new URL(google.authorizeUrl(credentials, request));
    expect(plain.searchParams.get('scope')).not.toContain('drive.file');
    const upgraded = new URL(
      google.authorizeUrl(credentials, { ...request, extraScopes: [...EXPORT_SCOPES.google] }),
    );
    expect(upgraded.searchParams.get('scope')).toContain('auth/drive.file');
    expect(upgraded.searchParams.get('scope')).toContain('auth/documents');
    expect(upgraded.searchParams.get('scope')).toContain('calendar.readonly');
    expect(upgraded.searchParams.get('include_granted_scopes')).toBe('true');

    const microsoft = createMicrosoftProvider(endpointsFor().microsoft, fetch);
    const scope = (extraScopes: readonly string[]) =>
      new URL(
        microsoft.authorizeUrl(credentials, { ...request, extraScopes: [...extraScopes] }),
      ).searchParams.get('scope');
    expect(scope([])).not.toContain('Files.ReadWrite');
    expect(scope(EXPORT_SCOPES.microsoft)).toContain('Files.ReadWrite');
  });

  it('recognises granted export scopes', () => {
    expect(hasExportAccess('google', undefined)).toBe(false);
    expect(hasExportAccess('google', 'openid https://www.googleapis.com/auth/drive.file')).toBe(
      false,
    );
    expect(
      hasExportAccess(
        'google',
        'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file',
      ),
    ).toBe(true);
    expect(hasExportAccess('microsoft', 'User.Read files.readwrite')).toBe(true);
  });
});

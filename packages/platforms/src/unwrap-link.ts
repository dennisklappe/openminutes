const MAX_UNWRAP_DEPTH = 4;
export const teamsHosts = new Set([
  'teams.microsoft.com',
  'teams.live.com',
  'gov.teams.microsoft.us',
  'dod.teams.microsoft.us',
]);

function decodeProofpointV2(value: string): string {
  return decodeURIComponent(value.replaceAll('_', '/').replace(/-([\dA-F]{2})/g, '%$1'));
}

function wrappedTarget(url: URL): string | undefined {
  const { hostname, pathname, searchParams } = url;
  if (hostname.endsWith('.safelinks.protection.outlook.com'))
    return searchParams.get('url') ?? undefined;
  if (hostname === 'www.google.com' && pathname === '/url') {
    return searchParams.get('q') ?? searchParams.get('url') ?? undefined;
  }
  if (hostname === 'urldefense.proofpoint.com' && pathname === '/v2/url') {
    const target = searchParams.get('u');
    return target ? decodeProofpointV2(target) : undefined;
  }
  if (hostname === 'urldefense.com') return /\/v3\/__(.+?)__;/.exec(url.pathname)?.[1];
  return undefined;
}

export function unwrapLink(raw: string): URL | undefined {
  let current = raw;
  try {
    for (let depth = 0; depth <= MAX_UNWRAP_DEPTH; depth++) {
      const url = new URL(/^https?:\/\//i.test(current) ? current : `https://${current}`);
      const target = wrappedTarget(url);
      if (target === undefined) return url;
      current = target;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

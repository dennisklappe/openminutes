import { tiers } from './offer';
import { repo, siteUrl } from './site';

export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbJsonLd(crumbs: Crumb[]): object {
  const all: Crumb[] = [{ name: 'OpenMinutes', path: '/' }, ...crumbs];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: all.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: new URL(c.path, siteUrl).href,
    })),
  };
}

/** One SoftwareApplication node for the whole site, referenced by @id from every SEO page. */
export const softwareJsonLd = {
  '@type': 'SoftwareApplication',
  '@id': `${siteUrl}/#software`,
  name: 'OpenMinutes',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Linux (Docker)',
  description:
    'Open source, self-hosted meeting notes. A bot joins Google Meet and Microsoft Teams meetings, records the audio and writes the transcript with who said what.',
  url: siteUrl,
  license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  codeRepository: repo,
  publisher: { '@id': `${siteUrl}/#org` },
  offers: [
    {
      '@type': 'Offer',
      name: 'Self-hosted',
      price: '0',
      priceCurrency: 'EUR',
      url: `${siteUrl}/docs/getting-started`,
    },
    ...tiers.map((t) => ({
      '@type': 'Offer',
      name: `OpenMinutes Hosted, ${t.concurrent} concurrent ${t.concurrent === 1 ? 'meeting' : 'meetings'}`,
      price: String(t.monthly),
      priceCurrency: 'EUR',
      url: `${siteUrl}/hosting`,
    })),
  ],
};

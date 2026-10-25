export const siteUrl = 'https://openminut.es';
export const repo = 'https://github.com/dennisklappe/openminutes';
export const supportEmail = 'support@openminut.es';
export const intakeEndpoint = 'https://api.openminut.es';

/** Klappe Development company identity, shown on the legal pages. */
export const company = {
  name: 'Klappe Development',
  url: 'https://klappe.dev',
  address: 'Boersenserf 10, 3871 RK Hoevelaken, the Netherlands',
  kvk: '71434577',
  btw: 'NL002415101B21',
};

/** Baked in at build time by CI, so visitors never trigger a request to GitHub. */
export const stars = Number(import.meta.env.PUBLIC_GITHUB_STARS ?? 0);

export function canonicalPath(pathname: string): string {
  const path = pathname.replace(/(\/index)?\.html$/, '');
  return path === '' ? '/' : path;
}

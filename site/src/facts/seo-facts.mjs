/**
 * Single source of truth for every factual claim on the /compare, /alternatives and /use pages.
 *
 * Rules:
 * - A statement about a competitor needs a source URL from the vendor itself (pricing, help center,
 *   terms, privacy or security pages). Where it cannot be verified, leave it out.
 * - Re-verify everything after 90 days and bump `verifiedOn`. `node scripts/check-claims.mjs` lists all facts
 *   with their sources and warns when the date is older than `reverifyAfterDays`.
 * - Competitor products change. Pages invite corrections through GitHub issues.
 */

export const verifiedOn = '2026-10-23';
export const verifiedLabel = '23 October 2026';
export const reverifyAfterDays = 90;

const DOCS = 'https://openminut.es/docs/';

/** Rows of the comparison table, in display order. */
export const rows = [
  { key: 'price', label: 'Price' },
  { key: 'free', label: 'Free tier or limits' },
  { key: 'platforms', label: 'Meeting platforms' },
  { key: 'capture', label: 'How it captures the meeting' },
  { key: 'region', label: 'Where data is stored' },
  { key: 'training', label: 'AI training on your data' },
  { key: 'selfhost', label: 'Self-hosting' },
  { key: 'export', label: 'Export' },
  { key: 'languages', label: 'Languages' },
  { key: 'speakers', label: 'Speaker labels' },
  { key: 'api', label: 'API' },
  { key: 'compliance', label: 'Compliance claims' },
];

/** What we say about ourselves. Sources are our own docs, which describe what works and what does not. */
export const om = {
  price: {
    value:
      'Self-hosting is free, with no licence key. Hosted by us: EUR 9, 20 or 59 a month for 1, 3 or 10 concurrent meetings, excluding VAT. Users and meeting hours are unlimited. You pay your own AI provider.',
    src: ['https://openminut.es/hosting'],
  },
  free: {
    value:
      'No limits set by us when you self-host. Your limits are your hardware (about 1 vCPU and 1.5 GB RAM per meeting recorded at once) and what your AI provider charges.',
    src: [`${DOCS}sizing`, `${DOCS}providers`],
  },
  platforms: {
    value: 'Google Meet and Microsoft Teams. Zoom is not supported and not planned for version 1.',
    src: [`${DOCS}faq`],
  },
  capture: {
    value:
      'A bot joins as a visible participant with its own name. For Google Meet the bot needs its own Google account, otherwise Meet may refuse it. Someone may need to admit it from the lobby.',
    src: [`${DOCS}meet-sign-in`, `${DOCS}teams`, `${DOCS}consent-and-legal`],
  },
  region: {
    value:
      'Wherever you run it: your server, your database, optionally your own S3-compatible bucket. If we host it for you, on infrastructure we operate in the Netherlands.',
    src: [`${DOCS}storage`, 'https://openminut.es/privacy'],
  },
  training: {
    value:
      'No telemetry. Audio and text go only to the transcription and summary providers you configure (their terms apply to that data), or nowhere with local transcription and no summary.',
    src: [`${DOCS}faq`],
  },
  selfhost: {
    value: 'Yes, that is the main way to use it. Docker Compose on a machine you run, AGPL-3.0.',
    src: [`${DOCS}getting-started`],
  },
  export: {
    value:
      'Minutes as a share link, HTML, Markdown, Word, Google Docs, Word on OneDrive or email. The transcript is also available as Markdown and JSON.',
    src: [`${DOCS}minutes`, `${DOCS}chat`],
  },
  languages: {
    value:
      'Depends on the transcription provider you choose, with automatic language detection by default. We do not publish a language count.',
    src: [`${DOCS}providers`],
  },
  speakers: {
    value:
      'Names come from the meeting itself: the bot reads who has the speaking indicator and matches it to the transcript words. The phone recorder tells voices apart from the audio instead.',
    src: [`${DOCS}speakers`],
  },
  api: {
    value:
      'The docs describe an API only for the phone recorder. There is no general integration API yet.',
    src: [`${DOCS}phone-recorder-api`],
  },
  compliance: {
    value:
      'No third-party security certification such as SOC 2. The source code is licensed under AGPL-3.0.',
    src: ['https://openminut.es/security'],
  },
};

/** The honest limits of OpenMinutes, reused on every comparison page. */
export const omLimits = [
  {
    text: 'Early stage. v0.1 is the first release and breaking changes are expected before v1.',
    href: DOCS + 'roadmap',
    label: 'Status and roadmap',
  },
  { text: 'No Zoom support, and none planned for version 1.', href: DOCS + 'faq', label: 'FAQ' },
  {
    text: 'You run and update it yourself (or pay us to), and you bring your own AI keys or a local model.',
    href: DOCS + 'providers',
    label: 'Providers and cost',
  },
  {
    text: 'Setup takes Docker, a machine and, for calendar auto-join, your own Google and Microsoft app registrations. Pasting a meeting link needs neither.',
    href: DOCS + 'getting-started',
    label: 'Getting started',
  },
  {
    text: 'A bot joins the meeting visibly. There is no bot-free capture and no desktop or mobile app. The phone recorder is an installable web app.',
    href: DOCS + 'phone-recorder',
    label: 'Phone recorder',
  },
  {
    text: 'Google Meet may refuse a bot that is not signed in, so the bot needs its own Google account.',
    href: DOCS + 'meet-sign-in',
    label: 'Signing the Meet bot in',
  },
  {
    text: 'Teams support is young: tests use fake Teams pages, not live recordings, and organisers can block anonymous guests.',
    href: DOCS + 'teams',
    label: 'Microsoft Teams',
  },
  {
    text: 'Far fewer integrations than the mature products, and no CRM sync.',
    href: 'https://openminut.es/',
    label: 'Home',
  },
];

import { list } from './competitors/index.mjs';

export const competitorList = list;
export const competitors = Object.fromEntries(list.map((c) => [c.slug, c]));

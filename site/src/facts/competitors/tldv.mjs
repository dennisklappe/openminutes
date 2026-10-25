const V = '2026-10-23';
const P = 'https://tldv.io/pricing/';
const PV = 'https://tldv.io/privacy/';
const SEC = 'https://tldv.io/features/security-commitment/';
const HC = 'https://intercom.help/tldv/en/articles/';

export default {
  slug: 'tldv',
  name: 'tl;dv',
  site: 'https://tldv.io',
  verified: V,
  entry: { plan: 'Pro', monthly: 29, annual: 18, cur: 'EUR' },
  oneLine: 'a hosted AI notetaker from a German company for Google Meet, Microsoft Teams and Zoom',
  rows: {
    price: {
      value:
        'Free; Pro EUR 18 and Business EUR 29 per seat per month billed annually (EUR 29 and EUR 39 billed monthly). Enterprise on request. Shown in EUR when we read it; the displayed currency may differ by location.',
      src: [P],
    },
    free: {
      value:
        'Free plan: unlimited recordings (stored for 3 months) and transcription in 30+ languages. Full AI notes cover the first 10 meetings, then only the first 10 minutes of each meeting. Limits are for the lifetime of the account.',
      src: [`${HC}8919450`, P],
    },
    platforms: { value: 'Google Meet, Microsoft Teams and Zoom.', src: [`${HC}14433922`] },
    capture: {
      value:
        'By default a visible "tl;dv bot" joins. A desktop app for Mac or Windows records audio without a bot, but not video, screen sharing or chat, and participants may not get an automatic notice.',
      src: [`${HC}5946261`, `${HC}14433337`],
    },
    region: {
      value:
        'Its privacy policy says services are hosted in the European Economic Area, except part of the AI processing, which you can set to the EU or the US.',
      src: [PV],
    },
    training: {
      value:
        'Its privacy policy says it does not use customer content to train, fine-tune or improve foundation models or other generative AI models.',
      src: [PV, SEC],
    },
    selfhost: {
      value:
        'We found no self-hosted option on its public pages. The Enterprise plan lists "privately hosted AI".',
      src: [P, SEC],
    },
    export: {
      value:
        'Recordings can be downloaded on paid plans with the right permissions. Transcripts can be copied; its help center says bulk download and export are not supported (articles from April 2025).',
      src: [`${HC}5946213`, `${HC}6122489`],
    },
    languages: { value: 'Transcription in 30+ languages.', src: [P, 'https://tldv.io/'] },
    speakers: { value: 'Identifies speakers automatically in transcripts.', src: [`${HC}6171907`] },
    api: {
      value:
        'REST API (version v1alpha1) with webhooks and an MCP server, on the Pro and Business plans.',
      src: ['https://doc.tldv.io/', `${HC}11583137`],
    },
    compliance: {
      value:
        'Claims SOC 2 Type II, GDPR and EU AI Act compliance. The company is Tldx Solutions GmbH in Aachen, Germany.',
      src: [SEC, PV],
    },
  },
  strengths: [
    {
      text: 'A European company that says its services are hosted inside the EEA, with a free plan that includes unlimited recordings.',
      src: [PV, P],
    },
    {
      text: 'Works with Zoom, Google Meet and Microsoft Teams, with or without a bot.',
      src: [`${HC}14433922`],
    },
    {
      text: 'Integrates with more than 5000 apps through Zapier plus native Slack, HubSpot, Salesforce and Notion.',
      src: ['https://tldv.io/integrations/'],
    },
  ],
  chooseInstead: [
    'You use Zoom. OpenMinutes does not support it.',
    'You want EU hosting without running a server: tl;dv says its services are in the EEA.',
    'You want a bot-free option as well as a bot (audio only).',
    'You want CRM, Slack and Notion integrations without building anything.',
    'Your company needs SOC 2 Type II from the vendor.',
  ],
};

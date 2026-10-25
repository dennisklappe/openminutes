const V = '2026-10-23';
const PRICING = 'https://fathom.ai/pricing';
const HC = 'https://help.fathom.video/en/articles/';

export default {
  slug: 'fathom',
  name: 'Fathom',
  site: 'https://fathom.ai',
  verified: V,
  entry: { plan: 'Team', monthly: 19, annual: 15, cur: 'USD' },
  oneLine:
    'a hosted AI notetaker for Zoom, Google Meet and Microsoft Teams with a generous free plan',
  rows: {
    price: {
      value:
        'Free; Premium $20, Team $19 and Business $34 per user per month billed monthly ($16, $15 and $25 billed annually). Team and Business have a 2-user minimum. Enterprise on request. Prices in USD.',
      src: [PRICING],
    },
    free: {
      value:
        'Free plan: unlimited recordings, storage and transcription. Advanced summaries and Ask Fathom are marked "limited use".',
      src: [PRICING, `${HC}296448`],
    },
    platforms: {
      value:
        'Zoom, Google Meet, Microsoft Teams and Slack Huddles, for live meetings only. Uploaded recordings are not supported.',
      src: [`${HC}6049729`, `${HC}11870465`],
    },
    capture: {
      value:
        'A visible bot joins by default. A bot-free desktop mode is in beta, on Mac only and for English-language meetings.',
      src: [`${HC}6150977`, `${HC}7573633`],
    },
    region: {
      value:
        'Its help center says all Fathom data is stored in the United States. We found no EU region option.',
      src: [`${HC}296512`, 'https://fathom.ai/privacy'],
    },
    training: {
      value:
        'Its AI sub-processors (Anthropic, OpenAI, Google) may not train on customer data. Fathom itself uses de-identified data to improve its own models, with an opt-out in settings.',
      src: [`${HC}296512`, 'https://fathom.ai/privacy'],
    },
    selfhost: {
      value: 'We found no self-hosted option. It is offered as a hosted service in the US.',
      src: ['https://fathom.ai/privacy'],
    },
    export: {
      value:
        'Its help center says transcripts cannot be downloaded as a file, only copied. Calls and clips can be downloaded, and its API returns summaries and transcripts.',
      src: [`${HC}296000`, PRICING],
    },
    languages: { value: 'Transcripts in 38 languages.', src: [`${HC}296192`] },
    speakers: {
      value: 'We found no page describing how it labels speakers, so we make no claim here.',
      src: [PRICING],
    },
    api: {
      value:
        'Public REST API with webhooks and OAuth, TypeScript and Python SDKs, and an MCP server.',
      src: ['https://developers.fathom.ai/'],
    },
    compliance: {
      value:
        'Says it is SOC 2 Type II, GDPR and HIPAA compliant, and that it does not have ISO 27001.',
      src: [`${HC}296512`],
    },
  },
  strengths: [
    {
      text: 'The free plan has unlimited recordings, storage and transcription.',
      src: [`${HC}296448`],
    },
    {
      text: 'Integrations with Slack, HubSpot, Salesforce, Asana and Zapier, plus a public API and MCP server.',
      src: ['https://www.fathom.ai/integrations', 'https://developers.fathom.ai/'],
    },
    { text: 'Nothing to host or maintain.', src: [PRICING] },
  ],
  chooseInstead: [
    'You use Zoom. OpenMinutes does not support it.',
    'You want a polished free tier with unlimited recordings and no server to run.',
    'You want CRM sync and ready-made Slack, HubSpot or Salesforce integrations.',
    'You want a bot-free option on a Mac, which Fathom offers in beta.',
    'Your company needs SOC 2 Type II or a signed BAA from the vendor.',
  ],
};

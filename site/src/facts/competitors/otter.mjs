const V = '2026-10-23';
const PRICING = 'https://otter.ai/pricing';
const PS = 'https://otter.ai/privacy-security';
const PP = 'https://otter.ai/privacy-policy';

export default {
  slug: 'otter',
  name: 'Otter.ai',
  site: 'https://otter.ai',
  verified: V,
  entry: { plan: 'Pro', monthly: 16.99, annual: 8.33, cur: 'USD' },
  oneLine: 'a hosted AI notetaker for Zoom, Microsoft Teams and Google Meet',
  rows: {
    price: {
      value:
        'Basic is free. Pro is $8.33 per user per month billed annually or $16.99 billed monthly. Business is $19.99 per user per month billed annually. Enterprise is quote-only. Prices in USD.',
      src: [PRICING],
    },
    free: {
      value:
        'Basic plan: 300 transcription minutes per month and 3 lifetime audio or video file imports.',
      src: [PRICING],
    },
    platforms: { value: 'Zoom, Microsoft Teams and Google Meet.', src: [PRICING] },
    capture: {
      value:
        'A notetaker joins meetings from your calendar. Bot-free options are a Mac and Windows desktop app and a Chrome extension for Google Meet. iOS and Android apps record in-person conversations.',
      src: ['https://otter.ai/integrations', 'https://otter.ai/meeting-agent'],
    },
    region: {
      value:
        'Its subprocessor list names Amazon Web Services in the United States for customer data storage. Its privacy policy relies on Standard Contractual Clauses for EU transfers. We found no EU region option.',
      src: ['https://otter.ai/subprocessors', PP],
    },
    training: {
      value:
        'Its privacy policy lists training its own AI on de-identified audio and transcripts as a purpose. Its Enterprise page documents a training opt-out through an account manager. Imported data such as Google Workspace documents is excluded from training.',
      src: [PP, PS, 'https://otter.ai/enterprise'],
    },
    selfhost: {
      value:
        'We found no self-hosted option described on its pricing, security or enterprise pages. It is offered as a hosted service.',
      src: [PS, 'https://otter.ai/enterprise'],
    },
    export: {
      value:
        'Basic exports mp3 and txt. Paid plans add pdf, docx and srt, and Business adds bulk export.',
      src: [PRICING],
    },
    languages: {
      value:
        'AI transcription in English, Spanish, French, German, Japanese and Chinese, according to its pricing page.',
      src: [PRICING],
    },
    speakers: {
      value: 'Speaker identification on all plans, and by name on paid plans.',
      src: [PRICING],
    },
    api: {
      value:
        'The pricing page lists an API and webhooks under Enterprise, and an MCP server from the free plan up.',
      src: [PRICING],
    },
    compliance: {
      value:
        'Says it has achieved a SOC 2 Type 2 report and incorporates GDPR standards. HIPAA is listed as an Enterprise add-on. Its security policies are based on the ISO 27001 framework, and we found no ISO 27001 certificate claim.',
      src: [PS, PRICING],
    },
  },
  strengths: [
    { text: 'Works with Zoom, Microsoft Teams and Google Meet on every plan.', src: [PRICING] },
    {
      text: 'Integrates with Slack, Notion, Jira, HubSpot, Salesforce and Zapier, and offers an MCP server.',
      src: ['https://otter.ai/integrations'],
    },
    {
      text: 'Offers bot-free recording through a desktop app and a Chrome extension for Google Meet, plus iOS and Android apps.',
      src: ['https://otter.ai/integrations'],
    },
  ],
  chooseInstead: [
    'You use Zoom. OpenMinutes does not support it.',
    'You want a managed service with Slack, CRM and project tool integrations.',
    'You want desktop, Chrome extension or mobile capture without a bot.',
    'Your company needs a vendor with a SOC 2 Type 2 report.',
  ],
};

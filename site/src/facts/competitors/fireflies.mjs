const V = '2026-10-23';
const PRICING = 'https://fireflies.ai/pricing';
const GUIDE =
  'https://guide.fireflies.ai/articles/9554534786-how-fireflies-joins-and-records-your-meetings-faqs';

export default {
  slug: 'fireflies',
  name: 'Fireflies.ai',
  site: 'https://fireflies.ai',
  verified: V,
  entry: { plan: 'Pro', monthly: 18, annual: 10, cur: 'USD' },
  oneLine: 'a hosted AI notetaker whose bot joins Zoom, Google Meet and Microsoft Teams',
  rows: {
    price: {
      value:
        'Free; Pro $10, Business $19 and Enterprise $39 per seat per month billed annually. Monthly billing is $18 for Pro and $29 for Business. Prices in USD.',
      src: [PRICING],
    },
    free: {
      value:
        'Free plan: transcription listed as unlimited, AI summaries limited, 400 minutes of storage per team and 20 AI credits.',
      src: [PRICING],
    },
    platforms: {
      value:
        'Zoom, Google Meet and Microsoft Teams, and others (its pricing page says 10+ platforms).',
      src: [PRICING, 'https://fireflies.ai/notetaker'],
    },
    capture: {
      value:
        'By default a visible bot called "Fireflies.ai Notetaker" joins and the host admits it from the lobby. Bot-free options are a Chrome extension (Google Meet only) and a Windows and Mac desktop app.',
      src: [
        GUIDE,
        'https://guide.fireflies.ai/articles/6666374717-how-to-record-meetings-without-a-bot-on-the-fireflies-desktop-app',
      ],
    },
    region: {
      value:
        'Its security FAQ says data is stored and processed in the US cloud by default. Enterprise has a Private Storage option for choosing where meeting data is stored.',
      src: [
        'https://fireflies.ai/blog/the-top-15-frequently-asked-questions-about-fireflies-security-2',
        'https://fireflies.ai/security',
      ],
    },
    training: {
      value:
        'Its Terms of Service say it will not use your content to train generative AI models, and its privacy policy says personal information is not used for AI model training.',
      src: ['https://fireflies.ai/terms-of-service', 'https://fireflies.ai/privacy-policy'],
    },
    selfhost: {
      value:
        'We found no self-hosted option on its pricing, security or FAQ pages. It is offered as a hosted service.',
      src: ['https://fireflies.ai/security'],
    },
    export: {
      value:
        'Transcripts as PDF, DOCX, SRT, CSV, JSON or Markdown. Downloads need the Pro plan or higher.',
      src: [
        'https://guide.fireflies.ai/articles/3319752033-how-to-download-transcripts-summaries-and-meeting-recordings-from-fireflies',
      ],
    },
    languages: { value: 'Transcription in 100+ languages, per its pricing page.', src: [PRICING] },
    speakers: {
      value: 'Shows who said what and talk time.',
      src: ['https://fireflies.ai/notetaker'],
    },
    api: {
      value: 'GraphQL API with per-plan rate limits.',
      src: ['https://docs.fireflies.ai/', PRICING],
    },
    compliance: {
      value:
        'Claims SOC 2 Type II, GDPR and ISO 42001. HIPAA is Enterprise with Private Storage only.',
      src: ['https://fireflies.ai/security', PRICING],
    },
  },
  /** Things that are good about the product, stated without comparison. */
  strengths: [
    {
      text: 'Joins Zoom, Google Meet and Microsoft Teams, and lists integrations with 100+ apps including HubSpot, Salesforce and Slack.',
      src: ['https://fireflies.ai/integrations'],
    },
    {
      text: 'No servers or setup on your side. Sign in and connect your calendar.',
      src: [PRICING],
    },
    {
      text: 'Offers bot-free recording through a Chrome extension (Google Meet only) and a desktop app.',
      src: [GUIDE],
    },
  ],
  /** Concrete reasons to pick it over OpenMinutes. */
  chooseInstead: [
    'You use Zoom. OpenMinutes does not support it.',
    'You want CRM, Slack and 100+ ready-made integrations without building anything.',
    'You do not want to run a server or bring your own AI keys.',
    'You need bot-free capture: Fireflies has a Chrome extension (Google Meet only) and a desktop app.',
    'Your company needs vendor assurances such as SOC 2 Type II or a signed HIPAA BAA, which Fireflies says it offers (HIPAA on Enterprise with Private Storage).',
  ],
};

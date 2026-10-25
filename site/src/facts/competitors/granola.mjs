const V = '2026-10-23';
const PRICING = 'https://www.granola.ai/pricing';
const D = 'https://docs.granola.ai/help-center/';
const SEC = `${D}consent-security-privacy/security-privacy-data-faqs`;

export default {
  slug: 'granola',
  name: 'Granola',
  site: 'https://www.granola.ai',
  verified: V,
  entry: { plan: 'Business', monthly: 14, annual: null, cur: 'USD' },
  oneLine:
    'a notepad app for Mac, Windows, iOS and Android that records your device audio instead of sending a bot',
  rows: {
    price: {
      value:
        'Basic $0, Business $14 and Enterprise $35 per user per month, in USD. Business is billed monthly.',
      src: [PRICING, 'https://docs.granola.ai/article/updates-to-our-individual-plan'],
    },
    free: {
      value:
        'Basic plan: notes stay viewable for 30 days, Slack is the only integration, and there is no API.',
      src: [PRICING],
    },
    platforms: {
      value:
        'Apps for macOS, Windows, iOS and Android. Because it records your device audio it works with any meeting app. The web app only views and edits notes.',
      src: ['https://www.granola.ai/', `${D}taking-notes/transcription`],
    },
    capture: {
      value:
        'No bot joins the meeting. It records your computer audio and microphone. Audio is streamed to a third-party transcription provider and deleted after transcription.',
      src: [SEC, `${D}taking-notes/transcription`],
    },
    region: {
      value:
        'All data is stored on AWS in the United States. It says it offers no EU, UK or other regional data residency.',
      src: [SEC],
    },
    training: {
      value:
        'By default it may use anonymized data to improve its services, with an opt-out in settings. Enterprise is opted out by default.',
      src: [`${D}consent-security-privacy/model-training`],
    },
    selfhost: {
      value: 'No self-hosted option is documented.',
      src: [`${D}consent-security-privacy/model-training`],
    },
    export: {
      value: 'CSV export only, emailed to you, for your own notes, once per 24 hours.',
      src: [`${D}sharing/exporting-notes`],
    },
    languages: {
      value: '31 languages on desktop and 17 on mobile.',
      src: [`${D}customising-granola/multi-language`],
    },
    speakers: {
      value:
        'Names come from the meeting app (Google Meet, Zoom or Teams desktop). Without that, the transcript shows only "Me" and "Them".',
      src: [`${D}taking-notes/speaker-attribution`],
    },
    api: {
      value: 'REST API and webhooks on Business and Enterprise, and MCP tools.',
      src: ['https://docs.granola.ai/api-reference/changelog', 'https://docs.granola.ai/webhooks'],
    },
    compliance: {
      value:
        'Holds SOC 2 Type II, claims GDPR and UK GDPR compliance, HIPAA only on Enterprise. ISO 27001 is not yet available.',
      src: [SEC],
    },
  },
  strengths: [
    { text: 'No bot joins the meeting, which suits sensitive or small conversations.', src: [SEC] },
    {
      text: 'Works with any meeting app because it records audio on your device, including in-person conversations on mobile.',
      src: ['https://www.granola.ai/'],
    },
    { text: 'AI-enhanced notes, templates and chat across your meetings.', src: [PRICING] },
  ],
  chooseInstead: [
    'You do not want a bot in the meeting at all. OpenMinutes always joins visibly.',
    'You use Zoom, or a meeting tool that OpenMinutes does not join.',
    'You want a desktop or mobile app rather than a server.',
    'You want AI-enhanced notes with templates and chat across meetings, from an app on your device.',
    'You are fine with data in the US and want SOC 2 Type II from the vendor.',
  ],
};

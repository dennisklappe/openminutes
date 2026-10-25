const V = '2026-10-23';
const PRICING = 'https://www.read.ai/plans-pricing';
const HC = 'https://support.read.ai/hc/en-us/articles/';

export default {
  slug: 'read-ai',
  name: 'Read AI',
  site: 'https://www.read.ai',
  verified: V,
  entry: { plan: 'Pro', monthly: 19.75, annual: 15, cur: 'USD' },
  oneLine: 'a hosted AI notetaker and meeting assistant for Zoom, Microsoft Teams and Google Meet',
  rows: {
    price: {
      value:
        'Free; Pro $15, Enterprise $22.50 and Enterprise+ $29.75 per user per month billed annually ($19.75, $29.75 and $39.75 billed monthly). Prices in USD.',
      src: [`${HC}22307341312275`, PRICING],
    },
    free: {
      value:
        'Free plan: 5 meeting transcripts and reports per month, up to 1 hour per meeting, no playback or uploads.',
      src: [PRICING, `${HC}22307341312275`],
    },
    platforms: {
      value: 'Zoom, Microsoft Teams and Google Meet. It cannot join other platforms such as Webex.',
      src: [`${HC}23181372301587`],
    },
    capture: {
      value:
        'By default it joins as a visible participant. There is a bot-free option for Google Meet, and desktop and mobile apps that record audio on the device.',
      src: [`${HC}23181372301587`, `${HC}42785087487251`, `${HC}45911611006995`],
    },
    region: {
      value:
        'Its security overview says data is stored in AWS us-east-1 (Northern Virginia, USA), with other locations only through sales. We found no official EU residency statement.',
      src: [`${HC}25702259763091`],
    },
    training: {
      value:
        "It says it does not train on meeting content without your explicit opt-in, with a Customer Experience program as the exception. Its own pages differ on that program's default, so we state none.",
      src: [`${HC}52055801266579`, 'https://www.read.ai/privacy-policy'],
    },
    selfhost: {
      value:
        'We found no self-hosted option on its public pricing or help pages. It is offered as a hosted service.',
      src: [PRICING],
    },
    export: {
      value:
        'Report content can be downloaded from a Download menu unless the workspace disables downloads, and reports can be saved to Google Docs or Microsoft OneNote. We could not confirm the file formats.',
      src: [`${HC}23833171061139`, `${HC}48660402148627`],
    },
    languages: {
      value: 'About 35 languages for meeting reports, according to its help center.',
      src: [`${HC}22189506678803`],
    },
    speakers: {
      value:
        'We could not confirm how it labels speakers from its own pages, so we make no claim here.',
      src: [`${HC}49381158409491`],
    },
    api: {
      value: 'Public REST API and MCP server, both in open beta and available on all plans.',
      src: [`${HC}49381161088659`, `${HC}49381158409491`],
    },
    compliance: {
      value:
        'Says it has achieved SOC 2 Type 2 and is GDPR compliant, and signs HIPAA BAAs (HIPAA is listed as an Enterprise+ feature).',
      src: [`${HC}25702259763091`, `${HC}52055801266579`, PRICING],
    },
  },
  strengths: [
    {
      text: 'Joins Zoom, Microsoft Teams and Google Meet, and integrates with HubSpot, Salesforce, Slack, Notion, Jira and more.',
      src: ['https://www.read.ai/integrations'],
    },
    {
      text: 'Offers bot-free capture on Google Meet and on-device audio capture in its desktop and mobile apps.',
      src: [`${HC}42785087487251`, `${HC}45911611006995`],
    },
    {
      text: 'Documents ways for participants to opt out: any participant can type a command in the meeting chat, and admins can enable advance notice for external invitees.',
      src: [`${HC}52118782802579`, `${HC}55230546830995`],
    },
  ],
  chooseInstead: [
    'You use Zoom. OpenMinutes does not support it.',
    'You want CRM, Slack, Notion and Jira integrations and a managed service.',
    'You want a bot-free option on Google Meet, or an on-device recorder.',
    'Your company needs SOC 2 Type 2 from the vendor or a HIPAA BAA.',
  ],
};

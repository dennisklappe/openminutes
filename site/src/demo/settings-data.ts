export type Field =
  | {
      kind: 'text' | 'password' | 'number' | 'area';
      key: string;
      label: string;
      value: string;
      help?: string;
      placeholder?: string;
    }
  | {
      kind: 'select' | 'segmented';
      key: string;
      label: string;
      value: string;
      options: [string, string][];
      help?: string;
    }
  | { kind: 'check'; key: string; label: string; value: boolean; help?: string };

export interface PanelDef {
  id: string;
  title: string;
  description?: string;
  fields: Field[];
  facts?: [string, string][];
  save?: string;
  actions?: { label: string; result: string }[];
}

export interface SectionDef {
  id: string;
  label: string;
  description: string;
  panels: PanelDef[];
}

const choices = (...labels: string[]): [string, string][] => labels.map((label) => [label, label]);

export const sections: SectionDef[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Appearance, how many meetings run at once, and the first-run setup.',
    panels: [
      {
        id: 'appearance',
        title: 'Appearance',
        description: 'Applies to this browser only.',
        fields: [
          {
            kind: 'segmented',
            key: 'theme',
            label: 'Theme',
            value: 'System',
            options: choices('System', 'Light', 'Dark'),
          },
        ],
      },
      {
        id: 'limits',
        title: 'Meeting limits',
        description:
          'Each meeting at the same time needs about 1 CPU core and 1.5 GB of memory. Meetings over the limit wait in the queue until a slot is free.',
        save: 'Save changes',
        fields: [
          { kind: 'number', key: 'parallel', label: 'Meetings at the same time', value: '2' },
          {
            kind: 'number',
            key: 'maxMinutes',
            label: 'Longest meeting (minutes)',
            value: '240',
            help: 'The bot leaves after this long.',
          },
        ],
      },
      {
        id: 'wizard',
        title: 'Setup wizard',
        description: 'Walk through the first-run setup again. Your current settings are kept.',
        fields: [],
        actions: [
          {
            label: 'Open the setup wizard',
            result: 'Setup wizard opened. Your current settings are kept.',
          },
        ],
      },
    ],
  },
  {
    id: 'bot',
    label: 'Bot identity',
    description: 'The name, chat message and camera image the bot joins with.',
    panels: [
      {
        id: 'identity',
        title: 'Name and chat message',
        save: 'Save changes',
        actions: [{ label: 'Use defaults', result: 'Defaults restored. Save to keep them.' }],
        fields: [
          {
            kind: 'text',
            key: 'botName',
            label: 'Display name',
            value: 'OpenMinutes Notetaker',
            help: 'Shown to everyone in the participant list.',
          },
          {
            kind: 'check',
            key: 'joinMessageOn',
            label: 'Post a chat message when the bot joins',
            value: true,
          },
          {
            kind: 'text',
            key: 'joinMessage',
            label: 'Join message',
            value:
              'OpenMinutes notetaker is recording notes for this meeting. For more info see https://openminut.es/',
            help: 'Posted in the meeting chat when the bot joins. {{name}} becomes the bot name.',
          },
        ],
      },
      {
        id: 'camera',
        title: 'Camera image',
        description:
          'Optional. With an image the bot turns its camera on and shows it as its video. Without one it joins with the camera off.',
        fields: [],
        actions: [{ label: 'Upload image', result: 'Image saved.' }],
      },
    ],
  },
  {
    id: 'minutes',
    label: 'Minutes',
    description:
      'How a meeting is written up when you share or export it. Every minutes document ends with a small "Powered by OpenMinutes" line.',
    panels: [
      {
        id: 'template',
        title: 'Template',
        description: 'Used for share links and exports. The preview below shows a demo meeting.',
        save: 'Save changes',
        fields: [
          {
            kind: 'select',
            key: 'template',
            label: 'Layout',
            value: 'Standard',
            options: choices('Standard', 'Compact', 'Detailed'),
          },
          { kind: 'check', key: 'attendees', label: 'List the attendees', value: true },
          { kind: 'check', key: 'actionTable', label: 'Show action items as a table', value: true },
        ],
      },
      {
        id: 'logo',
        title: 'Logo',
        description: 'Shown first on every minutes document. Optional.',
        fields: [],
        actions: [{ label: 'Upload logo', result: 'Logo saved.' }],
      },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    description:
      'How minutes are emailed to attendees. Pick a provider, set the sender, and send yourself a test mail. Nothing is ever sent without a click.',
    panels: [
      {
        id: 'mail-provider',
        title: 'Provider',
        save: 'Save changes',
        fields: [
          {
            kind: 'select',
            key: 'mailProvider',
            label: 'Provider',
            value: 'SMTP',
            options: choices('SMTP', 'Resend', 'Postmark'),
          },
          {
            kind: 'text',
            key: 'smtpHost',
            label: 'Host',
            value: '',
            placeholder: 'smtp.example.com',
          },
          {
            kind: 'password',
            key: 'smtpPassword',
            label: 'Password',
            value: '',
            placeholder: 'xxxxxxxxxxxx',
          },
        ],
      },
      {
        id: 'sender',
        title: 'Sender and message',
        description:
          'Minutes are sent from this address, one separate mail per person. The test mail only ever goes to your own address.',
        save: 'Save changes',
        actions: [{ label: 'Send test mail', result: 'Test mail sent to you@example.com.' }],
        fields: [
          { kind: 'text', key: 'fromName', label: 'From name', value: 'OpenMinutes' },
          { kind: 'text', key: 'fromAddress', label: 'From address', value: 'minutes@example.com' },
          {
            kind: 'text',
            key: 'ownAddress',
            label: 'Your own address',
            value: 'you@example.com',
            help: 'Test mails go here and nowhere else.',
          },
          { kind: 'text', key: 'subject', label: 'Subject', value: 'Minutes: {{title}}' },
          {
            kind: 'area',
            key: 'message',
            label: 'Message',
            value: 'Hi {{name}},\n\nThe minutes of {{title}} are ready: {{link}}',
            help: 'Placeholders: {{name}} {{title}} {{link}}.',
          },
        ],
      },
    ],
  },
  {
    id: 'calendars',
    label: 'Calendar accounts',
    description:
      'Connect a calendar and OpenMinutes joins the Meet and Teams meetings in it. New calendars start on Never, so nothing is joined until you pick a rule.',
    panels: [
      {
        id: 'calendar-google',
        title: 'Google',
        save: 'Save changes',
        actions: [
          {
            label: 'Connect Google',
            result: 'Connected you@example.com. Pick a join rule for each calendar below.',
          },
        ],
        fields: [
          {
            kind: 'text',
            key: 'googleId',
            label: 'Client ID',
            value: '',
            placeholder: 'xxxx.apps.googleusercontent.com',
          },
          {
            kind: 'password',
            key: 'googleSecret',
            label: 'Client secret',
            value: '',
            placeholder: 'xxxxxxxxxxxx',
          },
        ],
      },
      {
        id: 'calendar-rules',
        title: 'you@example.com',
        description: 'Google calendar',
        save: 'Save changes',
        actions: [
          {
            label: 'Disconnect',
            result: 'Disconnected. Meetings queued from this account are cancelled.',
          },
        ],
        fields: [
          {
            kind: 'select',
            key: 'joinRule',
            label: 'Join rule',
            value: 'Only meetings I organize',
            options: choices(
              'Join all meetings',
              'Only meetings I organize',
              'Only with external guests',
              'Never',
            ),
          },
        ],
      },
    ],
  },
  {
    id: 'google-meet',
    label: 'Google Meet sign-in',
    description: 'Let the bot join Google Meet with its own Google account instead of as a guest.',
    panels: [
      {
        id: 'meet-login',
        title: 'Sign in with email and password',
        description:
          'Optional. The bot signs in again by itself whenever the session ends. The details are stored encrypted on your own server and are never shown again.',
        save: 'Save changes',
        fields: [
          {
            kind: 'text',
            key: 'botEmail',
            label: 'Bot account email',
            value: '',
            placeholder: 'bot@example.com',
          },
          {
            kind: 'password',
            key: 'botPassword',
            label: 'Password',
            value: '',
            placeholder: 'xxxxxxxxxxxx',
          },
          {
            kind: 'password',
            key: 'botTotp',
            label: 'Authenticator secret (optional)',
            value: '',
            placeholder: 'XXXX XXXX XXXX XXXX',
          },
        ],
      },
    ],
  },
  {
    id: 'phone',
    label: 'Phone recorder',
    description: 'Record in-person conversations from your phone.',
    panels: [
      {
        id: 'phone-recorder',
        title: 'Phone recorder',
        description:
          "Record a conversation with your phone's microphone and get minutes like any other meeting. The recorder shows the notice below before it starts.",
        save: 'Save changes',
        fields: [
          { kind: 'check', key: 'phoneOn', label: 'Allow recording from a phone', value: true },
          {
            kind: 'area',
            key: 'consent',
            label: 'Consent notice',
            value: 'Tell everyone present that this conversation is recorded and transcribed.',
          },
        ],
      },
    ],
  },
  {
    id: 'transcription',
    label: 'Transcription',
    description:
      'Each meeting is transcribed after it ends. The local Whisper service needs no key.',
    panels: [
      {
        id: 'transcription-provider',
        title: 'Provider',
        save: 'Save changes',
        actions: [{ label: 'Test connection', result: 'Connection works: whisper small.' }],
        fields: [
          {
            kind: 'select',
            key: 'sttProvider',
            label: 'Provider',
            value: 'Local Whisper',
            options: choices('Local Whisper', 'OpenAI compatible API', 'Deepgram'),
          },
          {
            kind: 'select',
            key: 'sttModel',
            label: 'Model',
            value: 'small',
            options: choices('tiny', 'base', 'small', 'medium'),
          },
          {
            kind: 'password',
            key: 'sttKey',
            label: 'API key',
            value: '',
            placeholder: 'Not needed for local Whisper',
          },
        ],
      },
    ],
  },
  {
    id: 'summaries',
    label: 'Summaries',
    description: 'A language model turns the transcript into notes. Skip it to keep summaries off.',
    panels: [
      {
        id: 'summary-provider',
        title: 'Provider',
        save: 'Save changes',
        actions: [{ label: 'Test connection', result: 'Connection works.' }],
        fields: [
          {
            kind: 'select',
            key: 'llmProvider',
            label: 'Provider',
            value: 'Anthropic',
            options: choices('None', 'Anthropic', 'OpenAI', 'Ollama'),
          },
          { kind: 'text', key: 'llmModel', label: 'Model', value: '', placeholder: 'model-name' },
          {
            kind: 'password',
            key: 'llmKey',
            label: 'API key',
            value: '',
            placeholder: 'sk-xxxxxxxxxxxx',
          },
        ],
      },
      {
        id: 'speaker-names',
        title: 'Speaker names',
        save: 'Save changes',
        fields: [
          {
            kind: 'check',
            key: 'guessNames',
            label: 'Let the language model guess speaker names from the transcript',
            value: true,
          },
        ],
      },
      {
        id: 'summary-chat',
        title: 'Meeting chat',
        description:
          'The chat is extra context for the summary. It is not retold in the notes, only links shared in it are listed under Resources.',
        save: 'Save changes',
        fields: [
          {
            kind: 'check',
            key: 'chatLinks',
            label: 'Use the meeting chat',
            value: true,
            help: 'Links shared in chat land in Resources. On by default.',
          },
        ],
      },
      {
        id: 'prompts',
        title: 'Summary prompts',
        description: 'The instructions the language model gets with each transcript.',
        save: 'Save changes',
        fields: [
          {
            kind: 'select',
            key: 'prompt',
            label: 'Prompt',
            value: 'Meeting notes',
            options: choices('Meeting notes', 'Decisions and actions', 'New prompt'),
          },
          {
            kind: 'area',
            key: 'promptText',
            label: 'Prompt text',
            value: 'Write short notes with decisions, action items and open questions.',
            help: 'Built in prompts are read only. Copy one to edit it.',
          },
        ],
      },
    ],
  },
  {
    id: 'storage',
    label: 'Storage and retention',
    description: 'Recordings stay on the local volume by default. Transcripts are always kept.',
    panels: [
      {
        id: 'recordings',
        title: 'Recordings',
        description: 'Where recordings are kept, and for how long.',
        save: 'Save changes',
        fields: [
          {
            kind: 'select',
            key: 'store',
            label: 'Store audio on',
            value: 'Local volume',
            options: choices('Local volume', 'S3-compatible bucket'),
          },
          {
            kind: 'number',
            key: 'retention',
            label: 'Delete audio after (days)',
            value: '90',
            help: 'Leave empty to keep audio forever.',
          },
        ],
      },
    ],
  },
  {
    id: 'access',
    label: 'Access and updates',
    description: 'Who can sign in, and whether OpenMinutes tells you about new versions.',
    panels: [
      {
        id: 'access',
        title: 'Access',
        description: 'This instance is protected by the admin password you chose during setup.',
        facts: [['Method', 'Admin password']],
        fields: [],
        actions: [{ label: 'Sign out', result: 'Signed out. Reload the page to sign in again.' }],
      },
      {
        id: 'updates',
        title: 'Update notices',
        description:
          'When this is on, the server asks the public GitHub releases API for the latest version at most once a day and shows a banner. It sends no identifiers. It is off by default.',
        fields: [
          {
            kind: 'check',
            key: 'updates',
            label: 'Tell me when a new version is out',
            value: false,
          },
        ],
        save: 'Save changes',
      },
    ],
  },
];

export const defaultSettings = (): Record<string, string | boolean> =>
  Object.fromEntries(
    sections.flatMap((section) =>
      section.panels.flatMap((panel) => panel.fields.map((field) => [field.key, field.value])),
    ),
  );

import { ProviderError, parseJson, request } from '@openminutes/providers';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { z } from 'zod';
import { formatAddress } from '../address.js';
import { defineMailProvider } from '../define.js';

const TIMEOUT_MS = 30_000;
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const configSchema = z.object({
  account: z.email().optional().meta({
    label: 'Google account',
    placeholder: 'bot@gmail.com',
    help: 'Only needed when several Google accounts are connected. Leave empty to use the first that can send.',
  }),
});

const sent = z.object({ id: z.string().optional() });
const profile = z.object({ emailAddress: z.string() });

function compose(options: ConstructorParameters<typeof MailComposer>[0]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    new MailComposer(options).compile().build((error, message) => {
      if (error) reject(error);
      else resolve(message);
    });
  });
}

export const gmail = defineMailProvider({
  id: 'gmail',
  label: 'Gmail (connected Google account)',
  configSchema,
  create: ({ account }, { fetch, googleToken }) => {
    const token = () => {
      if (!googleToken) {
        throw new ProviderError('gmail', 'invalid_config', 'no Google account is connected');
      }
      return googleToken(account);
    };
    const authorized = async () => ({ Authorization: `Bearer ${await token()}` });

    return {
      async send(message) {
        const raw = await compose({
          from: formatAddress(message.from),
          to: message.to,
          ...(message.replyTo && { replyTo: message.replyTo }),
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        const response = await request(
          `${API}/messages/send`,
          {
            method: 'POST',
            headers: { ...(await authorized()), 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw: raw.toString('base64url') }),
          },
          { provider: 'gmail', fetch, timeoutMs: TIMEOUT_MS },
        );
        const { id } = await parseJson('gmail', response, sent);
        return id === undefined ? {} : { id };
      },

      async test() {
        const response = await request(
          `${API}/profile`,
          { headers: await authorized() },
          { provider: 'gmail', fetch, timeoutMs: TIMEOUT_MS },
        );
        const { emailAddress } = await parseJson('gmail', response, profile);
        return { detail: `sending as ${emailAddress}` };
      },
    };
  },
});

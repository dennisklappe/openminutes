import { joinUrl, parseJson, request } from '@openminutes/providers';
import { z } from 'zod';
import { defineMailProvider } from '../define.js';
import { formatAddress } from '../address.js';

const TIMEOUT_MS = 30_000;

const API_URL = 'https://api.emailit.com/v2';

const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const configSchema = z.object({
  apiKey: z
    .string()
    .min(1)
    .meta({ label: 'API key', help: 'An Emailit API key that may send mail.' }),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(DOMAIN, 'Enter a domain such as mail.example.com')
    .meta({
      label: 'Sending domain',
      placeholder: 'mail.example.com',
      help: 'A domain verified in Emailit. Mail goes out from an address on this domain.',
    }),
});

const sent = z.object({ id: z.string().optional() });

export const emailit = defineMailProvider({
  id: 'emailit',
  label: 'Emailit',
  configSchema,
  create: ({ apiKey }, { fetch }) => ({
    async send(message) {
      const response = await request(
        joinUrl(API_URL, '/emails'),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: formatAddress(message.from),
            to: message.to,
            ...(message.replyTo && { reply_to: message.replyTo }),
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        },
        { provider: 'emailit', fetch, timeoutMs: TIMEOUT_MS },
      );
      const { id } = await parseJson('emailit', response, sent);
      return id === undefined ? {} : { id };
    },

    test() {
      return Promise.resolve({
        detail: 'the key is saved, send a test mail to check the sending domain',
      });
    },
  }),
});

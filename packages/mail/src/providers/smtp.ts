import { ProviderError } from '@openminutes/providers';
import { createTransport, type Transporter } from 'nodemailer';
import { z } from 'zod';
import { formatAddress } from '../address.js';
import { defineMailProvider } from '../define.js';

const TIMEOUT_MS = 30_000;

const configSchema = z.object({
  host: z.string().min(1).meta({ label: 'Server', placeholder: 'smtp.example.com' }),
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(587)
    .meta({ label: 'Port', help: '587 for STARTTLS, 465 for implicit TLS.' }),
  secure: z
    .boolean()
    .default(false)
    .meta({ label: 'Use implicit TLS', help: 'Tick this for port 465. Leave it off for 587.' }),
  username: z.string().optional().meta({ label: 'Username' }),
  password: z.string().optional().meta({ label: 'Password' }),
});

function failure(error: unknown): ProviderError {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  return new ProviderError(
    'smtp',
    code === 'EAUTH' ? 'auth' : code === 'ETIMEDOUT' ? 'timeout' : 'network',
    message,
    undefined,
    { cause: error },
  );
}

export const smtp = defineMailProvider({
  id: 'smtp',
  label: 'SMTP',
  configSchema,
  create: ({ host, port, secure, username, password }) => {
    const transport: Transporter = createTransport({
      host,
      port,
      secure,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
      ...(username && { auth: { user: username, pass: password ?? '' } }),
    });
    return {
      async send(message) {
        try {
          const info = (await transport.sendMail({
            from: formatAddress(message.from),
            to: message.to,
            ...(message.replyTo && { replyTo: message.replyTo }),
            subject: message.subject,
            text: message.text,
            html: message.html,
          })) as { messageId?: string };
          return info.messageId === undefined ? {} : { id: info.messageId };
        } catch (error) {
          throw failure(error);
        } finally {
          transport.close();
        }
      },

      async test() {
        try {
          await transport.verify();
          return { detail: `connected to ${host}` };
        } catch (error) {
          throw failure(error);
        } finally {
          transport.close();
        }
      },
    };
  },
});

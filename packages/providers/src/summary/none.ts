import { z } from 'zod';
import { defineSummaryProvider } from '../define.js';

export const none = defineSummaryProvider({
  id: 'none',
  label: 'None',
  configSchema: z.object({}),
  create: () => ({
    model: '',
    maxInputChars: Number.MAX_SAFE_INTEGER,
    summarize: () => Promise.resolve(''),
    test: () => Promise.resolve({ detail: 'Summaries are disabled' }),
  }),
});

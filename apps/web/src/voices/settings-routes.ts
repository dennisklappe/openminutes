import {
  forgetVoices,
  parseVoiceTuning,
  VOICE_TUNING_DEFAULTS,
  VOICE_TUNING_KEYS,
  VOICE_TUNING_RANGE,
  type VoiceTuning,
} from '@openminutes/core';
import { eq, people, sql, voiceSamples } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { VoiceSettingsDto } from '../dto.js';
import { checkEnabled, rememberEnabled, type VoiceDeps } from './load.js';

const number = (name: keyof VoiceTuning) => {
  const [low, high] = VOICE_TUNING_RANGE[name];
  return z.number().min(low).max(high).optional();
};
const input = z
  .strictObject({
    remember: z.boolean().optional(),
    check: z.boolean().optional(),
    readySeconds: number('readySeconds'),
    readyMeetings: number('readyMeetings'),
    readyWays: number('readyWays'),
    agreeScore: number('agreeScore'),
    mergeSimilarity: number('mergeSimilarity'),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined));

export function voiceSettingsRoutes({ db, settings }: VoiceDeps): Hono {
  const routes = new Hono();

  const tuning = async (): Promise<VoiceTuning> =>
    parseVoiceTuning(
      Object.fromEntries(
        await Promise.all(
          Object.values(VOICE_TUNING_KEYS).map(async (key) => [key, await settings.get(key)]),
        ),
      ),
    );

  const read = async (): Promise<VoiceSettingsDto> => ({
    remember: await rememberEnabled(settings),
    check: await checkEnabled(settings),
    tuning: await tuning(),
    tuningDefaults: VOICE_TUNING_DEFAULTS,
    known: (
      await db
        .select({
          id: people.id,
          name: people.name,
          samples: sql<number>`coalesce(sum(${voiceSamples.weight}), 0)::int`,
          updatedAt: sql<Date>`max(${voiceSamples.createdAt})`,
        })
        .from(people)
        .innerJoin(voiceSamples, eq(voiceSamples.personId, people.id))
        .where(eq(voiceSamples.rejected, false))
        .groupBy(people.id)
        .orderBy(people.name)
    ).map((row) => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString() })),
  });

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid voice settings' }, 400);
    if (body.data.remember !== undefined) {
      await settings.set('voices.remember', String(body.data.remember));
    }
    if (body.data.check !== undefined) await settings.set('voices.check', String(body.data.check));
    for (const name of Object.keys(VOICE_TUNING_KEYS) as (keyof VoiceTuning)[]) {
      const value = body.data[name];
      if (value !== undefined) await settings.set(VOICE_TUNING_KEYS[name], String(value));
    }
    return c.json(await read());
  });

  routes.delete('/:id', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Voice not found' }, 404);
    const [found] = await db
      .select({ id: voiceSamples.id })
      .from(voiceSamples)
      .where(eq(voiceSamples.personId, id.data))
      .limit(1);
    if (!found) return c.json({ error: 'Voice not found' }, 404);
    await forgetVoices(db, [id.data]);
    return c.json(await read());
  });

  routes.delete('/', async (c) => {
    await forgetVoices(db);
    return c.json(await read());
  });

  return routes;
}

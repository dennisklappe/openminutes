import { eq, knownVoices, type Database } from '@openminutes/db';
import { mergeEmbeddings } from './voices.js';

type Writer = Pick<Database, 'select' | 'insert' | 'update'>;

/**
 * Stores a voice under a name, averaging it into what is already remembered for that name. The
 * email, when known, is kept with it so the person can be told apart from a namesake.
 */
export async function rememberVoice(
  db: Writer,
  name: string,
  embedding: number[],
  email?: string | null,
): Promise<void> {
  const [existing] = await db.select().from(knownVoices).where(eq(knownVoices.name, name));
  const now = new Date();
  if (!existing) {
    await db.insert(knownVoices).values({ name, embedding, email: email ?? null });
  } else if (existing.embedding.length === embedding.length) {
    await db
      .update(knownVoices)
      .set({
        embedding: mergeEmbeddings(existing.embedding, existing.samples, embedding),
        samples: existing.samples + 1,
        ...(email && { email }),
        updatedAt: now,
      })
      .where(eq(knownVoices.id, existing.id));
  } else {
    await db
      .update(knownVoices)
      .set({ embedding, samples: 1, ...(email && { email }), updatedAt: now })
      .where(eq(knownVoices.id, existing.id));
  }
}

import { eq, knownVoices, type Database } from '@openminutes/db';
import { mergeEmbeddings } from './voices.js';

type Writer = Pick<Database, 'select' | 'insert' | 'update'>;

/** Stores a voice under a name, averaging it into what is already remembered for that name. */
export async function rememberVoice(db: Writer, name: string, embedding: number[]): Promise<void> {
  const [existing] = await db.select().from(knownVoices).where(eq(knownVoices.name, name));
  const now = new Date();
  if (!existing) {
    await db.insert(knownVoices).values({ name, embedding });
  } else if (existing.embedding.length === embedding.length) {
    await db
      .update(knownVoices)
      .set({
        embedding: mergeEmbeddings(existing.embedding, existing.samples, embedding),
        samples: existing.samples + 1,
        updatedAt: now,
      })
      .where(eq(knownVoices.id, existing.id));
  } else {
    await db
      .update(knownVoices)
      .set({ embedding, samples: 1, updatedAt: now })
      .where(eq(knownVoices.id, existing.id));
  }
}

import { findPersonByName } from '@openminutes/core';
import { eq, people, type Database } from '@openminutes/db';
import { mergePeople, PeopleError, updatePerson } from './edit.js';

export type NameVoiceInput = { name: string } | { personId: string };

/**
 * Gives a voice of a shared account its name. The person made for the voice is renamed and
 * becomes a person like any other, or, when the name is someone who exists already or an
 * existing person is picked, folded into them: voice samples, lines and meetings move over.
 * Returns the person the voice is now.
 */
export async function nameVoicePerson(
  db: Database,
  personId: string,
  input: NameVoiceInput,
): Promise<string> {
  const [person] = await db.select().from(people).where(eq(people.id, personId));
  if (!person) throw new PeopleError('Person not found', 404);
  if (!person.unnamed) throw new PeopleError('This voice is named already', 409);
  if ('personId' in input) {
    if (input.personId === personId) throw new PeopleError('Pick someone else', 400);
    await mergePeople(db, input.personId, personId);
    return input.personId;
  }
  const twin = await findPersonByName(db, input.name);
  if (twin && twin.id !== personId) {
    await mergePeople(db, twin.id, personId);
    return twin.id;
  }
  await updatePerson(db, personId, { name: input.name });
  await db.update(people).set({ unnamed: false }).where(eq(people.id, personId));
  return personId;
}

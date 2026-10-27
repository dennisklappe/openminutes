import { inArray, people, sql } from '@openminutes/db';
import type { PeopleDto, PeopleQuery } from '../dto.js';
import { checkEnabled, rememberEnabled } from '../voices/load.js';
import { loadDuplicates, reviewCounts, toDto, type PeopleDeps } from './load.js';
import { loadProfileRows } from './profiles.js';
import { loadReviewQueue } from './review.js';
import { loadMeetingStats, seenStats } from './stats.js';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/**
 * One page of people, searched, filtered and sorted in the database so the list stays fast with
 * thousands of people. "joined" is everyone who is not only on an invitation.
 */
export async function loadPeoplePage(
  deps: PeopleDeps,
  query: PeopleQuery = {},
): Promise<PeopleDto> {
  const { db } = deps;
  const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(query.page ?? 1, 1);
  const needle = query.q?.trim() ?? '';
  const filters = [
    needle === ''
      ? undefined
      : sql`(p.name ilike ${likePattern(needle)} or p.emails::text ilike ${likePattern(needle)} or coalesce(p.notes, '') ilike ${likePattern(needle)})`,
    query.source === 'joined' ? sql`p.source <> 'invited'` : undefined,
    query.source === 'invited' ? sql`p.source = 'invited'` : undefined,
    query.tracking === 'untracked' ? sql`p.tracking = 'off'` : undefined,
    query.tracking === 'all' || query.tracking === 'untracked' ? undefined : sql`p.tracking = 'on'`,
  ].filter((filter) => filter !== undefined);
  const where = filters.length > 0 ? sql`where ${sql.join(filters, sql` and `)}` : sql``;
  const direction = query.dir === 'desc' ? sql`desc` : sql`asc`;
  const order =
    query.sort === 'meetings'
      ? sql`coalesce(st.meetings, 0) ${direction}, lower(p.name), p.id`
      : query.sort === 'lastSeen'
        ? sql`st.last_seen ${direction} nulls last, lower(p.name), p.id`
        : sql`lower(p.name) ${direction}, p.id`;

  const { rows: found } = await db.execute<{ id: string; total: number }>(sql`
    with st as (${seenStats()})
    select p.id, count(*) over ()::int as total
    from people p left join st on st.person_id = p.id
    ${where}
    order by ${order}
    limit ${pageSize} offset ${(page - 1) * pageSize}`);
  let total = found[0]?.total;
  if (total === undefined) {
    const { rows } = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from people p ${where}`,
    );
    total = rows[0]?.total ?? 0;
  }

  const { rows: invited } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from people where source = 'invited' and tracking = 'on'`,
  );
  const allReview = await reviewCounts(db);
  const ids = found.map((row) => row.id);
  const [rows, samples, seen, review, dupes] = await Promise.all([
    ids.length === 0 ? [] : db.select().from(people).where(inArray(people.id, ids)),
    loadProfileRows(db, ids),
    loadMeetingStats(db, ids),
    reviewCounts(db, ids),
    loadDuplicates(db),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    people: ids.flatMap((id) => {
      const person = byId.get(id);
      return person
        ? [
            toDto(
              person,
              samples.filter((sample) => sample.personId === id),
              seen,
              review,
              dupes,
            ),
          ]
        : [];
    }),
    total,
    needsReview: [...allReview.values()].reduce((sum, n) => sum + n, 0),
    reviewable: (await loadReviewQueue(deps))?.lines.length ?? 0,
    invitedOnly: invited[0]?.n ?? 0,
    page,
    pageSize,
    learning: await rememberEnabled(deps.settings),
    checking: await checkEnabled(deps.settings),
  };
}

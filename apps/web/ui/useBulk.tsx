import { useState, type ReactNode } from 'react';
import type { BulkResultDto } from '../src/dto.js';
import { api, errorMessage, type BulkAction } from './api.js';
import { useConfirm, type ConfirmOptions } from './Confirm.js';

const DAYS = 30;

const subject = (titles: string[]): ReactNode =>
  titles.length === 1 ? <strong>{titles[0]}</strong> : `${String(titles.length)} meetings`;

const confirmations: Partial<Record<BulkAction, (titles: string[]) => ConfirmOptions>> = {
  delete: (titles) => ({
    title:
      titles.length === 1 ? 'Delete this meeting?' : `Delete ${String(titles.length)} meetings?`,
    body: (
      <>
        <p>
          {subject(titles)} moves to the bin for {DAYS} days, then deleted forever. The share link
          stops working now.
        </p>
        <p>
          Links already written into calendar events stay there, but they no longer open the
          minutes. To keep it without cluttering your lists, archive it instead.
        </p>
      </>
    ),
    confirmLabel: 'Move to bin',
    destructive: true,
  }),
  purge: (titles) => ({
    title: 'Delete forever?',
    body: (
      <p>
        {subject(titles)} is deleted now, with the audio, transcript, summaries and speaker data.
        This cannot be undone.
      </p>
    ),
    confirmLabel: 'Delete forever',
    destructive: true,
  }),
};

const done: Record<BulkAction, string> = {
  archive: 'archived',
  unarchive: 'unarchived',
  delete: 'moved to the bin',
  restore: 'restored',
  purge: 'deleted forever',
};

export interface BulkNotice {
  text: string;
  link?: { href: string; label: string };
}

const noticeLinks: Partial<Record<BulkAction, BulkNotice['link']>> = {
  archive: { href: '#/archive', label: 'View archive' },
  delete: { href: '#/bin', label: 'View bin' },
};

/** A notice handed to the next page, for actions that leave the page they ran on. */
let carried: { notice: BulkNotice; at: number } | undefined;
const CARRY_MS = 10_000;

export function carryNotice(notice: BulkNotice | undefined) {
  carried = notice ? { notice, at: Date.now() } : undefined;
}

function takeCarried(): BulkNotice | undefined {
  const found = carried && Date.now() - carried.at < CARRY_MS ? carried.notice : undefined;
  carried = undefined;
  return found;
}

function bulkNotice(action: BulkAction, { changed, skipped }: BulkResultDto): BulkNotice {
  const noun = changed === 1 ? 'meeting' : 'meetings';
  const left =
    skipped > 0 ? `, ${String(skipped)} skipped because they are running or upcoming` : '';
  const link = changed > 0 ? noticeLinks[action] : undefined;
  return {
    text: `${String(changed)} ${noun} ${done[action]}${left}.`,
    ...(link && { link }),
  };
}

/** Runs archive, delete, restore and friends on one or many meetings, after the right confirmation. */
export function useBulk(onChanged: () => void) {
  const confirm = useConfirm();
  const [notice, setNotice] = useState<BulkNotice | undefined>(takeCarried);
  const [error, setError] = useState<string>();

  const run = async (
    action: BulkAction,
    items: { id: string; title: string }[],
    options?: { carry?: boolean },
  ) => {
    const ask = confirmations[action];
    if (ask && !(await confirm(ask(items.map((item) => item.title))))) return false;
    try {
      const result = await api.bulkMeetings(
        action,
        items.map((item) => item.id),
      );
      setError(undefined);
      const next = bulkNotice(action, result);
      setNotice(next);
      if (options?.carry) carryNotice(next);
      onChanged();
      return true;
    } catch (failure) {
      setNotice(undefined);
      setError(errorMessage(failure));
      return false;
    }
  };

  return { run, notice, error };
}

export function BulkMessages({
  bulk,
}: {
  bulk: Pick<ReturnType<typeof useBulk>, 'notice' | 'error'>;
}) {
  return (
    <>
      {bulk.notice && (
        <p className="banner" role="status">
          <span>{bulk.notice.text}</span>
          {bulk.notice.link && (
            <span className="banner-links">
              <a href={bulk.notice.link.href}>{bulk.notice.link.label}</a>
            </span>
          )}
        </p>
      )}
      {bulk.error && <p className="banner banner-error">{bulk.error}</p>}
    </>
  );
}

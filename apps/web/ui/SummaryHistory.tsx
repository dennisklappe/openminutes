import type { SummaryDto } from '../src/dto.js';
import { formatDate } from './format.js';

export function SummaryHistory(props: {
  summaries: SummaryDto[];
  viewed: string | undefined;
  locked: boolean;
  onView: (id: string) => void;
  onRestore: (summary: SummaryDto) => void;
}) {
  const { summaries, viewed, locked, onView, onRestore } = props;
  return (
    <section className="history" aria-labelledby="history-title">
      <h3 id="history-title">History</h3>
      <p className="hint">
        One version is active. Shared links, emails and the Google Doc and Word exports always show
        the active version. Regenerating adds a new AI version and makes it active. Restoring adds a
        copy of an older version as the newest one, so nothing is ever lost.
      </p>
      <ul className="history-list">
        {summaries.map((summary) => (
          <li key={summary.id} className={summary.id === viewed ? 'is-viewed' : undefined}>
            <span className="history-main">
              <strong>Version {summary.version}</strong>
              {summary.active && <span className="pill pill-transcribed">Active</span>}
              {summary.status === 'pending' && <span className="pill">Generating</span>}
              {summary.status === 'failed' && <span className="pill pill-failed">Failed</span>}
              <span className="muted">{summary.author}</span>
              <time className="muted" dateTime={summary.createdAt}>
                {formatDate(summary.createdAt)}
              </time>
            </span>
            {summary.status === 'done' && (
              <span className="actions">
                <button
                  type="button"
                  className="link"
                  aria-pressed={summary.id === viewed}
                  onClick={() => {
                    onView(summary.id);
                  }}
                >
                  View
                </button>
                {!summary.active && (
                  <button
                    type="button"
                    className="link"
                    disabled={locked}
                    onClick={() => {
                      onRestore(summary);
                    }}
                  >
                    Restore
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

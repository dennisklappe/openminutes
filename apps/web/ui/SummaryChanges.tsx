import { changedLines, diffLines } from './diff.js';

export function SummaryChanges({
  before,
  after,
  open,
}: {
  before: string;
  after: string;
  open: boolean;
}) {
  const lines = changedLines(diffLines(before, after));
  return (
    <details className="ai-changes" open={open}>
      <summary>Show changes</summary>
      <pre className="ai-diff" aria-label="Changes">
        {lines.map((line, index) =>
          line.kind === 'gap' ? (
            <span key={index} className="diff-gap">
              ...
            </span>
          ) : (
            <span key={index} className={`diff-${line.kind}`}>
              {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
              {line.text}
            </span>
          ),
        )}
      </pre>
    </details>
  );
}

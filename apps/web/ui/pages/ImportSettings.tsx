import { DOCS } from '../import/PickFile.js';
import { ImportIcon } from '../icons.js';
import { Panel } from '../Panel.js';

export function ImportSettings() {
  return (
    <Panel
      title="Import from Fireflies"
      description={
        <>
          Upload the account export from Fireflies and pick the meetings to bring over. Only the
          recordings and the meeting details come along: they are transcribed and summarised here
          like any other recording. Everything stays on your server, see the{' '}
          <a href={DOCS}>import guide</a>.
        </>
      }
      foot={
        <a className="button primary" href="#/import">
          <ImportIcon />
          <span>Import from Fireflies</span>
        </a>
      }
    >
      <p className="hint">Already imported meetings are skipped, so running it twice is safe.</p>
    </Panel>
  );
}

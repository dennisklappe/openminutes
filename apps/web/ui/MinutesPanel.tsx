import { useCallback, useEffect, useState } from 'react';
import type { ExporterDto, ExportOutcomeDto, MeetingExportDto, MinutesParts } from '../src/dto.js';
import { api, errorMessage, exportMinutes, meetingUrl } from './api.js';
import { DestinationRow } from './DestinationRow.js';
import { DownloadIcon, MoreIcon } from './icons.js';
import { Menu, type MenuItem } from './Menu.js';
import { Panel } from './Panel.js';
import { availableParts, noParts, samePartsAs } from './parts.js';
import { ShareDialog } from './ShareDialog.js';

export interface MinutesPanelProps {
  meetingId: string;
  /** What the meeting has to put in the minutes. The minutes themselves are always there. */
  has: { minutes: boolean; transcript: boolean; chat: boolean; links: boolean };
  /** Files that are not the minutes: the transcript on its own and the audio. */
  extraDownloads: MenuItem[];
  /** Re-process, archive, delete and the like, in the menu in the header. */
  more: MenuItem[];
}

function IncludeChoice(props: {
  parts: MinutesParts;
  has: MinutesPanelProps['has'];
  onChange: (parts: MinutesParts) => void;
}) {
  const { parts, has, onChange } = props;
  const box = (key: keyof MinutesParts, label: string, shown: boolean) =>
    shown && (
      <label className="check">
        <input
          type="checkbox"
          checked={parts[key]}
          onChange={(event) => {
            onChange({ ...parts, [key]: event.target.checked });
          }}
        />
        {label}
      </label>
    );
  return (
    <fieldset className="include">
      <legend>Include</legend>
      <label className="check">
        <input type="checkbox" checked disabled />
        Minutes
      </label>
      {box('includeTranscript', 'Transcript', has.transcript)}
      {box('includeChat', 'Chat', has.chat)}
      {box('includeLinks', 'Links', has.links)}
    </fieldset>
  );
}

export function MinutesPanel({ meetingId, has, extraDownloads, more }: MinutesPanelProps) {
  const [exporters, setExporters] = useState<ExporterDto[]>([]);
  const [records, setRecords] = useState<MeetingExportDto[]>([]);
  const [defaults, setDefaults] = useState<MinutesParts>(noParts);
  const [chosen, setChosen] = useState<MinutesParts>();
  const [outcome, setOutcome] = useState<ExportOutcomeDto>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const loadRecords = useCallback(() => {
    void api.meetingExports(meetingId).then(setRecords);
  }, [meetingId]);

  useEffect(() => {
    void api.exporters().then(setExporters);
    void api.minutesSettings().then((settings) => {
      setDefaults({
        includeTranscript: settings.includeTranscript,
        includeChat: settings.includeChat,
        includeLinks: settings.linksTab,
      });
    });
    loadRecords();
  }, [loadRecords]);

  const linkable = has.links || records.length > 0;
  const offered = { ...has, links: linkable };
  const parts = availableParts(chosen ?? defaults, offered);

  const attempt = (id: string, action: () => Promise<unknown>) => {
    setError(undefined);
    setOutcome(undefined);
    setBusy(id);
    action()
      .then(loadRecords, (failure: unknown) => {
        setError(errorMessage(failure));
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  const run = (exporter: ExporterDto, mode?: 'update' | 'new') => {
    attempt(exporter.id, async () => {
      const result = await exportMinutes(meetingId, exporter.id, parts, mode);
      if (result.kind === 'link' && result.note) setOutcome(result);
      if (result.kind === 'message') setOutcome(result);
    });
  };

  const downloads = exporters.filter((exporter) => exporter.kind === 'download');
  const destinations = exporters.filter(
    (exporter) => exporter.kind === 'destination' && exporter.enabled,
  );
  const preview = new URLSearchParams({
    transcript: parts.includeTranscript ? '1' : '0',
    chat: parts.includeChat ? '1' : '0',
    links: parts.includeLinks ? '1' : '0',
  });
  const menu = more.length > 0 && (
    <Menu label="More" trigger={<MoreIcon />} items={more} align="end" className="card-menu" />
  );

  return (
    <>
      <Panel title="Minutes" actions={menu}>
        {!has.minutes && <p className="muted">No minutes yet.</p>}
        {has.minutes && (
          <>
            <IncludeChoice parts={parts} has={offered} onChange={setChosen} />
            <div className="minutes-actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setSharing(true);
                }}
              >
                Share
              </button>
              <Menu
                label="Download"
                align="end"
                trigger={
                  <>
                    <DownloadIcon /> Download
                  </>
                }
                items={[
                  ...downloads.map((exporter) => ({
                    label: exporter.label,
                    onSelect: () => {
                      attempt(exporter.id, () => exportMinutes(meetingId, exporter.id, parts));
                    },
                  })),
                  ...extraDownloads,
                ]}
              />
              <a
                className="minutes-preview-link"
                href={`${meetingUrl(meetingId, 'minutes')}?${preview.toString()}`}
                target="_blank"
                rel="noreferrer"
              >
                Preview
              </a>
            </div>
            {destinations.length > 0 && (
              <ul className="destinations">
                {destinations.map((exporter) => {
                  const record = records.find((candidate) => candidate.exporterId === exporter.id);
                  const isLink = exporter.id === 'share-link';
                  return (
                    <DestinationRow
                      key={exporter.id}
                      exporter={exporter}
                      record={record}
                      outdated={record !== undefined && !samePartsAs(record, parts)}
                      busy={busy === exporter.id}
                      copied={copied}
                      actions={{
                        create: () => {
                          run(exporter);
                        },
                        update: () => {
                          if (isLink && record) {
                            attempt(exporter.id, () =>
                              api.updateShareLink(meetingId, record.ref, parts),
                            );
                          } else {
                            run(exporter, 'update');
                          }
                        },
                        createCopy: () => {
                          run(exporter, 'new');
                        },
                        copyLink: () => {
                          if (!record) return;
                          void navigator.clipboard.writeText(record.url).then(() => {
                            setCopied(true);
                          });
                        },
                        revoke: () => {
                          if (record) {
                            attempt(exporter.id, () => api.revokeShareLink(meetingId, record.ref));
                          }
                        },
                      }}
                    />
                  );
                })}
              </ul>
            )}
            {outcome?.kind === 'link' && outcome.note && <p className="muted">{outcome.note}</p>}
            {outcome?.kind === 'message' && <p>{outcome.text}</p>}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </Panel>
      {sharing && (
        <ShareDialog
          meetingId={meetingId}
          parts={parts}
          onClose={() => {
            setSharing(false);
            loadRecords();
          }}
        />
      )}
    </>
  );
}

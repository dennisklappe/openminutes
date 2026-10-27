import { useCallback, useRef, useState } from 'react';
import { api, errorMessage, meetingUrl, type ReprocessOptions } from '../api.js';
import { CalendarLinkPanel } from '../CalendarLinkPanel.js';
import { JoinChoice } from '../JoinChoice.js';
import { formatDate, formatDuration, platformLabels, progressLabel } from '../format.js';
import { languageName } from '../languages.js';
import { RerunDialog } from '../RerunDialog.js';
import { ChevronIcon, ClockIcon, ExternalIcon, PlatformIcon } from '../icons.js';
import { Panel } from '../Panel.js';
import { talkTime } from '../speakers.js';
import { MinutesPanel } from '../MinutesPanel.js';
import { StatusBadge } from '../StatusBadge.js';
import { SummaryPanel } from '../SummaryPanel.js';
import { MeetingCompany } from '../MeetingCompany.js';
import { MeetingTitle } from '../MeetingTitle.js';
import { PeopleCard } from '../participants/PeopleCard.js';
import { TranscriptPlayer, type PlayerHandle } from '../TranscriptPlayer.js';
import { WhoIsWho } from '../WhoIsWho.js';
import { useBulk } from '../useBulk.js';
import { usePolling } from '../usePolling.js';
import { useShowChat } from '../useShowChat.js';
import { downloadItems, moreItems } from './meetingMenus.js';

export function MeetingDetail({ id }: { id: string }) {
  const load = useCallback(() => api.meeting(id), [id]);
  const { data, error, refresh } = usePolling(load);
  const [peopleKey, setPeopleKey] = useState(0);
  const [actionError, setActionError] = useState<string>();
  const [showChat, setShowChat] = useShowChat();
  const [chosenTab, setChosenTab] = useState<'transcript' | 'summary'>();
  const [rerun, setRerun] = useState(false);
  const player = useRef<PlayerHandle>(null);
  const bulk = useBulk(() => {
    refresh();
  });

  if (error && !data) return <p className="error">{error.message}</p>;
  if (!data) return null;
  const {
    meeting,
    company,
    audio,
    audioDeletedAt,
    calendars,
    calendarLinks,
    calendarLinkEnabled,
    segments,
    speakerChoices,
    speakerCheck,
    chat,
    canTranscribe,
    series,
    canSkip,
    canRejoin,
    canDelete,
    summaries,
    speakersChangedSinceSummary,
    summaryOptions,
  } = data;

  const reprocess = (options?: ReprocessOptions) => {
    api.reprocess(id, options).then(
      () => {
        setActionError(undefined);
        refresh();
      },
      (failure: unknown) => {
        setActionError(errorMessage(failure));
      },
    );
  };

  const cancel = () => {
    api.cancelProcessing(id).then(refresh, (failure: unknown) => {
      setActionError(errorMessage(failure));
    });
  };

  const report = (failure: unknown) => {
    setActionError(errorMessage(failure));
  };

  const change = (action: () => Promise<unknown>) => {
    action().then(() => {
      setActionError(undefined);
      refresh();
    }, report);
  };

  const item = [{ id, title: meeting.title }];
  const remove = async () => {
    if (await bulk.run('delete', item, { carry: true })) window.location.hash = '#/';
  };

  const downloads = downloadItems({
    id,
    hasTranscript: segments.length > 0,
    hasAudio: Boolean(audio),
  });
  const more = moreItems({
    canTranscribe,
    canDelete,
    archived: Boolean(meeting.archivedAt),
    hasTranscript: segments.length > 0,
    speakerCount: meeting.speakerCount,
    isRecording: meeting.platform === 'recording',
    reprocess,
    reviewHref: `#/meetings/${id}/review`,
    chooseLanguage: () => {
      setRerun(true);
    },
    toggleArchive: () => void bulk.run(meeting.archivedAt ? 'unarchive' : 'archive', item),
    remove: () => void remove(),
  });

  const tab = chosenTab ?? (summaries.length > 0 ? 'summary' : 'transcript');
  const headline = meeting.startedAt ?? meeting.createdAt;
  return (
    <>
      {rerun && (
        <RerunDialog
          detected={meeting.language}
          onRun={(language) => {
            setRerun(false);
            reprocess(language ? { language } : undefined);
          }}
          onClose={() => {
            setRerun(false);
          }}
        />
      )}
      <div className="detail">
        <section>
          <a className="back" href="#/">
            <ChevronIcon />
            All meetings
          </a>
          <div className="detail-head">
            <MeetingTitle id={id} title={meeting.title} onSaved={refresh} />
            <p className="meta">
              {canSkip || canRejoin ? (
                <JoinChoice
                  meetingId={id}
                  status={meeting.status}
                  series={series}
                  onChanged={() => {
                    setActionError(undefined);
                    refresh();
                  }}
                  onError={setActionError}
                />
              ) : (
                <StatusBadge status={meeting.status} progress={meeting.progress} />
              )}
              <span>
                <PlatformIcon platform={meeting.platform} />
                {platformLabels[meeting.platform]}
              </span>
              <span>{formatDate(headline)}</span>
              {audio && (
                <span className="mono">
                  <ClockIcon />
                  {formatDuration(audio.durationMs)}
                </span>
              )}
            </p>
          </div>
          {(meeting.status === 'transcribed' || company.name) && (
            <MeetingCompany meetingId={id} company={company} onChanged={refresh} />
          )}
          {meeting.error && (
            <p className="banner banner-error">
              {meeting.error}
              {canTranscribe && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => {
                      reprocess();
                    }}
                  >
                    Retry
                  </button>
                </>
              )}
            </p>
          )}
          {meeting.status === 'skipped' && (
            <p className="banner">
              The bot will not join this meeting. Your calendar keeps it listed, but it is not
              queued again unless you choose Join this meeting again.
            </p>
          )}
          {series?.skippedId && (
            <p className="banner">
              This meeting belongs to a recurring series you chose not to join, so new occurrences
              are skipped too. Use the Auto-join menu to join the series again, or manage it under
              Settings, Calendar accounts.
            </p>
          )}
          {meeting.archivedAt && (
            <p className="banner">
              <span>
                This meeting is in the archive. It is kept for good and hidden from your lists.
              </span>
              <button type="button" onClick={() => void bulk.run('unarchive', item)}>
                Unarchive
              </button>
            </p>
          )}
          {(actionError ?? bulk.error) && (
            <p className="banner banner-error">{actionError ?? bulk.error}</p>
          )}
          {audio && segments.length > 0 && (
            <WhoIsWho
              meetingId={id}
              transcriptSize={segments.length}
              audioUrl={meetingUrl(id, 'audio')}
              onChanged={refresh}
            />
          )}
          <div className="tabs" role="tablist">
            {(['transcript', 'summary'] as const).map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                onClick={() => {
                  setChosenTab(name);
                }}
              >
                {name === 'transcript' ? 'Transcript' : 'Summary'}
              </button>
            ))}
          </div>
          {tab === 'transcript' && chat.length > 0 && (
            <label className="chat-toggle">
              <input
                type="checkbox"
                checked={showChat}
                onChange={(e) => {
                  setShowChat(e.target.checked);
                }}
              />
              Show chat
            </label>
          )}
          {!audio && (
            <p className="empty">
              {audioDeletedAt
                ? `Audio deleted ${formatDate(audioDeletedAt)}. The transcript and summaries are kept.`
                : 'No audio yet.'}
            </p>
          )}
          <TranscriptPlayer
            meetingId={id}
            recording={audio && { src: meetingUrl(id, 'audio'), durationMs: audio.durationMs }}
            segments={segments}
            speakerChoices={speakerChoices}
            speakerCheck={speakerCheck}
            chat={showChat ? chat : []}
            showTranscript={tab === 'transcript'}
            onChanged={refresh}
            controls={player}
          />
          {tab === 'transcript' && meeting.status === 'processing' && (
            <p className="empty">
              {progressLabel(meeting.progress)}.{' '}
              <button type="button" onClick={cancel}>
                Cancel
              </button>
            </p>
          )}
          {tab === 'transcript' &&
            audio &&
            segments.length === 0 &&
            meeting.status !== 'processing' && (
              <p className="empty">
                {meeting.status === 'transcribed'
                  ? 'No speech was detected in this recording. Pick the language from the menu and re-run it.'
                  : 'No transcript yet.'}
              </p>
            )}
          {tab === 'summary' && (
            <SummaryPanel
              meetingId={id}
              summaries={summaries}
              speakersChanged={speakersChangedSinceSummary}
              options={summaryOptions}
              hasTranscript={segments.length > 0}
              onRequested={refresh}
              onPeopleChanged={() => {
                setPeopleKey((key) => key + 1);
              }}
            />
          )}
        </section>
        <aside className="side">
          <Panel title="Details">
            <dl className="facts">
              <dt>Platform</dt>
              <dd>{platformLabels[meeting.platform]}</dd>
              {meeting.platform === 'imported' && (
                <>
                  <dt>Source</dt>
                  <dd>
                    <a href={meeting.joinUrl} target="_blank" rel="noreferrer">
                      Fireflies <ExternalIcon />
                    </a>
                  </dd>
                </>
              )}
              {meeting.platform !== 'recording' && meeting.platform !== 'imported' && (
                <>
                  <dt>Link</dt>
                  <dd className="mono" title={meeting.joinUrl}>
                    {meeting.joinUrl}
                  </dd>
                </>
              )}
              {calendars.length > 0 && (
                <>
                  <dt>Calendar</dt>
                  <dd title={calendars.map((c) => `${c.name} (${c.accountEmail})`).join('\n')}>
                    {calendars.length === 1
                      ? calendars[0]?.name
                      : `From ${String(calendars.length)} calendars`}
                  </dd>
                </>
              )}
              {meeting.endedAt && (
                <>
                  <dt>Ended</dt>
                  <dd>{formatDate(meeting.endedAt)}</dd>
                </>
              )}
              {meeting.language && (
                <>
                  <dt>Language</dt>
                  <dd>{languageName(meeting.language)}</dd>
                </>
              )}
              {meeting.speakersRefined && (
                <>
                  <dt>Speakers</dt>
                  <dd>Refined with the summary model</dd>
                </>
              )}
            </dl>
          </Panel>
          {meeting.platform !== 'recording' && (
            <PeopleCard
              meetingId={id}
              transcriptSize={segments.length}
              reloadKey={peopleKey}
              hasSummary={summaries.length > 0}
              onChanged={refresh}
            />
          )}
          {segments.length > 0 && (
            <Panel title="Talk time">
              <ul className="talk">
                {talkTime(segments).map(({ name, slot, share }) => (
                  <li key={name} data-speaker-slot={slot}>
                    <span>{name}</span>
                    <span className="mono muted">{Math.round(share * 100)}%</span>
                    <i style={{ width: `${share * 100}%` }} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {(segments.length > 0 || summaries.length > 0 || audio || more.length > 0) && (
            <MinutesPanel
              meetingId={id}
              has={{
                minutes: segments.length > 0 || summaries.length > 0,
                transcript: segments.length > 0,
                chat: chat.length > 0,
                links:
                  chat.some(
                    (message) => message.links.length > 0 || /https?:\/\//.test(message.text),
                  ) ||
                  summaries.some(
                    (summary) => summary.active && /https?:\/\//.test(summary.content),
                  ),
              }}
              extraDownloads={downloads}
              more={more}
            />
          )}
          {calendarLinks.length > 0 &&
            summaries.some((summary) => summary.active) &&
            (calendarLinkEnabled || calendarLinks.some((link) => link.status !== 'pending')) && (
              <CalendarLinkPanel meetingId={id} links={calendarLinks} onChanged={refresh} />
            )}
          {(canRejoin || canSkip) && (
            <div className="actions">
              {canRejoin && (
                <button
                  className="primary"
                  onClick={() => {
                    change(() => api.rejoinMeeting(id));
                  }}
                >
                  Join this meeting again
                </button>
              )}
              {canSkip && (
                <button
                  onClick={() => {
                    change(() => api.skipMeeting(id));
                  }}
                >
                  Don't join this meeting
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

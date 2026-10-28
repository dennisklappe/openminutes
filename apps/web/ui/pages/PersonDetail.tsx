import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { Fragment } from 'react';
import type {
  LanguageCoverageDto,
  EmailConflictDto,
  PersonChoiceDto,
  PersonDetailDto,
  PersonLineDto,
} from '../../src/dto.js';
import { api, errorMessage, meetingUrl } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { EmailConflict } from '../EmailConflict.js';
import { MergeInto } from '../MergePeople.js';
import { NameVoiceDialog } from '../NameVoice.js';
import {
  barPercent,
  emailConflictOf,
  lengthLabel,
  missingHint,
  parseEmails,
  profileLabels,
  reviewLabel,
  profileBreakdown,
  profileLevel,
  reasonLabel,
  speechText,
  validEmail,
  varietyLabel,
} from '../people.js';
import { SnippetPlayer } from '../SnippetPlayer.js';
import '../people.css';

function ReadinessBar({ label, share, text }: { label: string; share: number; text: string }) {
  return (
    <>
      <div
        className="voice-review-meter"
        role="progressbar"
        aria-label={label}
        aria-valuetext={text}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={barPercent(share)}
      >
        <span style={{ width: `${String(barPercent(share))}%` }} />
      </div>
      <span className="muted">{text}</span>
    </>
  );
}

const NAME_MAX = 80;
const NOTES_MAX = 2000;

function Details({
  detail,
  onSaved,
}: {
  detail: PersonDetailDto;
  onSaved: (next: PersonDetailDto) => void;
}) {
  const { person } = detail;
  const [name, setName] = useState(person.name);
  const [emails, setEmails] = useState(person.emails.join('\n'));
  const [notes, setNotes] = useState(person.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string }>();
  const [conflict, setConflict] = useState<EmailConflictDto>();
  const parsed = parseEmails(emails);
  const badEmail = parsed.find((email) => !validEmail(email));
  const dirty =
    name.trim() !== person.name ||
    parsed.join(',') !== person.emails.join(',') ||
    notes.trim() !== (person.notes ?? '');

  useEffect(() => {
    setName(person.name);
    setEmails(person.emails.join('\n'));
    setNotes(person.notes ?? '');
  }, [person.name, person.emails, person.notes]);

  const save = (mergeFrom?: string) => {
    setBusy(true);
    setNotice(undefined);
    setConflict(undefined);
    api
      .updatePerson(person.id, {
        name: name.trim(),
        emails: parsed,
        notes: notes.trim() === '' ? null : notes.trim(),
        ...(mergeFrom && { mergeFrom }),
      })
      .then(
        (next) => {
          setBusy(false);
          setNotice({ ok: true, text: mergeFrom ? 'Merged and saved.' : 'Saved.' });
          onSaved(next);
        },
        (failure: unknown) => {
          setBusy(false);
          const found = emailConflictOf(failure);
          if (found) setConflict(found);
          else setNotice({ ok: false, text: errorMessage(failure) });
        },
      );
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!dirty || busy || badEmail || name.trim() === '') return;
    save();
  };

  return (
    <form className="panel person-form" onSubmit={submit}>
      <header className="card-head">
        <div className="card-title">
          <h3>Details</h3>
        </div>
      </header>
      <div className="card-body">
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <small>Also changes the label on their lines in every meeting.</small>
        </label>
        <label className="field">
          <span>Emails</span>
          <textarea
            rows={Math.max(2, parsed.length + 1)}
            value={emails}
            autoComplete="off"
            onChange={(e) => {
              setEmails(e.target.value);
              setConflict(undefined);
            }}
          />
          <small>None, one or several. One per line or separated by commas.</small>
        </label>
        {badEmail && (
          <p className="feedback error" role="alert">
            {badEmail} is not an email address.
          </p>
        )}
        {conflict && (
          <EmailConflict
            conflict={conflict}
            busy={busy}
            onMerge={() => {
              save(conflict.personId);
            }}
            onKeep={() => {
              setConflict(undefined);
            }}
          />
        )}
        <label className="field">
          <span>Notes</span>
          <textarea
            rows={2}
            maxLength={NOTES_MAX}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </label>
      </div>
      <footer className="card-foot">
        <button
          className="primary"
          type="submit"
          disabled={!dirty || busy || badEmail !== undefined || name.trim() === ''}
        >
          Save changes
        </button>
        <div className="feedback-slot" role="status" aria-live="polite">
          {notice && <p className={`feedback ${notice.ok ? 'ok' : 'error'}`}>{notice.text}</p>}
        </div>
      </footer>
    </form>
  );
}

function MoveLine({
  choices,
  busy,
  onMove,
}: {
  choices: PersonChoiceDto[];
  busy: boolean;
  onMove: (personId: string) => void;
}) {
  const [target, setTarget] = useState('');
  return (
    <span className="line-move">
      <select
        aria-label="Move to another person"
        value={target}
        onChange={(e) => {
          setTarget(e.target.value);
        }}
      >
        <option value="">Move to...</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={target === '' || busy}
        onClick={() => {
          onMove(target);
          setTarget('');
        }}
      >
        Move
      </button>
    </span>
  );
}

function Line({
  line,
  detail,
  busy,
  act,
}: {
  line: PersonLineDto;
  detail: PersonDetailDto;
  busy: boolean;
  act: (run: Promise<PersonDetailDto>) => void;
}) {
  const id = detail.person.id;
  return (
    <li className="person-line">
      <div className="line-main">
        {line.hasAudio ? (
          <SnippetPlayer
            audioUrl={meetingUrl(line.meetingId, 'audio')}
            label={line.text}
            snippets={[{ startMs: line.startMs, endMs: line.endMs, text: line.text }]}
          />
        ) : (
          <p className="line-text">{line.text}</p>
        )}
        <p className="muted line-meta">
          <a href={`#/meetings/${line.meetingId}`}>{line.meetingTitle}</a>
          {line.sharedVia && (
            <span className="shared-marker" title={`Heard in the shared account ${line.sharedVia}`}>
              via shared account
            </span>
          )}
          {line.reason && <span> · {reasonLabel(line)}</span>}
          {line.verified && (
            <span>{line.inProfile ? ' · In the voice profile' : ' · Confirmed by you'}</span>
          )}
        </p>
      </div>
      <div className="line-actions">
        {line.verified && line.inProfile && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              act(api.removeLineFromProfile(id, line.id));
            }}
          >
            Remove from profile
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            act(api.rejectLine(id, line.id));
          }}
        >
          Not this person
        </button>
        <MoveLine
          choices={detail.choices}
          busy={busy}
          onMove={(personId) => {
            act(api.moveLine(id, line.id, personId));
          }}
        />
      </div>
    </li>
  );
}

function LineList({
  title,
  empty,
  lines,
  detail,
  busy,
  act,
}: {
  title: string;
  empty: string;
  lines: PersonLineDto[];
  detail: PersonDetailDto;
  busy: boolean;
  act: (run: Promise<PersonDetailDto>) => void;
}) {
  return (
    <section className="panel">
      <header className="card-head">
        <div className="card-title">
          <h3>
            {title} <span className="muted">{lines.length}</span>
          </h3>
        </div>
      </header>
      {lines.length === 0 ? (
        <p className="card-body muted">{empty}</p>
      ) : (
        <ul className="person-lines">
          {lines.map((line) => (
            <Line key={line.id} line={line} detail={detail} busy={busy} act={act} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function PersonDetail({ id }: { id: string }) {
  const confirm = useConfirm();
  const [detail, setDetail] = useState<PersonDetailDto>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState(false);
  const [naming, setNaming] = useState(false);

  useEffect(() => {
    setDetail(undefined);
    api.person(id).then(setDetail, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  }, [id]);

  const act = useCallback((run: Promise<PersonDetailDto>) => {
    setBusy(true);
    setError(undefined);
    run.then(
      (next) => {
        setDetail(next);
        setBusy(false);
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
        setBusy(false);
      },
    );
  }, []);

  if (!detail) {
    return (
      <>
        <a className="back-link" href="#/people">
          People
        </a>
        {error ? (
          <p className="feedback error" role="alert">
            {error}
          </p>
        ) : null}
      </>
    );
  }

  const { person } = detail;
  const level = profileLevel(person);

  const forget = async () => {
    const confirmed = await confirm({
      title: `Forget the voice of ${person.name}?`,
      body: <p>The saved voice samples are deleted. The person and their lines stay.</p>,
      confirmLabel: 'Forget voice',
      destructive: true,
    });
    if (confirmed) act(api.forgetPersonVoice(person.id));
  };

  const untracked = person.tracking === 'off';

  const forgetLanguage = async (profile: LanguageCoverageDto) => {
    const confirmed = await confirm({
      title: `Delete the ${profile.languageName} profile of ${person.name}?`,
      body: (
        <p>
          The voice samples in {profile.languageName} are deleted. The other languages, the person
          and their lines stay.
        </p>
      ),
      confirmLabel: 'Delete profile',
      destructive: true,
    });
    if (confirmed) act(api.forgetPersonProfile(person.id, profile.language));
  };

  const stopTracking = async () => {
    const confirmed = await confirm({
      title: `Stop tracking ${person.name}?`,
      body: (
        <p>
          Their saved voice samples and voice profile are deleted, and no voice is learned or
          suggested for them again. Their lines are no longer offered for review. {person.name}{' '}
          stays by name in every transcript and in the minutes. You can track them again later, the
          voice then starts from nothing.
        </p>
      ),
      confirmLabel: 'Stop tracking',
      destructive: true,
    });
    if (confirmed) act(api.setTracking(person.id, 'off'));
  };

  const remove = async () => {
    const confirmed = await confirm({
      title: `Delete ${person.name}?`,
      body: (
        <p>
          The person and their voice data are deleted. Their lines in meetings keep the name they
          show now.
        </p>
      ),
      confirmLabel: 'Delete person',
      destructive: true,
    });
    if (!confirmed) return;
    api.deletePerson(person.id).then(
      () => {
        window.location.hash = '#/people';
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  };

  return (
    <>
      <a className="back-link" href="#/people">
        People
      </a>
      <header className="page-head">
        <div>
          <h1>
            {person.name}
            {untracked && <span className="status-chip">Not tracked</span>}
            {person.unnamed && <span className="status-chip">Unnamed</span>}
            {person.sharedAccount && (
              <span className="status-chip" title="Heard in a shared account">
                via shared account: {person.sharedAccount}
              </span>
            )}
          </h1>
          <p className="lede">
            {person.emails.length === 0 ? 'No email' : person.emails.join(', ')}
            {' · '}
            {person.meetings} {person.meetings === 1 ? 'meeting' : 'meetings'}
          </p>
        </div>
        <div className="head-actions">
          {person.unnamed && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setNaming(true);
              }}
            >
              Name
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMerging(true);
            }}
            disabled={detail.choices.length === 0}
          >
            Merge into another person
          </button>
          {untracked ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                act(api.setTracking(person.id, 'on'));
              }}
            >
              Track again
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void stopTracking();
              }}
            >
              Do not track
            </button>
          )}
          <button
            type="button"
            className="danger"
            onClick={() => {
              void remove();
            }}
          >
            Delete
          </button>
        </div>
      </header>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      <div className="person-grid">
        <Details detail={detail} onSaved={setDetail} />
        {untracked ? (
          <section className="panel voice-profile" aria-label="Voice profile">
            <header className="card-head">
              <div className="card-title">
                <h3>Not tracked</h3>
              </div>
            </header>
            <div className="card-body">
              <p className="muted">
                No voice is learned or suggested for {person.name}, and their lines are not offered
                for review. Their name stays in transcripts and minutes.
              </p>
            </div>
            <footer className="card-foot">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  act(api.setTracking(person.id, 'on'));
                }}
              >
                Track again
              </button>
            </footer>
          </section>
        ) : (
          <section className="panel voice-profile" aria-label="Voice profile">
            <header className="card-head">
              <div className="card-title">
                <h3>Voice profile</h3>
              </div>
            </header>
            <div className="card-body">
              <p>
                <span className={`profile-dot ${level}`}>{profileLabels[level]}</span>
              </p>
              <dl className="facts">
                <dt>Verified samples</dt>
                <dd>{person.samples}</dd>
                <dt>Clean speech</dt>
                <dd>{person.voiceSeconds} s</dd>
                <dt>Languages</dt>
                <dd>
                  {detail.profiles.length === 0
                    ? 'None yet'
                    : detail.profiles.map((profile) => profile.languageName).join(', ')}
                </dd>
                <dt>Ways of sounding</dt>
                <dd>{detail.prototypes} in total, up to 5 per language</dd>
              </dl>
              {!detail.learning && (
                <p className="privacy-note">
                  Learning is off, so verifying a line only confirms who said it. Turn it on in
                  Settings, Summaries, Voices, to build a voice profile from verified lines.
                </p>
              )}
              {!detail.checking && detail.learning && person.samples > 0 && (
                <p className="privacy-note">
                  Checking lines against saved voices is off. Turn it on in Settings, Summaries,
                  Voices.
                </p>
              )}
            </div>
            <footer className="card-foot">
              <button
                type="button"
                className="danger"
                disabled={person.samples === 0 && detail.prototypes === 0}
                onClick={() => {
                  void forget();
                }}
              >
                Forget all voices
              </button>
            </footer>
          </section>
        )}
      </div>
      {!untracked && (
        <section className="panel review-entry">
          <header className="card-head">
            <div className="card-title">
              <h3>
                Needs review <span className="muted">{person.needsReview}</span>
              </h3>
            </div>
          </header>
          <div className="card-body review-entry-body">
            <p className="muted">
              {person.needsReview === 0
                ? 'No lines need a look.'
                : `About ${String(person.needsReview)} ${person.needsReview === 1 ? 'line' : 'lines'} to review, then the profile is good enough.`}
            </p>
            {person.needsReview > 0 && (
              <a className="button primary" href={`#/people/${person.id}/review`}>
                Review {reviewLabel(person.needsReview)}
              </a>
            )}
          </div>
        </section>
      )}
      {!untracked &&
        detail.profiles.map((profile) => (
          <Fragment key={profile.language}>
            <section
              className="panel language-profile"
              aria-label={`${profile.languageName} voice profile`}
            >
              <header className="card-head">
                <div className="card-title">
                  <h3>{profile.languageName}</h3>
                </div>
              </header>
              <div className="card-body">
                <dl className="readiness">
                  <div>
                    <dt>Length</dt>
                    <dd>
                      <ReadinessBar
                        label={`${profile.languageName} length`}
                        share={profile.readiness.length}
                        text={lengthLabel(profile)}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Variety</dt>
                    <dd>
                      <ReadinessBar
                        label={`${profile.languageName} variety`}
                        share={profile.readiness.variety}
                        text={varietyLabel(profile.readiness)}
                      />
                    </dd>
                  </div>
                </dl>
                <p className="muted">
                  {profile.readiness.ready ? (
                    <span className="ready-badge">Ready</span>
                  ) : (
                    missingHint(profile)
                  )}{' '}
                  {profileBreakdown(profile)}
                  {' · '}
                  {profile.samples} verified {profile.samples === 1 ? 'sample' : 'samples'}
                </p>
                {profile.autoSamples > 0 && (
                  <>
                    <p className="muted">
                      Added by itself from lines that were near certain. They count less than lines
                      you verified.
                    </p>
                    <ul className="auto-meetings">
                      {profile.autoMeetings.map((meeting) => (
                        <li key={meeting.meetingId}>
                          <a href={`#/meetings/${meeting.meetingId}`}>{meeting.title}</a>
                          <span className="muted"> · {speechText(meeting.seconds)}</span>{' '}
                          <button
                            type="button"
                            className="link"
                            disabled={busy}
                            onClick={() => {
                              act(
                                api
                                  .removeMeetingAutoSamples(meeting.meetingId)
                                  .then(() => api.person(person.id)),
                              );
                            }}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <footer className="card-foot">
                <button
                  type="button"
                  className="danger"
                  disabled={busy || profile.samples === 0}
                  onClick={() => {
                    void forgetLanguage(profile);
                  }}
                >
                  Delete this profile
                </button>
                <button
                  type="button"
                  disabled={busy || profile.autoSamples === 0}
                  onClick={() => {
                    act(api.removeAutoSamples(person.id, profile.language));
                  }}
                >
                  Remove auto samples
                </button>
              </footer>
            </section>
            <LineList
              title={`Verified lines in ${profile.languageName}`}
              empty="Verify a line in this language to confirm it is this person."
              lines={detail.verified.filter((line) => line.language === profile.language)}
              detail={detail}
              busy={busy}
              act={act}
            />
          </Fragment>
        ))}
      {(untracked || detail.profiles.length === 0) && (
        <LineList
          title="Verified lines"
          empty="Verify a line to confirm it is this person."
          lines={detail.verified}
          detail={detail}
          busy={busy}
          act={act}
        />
      )}
      {naming && (
        <NameVoiceDialog
          person={person}
          onClose={() => {
            setNaming(false);
          }}
          onNamed={(personId) => {
            setNaming(false);
            if (personId === person.id) act(api.person(person.id));
            else window.location.hash = `#/people/${personId}`;
          }}
        />
      )}
      {merging && (
        <MergeInto
          person={person}
          choices={detail.choices}
          onClose={() => {
            setMerging(false);
          }}
          onMerged={(keepId) => {
            setMerging(false);
            if (keepId === person.id) act(api.person(person.id));
            else window.location.hash = `#/people/${keepId}`;
          }}
        />
      )}
    </>
  );
}

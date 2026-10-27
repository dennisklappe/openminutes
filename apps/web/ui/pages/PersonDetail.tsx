import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import type { PersonChoiceDto, PersonDetailDto, PersonLineDto } from '../../src/dto.js';
import { api, errorMessage, meetingUrl } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { Dialog } from '../Dialog.js';
import { parseEmails, profileLabels, profileLevel, reasonLabel, validEmail } from '../people.js';
import { SnippetPlayer } from '../SnippetPlayer.js';
import '../people.css';

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

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!dirty || busy || badEmail || name.trim() === '') return;
    setBusy(true);
    setNotice(undefined);
    api
      .updatePerson(person.id, {
        name: name.trim(),
        emails: parsed,
        notes: notes.trim() === '' ? null : notes.trim(),
      })
      .then(
        (next) => {
          setBusy(false);
          setNotice({ ok: true, text: 'Saved.' });
          onSaved(next);
        },
        (failure: unknown) => {
          setBusy(false);
          setNotice({ ok: false, text: errorMessage(failure) });
        },
      );
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
            }}
          />
          <small>None, one or several. One per line or separated by commas.</small>
        </label>
        {badEmail && (
          <p className="feedback error" role="alert">
            {badEmail} is not an email address.
          </p>
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

function MergeDialog({
  detail,
  onClose,
  onMerged,
}: {
  detail: PersonDetailDto;
  onClose: () => void;
  onMerged: (next: PersonDetailDto) => void;
}) {
  const [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const source = detail.choices.find((choice) => choice.id === sourceId);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!source || busy) return;
    setBusy(true);
    api.mergePerson(detail.person.id, source.id).then(onMerged, (failure: unknown) => {
      setBusy(false);
      setError(errorMessage(failure));
    });
  };

  return (
    <Dialog title={`Merge into ${detail.person.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">
          Their emails, voice samples and meetings move to {detail.person.name}. The other person is
          then removed. This cannot be undone.
        </p>
        <label className="field">
          <span>Person to merge in</span>
          <select
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
            }}
          >
            <option value="">Choose a person</option>
            {detail.choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={!source || busy}>
            Merge
          </button>
        </div>
      </form>
    </Dialog>
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
          <h1>{person.name}</h1>
          <p className="lede">
            {person.emails.length === 0 ? 'No email' : person.emails.join(', ')}
            {' · '}
            {person.meetings} {person.meetings === 1 ? 'meeting' : 'meetings'}
          </p>
        </div>
        <div className="head-actions">
          <button
            type="button"
            onClick={() => {
              setMerging(true);
            }}
            disabled={detail.choices.length === 0}
          >
            Merge another person
          </button>
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
              <dt>Ways of sounding</dt>
              <dd>{detail.prototypes} of 5</dd>
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
              Forget voice
            </button>
          </footer>
        </section>
      </div>
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
              : 'Go through the uncertain lines one at a time, least sure first.'}
          </p>
          {person.needsReview > 0 && (
            <a className="button primary" href={`#/people/${person.id}/review`}>
              Review {person.needsReview} {person.needsReview === 1 ? 'line' : 'lines'}
            </a>
          )}
        </div>
      </section>
      <LineList
        title="Verified lines"
        empty="Verify a line to confirm it is this person."
        lines={detail.verified}
        detail={detail}
        busy={busy}
        act={act}
      />
      {merging && (
        <MergeDialog
          detail={detail}
          onClose={() => {
            setMerging(false);
          }}
          onMerged={(next) => {
            setMerging(false);
            setDetail(next);
          }}
        />
      )}
    </>
  );
}

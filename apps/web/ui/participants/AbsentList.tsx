import { useState } from 'react';
import type { InviteeDto, ParticipantDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { MoreIcon } from '../icons.js';
import { Menu } from '../Menu.js';
import { LinkDialog } from './LinkDialog.js';
import { inviteeLabel } from './names.js';

interface Props {
  meetingId: string;
  absent: InviteeDto[];
  people: ParticipantDto[];
  onChanged: () => void;
  onError: (message: string) => void;
}

export function AbsentList({ meetingId, absent, people, onChanged, onError }: Props) {
  const [linking, setLinking] = useState<InviteeDto>();
  if (absent.length === 0) return null;

  const remove = (invitee: InviteeDto) => {
    api.dismissInvitee(meetingId, invitee.email).then(onChanged, (failure: unknown) => {
      onError(errorMessage(failure));
    });
  };

  return (
    <>
      <h3 className="people-heading">Unable to attend</h3>
      <ul className="participant-list absent-list">
        {absent.map((invitee) => (
          <li key={invitee.email}>
            <div className="people-name">
              <span>
                {inviteeLabel(invitee)}
                {invitee.declined && <span className="muted"> (declined)</span>}
              </span>
              <Menu
                label={`Options for ${invitee.name ?? invitee.email}`}
                align="end"
                trigger={<MoreIcon />}
                items={[
                  {
                    label: 'They were there',
                    onSelect: () => {
                      setLinking(invitee);
                    },
                  },
                  {
                    label: 'Remove from list',
                    onSelect: () => {
                      remove(invitee);
                    },
                  },
                ]}
              />
            </div>
          </li>
        ))}
      </ul>
      {linking && (
        <LinkDialog
          meetingId={meetingId}
          invitee={linking}
          people={people}
          onClose={() => {
            setLinking(undefined);
          }}
          onSaved={onChanged}
        />
      )}
    </>
  );
}

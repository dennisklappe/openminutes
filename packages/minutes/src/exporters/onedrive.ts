import { buildDocx } from '../docx/build.js';
import {
  ExportError,
  type Exporter,
  type ExportInput,
  type ExportOutcome,
  type GrantAccessInput,
  type GrantAccessOutcome,
} from '../exporter.js';
import { minutesFilename } from '../filename.js';
import { sameEmail } from '../people.js';
import { apiClient, type Fetch } from './http.js';
import { DOCX_TYPE } from './word.js';

export interface OneDriveContext {
  accessToken: string;
  accountEmail: string;
  ownerEmail: string | undefined;
}

export interface OneDriveDeps {
  fetch: Fetch;
  graph: string;
  resolve(): Promise<OneDriveContext>;
}

const FOLDER = 'OpenMinutes';
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

interface DriveItem {
  id: string;
  webUrl: string;
}

export function createOneDriveExporter(deps: OneDriveDeps): Exporter {
  async function run({
    meetingId,
    minutes,
    options,
    previous,
  }: ExportInput): Promise<ExportOutcome> {
    const context = await deps.resolve();
    const body = buildDocx(minutes, options);
    if (body.length > SIMPLE_UPLOAD_LIMIT) {
      throw new ExportError('The document is larger than 4 MB, download the Word file instead');
    }
    const api = apiClient('Microsoft', deps.fetch, context.accessToken);
    const name = `${meetingId.slice(0, 8)}-${minutesFilename(minutes.title, 'docx')}`;
    const target = previous
      ? `${deps.graph}/me/drive/items/${previous.ref}/content`
      : `${deps.graph}/me/drive/root:/${FOLDER}/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=replace`;
    const response = await api.raw('PUT', target, Buffer.from(body), { 'content-type': DOCX_TYPE });
    const item = (await response.json()) as DriveItem;

    if (!previous && context.ownerEmail && !sameEmail(context.ownerEmail, context.accountEmail)) {
      await api.json('POST', `${deps.graph}/me/drive/items/${item.id}/invite`, {
        recipients: [{ email: context.ownerEmail }],
        roles: ['write'],
        requireSignIn: true,
        sendInvitation: false,
      });
    }
    return {
      kind: 'link',
      url: item.webUrl,
      label: previous ? 'Open the updated Word document' : 'Open in Word online',
      ref: item.id,
    };
  }

  async function grantAccess({ url, emails }: GrantAccessInput): Promise<GrantAccessOutcome> {
    const context = await deps.resolve();
    const api = apiClient('Microsoft', deps.fetch, context.accessToken);
    const shareId = `u!${Buffer.from(url).toString('base64url')}`;
    const item = await api.json<DriveItem>('GET', `${deps.graph}/shares/${shareId}/driveItem`);
    const outcome: GrantAccessOutcome = { granted: [], failed: [] };
    for (const email of emails) {
      try {
        await api.json('POST', `${deps.graph}/me/drive/items/${item.id}/invite`, {
          recipients: [{ email }],
          roles: ['read'],
          requireSignIn: true,
          sendInvitation: false,
        });
        outcome.granted.push(email);
      } catch (error) {
        outcome.failed.push({ email, reason: error instanceof Error ? error.message : 'failed' });
      }
    }
    return outcome;
  }

  return {
    id: 'onedrive',
    label: 'Word on OneDrive',
    destination: true,
    shareLabel: 'Word document',
    description: 'Uploads the Word document to OneDrive so it opens in Word online and Teams.',
    export: run,
    grantAccess,
  };
}

export interface Endpoints {
  google: {
    auth: string;
    token: string;
    userinfo: string;
    api: string;
    docs: string;
    drive: string;
    driveUpload: string;
  };
  microsoft: { authority: string; graph: string };
}

export function endpointsFor(fakeBaseUrl?: string): Endpoints {
  if (fakeBaseUrl) {
    const base = fakeBaseUrl.replace(/\/$/, '');
    return {
      google: {
        auth: `${base}/google/auth`,
        token: `${base}/google/token`,
        userinfo: `${base}/google/userinfo`,
        api: `${base}/google/calendar/v3`,
        docs: `${base}/google/docs/v1`,
        drive: `${base}/google/drive/v3`,
        driveUpload: `${base}/google/upload/drive/v3`,
      },
      microsoft: { authority: `${base}/microsoft/login`, graph: `${base}/microsoft/graph` },
    };
  }
  return {
    google: {
      auth: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
      api: 'https://www.googleapis.com/calendar/v3',
      docs: 'https://docs.googleapis.com/v1',
      drive: 'https://www.googleapis.com/drive/v3',
      driveUpload: 'https://www.googleapis.com/upload/drive/v3',
    },
    microsoft: {
      authority: 'https://login.microsoftonline.com',
      graph: 'https://graph.microsoft.com/v1.0',
    },
  };
}

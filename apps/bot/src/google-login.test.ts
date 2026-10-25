import { describe, expect, it } from 'vitest';
import type { GoogleContext, GooglePage } from './google-browser.js';
import { signInToGoogle } from './google-login.js';

// Mirrors the real sign-in page seen on 2026-10-22: the email field is a text input named
// identifier, and the password step has the path /v3/signin/challenge/pwd before its field renders.
function fakeSignIn() {
  const fills: string[] = [];
  let url = 'about:blank';
  let step: 'email' | 'pending' | 'password' | 'done' = 'email';
  let polls = 0;
  const visible = (selector: string) =>
    (selector === 'input[name="identifier"]' && step === 'email') ||
    (selector === 'input[name="Passwd"]' && step === 'password');
  const page: GooglePage = {
    goto: () => {
      url = 'https://accounts.google.com/v3/signin/identifier';
      return Promise.resolve();
    },
    url: () => url,
    locator: (selector) => ({
      isVisible: () => Promise.resolve(visible(selector)),
      fill: (value) => {
        fills.push(`${selector}=${value}`);
        return Promise.resolve();
      },
      click: () => {
        if (selector === '#identifierNext') {
          step = 'pending';
          url = 'https://accounts.google.com/v3/signin/challenge/pwd';
        }
        if (selector === '#passwordNext') step = 'done';
        return Promise.resolve();
      },
    }),
    waitForTimeout: () => {
      if (step === 'pending' && ++polls >= 2) step = 'password';
      return Promise.resolve();
    },
  };
  const context: GoogleContext = {
    newPage: () => Promise.resolve(page),
    storageState: () => Promise.resolve({ cookies: [], origins: [] }),
    cookies: () => Promise.resolve(step === 'done' ? [{ name: 'SID' }] : []),
  };
  return { page, context, fills };
}

describe('signInToGoogle', () => {
  it('types into the real email field and waits for the password step', async () => {
    const { page, context, fills } = fakeSignIn();
    const outcome = await signInToGoogle(context, page, {
      email: 'bot@example.com',
      password: 'pw',
    });
    expect(outcome).toEqual({ ok: true });
    expect(fills).toEqual(['input[name="identifier"]=bot@example.com', 'input[name="Passwd"]=pw']);
  });
});

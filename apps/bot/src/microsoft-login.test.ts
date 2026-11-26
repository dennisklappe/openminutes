import { loadBotSessionInfo, saveBotCredentials, SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GoogleBrowser, GoogleContext, GooglePage } from './google-browser.js';
import {
  CANNOT_PASS,
  signInToMicrosoft,
  signInWithSavedMicrosoftCredentials,
} from './microsoft-login.js';

const EMAIL = 'input[name="loginfmt"]';
const PASSWORD = 'input[name="passwd"]';
const CODE = 'input[name="otc"]';
const KMSI = '#KmsiCheckboxField';
const OPTION = '[data-value="PhoneAppOTP"]';

interface Step {
  url: string;
  visible?: string[];
  text?: string;
  /** Selector that moves to the next step. */
  next?: string;
}

const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TEAMS = 'https://teams.microsoft.com/v2/';
const emailStep: Step = { url: LOGIN, visible: [EMAIL], text: 'Sign in', next: '#idSIButton9' };
const passwordStep: Step = {
  url: LOGIN,
  visible: [PASSWORD],
  text: 'Enter password',
  next: '#idSIButton9',
};
const codeStep: Step = {
  url: LOGIN,
  visible: [CODE],
  text: 'Enter the code displayed in the authenticator app on your mobile device',
  next: '#idSubmit_SAOTCC_Continue',
};
const kmsiStep: Step = {
  url: `${LOGIN}/kmsi`,
  visible: [KMSI],
  text: 'Stay signed in?',
  next: '#idSIButton9',
};
const teamsStep: Step = { url: TEAMS, text: 'Chat Teams Calendar' };

/** Walks through the steps; the sign-in cookie is set once the Teams step is reached. */
function fakeSignIn(steps: Step[]) {
  const fills: string[] = [];
  const clicks: string[] = [];
  let index = 0;
  const step = () => steps[Math.min(index, steps.length - 1)] ?? teamsStep;
  const page: GooglePage = {
    goto: () => Promise.resolve(),
    url: () => step().url,
    locator: (selector) => ({
      isVisible: () => Promise.resolve(step().visible?.includes(selector) ?? false),
      fill: (value) => {
        fills.push(`${selector}=${value}`);
        return Promise.resolve();
      },
      click: () => {
        clicks.push(selector);
        if (step().next === selector) index += 1;
        return Promise.resolve();
      },
    }),
    innerText: () => Promise.resolve(step().text ?? ''),
    waitForTimeout: () => Promise.resolve(),
  };
  const signedIn = () => step().url.startsWith(TEAMS);
  const context: GoogleContext = {
    newPage: () => Promise.resolve(page),
    storageState: () =>
      Promise.resolve({
        cookies: signedIn()
          ? [
              {
                name: 'ESTSAUTHPERSISTENT',
                value: 'v',
                domain: '.login.microsoftonline.com',
                path: '/',
                expires: Date.now() / 1000 + 90 * 86_400,
                httpOnly: true,
                secure: true,
                sameSite: 'None' as const,
              },
            ]
          : [],
        origins: [],
      }),
    cookies: () => Promise.resolve(signedIn() ? [{ name: 'ESTSAUTHPERSISTENT' }] : []),
  };
  return { page, context, fills, clicks };
}

const credentials = { email: 'bot@example.com', password: 'pw' };
const withTotp = { ...credentials, totpSecret: 'JBSWY3DPEHPK3PXP' };

describe('signInToMicrosoft', () => {
  it('signs in with email and password and answers Yes to stay signed in', async () => {
    const { page, context, fills, clicks } = fakeSignIn([
      emailStep,
      passwordStep,
      kmsiStep,
      teamsStep,
    ]);
    expect(await signInToMicrosoft(context, page, credentials)).toEqual({ ok: true });
    expect(fills).toEqual([`${EMAIL}=bot@example.com`, `${PASSWORD}=pw`]);
    expect(clicks.filter((c) => c === '#idSIButton9')).toHaveLength(3);
  });

  it('types the authenticator code when the account has one', async () => {
    const { page, context, fills } = fakeSignIn([
      emailStep,
      passwordStep,
      codeStep,
      kmsiStep,
      teamsStep,
    ]);
    const outcome = await signInToMicrosoft(context, page, withTotp, () => new Date(0));
    expect(outcome).toEqual({ ok: true });
    expect(fills[2]).toMatch(/^input\[name="otc"\]=\d{6}$/);
  });

  it('picks the authenticator app when Microsoft offers a choice', async () => {
    const chooser: Step = {
      url: LOGIN,
      visible: [OPTION],
      text: 'Verify your identity. Approve a request on my Microsoft Authenticator app',
      next: OPTION,
    };
    const { page, context } = fakeSignIn([
      emailStep,
      passwordStep,
      chooser,
      codeStep,
      kmsiStep,
      teamsStep,
    ]);
    expect(await signInToMicrosoft(context, page, withTotp)).toEqual({ ok: true });
  });

  it('asks for the authenticator secret when a code is needed and none is saved', async () => {
    const { page, context } = fakeSignIn([emailStep, passwordStep, codeStep]);
    expect(await signInToMicrosoft(context, page, credentials)).toEqual({
      ok: false,
      reason: 'Microsoft asks for a verification code, add the authenticator secret',
    });
  });

  it.each([
    [
      'number matching',
      'Approve sign-in request. Enter the number shown to sign in.',
      'number matching in Microsoft Authenticator',
    ],
    ['SMS', 'We texted your phone +XX XXXXXXX12', 'a code by text message'],
    ['a security key', 'Sign in with your security key', 'a security key or passkey'],
    ['a passkey', 'Use your passkey', 'a security key or passkey'],
    [
      'MFA registration',
      'More information required',
      'setting up more security info, finish it once in a normal browser',
    ],
  ])('reports %s as a step the bot cannot pass', async (_, text, what) => {
    const { page, context } = fakeSignIn([emailStep, passwordStep, { url: LOGIN, text }]);
    expect(await signInToMicrosoft(context, page, withTotp)).toEqual({
      ok: false,
      reason: `${CANNOT_PASS}: ${what}`,
    });
  });

  it('reports an SMS code instead of typing the authenticator code into it', async () => {
    const sms: Step = { url: LOGIN, visible: [CODE], text: 'We texted your phone. Enter code' };
    const { page, context, fills } = fakeSignIn([emailStep, passwordStep, sms]);
    expect(await signInToMicrosoft(context, page, withTotp)).toEqual({
      ok: false,
      reason: `${CANNOT_PASS}: a code by text message`,
    });
    expect(fills).toHaveLength(2);
  });

  it('reports a Conditional Access block', async () => {
    const blocked: Step = { url: LOGIN, text: 'Your sign-in was blocked. AADSTS53003' };
    const { page, context } = fakeSignIn([emailStep, passwordStep, blocked]);
    const outcome = await signInToMicrosoft(context, page, credentials);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toMatch(/^Conditional Access blocked/);
  });

  it('reports a wrong password', async () => {
    const wrong: Step = {
      url: LOGIN,
      visible: [PASSWORD],
      text: 'Your account or password is incorrect.',
    };
    const { page, context } = fakeSignIn([emailStep, wrong]);
    expect(await signInToMicrosoft(context, page, credentials)).toEqual({
      ok: false,
      reason: 'Microsoft rejected the password',
    });
  });

  it('does not follow a federated sign-in', async () => {
    const adfs: Step = { url: 'https://adfs.example.com/adfs/ls/', visible: ['#userNameInput'] };
    const { page, context, fills } = fakeSignIn([emailStep, adfs]);
    const outcome = await signInToMicrosoft(context, page, credentials);
    expect(!outcome.ok && outcome.reason).toMatch(/adfs\.example\.com \(federated sign-in\)/);
    expect(fills).toHaveLength(1);
  });
});

describe('signInWithSavedMicrosoftCredentials', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  const launcher = (steps: Step[]) => {
    const { context } = fakeSignIn(steps);
    const storageState = vi.spyOn(context, 'storageState');
    const close = vi.fn(() => Promise.resolve());
    const browser: GoogleBrowser = { newContext: () => Promise.resolve(context), close };
    return { launch: vi.fn(() => Promise.resolve(browser)), close, storageState };
  };

  it('does nothing without saved credentials', async () => {
    const { launch } = launcher([]);
    expect(await signInWithSavedMicrosoftCredentials({ settings: store, launch })).toEqual({
      ok: false,
      reason: 'No Microsoft email and password are saved',
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it('stores the new session with IndexedDB after signing in', async () => {
    await saveBotCredentials('microsoft', store, credentials);
    const { launch, close, storageState } = launcher([
      emailStep,
      passwordStep,
      kmsiStep,
      teamsStep,
    ]);
    expect(await signInWithSavedMicrosoftCredentials({ settings: store, launch })).toEqual({
      ok: true,
    });
    expect(storageState).toHaveBeenCalledWith({ indexedDB: true });
    expect((await loadBotSessionInfo('microsoft', store)).status).toBe('valid');
    expect(close).toHaveBeenCalled();
  });
});

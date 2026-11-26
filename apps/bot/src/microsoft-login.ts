import {
  loadBotCredentials,
  saveBotSession,
  totp,
  type BotCredentials,
  type SettingsStore,
} from '@openminutes/core';
import {
  contextOptions,
  type GoogleContext,
  type GooglePage,
  type LaunchGoogleBrowser,
} from './google-browser.js';

// Field names of login.microsoftonline.com and login.live.com as documented by tools that
// automate it (issue #50 spike). Microsoft varies the flow per tenant: confirm live when it breaks.
const SELECTORS = {
  email: 'input[name="loginfmt"]',
  password: 'input[name="passwd"]',
  code: 'input[name="otc"]',
  next: '#idSIButton9',
  codeNext: '#idSubmit_SAOTCC_Continue',
  staySignedIn: '#KmsiCheckboxField',
  authenticatorOption: '[data-value="PhoneAppOTP"]',
} as const;

// Opening Teams sends a signed-out browser to the Microsoft sign-in and back, so the session
// that is stored afterwards holds the Teams tokens too.
const SIGN_IN_URL = 'https://teams.microsoft.com/v2/';
const LOGIN_COOKIE_URLS = ['https://login.microsoftonline.com', 'https://login.live.com'];
const AUTH_COOKIES = new Set(['ESTSAUTHPERSISTENT', 'ESTSAUTH']);
const TEAMS_HOSTS = /(^|\.)(teams\.microsoft\.com|teams\.cloud\.microsoft|teams\.live\.com)$/;
const MICROSOFT_HOSTS =
  /(^|\.)(microsoftonline\.com|microsoft\.com|cloud\.microsoft|live\.com|office\.com|msauth\.net|msftauth\.net)$/;
const DEADLINE_MS = 90_000;
const POLL_MS = 1_000;
/** Teams writes its tokens and the MSAL account entry (the bot account name) after it boots. */
const SETTLE_MS = 15_000;

export const CANNOT_PASS = 'Microsoft asked for a step the bot cannot pass';

type LoginOutcome = { ok: true } | { ok: false; reason: string };

const failed = (reason: string): LoginOutcome => ({ ok: false, reason });

/** Errors that end the sign-in, checked on every step. */
const ERRORS: readonly [RegExp, string][] = [
  [
    /AADSTS5300[0-4]|Your sign-in was blocked|You cannot access this right now|doesn't meet the criteria/i,
    'Conditional Access blocked the sign-in of the bot account, ask the tenant admin to exclude it or allow the server address',
  ],
  [/AADSTS50126|password is incorrect/i, 'Microsoft rejected the password'],
  [
    /AADSTS50034|couldn't find an account|account doesn't exist/i,
    'Microsoft does not know this account',
  ],
  [/AADSTS50053|account is locked/i, 'The bot account is locked, sign in once in a normal browser'],
  [/AADSTS50057|account is disabled/i, 'The bot account is disabled'],
  [
    /AADSTS50055|password (has )?expired|update your password/i,
    'The password of the bot account expired, set a new one and save it here',
  ],
];

/** Steps the bot reports and never works around, checked when no field it can fill is shown. */
const STUCK: readonly [RegExp, string][] = [
  [
    /Approve sign-in request|Enter the number shown|number shown to sign in|Open your Authenticator app/i,
    'number matching in Microsoft Authenticator',
  ],
  [/We texted your phone|text message|SMS/i, 'a code by text message'],
  [/We're calling your phone|phone call/i, 'a phone call'],
  [/We emailed a code|code to your email|sent a code to/i, 'a code by email'],
  [/security key|FIDO|passkey|Windows Hello|face, fingerprint/i, 'a security key or passkey'],
  [
    /More information required|Let's keep your account secure|Help us protect your account|Action required/i,
    'setting up more security info, finish it once in a normal browser',
  ],
  [/Enter the characters you see|captcha|prove you're not a robot/i, 'a captcha'],
  [/AADSTS5007[69]|Verify your identity/i, 'an extra verification, add the authenticator secret'],
];

const match = (rules: readonly [RegExp, string][], text: string) =>
  rules.find(([pattern]) => pattern.test(text))?.[1];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

async function signedIn(context: GoogleContext, page: GooglePage): Promise<boolean> {
  if (!TEAMS_HOSTS.test(hostOf(page.url()))) return false;
  const cookies = await Promise.all(LOGIN_COOKIE_URLS.map((url) => context.cookies(url)));
  return cookies.flat().some((cookie) => AUTH_COOKIES.has(cookie.name));
}

/**
 * Signs in to a Microsoft work or school account with email, password and an optional
 * authenticator code, answering Yes to "Stay signed in?". Federated sign-in, number matching,
 * SMS, security keys, passkeys, captchas and Conditional Access blocks are reported as a reason,
 * never worked around.
 */
export async function signInToMicrosoft(
  context: GoogleContext,
  page: GooglePage,
  credentials: BotCredentials,
  now: () => Date = () => new Date(),
): Promise<LoginOutcome> {
  const email = page.locator(SELECTORS.email);
  const password = page.locator(SELECTORS.password);
  const code = page.locator(SELECTORS.code);
  const staySignedIn = page.locator(SELECTORS.staySignedIn);
  const authenticatorOption = page.locator(SELECTORS.authenticatorOption);

  await page.goto(SIGN_IN_URL, { waitUntil: 'domcontentloaded' });

  let emailSent = false;
  let passwordSent = false;
  let codeSent = false;
  let optionPicked = false;
  let staySent = 0;
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    if (await signedIn(context, page)) {
      await page.waitForTimeout(SETTLE_MS);
      return { ok: true };
    }
    const host = hostOf(page.url());
    const text = `${page.url()}\n${await page.innerText('body').catch(() => '')}`;
    const error = match(ERRORS, text);
    if (error) return failed(error);
    if (emailSent && host !== '' && !MICROSOFT_HOSTS.test(host)) {
      return failed(
        `The tenant sends the sign-in to ${host} (federated sign-in), which the bot does not support. Use a session file`,
      );
    }

    if (await password.isVisible()) {
      if (passwordSent) return failed('Microsoft rejected the password');
      passwordSent = true;
      await password.fill(credentials.password);
      await page.locator(SELECTORS.next).click();
    } else if (await code.isVisible()) {
      const other = match(STUCK, text);
      if (other && !/authenticator app/i.test(text)) return failed(`${CANNOT_PASS}: ${other}`);
      if (codeSent) return failed('Microsoft rejected the authenticator code');
      if (!credentials.totpSecret) {
        return failed('Microsoft asks for a verification code, add the authenticator secret');
      }
      codeSent = true;
      await code.fill(totp(credentials.totpSecret, now()));
      await page.locator(SELECTORS.codeNext).click();
    } else if (await staySignedIn.isVisible()) {
      // "Stay signed in?": Yes issues the persistent cookie the session needs.
      if (++staySent > 3) return failed('The "Stay signed in?" step did not finish');
      await page.locator(SELECTORS.next).click();
    } else if (!optionPicked && credentials.totpSecret && (await authenticatorOption.isVisible())) {
      optionPicked = true;
      await authenticatorOption.click();
    } else if (await email.isVisible()) {
      if (emailSent) {
        const stuck = match(STUCK, text);
        if (stuck) return failed(`${CANNOT_PASS}: ${stuck}`);
      } else {
        emailSent = true;
        await email.fill(credentials.email);
        await page.locator(SELECTORS.next).click();
      }
    } else if (emailSent) {
      const stuck = match(STUCK, text);
      if (stuck) return failed(`${CANNOT_PASS}: ${stuck}`);
    }
    await page.waitForTimeout(POLL_MS);
  }
  return failed('The Microsoft sign-in did not finish in time');
}

/**
 * Signs in again with the saved Microsoft credentials in a headless browser and stores the new
 * session, IndexedDB included (Teams v2 keeps its tokens there).
 */
export async function signInWithSavedMicrosoftCredentials(deps: {
  settings: SettingsStore;
  launch: LaunchGoogleBrowser;
}): Promise<LoginOutcome> {
  const credentials = await loadBotCredentials('microsoft', deps.settings);
  if (!credentials) return failed('No Microsoft email and password are saved');
  const browser = await deps.launch();
  try {
    const context = await browser.newContext(contextOptions());
    const outcome = await signInToMicrosoft(context, await context.newPage(), credentials);
    if (outcome.ok) {
      await saveBotSession(
        'microsoft',
        deps.settings,
        await context.storageState({ indexedDB: true }),
      );
    }
    return outcome;
  } finally {
    await browser.close();
  }
}

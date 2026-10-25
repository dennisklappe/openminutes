import { totp, type GoogleCredentials } from '@openminutes/core';
import type { GoogleContext, GooglePage } from './google-browser.js';

// Seen on the real sign-in page (2026-10-22): the email field is a text input named identifier, and the
// password and code steps live at /challenge/pwd and /challenge/totp, which are the normal steps.
const EXTRA_STEP = /\/(challenge(?!\/(pwd|totp)\b)|rejected|speedbump)\b/;
const SIGN_IN_URL = 'https://accounts.google.com/signin/v2/identifier?hl=en&flowName=GlobalSignIn';
const DEADLINE_MS = 90_000;
const POLL_MS = 1_000;

type LoginOutcome = { ok: true } | { ok: false; reason: string };

const failed = (reason: string): LoginOutcome => ({ ok: false, reason });

const hasSignIn = async (context: GoogleContext) =>
  (await context.cookies('https://accounts.google.com')).some((cookie) => cookie.name === 'SID');

/**
 * Signs in with email, password and an optional authenticator code. Any other step (phone
 * verification, "unusual activity", captcha) is reported as a reason, never worked around.
 */
export async function signInToGoogle(
  context: GoogleContext,
  page: GooglePage,
  credentials: GoogleCredentials,
  now: () => Date = () => new Date(),
): Promise<LoginOutcome> {
  const email = page.locator('input[name="identifier"]');
  const password = page.locator('input[name="Passwd"]');
  const code = page.locator('input[name="totpPin"]');

  await page.goto(SIGN_IN_URL, { waitUntil: 'domcontentloaded' });
  await email.fill(credentials.email);
  await page.locator('#identifierNext').click();

  let passwordSent = false;
  let codeSent = false;
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    if (await hasSignIn(context)) return { ok: true };
    if (await password.isVisible()) {
      if (passwordSent) return failed('Google rejected the password');
      passwordSent = true;
      await password.fill(credentials.password);
      await page.locator('#passwordNext').click();
    } else if (await code.isVisible()) {
      if (codeSent) return failed('Google rejected the authenticator code');
      if (!credentials.totpSecret) {
        return failed('Google asks for a verification code, add the authenticator secret');
      }
      codeSent = true;
      await code.fill(totp(credentials.totpSecret, now()));
      await page.locator('#totpNext').click();
    } else if (EXTRA_STEP.test(new URL(page.url()).pathname)) {
      return failed('Google asked for an extra verification step the bot cannot pass');
    }
    await page.waitForTimeout(POLL_MS);
  }
  return failed('The Google sign-in did not finish in time');
}

import type { GoogleStorageState } from '@openminutes/core';
import { chromium } from 'playwright-core';
import type { BotEnv } from './env.js';

export const FINGERPRINT_ARGS = ['--no-sandbox', '--disable-blink-features=AutomationControlled'];

export const contextOptions = (storageState?: GoogleStorageState) => ({
  locale: 'en-US',
  viewport: { width: 1280, height: 720 },
  ...(storageState && { storageState }),
});

export interface LoginLocator {
  isVisible(): Promise<boolean>;
  fill(value: string): Promise<void>;
  click(): Promise<void>;
}

export interface GooglePage {
  goto(
    url: string,
    options?: { waitUntil?: 'domcontentloaded'; timeout?: number },
  ): Promise<unknown>;
  url(): string;
  locator(selector: string): LoginLocator;
  waitForTimeout(ms: number): Promise<void>;
}

export interface GoogleContext {
  newPage(): Promise<GooglePage>;
  storageState(): Promise<GoogleStorageState>;
  cookies(url: string): Promise<{ name: string }[]>;
}

export interface GoogleBrowser {
  newContext(options: ReturnType<typeof contextOptions>): Promise<GoogleContext>;
  close(): Promise<void>;
}

export type LaunchGoogleBrowser = () => Promise<GoogleBrowser>;

export const launchHeadless =
  (env: BotEnv): LaunchGoogleBrowser =>
  () =>
    chromium.launch({
      headless: true,
      args: [...FINGERPRINT_ARGS, ...env.OPENMINUTES_CHROMIUM_ARGS],
    });

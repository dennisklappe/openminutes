import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const EM_DASH = String.fromCharCode(0x2014);
const SKIPPED =
  /^(LICENSE$|pnpm-lock\.yaml$)|\.(png|jpe?g|webp|gif|ico|woff2?|wav|mp3|webm|pdf)$|\/fixtures\//i;

describe('repository text', () => {
  it('contains no em dashes', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter((file) => file !== '' && !SKIPPED.test(file));
    const offenders = files.filter((file) => {
      try {
        return readFileSync(join(ROOT, file), 'utf8').includes(EM_DASH);
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });
});

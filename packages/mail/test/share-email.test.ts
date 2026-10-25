import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY, DEFAULT_SUBJECT, renderShareEmail } from '../src/index.js';

const base = {
  subject: DEFAULT_SUBJECT,
  body: DEFAULT_BODY,
  title: 'Weekly <sync>',
  date: 'Monday 5 October 2026',
};
const item = { label: 'Read the minutes', url: 'https://om.test/s/abc' };

describe('renderShareEmail', () => {
  it('fills placeholders and ends with the powered by line', () => {
    const mail = renderShareEmail({ ...base, item });
    expect(mail.subject).toBe('Minutes: Weekly <sync> (Monday 5 October 2026)');
    expect(mail.text).toContain('Read the minutes: https://om.test/s/abc');
    expect(mail.text).toContain(
      'Powered by OpenMinutes: https://github.com/dennisklappe/openminutes',
    );
    expect(mail.html).toContain('href="https://github.com/dennisklappe/openminutes"');
    expect(mail.html).toContain('Weekly &lt;sync&gt;');
    expect(mail.html).not.toContain('Weekly <sync>');
  });

  it('ignores the old document placeholder', () => {
    const mail = renderShareEmail({ ...base, body: '{{link}}\n\n{{document}}', item });
    expect(mail.text).not.toContain('{{');
    expect(mail.text.match(/om\.test\/s\/abc/g)).toHaveLength(1);
  });

  it('appends the link when the template does not mention it', () => {
    const mail = renderShareEmail({ ...base, body: 'Hello {{title}}', item });
    expect(mail.text).toContain('Read the minutes: https://om.test/s/abc');
  });

  it('keeps unknown placeholders visible so typos are noticed', () => {
    const mail = renderShareEmail({ ...base, body: 'Hi {{nmae}}' });
    expect(mail.text).toContain('{{nmae}}');
  });
});

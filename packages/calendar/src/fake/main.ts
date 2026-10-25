import { startFakeCalendar } from './server.js';

const { PORT = '9000', FAKE_EMAIL, FAKE_EXPIRES_IN } = process.env;
const fake = await startFakeCalendar({
  port: Number(PORT),
  ...(FAKE_EMAIL && { email: FAKE_EMAIL }),
  ...(FAKE_EXPIRES_IN && { expiresInSeconds: Number(FAKE_EXPIRES_IN) }),
});
console.log(`fake calendar API listening on ${fake.baseUrl}`);

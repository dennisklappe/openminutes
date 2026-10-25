import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRealServer } from './real-server.mjs';

const requireFrom = (path) => createRequire(new URL(path, import.meta.url));
const loadWorker = (name) =>
  import(pathToFileURL(requireFrom('../../apps/worker/package.json').resolve(name)).href);
const uiDir = fileURLToPath(new URL('../../apps/web/dist/ui', import.meta.url));

// The real web server on embedded Postgres, the worker pipeline (ffmpeg merge, local whisper,
// diarization) and a stub summary LLM. Shared by the Chromium and WebKit phone scripts.
export async function startStack(whisper) {
  const llm = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { messages = [] } = body ? JSON.parse(body) : {};
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const content = /title/i.test(system)
      ? 'Garden plans and the budget'
      : '## Summary\n\nTwo people discussed the garden plans.';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise((resolve) => llm.listen(0, '127.0.0.1', resolve));
  const llmUrl = `http://127.0.0.1:${llm.address().port}/v1`;

  const [
    core,
    providers,
    processModule,
    summaryModule,
    mergeModule,
    trimModule,
    silenceModule,
    recording,
  ] = await Promise.all([
    loadWorker('@openminutes/core'),
    loadWorker('@openminutes/providers'),
    import(new URL('../../apps/worker/dist/process.js', import.meta.url).href),
    import(new URL('../../apps/worker/dist/summary-job.js', import.meta.url).href),
    import(new URL('../../apps/worker/dist/merge-audio.js', import.meta.url).href),
    import(new URL('../../apps/worker/dist/trim-audio.js', import.meta.url).href),
    import(new URL('../../apps/worker/dist/detect-silence.js', import.meta.url).href),
    import(new URL('../../apps/worker/dist/recording-deps.js', import.meta.url).href),
  ]);

  const queue = {
    send: async (name, payload) => {
      if (name === 'meeting.process')
        void processModule.processMeeting(processDeps, payload.meetingId);
      if (name === 'meeting.summarize')
        void summaryModule.runSummary(summaryDeps, payload.summaryId);
    },
  };
  let processDeps;
  let summaryDeps;
  const server = await startRealServer({
    uiDir,
    onJob: (name, payload) => queue.send(name, payload),
  });
  const { settings, storage } = server;
  await settings.set('transcription.provider', 'local');
  await settings.set(
    'transcription.configs',
    JSON.stringify({ local: { baseUrl: whisper, model: 'small' } }),
  );
  await settings.set('summary.provider', 'openai-compatible');
  await settings.set(
    'summary.configs',
    JSON.stringify({ 'openai-compatible': { baseUrl: llmUrl, model: 'stub' } }),
  );
  await settings.set('voices.remember', 'true');
  processDeps = {
    db: server.db,
    mergeAudio: mergeModule.mergeAudio,
    trimAudio: trimModule.trimAudio,
    detectSilence: silenceModule.detectSilence,
    loadStorage: () => core.loadAudioStorage(settings, storage),
    createTranscriber: () => core.createConfiguredTranscriber(settings),
    createRefiner: async () => undefined,
    requestSummary: (meetingId) =>
      core.requestSummary({ db: server.db, queue, settings }, meetingId),
    recording: recording.createRecordingDeps(settings, (config) =>
      providers.createLocalDiarizer(config, { fetch }),
    ),
  };
  summaryDeps = {
    db: server.db,
    settings,
    queue,
    createSummarizer: async (id) => (await core.createConfiguredSummarizer(settings, id)).provider,
  };

  return {
    server,
    api: (path) =>
      fetch(`${server.url}/api${path}`, {
        headers: { cookie: `${server.cookie.name}=${server.cookie.value}` },
      }).then((r) => r.json()),
    close: async () => {
      llm.close();
      await server.close();
    },
  };
}

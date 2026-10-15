import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleStreamingRequest, streamingResponse, requestDigest,
  signStreamingTicket, encryptPrivateContext, QStreamBudget,
} from './worker.mjs';
import { readQStream } from './reader.mjs';
import { tryStreamQReply } from './q-chat-integration.mjs';

const ORIGIN = 'https://the-quiet-fight-production-plwzkx.v2.appdeploy.ai';
const encoder = new TextEncoder();

function streamOf(...parts) {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

function provider(...parts) {
  return new Response(streamOf(...parts), { headers: { 'Content-Type': 'text/event-stream' } });
}

const DELTA_A = 'data: {"type":"response.output_text.delta","delta":"I hear "}\n\n';
const DELTA_B = 'data: {"type":"response.output_text.delta","delta":"you."}\n\n';
const DONE = 'data: {"type":"response.completed"}\n\n';

test('forwards real AI answer deltas split across arbitrary network packets', async () => {
  const upstream = provider(
    'data: {"type":"response.reasoning_summary_text.delta","delta":"INTERNAL PRIVATE"}\n\n',
    DELTA_A.slice(0, 26), DELTA_A.slice(26),
    DELTA_B.slice(0, 3), DELTA_B.slice(3),
    DONE
  );
  const output = await streamingResponse(upstream, ORIGIN).text();
  const frames = output.trim().split('\n\n').map(x => JSON.parse(x.slice(6)));
  assert.deepEqual(frames, [
    { type: 'delta', text: 'I hear ' },
    { type: 'delta', text: 'you.' },
    { type: 'done' },
  ]);
  assert.equal(output.includes('INTERNAL PRIVATE'), false);
});

test('provider failure emits a safe error instead of leaving chat hanging', async () => {
  const output = await streamingResponse(
    provider('data: {"type":"response.failed","error":{"message":"secret hidden"}}\n\n'), ORIGIN
  ).text();
  assert.equal(output.includes('"type":"error"'), true);
  assert.equal(output.includes('secret hidden'), false);
});

test('missing streaming configuration fails closed before calling paid provider', async () => {
  let called = 0;
  const request = new Request('https://stream.example/chat/stream', {
    method: 'POST', headers: { Origin: ORIGIN }, body: JSON.stringify({ message: 'Hello' }),
  });
  const response = await handleStreamingRequest(request, {}, async () => { called++; });
  assert.equal(response.status, 503);
  assert.equal(called, 0);
});

test('only a signed short-lived ticket for the exact message unlocks streaming', async () => {
  const normalizedBody = { message: 'I miss my children', history: [] };
  const privateSummary = 'Separated dad, minimal contact. Do not assume regular handovers.';
  const encryptedContext = await encryptPrivateContext(
    privateSummary, 'local-test-secret-not-for-production'
  );
  const ticket = await signStreamingTicket({
    aud: 'q-stream-poc-v1', sub: 'sample-user', jti: 'test_session_12345',
    exp: Math.floor(Date.now() / 1000) + 45,
    bodyHash: await requestDigest(normalizedBody),
    context: encryptedContext,
  }, 'local-test-secret-not-for-production');
  // The signed ticket contains no readable journal or journey information.
  assert.equal(ticket.includes(privateSummary), false);
  const encoded = ticket.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
  assert.equal(atob(encoded).includes(privateSummary), false);
  const env = {
    STREAMING_ENABLED: 'true',
    STREAM_MODEL: 'gpt-5.5',
    OPENAI_API_KEY: 'fake-key-never-sent',
    STREAM_TICKET_SECRET: 'local-test-secret-not-for-production',
    Q_STREAM_BUDGET: {
      idFromName: () => 'shared-budget',
      get: () => ({ fetch: async () => new Response('', { status: 200 }) }),
    },
  };
  let upstreamPayload;
  const providerFetch = async (_url, options) => {
    upstreamPayload = JSON.parse(options.body);
    return provider(DELTA_A, DELTA_B, DONE);
  };
  const makeRequest = (body) => new Request('https://stream.example/chat/stream', {
    method: 'POST',
    headers: { Origin: ORIGIN, Authorization: 'Bearer ' + ticket },
    body: JSON.stringify(body),
  });
  const good = await handleStreamingRequest(makeRequest(normalizedBody), env, providerFetch);
  assert.equal(good.status, 200);
  const content = await good.text();
  assert.ok(content.includes('"delta"'));
  assert.equal(upstreamPayload.stream, true);
  assert.equal(upstreamPayload.store, false);
  assert.equal(upstreamPayload.model, 'gpt-5.5');
  assert.match(upstreamPayload.instructions, /Do not assume regular handovers/);
  assert.equal(upstreamPayload.max_output_tokens, 1000);

  upstreamPayload = undefined;
  const bad = await handleStreamingRequest(makeRequest({ message: 'Changed request', history: [] }), env, providerFetch);
  assert.equal(bad.status, 401);
  assert.equal(upstreamPayload, undefined);
});

test('budget reservation rejects token replay and stops after configured allowance', async () => {
  const mem = new Map();
  const guard = new QStreamBudget({
    storage: {
      transaction: fn => fn({
        get: key => mem.get(key),
        put: (key, value) => mem.set(key, value),
      }),
    },
  }, { MONTHLY_BUDGET_PENCE: '600', UPPER_BOUND_RESERVATION_PENCE: '300' });
  const reserve = jti => guard.fetch(new Request('https://budget.internal/reserve', {
    method: 'POST', body: JSON.stringify({ jti }),
  }));
  assert.equal((await reserve('unique_ticket_12345')).status, 200);
  assert.equal((await reserve('unique_ticket_12345')).status, 409);
  assert.equal((await reserve('unique_ticket_45678')).status, 200);
  assert.equal((await reserve('unique_ticket_99999')).status, 429);
});

test('frontend displays answer pieces immediately, then marks completion', async () => {
  const pieces = [];
  let complete = '';
  const response = await streamingResponse(provider(DELTA_A, DELTA_B, DONE), ORIGIN);
  const success = await readQStream(response, {
    onDelta: (text, running) => pieces.push({ text, running }),
    onDone: text => { complete = text; },
  });
  assert.equal(success, true);
  assert.deepEqual(pieces, [
    { text: 'I hear ', running: 'I hear ' },
    { text: 'you.', running: 'I hear you.' },
  ]);
  assert.equal(complete, 'I hear you.');
});

test('frontend reports interrupted answers without pretending they completed', async () => {
  let errored = '';
  const result = await readQStream(
    await streamingResponse(provider(DELTA_A), ORIGIN),
    { onError: text => { errored = text; } }
  );
  assert.equal(result, false);
  assert.match(errored, /interrupted|stopped/i);
});

test('Q integration preserves real incremental text and completes once', async () => {
  let issued = null;
  let posted = null;
  const deltas = [];
  const statuses = [];
  const completions = [];
  const result = await tryStreamQReply({
    message: '  I miss the kids  ',
    history: [{ role: 'user', text: 'Hello' }],
    streamUrl: 'https://preview.example/chat/stream',
    issueTicket: async body => { issued = body; return { ticket: 'session-token' }; },
    fetchImpl: async (url, req) => {
      posted = { url, ...req };
      return streamingResponse(provider(DELTA_A, DELTA_B, DONE), ORIGIN);
    },
    onStatus: next => statuses.push(next),
    onDelta: (piece, full) => deltas.push({ piece, full }),
    onComplete: answer => completions.push(answer),
  });
  assert.equal(result.mode, 'streamed');
  assert.equal(result.text, 'I hear you.');
  assert.deepEqual(issued, { message: 'I miss the kids', history: [{ role: 'user', text: 'Hello' }] });
  assert.equal(posted.headers.Authorization, 'Bearer session-token');
  assert.equal(JSON.parse(posted.body).message, issued.message);
  assert.deepEqual(statuses, ['thinking', 'streaming', 'streaming']);
  assert.equal(completions.length, 1);
  assert.deepEqual(deltas.map(d => d.full), ['I hear ', 'I hear you.']);
});

test('Q falls back to existing AI before any streaming text is shown', async () => {
  let issueCalls = 0;
  const result = await tryStreamQReply({
    message: 'Today feels hard',
    streamUrl: 'https://preview.example/chat/stream',
    issueTicket: async () => { issueCalls++; throw new Error('Ticket not configured'); },
  });
  assert.equal(result.mode, 'fallback');
  assert.equal(issueCalls, 1);
  const disabled = await tryStreamQReply({
    message: 'Today feels hard',
    issueTicket: async () => { issueCalls++; },
  });
  assert.equal(disabled.mode, 'fallback');
  assert.equal(issueCalls, 1);
});

test('Q never duplicates an answer or silently switches providers mid-stream', async () => {
  const texts = [];
  const interruptions = [];
  const result = await tryStreamQReply({
    message: 'Please listen',
    streamUrl: 'https://preview.example/chat/stream',
    issueTicket: async () => ({ ticket: 'signed-preview-session' }),
    fetchImpl: async () => streamingResponse(provider(DELTA_A), ORIGIN),
    onDelta: (_part, whole) => texts.push(whole),
    onInterrupted: msg => interruptions.push(msg),
  });
  assert.equal(result.mode, 'interrupted');
  assert.equal(result.text, 'I hear ');
  assert.equal(texts.length, 1);
  assert.equal(interruptions.length, 1);
});

test('Q discards a cancelled request rather than starting a second response', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await tryStreamQReply({
    message: 'Can we talk?',
    streamUrl: 'https://preview.example/chat/stream',
    signal: controller.signal,
    issueTicket: async () => ({ ticket: 'token' }),
  });
  assert.equal(result.mode, 'cancelled');
});

test('signed streaming ticket accepts subsequent turns and preserves exact conversation', async () => {
  const secret = 'local-test-secret-not-for-production';
  const body = {
    message: 'Can I tell you what happened next?',
    history: [
      { role: 'user', text: 'I miss my kids.' },
      { role: 'assistant', text: 'It sounds especially hard today.' },
    ],
  };
  const context = await encryptPrivateContext('Shared-care arrangement.', secret);
  const token = await signStreamingTicket({
    aud: 'q-stream-poc-v1', sub: 'sample-user', jti: 'continued_chat_ticket_123',
    exp: Math.floor(Date.now() / 1000) + 60,
    bodyHash: await requestDigest(body),
    context,
  }, secret);
  let upstreamInput = [];
  const env = {
    STREAMING_ENABLED: 'true',
    STREAM_MODEL: 'gpt-5.5',
    OPENAI_API_KEY: 'never-a-real-key',
    STREAM_TICKET_SECRET: secret,
    Q_STREAM_BUDGET: {
      idFromName: () => 'guard',
      get: () => ({ fetch: async () => new Response('', { status: 200 }) }),
    },
  };
  const request = new Request('https://preview.example/chat/stream', {
    method: 'POST',
    headers: { Origin: ORIGIN, Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  const response = await handleStreamingRequest(request, env, async (_url, options) => {
    upstreamInput = JSON.parse(options.body).input;
    return provider(DELTA_A, DONE);
  });
  assert.equal(response.status, 200);
  assert.deepEqual(upstreamInput, [
    { role: 'user', content: 'I miss my kids.' },
    { role: 'assistant', content: 'It sounds especially hard today.' },
    { role: 'user', content: 'Can I tell you what happened next?' },
  ]);
  assert.ok((await response.text()).includes('done'));
});

test('Q never auto-retries after AI stream fetch returns an error status', async () => {
  let providerCalls = 0;
  const interruptions = [];
  const result = await tryStreamQReply({
    message: 'I need somewhere to talk',
    streamUrl: 'https://preview.example/chat/stream',
    issueTicket: async () => ({ ticket: 'valid-ticket' }),
    fetchImpl: async () => {
      providerCalls++;
      return new Response('upstream failed', { status: 502 });
    },
    onInterrupted: msg => interruptions.push(msg),
  });
  assert.equal(result.mode, 'interrupted');
  assert.equal(providerCalls, 1);
  assert.equal(interruptions.length, 1);
});

test('Q never auto-retries after stream connects but closes before first token', async () => {
  let providerCalls = 0;
  const interruptions = [];
  const result = await tryStreamQReply({
    message: 'I am feeling alone today',
    streamUrl: 'https://preview.example/chat/stream',
    issueTicket: async () => ({ ticket: 'valid-ticket' }),
    fetchImpl: async () => {
      providerCalls++;
      return streamingResponse(provider('data: {"type":"response.created"}\n\n'), ORIGIN);
    },
    onInterrupted: msg => interruptions.push(msg),
  });
  assert.equal(result.mode, 'interrupted');
  assert.equal(providerCalls, 1);
  assert.equal(interruptions.length, 1);
});

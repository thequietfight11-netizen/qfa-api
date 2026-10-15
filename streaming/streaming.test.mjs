import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleStreamingRequest, streamingResponse, requestDigest,
  signStreamingTicket, QStreamBudget,
} from './worker.mjs';
import { readQStream } from './reader.mjs';

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
  const ticket = await signStreamingTicket({
    aud: 'q-stream-poc-v1', sub: 'sample-user', jti: 'test_session_12345',
    exp: Math.floor(Date.now() / 1000) + 45,
    bodyHash: await requestDigest(normalizedBody),
    summary: 'Separated dad, minimal contact. Do not assume regular handovers.',
  }, 'local-test-secret-not-for-production');
  const env = {
    STREAMING_ENABLED: 'true',
    STREAM_MODEL: 'configured-model-under-test',
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
  assert.equal(upstreamPayload.model, 'configured-model-under-test');
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

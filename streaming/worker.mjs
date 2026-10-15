/*
 * Quiet Fight live-token streaming proof of concept.
 *
 * ISOLATED: This file is NOT the deployed production worker.js.
 * Fail-closed unless the test deployment has a ticket issuer, spend reservation
 * Durable Object, OpenAI key, and explicit STREAMING_ENABLED=true.
 */

const ALLOWED_ORIGINS = new Set([
  'https://thequietfight.co.uk',
  'https://www.thequietfight.co.uk',
  'https://the-quiet-fight-production-plwzkx.v2.appdeploy.ai',
]);

const INSTRUCTIONS = [
  'You are Q, the Quiet Fight support coach for separated dads.',
  'Recognise what the dad is saying, help him make sense of it, and offer one useful next step when appropriate.',
  'Be warm, direct and plain-spoken. Never blame the other parent. Never diagnose.',
  'Never pretend to be a solicitor, therapist or emergency service.',
  'Do not force optimism or wrap painful things in motivational clichés.',
  'Keep the dad\'s relationship with his children central without assuming he currently has contact.',
  'If the user mentions immediate danger, suicide intent, self-harm plans, or being unable to stay safe, tell him to contact emergency help now: 999/A&E in the UK, NHS 111 mental health option for urgent help in England, or Samaritans 116 123.',
  'Avoid long lists. Usually answer in 2-5 short paragraphs.',
].join('\n');

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) },
  });
}

function clampHistory(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(-8).flatMap(item => {
    const role = item?.role;
    const content = typeof item?.text === 'string' ? item.text.trim().slice(0, 3000) : '';
    return (role === 'user' || role === 'assistant') && content ? [{ role, content }] : [];
  });
}

function normalizeBody(body) {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > 4000) throw new Error('Invalid message length');
  return { message, history: clampHistory(body?.history) };
}

function bytesToBase64Url(bytes) {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Bad ticket');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

export async function requestDigest(normalizedBody) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(normalizedBody)));
  return bytesToBase64Url(new Uint8Array(hash));
}

// Used by the TESTS and by the future server-side AppDeploy ticket issuer.
// Never call from a browser: the HMAC secret must remain server-only.
export async function signStreamingTicket(payload, secret) {
  const raw = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(raw));
  return raw + '.' + bytesToBase64Url(new Uint8Array(signature));
}

async function verifyTicket(ticket, secret, digest, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!ticket || ticket.length > 4096) return null;
  const parts = ticket.split('.');
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC', await hmacKey(secret), base64UrlToBytes(parts[1]), new TextEncoder().encode(parts[0])
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    if (
      payload.aud !== 'q-stream-poc-v1' ||
      typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 ||
      typeof payload.jti !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(payload.jti) ||
      typeof payload.exp !== 'number' || payload.exp <= nowSeconds || payload.exp > nowSeconds + 90 ||
      payload.bodyHash !== digest ||
      typeof payload.summary !== 'string' || payload.summary.length > 1800
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

function sse(data) {
  return new TextEncoder().encode('data: ' + JSON.stringify(data) + '\n\n');
}

/**
 * Re-frame the REAL OpenAI Responses SSE stream, forwarding only public answer
 * tokens. Never reveal reasoning events or leak provider API errors/secrets.
 * Each delta reaches the client as soon as it arrives (no typewriter fakery).
 */
export function streamingResponse(upstream, origin) {
  if (!upstream.body) throw new Error('Provider did not return a stream');
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let stopped = false;
  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      let completed = false;
      let delivered = false;
      let ended = false;

      function emit(data) {
        if (!stopped && !ended) controller.enqueue(sse(data));
      }

      function handleFrame(frame) {
        const lines = frame.split(/\r?\n/);
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') return;
        let event;
        try { event = JSON.parse(data); } catch { return; }
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          if (!event.delta) return;
          delivered = true;
          emit({ type: 'delta', text: event.delta });
        } else if (event.type === 'response.completed') {
          completed = true;
          emit({ type: 'done' });
        } else if (event.type === 'response.failed' || event.type === 'error') {
          emit({ type: 'error', message: 'Q could not finish just now. Please try again.' });
          ended = true;
        }
      }

      try {
        while (!stopped) {
          const read = await reader.read();
          if (read.done) break;
          buffer += decoder.decode(read.value, { stream: true });
          // Provider frames can arrive split mid-byte and mid-JSON string.
          let match;
          while ((match = /(?:\r?\n){2}/.exec(buffer))) {
            const frame = buffer.slice(0, match.index);
            buffer = buffer.slice(match.index + match[0].length);
            handleFrame(frame);
            if (ended) break;
          }
          if (buffer.length > 65536) throw new Error('Oversized provider event');
          if (ended) break;
        }
        if (!stopped && !completed && !ended) {
          emit({ type: 'error', message: delivered
            ? 'Q was interrupted before finishing. Please try again.'
            : 'Q could not respond just now. Please try again.' });
        }
      } catch {
        if (!stopped && !ended) emit({ type: 'error', message: 'The connection was interrupted. Please try again.' });
      } finally {
        stopped = true;
        if (!ended) ended = true;
        try { await reader.cancel(); } catch { /* already closed */ }
        try { controller.close(); } catch { /* client cancelled */ }
      }
    },
    cancel() {
      stopped = true;
      reader.cancel().catch(() => {});
    },
  });
  return new Response(stream, {
    headers: {
      ...cors(origin),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Durable Object: one-use ticket + explicit per-month spend reservation. */
export class QStreamBudget {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
  }
  async fetch(request) {
    if (request.method !== 'POST') return new Response('', { status: 405 });
    const { jti } = await request.json();
    const cap = Number(this.env.MONTHLY_BUDGET_PENCE);
    const reserve = Number(this.env.UPPER_BOUND_RESERVATION_PENCE);
    // Fail closed: this is a reservation policy, not a claim about provider prices.
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 2500 ||
        !Number.isSafeInteger(reserve) || reserve < 1 || reserve > cap)
      return jsonResponse({ error: 'Budget not configured' }, 503, '');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(jti || ''))
      return new Response('', { status: 400 });
    const month = new Date().toISOString().slice(0, 7);
    const result = await this.storage.transaction(async tx => {
      if (await tx.get('ticket:' + jti)) return 409;
      const used = Number(await tx.get('used:' + month) || 0);
      if (used + reserve > cap) return 429;
      await tx.put('ticket:' + jti, month);
      await tx.put('used:' + month, used + reserve);
      return 200;
    });
    return new Response('', { status: result });
  }
}

export async function handleStreamingRequest(request, env, fetchImpl = fetch) {
  const origin = request.headers.get('Origin') || '';
  // A valid Origin is necessary for browser access but NOT sufficient for auth.
  if (!ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: 'Origin not allowed' }, 403, origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/chat/stream')
    return jsonResponse({ error: 'Not found' }, 404, origin);

  if (
    env.STREAMING_ENABLED !== 'true' ||
    !env.OPENAI_API_KEY || !env.STREAM_TICKET_SECRET ||
    !env.STREAM_MODEL || !env.Q_STREAM_BUDGET
  ) return jsonResponse({ error: 'Preview streaming is not enabled' }, 503, origin);

  const raw = await request.text();
  if (raw.length > 18000) return jsonResponse({ error: 'Request too large' }, 413, origin);
  let body;
  try { body = normalizeBody(JSON.parse(raw)); }
  catch { return jsonResponse({ error: 'Invalid message' }, 400, origin); }
  const auth = request.headers.get('Authorization') || '';
  const ticket = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = await verifyTicket(ticket, env.STREAM_TICKET_SECRET, await requestDigest(body));
  if (!payload) return jsonResponse({ error: 'Invalid or expired session' }, 401, origin);

  // Reserve spend *before* making an upstream paid request. One-use tickets stop
  // replays; missing/misconfigured budget fails closed without spending.
  const guard = env.Q_STREAM_BUDGET.get(env.Q_STREAM_BUDGET.idFromName('all-users'));
  let check;
  try {
    check = await guard.fetch('https://budget.internal/reserve', {
      method: 'POST', body: JSON.stringify({ jti: payload.jti }),
    });
  } catch {
    return jsonResponse({ error: 'Preview budget check unavailable' }, 503, origin);
  }
  if (!check.ok) return jsonResponse({ error: 'Preview request limit reached' }, check.status === 409 ? 409 : 429, origin);

  let upstream;
  try {
    upstream = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: request.signal,
      headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.STREAM_MODEL, // Explicit: no silent model downgrade.
        instructions: INSTRUCTIONS + '\nPrivate journey context: ' + payload.summary,
        input: [
          ...body.history.map(x => ({ role: x.role, content: x.content })),
          { role: 'user', content: body.message },
        ],
        reasoning: { effort: 'low' },
        max_output_tokens: 1000,
        store: false,
        stream: true,
      }),
    });
  } catch {
    return jsonResponse({ error: 'Q is temporarily unavailable' }, 502, origin);
  }
  if (!upstream.ok) {
    try { await upstream.body?.cancel(); } catch { /* no-op */ }
    return jsonResponse({ error: 'Q is temporarily unavailable' }, 502, origin);
  }
  return streamingResponse(upstream, origin);
}

export default { fetch: handleStreamingRequest };

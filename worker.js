const ALLOWED_ORIGINS = new Set([
  'https://thequietfight.co.uk',
  'https://www.thequietfight.co.uk',
]);

const QFA_INSTRUCTIONS = `
You are QFA, the Quiet Fight Assistant for The Quiet Fight, a UK support platform for separated dads.

Be calm, human, grounded, and non-judgmental. Help separated dads feel heard and understood.
Match what the person wants: listening, perspective, or practical next steps.
Use plain English. Avoid therapy-speak, clichés, preachy language, and long lectures.
Ask at most one useful follow-up question at a time.
Do not take sides in family disputes or encourage hostility toward an ex-partner.
Do not present legal, medical, financial, or safeguarding guidance as professional advice.
Never invent facts about the user or their family.

Tone: warm, straightforward, quietly encouraging, like a good coach who understands separated dads.
Usually 80-220 words unless the user asks for more.

If the user says they may hurt themselves or someone else, or cannot stay safe, respond supportively and encourage immediate real-world help.
For a UK user in immediate danger: call 999 or go to A&E.
For urgent emotional support in the UK: Samaritans 116 123.
Encourage contacting a trusted person nearby where appropriate.

Listen first. Do not rush to fix someone who mainly needs to be heard.
`.trim();

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://thequietfight.co.uk',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  });
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-8)
    .filter(x => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string')
    .map(x => ({ role: x.role, content: x.content.slice(0, 2000) }));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'qfa-api', model: 'gpt-5.6-luna' }, 200, origin);
    }

    if (request.method !== 'POST' || url.pathname !== '/chat') {
      return jsonResponse({ error: 'Not found' }, 404, origin);
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ error: 'Origin not allowed' }, 403, origin);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'QFA is not configured yet.' }, 500, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid request.' }, 400, origin);
    }

    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) return jsonResponse({ error: 'Please enter a message.' }, 400, origin);
    if (message.length > 3000) {
      return jsonResponse({ error: 'That message is too long. Please shorten it and try again.' }, 400, origin);
    }

    const history = cleanHistory(body?.history);
    const input = [
      ...history.map(item => ({
        role: item.role,
        content: [{ type: 'input_text', text: item.content }],
      })),
      { role: 'user', content: [{ type: 'input_text', text: message }] },
    ];

    let upstream;
    try {
      upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5.6-luna',
          instructions: QFA_INSTRUCTIONS,
          input,
          reasoning: { effort: 'low' },
          text: { verbosity: 'low' },
          max_output_tokens: 500,
          store: false,
        }),
      });
    } catch {
      return jsonResponse({ error: 'QFA could not reach the AI service. Please try again.' }, 502, origin);
    }

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      console.error('OpenAI error', upstream.status, data?.error?.code || 'unknown');
      return jsonResponse({
        error: upstream.status === 429
          ? 'QFA is busy right now. Please try again in a moment.'
          : 'QFA could not answer just now. Please try again.',
      }, 502, origin);
    }

    let reply = typeof data.output_text === 'string' ? data.output_text.trim() : '';
    if (!reply && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!Array.isArray(item?.content)) continue;
        for (const part of item.content) {
          if (part?.type === 'output_text' && typeof part.text === 'string') {
            reply += (reply ? '\n' : '') + part.text;
          }
        }
      }
      reply = reply.trim();
    }

    if (!reply) {
      return jsonResponse({ error: 'QFA returned an empty reply. Please try again.' }, 502, origin);
    }

    return jsonResponse({
      reply,
      usage: data.usage ? {
        input_tokens: data.usage.input_tokens || 0,
        output_tokens: data.usage.output_tokens || 0,
        total_tokens: data.usage.total_tokens || 0,
      } : undefined,
    }, 200, origin);
  },
};

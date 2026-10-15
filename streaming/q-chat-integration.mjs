import { readQStream } from './reader.mjs';

/**
 * Adapter used by a future tester-only Q chat. It deliberately does not choose
 * a production URL, enable streaming or call AppDeploy authentication itself.
 *
 * The app supplies issueTicket = async body =>
 *    (await api.post('/api/q-stream-ticket', body)).data
 *
 * Network calls to AppDeploy still use the AppDeploy `api` client. Native
 * fetch is required only for the separate external Cloudflare SSE endpoint.
 */
export async function tryStreamQReply({
  message,
  history = [],
  issueTicket,
  streamUrl,
  fetchImpl = fetch,
  signal,
  onStatus = () => {},
  onDelta = () => {},
  onComplete = () => {},
  onInterrupted = () => {},
}) {
  if (typeof message !== 'string' || !message.trim()) {
    return { mode: 'rejected' };
  }
  if (!streamUrl || !/^https:\/\//.test(streamUrl) || typeof issueTicket !== 'function') {
    return { mode: 'fallback', reason: 'Streaming preview not configured' };
  }
  // Copy the exact request that is signed; the worker verifies its digest.
  const body = { message: message.trim(), history };
  let partialReply = '';
  let hasStarted = false;
  let finished = false;
  let error = '';

  try {
    onStatus('thinking');
    const issued = await issueTicket(body);
    if (signal?.aborted) return { mode: 'cancelled' };
    if (!issued || typeof issued.ticket !== 'string' || !issued.ticket) {
      return { mode: 'fallback', reason: 'No streaming session' };
    }

    const response = await fetchImpl(streamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + issued.ticket,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (signal?.aborted) return { mode: 'cancelled' };
    if (!response.ok) return { mode: 'fallback', reason: 'Streaming unavailable' };

    const ok = await readQStream(response, {
      signal,
      onDelta: (piece, fullText) => {
        hasStarted = true;
        partialReply = fullText;
        onStatus('streaming');
        onDelta(piece, fullText);
      },
      onDone: fullText => {
        finished = true;
        partialReply = fullText;
        onComplete(fullText);
      },
      onError: reason => { error = reason; },
    });
    if (signal?.aborted) return { mode: 'cancelled' };
    if (ok && finished && partialReply.trim()) {
      return { mode: 'streamed', text: partialReply };
    }
    // Safe fallback only if NOTHING was displayed. Never issue a second
    // paid request after some of a personal answer has already reached the dad.
    if (!hasStarted) return { mode: 'fallback', reason: error || 'Stream was empty' };
    onInterrupted(error || 'Q was interrupted. Please try again.');
    return { mode: 'interrupted', text: partialReply, reason: error };
  } catch {
    if (signal?.aborted) return { mode: 'cancelled' };
    if (!hasStarted) return { mode: 'fallback', reason: 'Stream could not start' };
    onInterrupted('The connection was interrupted. Please try again.');
    return { mode: 'interrupted', text: partialReply };
  }
}

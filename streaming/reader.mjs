/**
 * Streaming Q frontend reader (prototype only).
 * Reads server-sent text events progressively; never displays AI reasoning.
 * No fake typing delay, no artificial chunking of a completed response.
 */
export async function readQStream(response, {
  onDelta = () => {},
  onDone = () => {},
  onError = () => {},
  signal,
} = {}) {
  if (!response.ok || !response.body) {
    onError('Q could not connect. Please try again.');
    return false;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let finished = false;

  const readFrame = (frame) => {
    const data = frame.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let event;
    try { event = JSON.parse(data); }
    catch { return; }
    if (event.type === 'delta' && typeof event.text === 'string') {
      // append content as ordinary text, not HTML
      reply += event.text;
      onDelta(event.text, reply);
    } else if (event.type === 'done') {
      finished = true;
      onDone(reply);
    } else if (event.type === 'error') {
      finished = true;
      onError(typeof event.message === 'string' ? event.message : 'Q was interrupted.');
    }
  };

  try {
    while (!finished) {
      if (signal?.aborted) throw new Error('Aborted');
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let match;
      while ((match = /(?:\r?\n){2}/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        readFrame(frame);
        if (finished) break;
      }
      if (buffer.length > 65536) throw new Error('Oversized event');
    }
    if (!finished) onError('Q stopped before finishing. Please try again.');
    return finished;
  } catch {
    onError(signal?.aborted ? 'Q was cancelled.' : 'Q lost the connection. Please try again.');
    return false;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
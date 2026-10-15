# Q streaming — acceptance checklist

**Status:** code-complete prototype, not connected to a real model or testers.

## Model and quality
- Only `gpt-5.5` is allowed in the preview worker until its actual suitability has been assessed. The live AppDeploy `ai.generate` model is not exposed to this service; **equivalence is unverified**.
- Test all 15 fictitious scenarios in `quality-scenarios.json` with existing Q and the candidate. Do not import private coaching chats, names or real children's details into test fixtures.
- Review side-by-side, blinded to provider. Check recognition, specificity, no blame, safety referrals, co-parenting boundaries, chat continuity and unwanted forced optimism.
- **Release gate:** No new safety failure; no unacceptable drop in recognition, privacy or practical usefulness. Rework the model/prompt if quality regresses; never hide that tradeoff.
- Keep the exact Q coaching instructions synchronised between the worker and AppDeploy whenever they are edited.

## Phone + web experience
- On Send, the existing gentle Q thinking indicator appears immediately.
- When **genuine provider deltas** arrive, reveal words as they arrive (no fake typing or client-side delay).
- During the response the Send button is disabled, and all history remains in order.
- When the final event arrives, replace the provisional text with the completed message.
- On interruption, clearly label the *partial* answer as incomplete and invite retry.
- Only fall back to normal AppDeploy Q if no request was sent to the paid provider; never silently duplicate an AI call.
- Escape text (never inject streamed strings as HTML). No browser console logging of conversation or ticket contents.
- Ensure sensible scrolling; typing and accessibility (reduced motion/screen reader) must remain usable.
- Test on Chrome Android, Google Play Trusted Web Activity and desktop browsers, including loss of connectivity, expired ticket, slow response, account sign-out and reopening the app.

## Latency acceptance
Measure the same short, medium and long prompts across both services and several test runs:
1. Time from tapping Send until thinking message appears.
2. Time until **first visible AI text**.
3. Time until complete reply.
4. Quality scores and API charges per request.

A streaming version only improves experience if first-text latency is measurably lower without harming answer quality. Do not invent results before the real test.

## Cost / authorisation
- **Preview only:** `STREAMING_ENABLED=false` until specifically enabled.
- `STREAM_MODEL=gpt-5.5` is fixed allowlist. Official 2026 API rate used for *planning*: $5 per million input and $30 per million output tokens; recheck before any real calls.
- Worker sets maximum output tokens to 1000 and caps message/history input lengths.
- **Reserve-based pilot budget:** monthly cap 500 pence (£5), reservation 50 pence per request. This allows **at most 10 approved requests per month** in the preview, counting unused tokens conservatively. The rest of The Quiet Fight's automation budget remains unallocated to this test.
- A reservation is a protective ceiling for known usage assumptions, not a provider-issued total-billing cap. Re-evaluate rates, token usage, other operational costs and currency conversion before enabling. Cloudflare paid plans and other services may charge separately.
- The preview calls fail closed with missing config or spent budget. No provider key, Cloudflare token or shared signing secret goes in GitHub source.
- Google Play closed-test app is **not** automatically updated by these isolated GitHub commits.

## Pending access
To complete a real tester-only deployment we need secure, user-authorised Cloudflare account access (or a manual Cloudflare Worker deployment) and separate OpenAI API credentials/billing. ChatGPT Plus access does not supply API credits. Account secrets go through provider forms or secure secret-entry links, never chat text.

## Completed mock verification
GitHub Actions: `node --test streaming/streaming.test.mjs`. Tests prove authenticated ticket matching, encryption, spend denial, incremental deltas, follow-up turns, safe cancellation and not silently double-sending requests. They **do not** prove the real OpenAI key/model/cloud infrastructure are working until connected.

# Q — real-time text streaming (isolated prototype)

This is **NOT deployed** and does not change either the production website or the Play Store app.

## Why a separate streaming service?

The current live AppDeploy API uses `ai.generate()`, which returns completed text. Its documented API does **not** expose streaming tokens. The existing `Q is thinking` indicator stays in production until the complete alternative is verified.

This prototype forwards **real** `response.output_text.delta` events from the OpenAI Responses API as small, server-sent `delta` events to the client. It never streams hidden reasoning or artificially reveals a completed answer one character at a time. It emits `done` or safe `error`.

## Safety and security built in

- **Separate** Cloudflare script name `qfa-streaming-preview`, disabled with `STREAMING_ENABLED=false`.
- Browser Origin allowlist **plus** a cryptographically signed, short-lived, request-bound ticket minted by an **authenticated server-side** issuer.
- Server-side one-use ticket and monthly spending *reservation* using one Durable Object. Fail closed if the guard, key or model is missing.
- Request sizes, history and output length capped; `store: false`.
- No API keys in frontend code, and no provider error text or internal reasoning shown to dads.
- Reserve pricing must be validated against the chosen model's current worst-case rates and currency conversion before any paid traffic. The guard is a reservation/call ceiling, not a guarantee that actual usage cannot exceed it.
- Do not turn on streaming until a proper spend policy, QA, and an AppDeploy authenticated ticket issuer are in place.

## Still required before live phone testing

1. **Implemented, but disabled:** the production AppDeploy backend now has a `requireAuth()`-protected `POST /api/q-stream-ticket` issuer. It encrypts each dad’s own journey context and signs the message-bound 60-second ticket. It fails closed because `Q_STREAM_TICKET_SECRET` has **not** been configured; live `/api/q` is unaffected. When ready, provide the same strong secret securely to both services. Never put the secret in source files or the browser.
2. Choose an actually available OpenAI model that meets Q's current quality bar. The existing AppDeploy AI model has not been mapped to a direct OpenAI model; do **not** promise equivalent replies until a blind quality comparison.
3. Verify price and configure enforced spending policy before turning on `STREAMING_ENABLED`. Confirm Durable Object and model availability on the target Cloudflare account.
4. Add the `readQStream` reader to a **separate** app preview, retaining existing AppDeploy `POST /api/q` as a safe fallback; test Chrome, Android TWA, network interruptions, logout and message ordering.
5. Arrange Cloudflare deployment permission or user-run Wrangler publish to the **preview** worker only. Never deploy onto the existing `qfa-api` worker or change the Play Store app without approval.

## Local unit checks

Run: `node --test streaming/streaming.test.mjs`

The suite uses a **mock OpenAI SSE response**, so it generates no paid AI calls. GitHub Actions automatically runs the same tests for this feature branch.

## Draft contract

Authenticated issuer creates a base64url HMAC-SHA256 ticket with fields (the private journey context is AES-GCM encrypted before insertion):

```json
{
  "aud": "q-stream-poc-v1",
  "sub": "authenticated-user-id",
  "jti": "cryptographically-random-unique-ticket",
  "exp": 1770000060,
  "bodyHash": "sha256-base64url-of-normalized-message-history",
  "context": "base64url-12-byte-IV.base64url-AES-GCM-ciphertext"
}
```

Client submits the exact `{ "message": "...", "history": [{ "role": "user", "text": "..." }] }` request body to `POST /chat/stream` with `Authorization: Bearer <signed-ticket>`.

Server replies `text/event-stream` with events such as:

```text
data: {"type":"delta","text":"That sounds"}

data: {"type":"delta","text":" difficult."}

data: {"type":"done"}

```

The client appends each `delta` to a text node **as it arrives** (never `innerHTML`), keeps the current thinking bubble until the first text event, and removes it on complete/error.

The authenticated ticket issuer code is now deployed **dormant** in the existing AppDeploy backend, with no secret configured and no production client using it. No production AI streaming traffic is enabled.

# Ring receiver

Catches voice notes from the Index 01 and drops them into the notebook.

The ring transcribes on its own side and POSTs the text here. This Worker writes
one `pending` note to Firestore and stops. All the thinking — summary, tags,
personas, concepts, memory — happens in the browser the next time Noteworthy is
opened, because `app.js` reprocesses any note left pending. Nothing about the
existing pipeline changes.

## Setup

**1. Make an account for the ring.**

Firebase console → Authentication → Users → Add user. Use `ring@noteworthy.local`
and a long random password. Copy the **User UID**.

**2. Let that account in.**

Add the uid to the allowlist in `../firestore.rules`, then publish:

```bash
firebase deploy --only firestore:rules
```

Until the rules are published the Worker gets a 403 and every note bounces.

**3. Deploy.**

```bash
cd worker && npx wrangler deploy
```

**4. Give it the two secrets.**

```bash
npx wrangler secret put FIREBASE_PASSWORD
```

```bash
npx wrangler secret put RING_SECRET
```

For `RING_SECRET`, use something long and random — `openssl rand -hex 32`. It is
the only thing guarding the endpoint.

**5. Point the ring at it.**

In the Index app, add a webhook:

- **URL** — the `https://noteworthy-ring.<subdomain>.workers.dev` address wrangler printed
- **Send** — text only
- **Header** — name `Authorization`, value `Bearer <the RING_SECRET from step 4>`
  (a bare `<RING_SECRET>` with no prefix is accepted too — the field is a
  one-liner on a phone, and a missing prefix looks just like a correct one)

## Checking it works

```bash
curl -X POST https://noteworthy-ring.<subdomain>.workers.dev -H "Authorization: Bearer <RING_SECRET>" -F "transcription=hello from the ring" -F "recordedAt=$(date +%s)000" -F "client=ring"
```

A `201 Wrote <id>.` means it landed. Open Noteworthy and the note will be sitting
there, tagged `ring`, filling itself in.

Wrong secret returns `401 No.` — worth confirming too, since that check is the
whole lock.

## Watching it

```bash
npx wrangler tail
```

## What each reply means

| Status | Meaning |
|---|---|
| `201` | Note written. |
| `200` | Delivery had no transcription — nothing to write, don't retry. |
| `401` | Bad or missing `Authorization` header. Both `Bearer <secret>` and a bare `<secret>` are accepted, so a 401 means the secret itself is wrong or truncated. |
| `500` | Sign-in or Firestore failed. **The note was lost.** Check `wrangler tail`. |

/**
 * Noteworthy — Index 01 ring receiver
 * ============================================================================
 *
 * The Index 01 posts a finished voice note here: HTTPS POST, multipart/form-data,
 * carrying `transcription`, `recordedAt` (ms since the unix epoch) and `client`
 * (always the string 'ring').
 *
 * Configure the ring to send TEXT ONLY. By the time this runs the words have
 * already been transcribed on the ring's side, and that transcription is the
 * good part — there is nothing Noteworthy can do with the M4A that would improve
 * on it, and accepting audio would mean a storage bucket, a quota and an upload
 * path in exchange for nothing.
 *
 * This file does exactly one thing: write a single pending note into Firestore.
 * It does not call Gemini and it must not learn how. app.js already sweeps up
 * anything left in 'pending' the next time the notebook is opened and runs the
 * whole pipeline in the browser — summary, tags, personas, concepts, embeddings,
 * memory. A second copy of any of that here would be two versions of the same
 * prompt drifting apart, and the browser copy is the one that gets maintained.
 *
 * Nothing secret is in this file. The password and the shared secret arrive as
 * Cloudflare bindings, which matters more than usual: the Pages workflow rsyncs
 * the whole repo into the published site, so this source is readable by anyone
 * who guesses the path.
 */

const SIGN_IN = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';

// Firebase id tokens last an hour, and a Worker isolate usually outlives a
// single request, so a note that arrives soon after another skips the sign-in
// round trip. Purely an optimisation: if the isolate is cold, or this is stale,
// the code below just signs in again.
let cachedToken = null;

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return reply(405, 'This endpoint takes POSTs from the ring.');
        }

        // The URL is public and unguessable only until it is guessed. This
        // header is the entire lock on the notebook's front door, so it is
        // checked before the body is even read.
        //
        // Both `Bearer <secret>` and a bare `<secret>` are accepted. Neither
        // form gives anything away — you still have to know all 64 characters
        // — and the value gets typed into a one-line field on a phone, where a
        // missing prefix looks exactly like a correct one and costs an
        // afternoon. Trimmed, too: a paste that picks up a trailing space
        // should not read as an intruder.
        const offered = (request.headers.get('Authorization') || '').trim();
        const secret = env.RING_SECRET || '';
        const admitted = secret !== '' && (
            constantTimeEqual(offered, `Bearer ${secret}`) ||
            constantTimeEqual(offered, secret)
        );
        if (!admitted) {
            return reply(401, 'No.');
        }

        let form;
        try {
            form = await request.formData();
        } catch {
            return reply(400, 'Expected multipart/form-data.');
        }

        const rawText = String(form.get('transcription') || '').trim();
        if (!rawText) {
            // A delivery with no transcription is legitimate: the transcription
            // failed, or the ring is set to audio-only. There is no note to
            // write and there never will be for this delivery, so answer 200
            // rather than invite a retry of something that cannot succeed.
            return reply(200, 'No transcription in this delivery; nothing written.');
        }

        const createdAt = isoFrom(form.get('recordedAt'));

        try {
            const id = await createNote(env, rawText, createdAt);
            return reply(201, `Wrote ${id}.`);
        } catch (err) {
            // 500 is the honest answer: the thought did not land. A cheerful 200
            // here would lose it silently, which is the single failure this
            // whole path exists to prevent.
            cachedToken = null;
            return reply(500, `Could not write the note: ${err.message}`);
        }
    },
};

/**
 * Writes one note document, shaped exactly like the ones addNoteAPI() creates
 * in api.js. Anything that diverges from that shape is a note the app will
 * render slightly wrong forever.
 */
async function createNote(env, rawText, createdAt) {
    const idToken = await firebaseIdToken(env);
    const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/notes`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            fields: {
                profile: { stringValue: env.PROFILE },
                raw_text: { stringValue: rawText },

                // stringValue, not timestampValue. The app writes these with
                // new Date().toISOString() and sorts with new Date(n.created_at);
                // a real Firestore timestamp comes back as an object and that
                // sort quietly turns into NaN.
                created_at: { stringValue: createdAt },
                updated_at: { stringValue: createdAt },

                // 'pending' is the handoff. The load path in app.js reprocesses
                // any pending note older than five seconds, which is what turns
                // this bare row into a real note.
                status: { stringValue: 'pending' },

                // processNote merges model tags into whatever is already there
                // rather than replacing them, so this one survives enrichment
                // and stays a permanent marker of where the note came from.
                tags: { arrayValue: { values: [{ stringValue: 'ring' }] } },
            },
        }),
    });

    if (!res.ok) {
        throw new Error(`Firestore said ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const doc = await res.json();
    return String(doc.name || '').split('/').pop() || 'a note';
}

/**
 * Signs in as the dedicated ring account and returns its id token.
 *
 * This is a password sign-in rather than a service account because the rules in
 * firestore.rules check request.auth.uid against a named allowlist. A service
 * account would bypass the rules entirely; this way the ring is just another
 * name on the same list, revoked the same way as any other.
 */
async function firebaseIdToken(env) {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
        return cachedToken.idToken;
    }

    const res = await fetch(`${SIGN_IN}?key=${env.FIREBASE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: env.FIREBASE_EMAIL,
            password: env.FIREBASE_PASSWORD,
            returnSecureToken: true,
        }),
    });

    if (!res.ok) {
        throw new Error(`sign-in failed with ${res.status}`);
    }

    const body = await res.json();
    if (!body.idToken) throw new Error('sign-in returned no token');

    cachedToken = {
        idToken: body.idToken,
        expiresAt: Date.now() + Number(body.expiresIn || 3600) * 1000,
    };
    return cachedToken.idToken;
}

/** recordedAt is ms since epoch. Missing or malformed, now beats 1970 — the
 *  note still sorts into the place the reader expects to find it. */
function isoFrom(recordedAt) {
    const ms = Number(recordedAt);
    if (!Number.isFinite(ms) || ms <= 0) return new Date().toISOString();
    return new Date(ms).toISOString();
}

/** Compares without letting the time taken narrow down the answer. Length still
 *  leaks, which is why the secret should be long and random rather than short
 *  and clever. */
function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function reply(status, message) {
    return new Response(message + '\n', {
        status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
}

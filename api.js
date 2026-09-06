import { db } from './firebase.js';
import { collection, addDoc, getDocs, doc, setDoc, getDoc, query, where, orderBy, deleteDoc, updateDoc, serverTimestamp, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ============================================================================
// PERSONAS
// ============================================================================
export const PERSONAS = {
    philosopher: { emoji: '🏛', name: 'Philosopher', desc: 'Ontological, ethical & existential angles' },
    scientist:   { emoji: '🔬', name: 'Scientist',   desc: 'Empirical rigor & hypothesis testing' },
    designer:    { emoji: '🎨', name: 'Designer',    desc: 'Form, function & user empathy' },
    strategist:  { emoji: '♟', name: 'Strategist',  desc: 'First-principles & tradeoffs' },
    therapist:   { emoji: '🧠', name: 'Therapist',   desc: 'Emotional subtext & cognitive patterns' },
    historian:   { emoji: '📜', name: 'Historian',   desc: 'Historical context & long arcs' },
    poet:        { emoji: '✍️', name: 'Poet',        desc: 'Metaphor, rhythm & language as feeling' },
    economist:   { emoji: '📊', name: 'Economist',   desc: 'Incentives, systems & second-order effects' },
};

const PERSONA_PROMPTS = {
    philosopher: `You are a philosopher acting as a thought partner. When analyzing this note, look for ontological questions (what IS this?), ethical tensions, assumptions about truth or meaning, and connections to major philosophical traditions. Surface the deepest existential stakes, challenge definitional boundaries, and find the paradoxes. Analyze the raw text and return a single valid JSON object:
{
  "summary": "A philosophical 1-2 sentence reframing of the note's deeper intent — what question of existence or meaning is really being asked?",
  "tags": ["tag1", "tag2"],
  "category": "idea, task, journal, reference, brainstorm, other",
  "sentiment": "positive, negative, neutral, mixed",
  "insights": {
    "themes": ["Ontological theme or tension"],
    "references": ["Philosophical concept or thinker"],
    "books": ["Title by Author — philosophical connection"],
    "follow_ups": ["Deep philosophical question to sit with?"]
  }
}
Return ONLY JSON.`,

    scientist: `You are a scientist acting as a thought partner. When analyzing this note, apply empirical rigor: what claims are being made? What evidence would be needed? What are the testable hypotheses? What variables are confounded? Think across disciplines — neuroscience, physics, biology, complexity theory. Analyze the raw text and return a single valid JSON object:
{
  "summary": "A precise, evidence-focused 1-2 sentence restatement of what is being observed or claimed, and what would need to be true for it to hold up.",
  "tags": ["tag1", "tag2"],
  "category": "idea, task, journal, reference, brainstorm, other",
  "sentiment": "positive, negative, neutral, mixed",
  "insights": {
    "themes": ["Core empirical claim or phenomenon"],
    "references": ["Scientific concept, study, or model"],
    "books": ["Title by Author — scientific connection"],
    "follow_ups": ["What experiment or data would test this?"]
  }
}
Return ONLY JSON.`,

    designer: `You are a designer acting as a thought partner. When analyzing this note, think about form and function: who is the user or audience? What problem is being solved? What friction exists? What would a beautifully designed solution look like? Think about systems, affordances, and the human experience of navigating this idea. Analyze the raw text and return a single valid JSON object:
{
  "summary": "A design-minded 1-2 sentence description of the core human need or tension this note reveals.",
  "tags": ["tag1", "tag2"],
  "category": "idea, task, journal, reference, brainstorm, other",
  "sentiment": "positive, negative, neutral, mixed",
  "insights": {
    "themes": ["Design problem or opportunity"],
    "references": ["Design principle, methodology, or precedent"],
    "books": ["Title by Author — design connection"],
    "follow_ups": ["Who experiences this? How might it be redesigned?"]
  }
}
Return ONLY JSON.`,

    strategist: `You are a strategist acting as a thought partner. When analyzing this note, apply first-principles thinking: what are the core constraints? What are the incentives at play? What would a 10x outcome look like? What tradeoffs are hidden? Think about competitive dynamics, resource allocation, and the second-order effects of each choice. Analyze the raw text and return a single valid JSON object:
{
  "summary": "A strategic 1-2 sentence distillation of the core decision or leverage point in this note.",
  "tags": ["tag1", "tag2"],
  "category": "idea, task, journal, reference, brainstorm, other",
  "sentiment": "positive, negative, neutral, mixed",
  "insights": {
    "themes": ["Strategic tension or leverage point"],
    "references": ["Strategic framework or mental model"],
    "books": ["Title by Author — strategic relevance"],
    "follow_ups": ["What's the highest-leverage next move?"]
  }
}
Return ONLY JSON.`,

    therapist: `You are a compassionate therapist acting as a thought partner. When analyzing this note, look beneath the surface: what emotions are present (spoken or unspoken)? What cognitive patterns or limiting beliefs might be at work? What does the person seem to need? Look for themes of avoidance, projection, or unmet needs. Respond with warmth and non-judgment. Analyze the raw text and return a single valid JSON object:
{
  "summary": "A warm, emotionally attuned 1-2 sentence reflection on what this note might be expressing beneath the surface.",
  "tags": ["tag1", "tag2"],
  "category": "idea, task, journal, reference, brainstorm, other",
  "sentiment": "positive, negative, neutral, mixed",
  "insights": {
    "themes": ["Emotional theme or psychological pattern"],
    "references": ["Psychological concept or framework"],
    "books": ["Title by Author — psychological resonance"],
    "follow_ups": ["What feeling might this be connected to?"]
  }
}
Return ONLY JSON.`,

    historian: `You are a historian acting as a thought partner. When analyzing this note, place it in historical context: what long arcs does this connect to? What precedents exist? What does history tell us about this kind of moment or idea? Look for patterns across centuries, civilizations, and movements. Analyze the raw text and return a single valid JSON object:
{
  "summary": "A historically grounded 1-2 sentence reframing of this note within broader human timescales and precedent.",
  "tags": ["tag1", "tag2"],
  "category": "idea, task, journal, reference, brainstorm, other",
  "sentiment": "positive, negative, neutral, mixed",
  "insights": {
    "themes": ["Historical pattern or recurring dynamic"],
    "references": ["Historical event, era, or figure"],
    "books": ["Title by Author — historical connection"],
    "follow_ups": ["What does history suggest about how this unfolds?"]
  }
}
Return ONLY JSON.`,

    poet: `You are a poet acting as a thought partner. When analyzing this note, find the images, metaphors, and rhythms beneath the words. What would this become as a poem or piece of prose? What is the texture of the feeling? What single image captures its essence? Think about language, sound, and meaning as inseparable. Analyze the raw text and return a single valid JSON object:
{
  "summary": "A lyrical, image-rich 1-2 sentence response to the emotional core of this note — let it sing.",
  "tags": ["tag1", "tag2"],
  "category": "idea, task, journal, reference, brainstorm, other",
  "sentiment": "positive, negative, neutral, mixed",
  "insights": {
    "themes": ["Central image or emotional texture"],
    "references": ["Poem, poet, or literary device"],
    "books": ["Title by Author — literary resonance"],
    "follow_ups": ["What metaphor wants to live here?"]
  }
}
Return ONLY JSON.`,

    economist: `You are an economist acting as a thought partner. When analyzing this note, look for incentive structures, resource constraints, information asymmetries, and unintended consequences. What are the opportunity costs? Who benefits and who loses? What would a market or systems analysis reveal? Think in terms of flows, scarcity, and equilibrium. Analyze the raw text and return a single valid JSON object:
{
  "summary": "An economically minded 1-2 sentence restatement of the core incentive structure or resource tension in this note.",
  "tags": ["tag1", "tag2"],
  "category": "idea, task, journal, reference, brainstorm, other",
  "sentiment": "positive, negative, neutral, mixed",
  "insights": {
    "themes": ["Incentive structure or economic dynamic"],
    "references": ["Economic concept or model"],
    "books": ["Title by Author — economic relevance"],
    "follow_ups": ["What are the second-order effects of this?"]
  }
}
Return ONLY JSON.`
};

// Cluster synthesis prompt
const CLUSTER_SYNTHESIS_PROMPT = `You are a synthesis engine for a thinking and note-taking app. You have been given a collection of notes that the user has grouped together into a cluster. Your job is to synthesize these notes into a coherent whole — not a summary, but a *synthesis*: find the emergent patterns, surface the hidden tensions, name what is trying to be said across all these fragments.

Analyze all notes and return a single valid JSON object:
{
  "narrative": "A 2-4 sentence synthesis that captures what this cluster, taken as a whole, is really about. Speak directly to the person. Use conversational, insight-rich prose.",
  "themes": ["3-5 core themes that emerge across multiple notes"],
  "tensions": ["1-3 genuine contradictions or unresolved tensions across the notes"],
  "questions": ["3-5 questions the cluster collectively seems to be working toward"],
  "synthesis_title": "A poetic or evocative 3-6 word title that names what this cluster is really about"
}
Return ONLY JSON.`;

// ============================================================================
// GEMINI API
// ============================================================================
export class MissingKeyError extends Error {
    constructor() {
        super('Add your Gemini API key in Settings to enable analysis.');
        this.name = 'MissingKeyError';
    }
}

export class RateLimitError extends Error {
    constructor(message, { perDay = false, retryAfter = 0 } = {}) {
        super(message);
        this.name = 'RateLimitError';
        this.perDay = perDay;
        this.retryAfter = retryAfter;
    }
}

/** Long jobs can hook this to say why they have gone quiet. */
let onRateLimitWait = () => {};
export function setRateLimitReporter(fn) { onRateLimitWait = fn || (() => {}); }

/**
 * A 429 from Gemini carries a QuotaFailure naming the quota and a RetryInfo
 * saying how long to wait. Per-minute limits are worth waiting out; per-day
 * ones are not, and telling them apart is the difference between "try again in
 * a minute" and "that is it until tomorrow".
 */
async function readQuotaFailure(response) {
    let body = {};
    try { body = JSON.parse(await response.text()); } catch { /* keep the defaults */ }
    const details = body?.error?.details || [];

    const quota = details.find(d => (d['@type'] || '').includes('QuotaFailure'));
    const quotaId = quota?.violations?.[0]?.quotaId || '';
    const perDay = /perday/i.test(quotaId);

    const retryInfo = details.find(d => (d['@type'] || '').includes('RetryInfo'));
    const retryAfter = Math.ceil(parseFloat(retryInfo?.retryDelay || '0')) || 30;

    const message = perDay
        ? "You've used up today's Gemini quota. It resets at midnight Pacific time, or you can raise the limit in Google AI Studio."
        : `Gemini is rate limiting — too many requests in a short window. Try again in about ${retryAfter} seconds.`;

    return { perDay, retryAfter, message, quotaId };
}

// 3.8 is named explicitly rather than left to the "-latest" alias to resolve —
// same price as 3.6/3.7 but the newest of the three, so there's no reason to
// leave the choice to whatever Google happens to be routing it to today.
//
// But a pinned dated model is exactly what silently killed embeddings for nine
// months when text-embedding-004 was retired — the app never noticed a 404 for
// nine months. So it isn't pinned alone: if 3.8 is ever retired, this falls to
// the "-latest" alias, which always resolves to whatever's current, and only
// then to the old 3.5 pin as a last resort. Explicit choice first, safety net
// behind it.
const CHAT_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash'];
let chatModel = null;

export async function callGemini(systemPrompt, userText, opts = {}) {
    const key = geminiKey();
    if (!key) throw new MissingKeyError();
    const models = chatModel ? [chatModel] : CHAT_MODELS;

    let lastErr = null;
    for (const model of models) {
        try {
            const result = await callGeminiModel(model, key, systemPrompt, userText, opts);
            chatModel = model; // this one works — stop probing the chain on future calls
            return result;
        } catch (e) {
            lastErr = e;
            // Only "this model name doesn't exist" moves to the next candidate.
            // A malformed prompt also comes back as a 400, but reads identically
            // from every model in the chain, so trying the rest would just be
            // three more calls to fail the same way.
            const modelUnknown = (e?.status === 404 || e?.status === 400) && /not found|not supported/i.test(e?.message || '');
            if (!modelUnknown) throw e;
        }
    }
    throw lastErr;
}

async function callGeminiModel(model, key, systemPrompt, userText, opts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    let retries = 3;
    let delay = 1000;

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: opts.contents || [{ parts: [{ text: userText }] }],
                    generationConfig: {
                        temperature: opts.temperature ?? 0.3,
                        maxOutputTokens: opts.maxTokens ?? 8192,
                        ...(opts.json ? { responseMimeType: 'application/json' } : {}),
                    },
                }),
            });

            if (response.status === 429) {
                // Google says which quota was hit and how long to wait; the old
                // code threw the body away and reported "Status 429", then gave
                // up after seven seconds of backoff against a limit that resets
                // in sixty. Read what it actually said.
                const info = await readQuotaFailure(response);
                if (info.perDay) throw new RateLimitError(info.message, { perDay: true });
                if (i === retries - 1) throw new RateLimitError(info.message, { retryAfter: info.retryAfter });
                const wait = Math.min(Math.max(info.retryAfter * 1000, delay), 65000);
                console.warn(`Rate limited. Waiting ${Math.round(wait / 1000)}s before retrying…`);
                onRateLimitWait(Math.round(wait / 1000));
                await new Promise(res => setTimeout(res, wait));
                delay *= 2;
                continue;
            }

            if (response.status === 503) {
                if (i === retries - 1) throw new Error('Gemini is unavailable right now. Try again shortly.');
                console.warn(`Gemini returned 503. Retrying in ${delay}ms…`);
                await new Promise(res => setTimeout(res, delay));
                delay *= 2;
                continue;
            }

            if (!response.ok) {
                const err = await response.text();
                const bad = new Error(`Gemini Error: ${err.slice(0, 200)}`);
                bad.status = response.status;
                throw bad;
            }
            const data = await response.json();
            const candidate = data?.candidates?.[0];
            if (candidate && candidate.finishReason && candidate.finishReason !== 'STOP') {
                console.warn(`Gemini API call finished with reason: ${candidate.finishReason}`, candidate);
            }
            return candidate?.content?.parts?.[0]?.text ?? '';
        } catch (e) {
            // A quota decision has already been made above — retrying a spent
            // daily quota just delays the same answer by a few seconds.
            if (e?.name === 'RateLimitError') throw e;
            // A 4xx is the request being wrong, not the network having a bad
            // moment — a wrong model name or a malformed prompt reads back
            // identically three times in a row. Fail once, immediately, so
            // the model chain above can try its next candidate without
            // burning three seconds per name that doesn't exist.
            if (e?.status >= 400 && e.status < 500) throw e;
            if (i === retries - 1) throw e;
            console.warn(`Gemini API call failed: ${e.message}. Retrying in ${delay}ms...`);
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }
}

// ============================================================================
// EMBEDDINGS — used for incremental, scalable note linking
// ============================================================================

function geminiKey() {
    return localStorage.getItem('nw_gemini_key') || '';
}

/**
 * Embed a piece of text into a vector using Gemini's embedding endpoint.
 * Returns null on failure so callers can degrade gracefully — linking is a
 * nice-to-have, never a reason to fail a capture.
 */
/* text-embedding-004 was shut down on 14 Jan 2026. Every embed call after that
   date returned 404 and the old code turned a non-ok response into a silent
   null, so the notebook quietly stopped being indexed for nine months and the
   only symptom was "Embedded 0 notes". Hence both changes below: a chain of
   models so one retirement cannot stop the app dead, and errors that are
   actually reported. */
const EMBED_MODELS = [
    // taskType is supported here and matches exactly what we use vectors for
    { id: 'gemini-embedding-001', taskType: 'SEMANTIC_SIMILARITY' },
    // The current recommendation; takes no taskType, self-normalises
    { id: 'gemini-embedding-2', taskType: null },
];

// 768 keeps a note's vector at a size worth loading over mobile data. Every
// note in a notebook has to come down together, and 3072 would quadruple that
// for accuracy this use does not need.
const EMBED_DIM = 768;

/** Which model answered last, so a dead one is not retried once per note. */
let embedModel = null;
/** The last real failure, so callers can say what went wrong. */
export let lastEmbedError = null;

/** Cosine is scale-invariant, but storing unit vectors keeps the index uniform. */
function normalize(vec) {
    let mag = 0;
    for (const v of vec) mag += v * v;
    mag = Math.sqrt(mag);
    return mag ? vec.map(v => v / mag) : vec;
}

/**
 * Embed a piece of text into a vector. Returns null on failure so callers can
 * degrade gracefully — indexing is a nice-to-have, never a reason to fail a
 * capture — but the reason is left in `lastEmbedError` and the console.
 */
export async function embedText(text) {
    const key = geminiKey();
    if (!key) { lastEmbedError = 'No Gemini API key saved.'; return null; }

    const body = (m) => JSON.stringify({
        content: { parts: [{ text: (text || '').slice(0, 8000) }] },
        outputDimensionality: EMBED_DIM,
        ...(m.taskType ? { taskType: m.taskType } : {}),
    });

    // Once a model has answered, stay on it; otherwise walk the chain.
    const candidates = embedModel ? [embedModel, ...EMBED_MODELS.filter(m => m !== embedModel)] : EMBED_MODELS;

    for (const m of candidates) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:embedContent?key=${key}`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body(m),
            });

            if (!res.ok) {
                const detail = (await res.text()).slice(0, 300);
                lastEmbedError = `${m.id}: HTTP ${res.status} — ${detail}`;
                console.warn('Embedding failed:', lastEmbedError);
                // A retired or unknown model is worth trying past; a bad key or
                // a rate limit is not — the next model would fail identically.
                if (res.status === 404 || res.status === 400) { if (embedModel === m) embedModel = null; continue; }
                return null;
            }

            const data = await res.json();
            const values = data?.embedding?.values ?? data?.embeddings?.[0]?.values;
            if (!Array.isArray(values) || !values.length) {
                lastEmbedError = `${m.id}: response carried no vector.`;
                console.warn('Embedding failed:', lastEmbedError);
                continue;
            }

            if (embedModel?.id !== m.id) console.info(`Embeddings running on ${m.id} (${values.length}d).`);
            embedModel = m;
            lastEmbedError = null;
            return normalize(values);
        } catch (e) {
            lastEmbedError = `${m.id}: ${e.message}`;
            console.warn('Embedding failed:', lastEmbedError);
        }
    }
    return null;
}

/** The model actually answering, for anything that wants to report it. */
export function embedModelName() {
    return embedModel?.id || null;
}

export function cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Rank every other note in the profile against `note` by embedding similarity,
 * falling back to tag/concept overlap when embeddings are unavailable.
 */
export function rankNeighbors(note, allNotes, k = 12) {
    const others = allNotes.filter(n => n.id !== note.id && !isDiscoverNote(n));
    const scored = others.map(n => {
        let score = 0;
        if (note.embedding && n.embedding) {
            score = cosineSim(note.embedding, n.embedding);
        } else {
            // Lexical fallback: shared tags and concepts
            const mine = new Set([...(note.tags || []), ...(note.concepts || [])].map(t => t.toLowerCase()));
            const theirs = [...(n.tags || []), ...(n.concepts || [])].map(t => t.toLowerCase());
            const overlap = theirs.filter(t => mine.has(t)).length;
            const union = new Set([...mine, ...theirs]).size || 1;
            score = overlap / union;
        }
        return { note: n, score };
    });
    return scored
        .filter(s => s.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
}

function tryParseJSON(text) {
    try { return JSON.parse(text); } catch { }
    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
    try { return JSON.parse(stripped); } catch { }
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
        try { return JSON.parse(match[0]); } catch { }
        const fixed = match[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/\n/g, '\\n');
        try { return JSON.parse(fixed); } catch { }
    }
    throw new Error('Could not parse JSON');
}

const NOTE_PROMPT = `You are a deeply curious, collaborative, and grounded thought partner. Focus on the underlying human intent behind the note. Analyze the raw text and return a single valid JSON object:
{
  "summary": "A conversational 1-2 sentence capturing of the underlying intent and direction of the note, favoring human conversational prose over clinical summaries.",
  "concepts": ["Canonical Concept"],
  "tags": ["tag1", "tag2"],
  "category": "idea, task, journal, reference, brainstorm, other",
  "sentiment": "positive, negative, neutral, mixed",
  "insights": {
    "themes": ["theme1"],
    "references": ["Concept"],
    "books": ["Title by Author — reason"],
    "follow_ups": ["Question?"]
  }
}
Return ONLY JSON.`;

/**
 * Appended to whichever analysis prompt is in play. This is the single most
 * important instruction in the app: without it every note invents its own
 * vocabulary and nothing ever accumulates.
 */
function conceptInstruction(existingConcepts) {
    const list = existingConcepts.length
        ? existingConcepts.map(c => `- ${c.name}`).join('\n')
        : '(none yet — you are naming the first ones)';
    return `

VOCABULARY DISCIPLINE — this matters more than anything else in your output.

Here are the concepts already in use in this person's notebook:
${list}

For the "concepts" field, return 1–4 concepts that this note genuinely belongs to.

- REUSE an existing concept name, copied EXACTLY, whenever one fits — even loosely. This is strongly preferred.
- Only mint a new concept when the note is genuinely about something none of the above covers.
- A new concept must be broad enough that future notes will plausibly share it. "Design Philosophy" is a concept; "the specific webinar I watched on Tuesday" is not.
- Use Title Case. Prefer 1–3 words. Never invent a variant of an existing name (if "Design Philosophy" exists, do not write "Philosophy of Design").

"tags" stay free-form and specific — they describe this note. "concepts" are the shared shelves the note is filed under. Do not duplicate one into the other.`;
}

const MEMORY_EXTRACT_PROMPT = `You analyze notes to extract durable signals about the person behind them — the things that will still be true in six months.

Extract at most 3 signals, and only ones worth remembering. A signal is worth remembering if it would help a thought partner understand this person the next time they write something. Passing references, one-off facts, and restatements of the note's content are NOT signals.

You are shown the person's existing profile. Prefer REINFORCING an existing signal over minting a near-duplicate: if a new observation is essentially something already on the list, return it with the exact same "content" string as the existing entry and a higher strength — the system will merge them. Only write new wording when the observation is genuinely new.

Types: "interest" (a subject they keep returning to), "value" (something they believe or care about), "trait" (how they think or work).

Return a JSON array: [{"type": "interest", "content": "description", "strength": 0.5}]
Return an empty array [] if the note reveals nothing durable. Only return JSON.`;

const MEMORY_CONSOLIDATE_PROMPT = `You are consolidating a personal profile that has accumulated redundant, overlapping entries over time.

You are given a list of profile signals, each with an index. Group together entries that describe the SAME underlying interest, value or trait — even when the wording differs substantially. Then write one clean, specific sentence for each group.

Rules:
- Be aggressive about merging. "Interested in design theory" and "Studies the philosophy of design methodology" are the same signal.
- Do NOT merge genuinely distinct things just because they share a word. "Indian classical aesthetics" and "Indian politics" are different.
- The merged wording should be the most specific accurate version, not the vaguest.
- Drop entries that are trivial, circumstantial, or that read as a summary of one note rather than a fact about the person.

Return JSON: {"groups": [{"indices": [0, 4, 9], "type": "interest", "content": "merged wording", "strength": 0.8}], "drop": [2, 7]}
Only return JSON.`;

const CARD_GEN_PROMPT = `You generate "Discover" cards for someone whose notebook you know well. A good card feels like it came from a friend who has been paying attention — specific to this person, not to their demographic.

You are given their profile, the concepts they keep returning to, their recent notes, and — most useful of all — the cards they KEPT and the cards they PASSED on. Aim at the person, not the last thing they wrote.

Card types:
- "recommendation" — a book, essay, film, album, place, tool or practice they would probably love, with a sentence on why THEM
- "quote" — a real quotation from a real, named source, chosen because it speaks to something they care about
- "excerpt" — a short idea, argument or passage worth knowing about, attributed
- "question" — something worth sitting with, drawn from a tension in their own thinking
- "observation" — a pattern running across their notes that they have not named yet

How many: 7 cards. Never fewer than 5, never more than 8. Drop a type rather than force a weak card.
Rough mix: 3 recommendations, 2 quotes or excerpts, 1 question, 1 observation.

Rules:
- Reach. At least two recommendations should be things they are unlikely to have already found — adjacent to what they love, not the canonical first result for it.
- Never fabricate or misattribute a quotation. If you are not certain of both the wording and the author, make it a recommendation or an excerpt instead.
- Avoid the obvious. If they are deep in design theory, do not hand them Don Norman.
- The KEPT cards tell you what lands. The PASSED cards tell you what does not. Follow both.
- Do not repeat anything already shown to them.
- No two cards in one batch may point at the same work, person or idea.
- "why" is one sentence spoken to them, naming the specific thing in their notes this comes from. No flattery, no restating their note back at them.

Return a JSON array of 5-8 cards:
[{"card_type": "recommendation", "content": "the thing itself, 1-3 sentences", "source": "author, title, year — or null", "why": "one sentence on why this, for them"}]
Only return JSON.`;

const CHAT_SYSTEM_PROMPT = `You are not an AI assistant; you are a deeply curious, collaborative, and grounded thought partner who has been reading this person's notebook for months. Focus on the underlying human intent behind the user's notes, challenge assumptions gently when necessary, and favor conversational, empathetic prose over rigid, clinical summaries.

You have three things a generic assistant does not: a picture of who this person is, the other notes surrounding this one, and the connections already drawn between them. Use them.

- Say the thing only you can say. "You've circled this three times since June, from different angles" is worth more than a well-structured summary.
- Reference their other notes by name when they're relevant. Be specific about what a past note actually said.
- Notice when this note contradicts or complicates something they wrote earlier, and name it kindly.
- Do not flatter, do not open with a compliment, and do not restate their note back to them before responding.
- Never invent a note, a connection, or a fact about them that isn't in the context below. If you don't have it, say so plainly.
- Keep it conversational. Short paragraphs. No headers or bullet lists unless they ask for structure.`;

// ============================================================================
// DATA API (Firestore)
// ============================================================================

// No login/logout needed for unauthenticated access

export function isDiscoverNote(note) {
    if (!note) return false;
    if (note.tags && Array.isArray(note.tags) && note.tags.includes('discover')) {
        return true;
    }
    if (note.discover_card_id) {
        return true;
    }
    if (note.raw_text && typeof note.raw_text === 'string') {
        const lower = note.raw_text.toLowerCase();
        if (lower.includes('tags:\n  - discover') || lower.includes('tags: ["discover"]')) {
            return true;
        }
    }
    return false;
}

export async function getNotesAPI(profile) {
    const q = query(collection(db, "notes"), where("profile", "in", profile === 'combined' ? ['prineeth', 'pramoddini'] : [profile]));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort in memory to avoid needing Firestore composite indexes
    return docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function getNoteByIdAPI(id) {
    const snap = await getDoc(doc(db, "notes", id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function addNoteAPI(rawText, profile, initialTags = [], additionalFields = {}) {
    // Detect @persona prefix — strip it from saved text, store it separately
    let personaKey = null;
    let cleanText = rawText;
    const personaNames = Object.keys(PERSONAS);
    const personaMatch = rawText.match(new RegExp(`^@(${personaNames.join('|')})\\b\\s*`, 'i'));
    if (personaMatch) {
        personaKey = personaMatch[1].toLowerCase();
        cleanText = rawText.slice(personaMatch[0].length).trim();
    }

    const noteRef = await addDoc(collection(db, "notes"), {
        profile,
        raw_text: cleanText,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'pending',
        tags: initialTags,
        ...(personaKey ? { persona: personaKey } : {}),
        ...additionalFields
    });

    // Fire and forget processing with optional persona
    processNote(noteRef.id, cleanText, profile, personaKey).catch(console.error);

    return { id: noteRef.id, status: 'pending' };
}

export async function deleteNoteAPI(id) {
    await deleteDoc(doc(db, "notes", id));
}

export async function updateNoteAPI(id, newText, profile) {
    await updateDoc(doc(db, "notes", id), {
        raw_text: newText,
        status: 'pending',
        updated_at: new Date().toISOString(),
        summary: null,
        tags: [],
        category: null,
        sentiment: null,
        insights: {}
    });
    // Preserve existing persona when re-processing after edit
    const snap = await getDoc(doc(db, 'notes', id));
    const existingPersona = snap.exists() ? (snap.data().persona || null) : null;
    processNote(id, newText, profile, existingPersona).catch(console.error);
}

export async function updateNoteTagsAPI(id, tags) {
    await updateDoc(doc(db, "notes", id), { tags });
    return tags;
}

export async function updateNoteWorkbenchAPI(id, workbench) {
    await updateDoc(doc(db, "notes", id), { workbench });
    return workbench;
}

export async function addNoteTagAPI(id, tag) {
    await updateDoc(doc(db, "notes", id), {
        tags: arrayUnion(tag)
    });
}

export async function reprocessNoteAPI(id, personaOverride) {
    const note = await getNoteByIdAPI(id);
    if (!note) return;
    const hasDeclaredOverride = arguments.length >= 2; // distinguish null from undefined
    const persona = hasDeclaredOverride ? personaOverride : (note.persona || null);
    if (hasDeclaredOverride) {
        // Explicitly set or clear the persona field
        await updateDoc(doc(db, 'notes', id), { 
            persona: personaOverride || null, 
            status: 'processing',
            updated_at: new Date().toISOString()
        });
    } else {
        await updateDoc(doc(db, "notes", id), { 
            status: 'processing',
            updated_at: new Date().toISOString()
        });
    }
    processNote(id, note.raw_text, note.profile, persona).catch(console.error);
}

/**
 * Pick the lens that actually fits this note. Cheap and deterministic — no API
 * call — so it can run on render. Returns { key, why }.
 */
export function suggestPersona(note) {
    if (!note) return { key: 'philosopher', why: 'A general lens to start from' };
    const text = `${note.raw_text || ''} ${note.summary || ''} ${(note.tags || []).join(' ')} ${(note.concepts || []).join(' ')}`.toLowerCase();
    const cat = note.category || '';
    const sent = note.sentiment || '';
    const has = (...words) => words.some(w => text.includes(w));

    if (cat === 'journal' && (sent === 'mixed' || sent === 'negative'))
        return { key: 'therapist', why: 'A personal note with something unresolved in it' };
    if (has('feel', 'anxious', 'lonely', 'afraid', 'tired of', 'burnt out', 'my self'))
        return { key: 'therapist', why: 'There is feeling under this one' };
    if (has('design', 'interface', 'ux', 'affordance', 'prototype', 'craft', 'aesthetic'))
        return { key: 'designer', why: 'This is a design question' };
    if (has('history', 'tradition', 'century', 'colonial', 'ancient', 'heritage', 'medieval'))
        return { key: 'historian', why: 'This sits on a long arc' };
    if (has('market', 'incentive', 'price', 'economy', 'capital', 'business model', 'cost of'))
        return { key: 'economist', why: 'There are incentives at work here' };
    if (has('poem', 'poetry', 'metaphor', 'music', 'beauty', 'lyric', 'image of'))
        return { key: 'poet', why: 'This one wants language, not analysis' };
    if (has('experiment', 'data', 'hypothesis', 'evidence', 'neuro', 'physics', 'study shows'))
        return { key: 'scientist', why: 'There is a testable claim in here' };
    if (cat === 'idea' || has('strategy', 'tradeoff', 'leverage', 'decision', 'should we', 'roadmap'))
        return { key: 'strategist', why: 'There is a decision hiding in this' };
    if (has('meaning', 'ethic', 'ontolog', 'exist', 'moral', 'truth', 'what is'))
        return { key: 'philosopher', why: 'This is asking a question about what is' };

    return { key: 'philosopher', why: 'A good default for an open question' };
}

/**
 * Run a persona over a note and store the reading ALONGSIDE the others, so two
 * lenses can be held side by side instead of one overwriting the last.
 */
export async function analyzeWithPersonaAPI(noteId, personaKey) {
    if (!PERSONAS[personaKey]) throw new Error('Unknown persona: ' + personaKey);
    const note = await getNoteByIdAPI(noteId);
    if (!note) throw new Error('Note not found');

    const existingConcepts = await getConceptsAPI(note.profile);
    const prompt = PERSONA_PROMPTS[personaKey] + conceptInstruction(existingConcepts.slice(0, 80));
    const text = await callGemini(prompt, stripDerived(note.raw_text), { json: true });
    const parsed = tryParseJSON(text);

    const readings = { ...(note.persona_readings || {}) };
    readings[personaKey] = {
        summary: parsed.summary ?? null,
        insights: parsed.insights ?? {},
        sentiment: parsed.sentiment ?? null,
        created_at: new Date().toISOString(),
    };

    await updateDoc(doc(db, 'notes', noteId), {
        persona_readings: readings,
        persona: personaKey,
        updated_at: new Date().toISOString(),
    });

    // Concepts from any lens still count toward the shared vocabulary
    if (parsed.concepts?.length) {
        const merged = Array.from(new Set([...(note.concepts || []), ...parsed.concepts]));
        await syncNoteConceptsAPI(noteId, note.profile, merged);
    }

    return readings[personaKey];
}

export async function deletePersonaReadingAPI(noteId, personaKey) {
    const note = await getNoteByIdAPI(noteId);
    if (!note) return;
    const readings = { ...(note.persona_readings || {}) };
    delete readings[personaKey];
    await updateDoc(doc(db, 'notes', noteId), { persona_readings: readings });
}

const EXPLORE_PROMPTS = {
    themes: `You are a research analyst. Given a note, conduct a thorough thematic analysis. Go far beyond the surface. 
Identify 6-10 deep, interconnected themes. For each theme:
- Name it clearly
- Explain why it's relevant in 1-2 sentences
- Identify how it connects to broader intellectual, cultural, or philosophical domains

Return a JSON array of objects: [{"theme": "name", "explanation": "why this matters", "connections": "broader context"}]
Return ONLY the JSON, no markdown.`,

    references: `You are a polymath researcher. Given a note, identify 8-12 relevant concepts, frameworks, mental models, and ideas from across disciplines — philosophy, psychology, design, economics, science, art, technology.

For each reference:
- Name the concept or framework
- Explain it briefly (1 sentence)
- Explain its relevance to the note (1 sentence)

Go deep. Surface non-obvious connections. Think across disciplines.

Return a JSON array: [{"concept": "name", "description": "what it is", "relevance": "why it connects"}]
Return ONLY the JSON, no markdown.`,

    books: `You are a well-read librarian and literary advisor. Given a note, recommend 8-12 books that would deeply resonate with the person who wrote this. Include:
- Classic works and contemporary ones
- Different formats: books, essays, papers, long-form articles
- Span across fiction, non-fiction, philosophy, science, design, culture

For each:
- Full title and author
- A compelling 1-2 sentence description of why this specific person would find it valuable
- What perspective or insight it offers related to their note

Return a JSON array: [{"title": "Book Title", "author": "Author Name", "reason": "why it resonates"}]
Return ONLY the JSON, no markdown.`,

    follow_ups: `You are a thoughtful, friendly reflection partner. Given a note, generate 8-12 conversational, clear follow-up questions.

Questions should:
- Stay closely grounded in the user's note
- Be simple, direct, and written in a natural, conversational tone
- Avoid overly academic, abstract, or highly complex philosophical jargon
- Help the user explore next steps, clarify their feelings, or expand their ideas naturally
- Feel curious and supportive, like a friend asking a clarifying question

Return a JSON array of objects: [{"question": "Question?", "context": "brief explanation of why this question is relevant"}]
Return ONLY the JSON, no markdown.`
};

export async function exploreNoteAPI(id, section) {
    const note = await getNoteByIdAPI(id);
    if (!note) throw new Error("Note not found");

    const prompt = EXPLORE_PROMPTS[section];
    if (!prompt) throw new Error("Invalid section: " + section);

    const existingItems = note.insights?.[section] || [];
    const noteContext = `Note: "${note.raw_text}"
${note.summary ? `Summary: ${note.summary}` : ''}
${note.tags?.length ? `Tags: ${note.tags.join(', ')}` : ''}
${note.category ? `Category: ${note.category}` : ''}
${existingItems.length ? `\nAlready identified (DO NOT repeat these):\n${existingItems.map(i => `- ${typeof i === 'string' ? i : JSON.stringify(i)}`).join('\n')}` : ''}`;

    const text = await callGemini(prompt, noteContext, {
        json: true,
        temperature: 0.7,
        maxTokens: 4096,
    });

    const newResults = tryParseJSON(text);

    if (Array.isArray(newResults) && newResults.length) {
        const currentInsights = note.insights || {};
        const currentSectionItems = currentInsights[section] || [];
        
        const mergedItems = [...currentSectionItems];
        newResults.forEach(newItem => {
            const titleOf = (x) => {
                if (typeof x === 'string') return x.trim().toLowerCase();
                return (x.theme || x.concept || x.title || x.question || '').trim().toLowerCase();
            };
            const newTitle = titleOf(newItem);
            const exists = mergedItems.some(existing => titleOf(existing) === newTitle);
            if (!exists) {
                mergedItems.push(newItem);
            }
        });
        
        currentInsights[section] = mergedItems;
        await updateDoc(doc(db, "notes", id), { insights: currentInsights });
    }

    return newResults;
}


async function processNote(noteId, rawText, profile, personaKey = null) {
    try {
        await updateDoc(doc(db, "notes", noteId), { 
            status: 'processing',
            updated_at: new Date().toISOString()
        });
        // Show the model the vocabulary that already exists so it reuses instead of re-mints
        const existingConcepts = await getConceptsAPI(profile);
        const base = (personaKey && PERSONA_PROMPTS[personaKey]) ? PERSONA_PROMPTS[personaKey] : NOTE_PROMPT;
        const prompt = base + conceptInstruction(existingConcepts.slice(0, 80));

        const text = await callGemini(prompt, rawText, { json: true });
        const parsed = tryParseJSON(text);

        // Fetch existing tags (like custom google tags) so we can merge them instead of overwriting
        const noteSnap = await getDoc(doc(db, "notes", noteId));
        const existingTags = noteSnap.exists() ? (noteSnap.data().tags || []) : [];
        const mergedTags = Array.from(new Set([...existingTags, ...(parsed.tags ?? [])]));

        const updatePayload = {
            summary: parsed.summary ?? null,
            tags: mergedTags,
            category: parsed.category ?? null,
            sentiment: parsed.sentiment ?? null,
            status: 'processed',
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        if (parsed.insights) updatePayload.insights = parsed.insights;

        await updateDoc(doc(db, "notes", noteId), updatePayload);

        // File the note under its concepts
        await syncNoteConceptsAPI(noteId, profile, parsed.concepts || []);

        // Embed, then link against nearest neighbours. Both are best-effort:
        // a capture is never allowed to fail because the graph work failed.
        (async () => {
            const vec = await embedText(`${rawText}\n${parsed.summary || ''}`);
            if (vec) await updateDoc(doc(db, 'notes', noteId), { embedding: vec });
            await linkNoteAPI(noteId);
            await updateDoc(doc(db, 'notes', noteId), { linked_at: new Date().toISOString() });
        })().catch(console.error);

        // Memory Extraction
        extractMemory(noteId, rawText, profile).catch(console.error);
        return true;
    } catch (e) {
        console.error("Gemini processing failed:", e);
        // The failure used to be recorded as the bare word 'error'. Nine notes
        // sat like that with nothing anywhere saying whether it was the key,
        // the quota, or the note itself.
        await updateDoc(doc(db, "notes", noteId), { 
            status: 'error',
            error_message: String(e?.message || e).slice(0, 300),
            error_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
        // A spent daily quota is not this note's problem — every note after it
        // fails identically. Let a batch stop rather than burn through the
        // backlog marking all of it broken.
        if (e?.name === 'RateLimitError') throw e;
        return false;
    }
}

/**
 * Re-run the analysis on every note that failed it, oldest first and strictly
 * one at a time: the per-minute quota is usually how they failed, and firing
 * the whole backlog in parallel reproduces it exactly.
 */
export async function retryFailedNotesAPI(profile, onProgress = () => {}) {
    if (!geminiKey()) throw new MissingKeyError();
    const failed = (await getNotesAPI(profile))
        .filter(n => n.status === 'error' && (n.raw_text || '').trim())
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    let done = 0, failedAgain = 0;
    for (const note of failed) {
        onProgress({ done, total: failed.length, note });
        try {
            await updateDoc(doc(db, 'notes', note.id), {
                status: 'processing', updated_at: new Date().toISOString()
            });
            const ok = await processNote(note.id, note.raw_text, note.profile, note.persona || null);
            ok ? done++ : failedAgain++;
        } catch (e) {
            if (e?.name === 'RateLimitError') {
                return { total: failed.length, done, failedAgain, stopped: e.message };
            }
            failedAgain++;
        }
    }
    return { total: failed.length, done, failedAgain, stopped: null };
}

async function extractMemory(noteId, rawText, profile) {
    // Delete existing memory items for this note to prevent duplicates during reprocessing
    try {
        const qDuplicate = query(collection(db, "memory"), where("note_id", "==", noteId));
        const dupSnap = await getDocs(qDuplicate);
        for (const d of dupSnap.docs) {
            await deleteDoc(doc(db, "memory", d.id));
        }
    } catch (err) {
        console.error("Failed to delete existing memory items for note:", noteId, err);
    }

    const all = await getMemoryAPI(profile);
    const top = rankMemory(all).slice(0, MEMORY_CONTEXT_CAP);
    const existing = top.map(m => `- [${m.type}] ${m.content}`).join('\n');

    const prompt = `Existing profile:\n${existing || 'None'}\n\nNew note:\n"""\n${rawText}\n"""`;
    const text = await callGemini(MEMORY_EXTRACT_PROMPT, prompt, { json: true, temperature: 0.4 });
    const signals = tryParseJSON(text);
    if (!Array.isArray(signals)) return;

    const byContent = new Map(all.map(m => [m.content.trim().toLowerCase(), m]));

    for (const s of signals) {
        const content = (s.content || '').trim();
        if (!content) continue;
        const hit = byContent.get(content.toLowerCase());
        if (hit) {
            // Reinforce rather than duplicate: bump confidence and refresh recency.
            await updateDoc(doc(db, 'memory', hit.id), {
                confidence: Math.min(1, (hit.confidence || 0.5) + 0.12),
                reinforced_count: (hit.reinforced_count || 1) + 1,
                last_seen: new Date().toISOString(),
            });
        } else {
            await addDoc(collection(db, "memory"), {
                profile,
                note_id: noteId,
                type: s.type || 'interest',
                content,
                confidence: s.strength || 0.5,
                reinforced_count: 1,
                created_at: new Date().toISOString(),
                last_seen: new Date().toISOString(),
            });
        }
    }

    // Once the profile grows past the point where it still reads as a profile,
    // fold it back down. Fire-and-forget so capture never waits on it.
    if (all.length + signals.length > MEMORY_CONSOLIDATE_THRESHOLD) {
        consolidateMemoryAPI(profile).catch(console.error);
    }
}

// ============================================================================
// PROFILE / MEMORY
// ============================================================================

const MEMORY_CONTEXT_CAP = 40;
const MEMORY_CONSOLIDATE_THRESHOLD = 120;

export async function getMemoryAPI(profile) {
    const profiles = profile === 'combined' ? ['prineeth', 'pramoddini'] : [profile];
    const q = query(collection(db, 'memory'), where('profile', 'in', profiles));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Score memories by confidence weighted against recency, so a profile reflects
 * who someone is becoming rather than everything they have ever mentioned.
 */
export function rankMemory(items) {
    const now = Date.now();
    return [...items].sort((a, b) => score(b) - score(a));
    function score(m) {
        const conf = m.confidence || 0.5;
        const reinforced = Math.min(3, m.reinforced_count || 1);
        const seen = new Date(m.last_seen || m.created_at || 0).getTime();
        const ageDays = Math.max(0, (now - seen) / 86400000);
        const recency = Math.exp(-ageDays / 120); // ~4-month half-life
        return conf * (0.45 + 0.35 * recency) * (0.7 + 0.3 * reinforced);
    }
}

/**
 * The block that gets prepended to every prompt that should know who it's talking to.
 * This is the thing the app was building all along and never reading.
 */
export async function getProfileBlockAPI(profile) {
    const items = rankMemory(await getMemoryAPI(profile)).slice(0, MEMORY_CONTEXT_CAP);
    if (!items.length) return '';
    const group = (t) => items.filter(m => m.type === t).map(m => m.content);
    const parts = [];
    const interests = group('interest');
    const values = group('value');
    const traits = group('trait');
    if (interests.length) parts.push(`Recurring interests:\n${interests.map(x => `- ${x}`).join('\n')}`);
    if (values.length) parts.push(`What they seem to value:\n${values.map(x => `- ${x}`).join('\n')}`);
    if (traits.length) parts.push(`How they think:\n${traits.map(x => `- ${x}`).join('\n')}`);
    return `WHO YOU ARE TALKING TO\n${parts.join('\n\n')}`;
}

/**
 * Merge near-duplicate memories and drop the trivial ones. Runs in batches so a
 * very large profile doesn't blow the context window in one call.
 */
export async function consolidateMemoryAPI(profile, onProgress = () => {}) {
    const all = await getMemoryAPI(profile);
    if (all.length < 12) return { before: all.length, after: all.length, merged: 0, dropped: 0 };

    const BATCH = 80;
    let merged = 0, dropped = 0;

    for (let start = 0; start < all.length; start += BATCH) {
        const batch = all.slice(start, start + BATCH);
        onProgress(`Consolidating ${start + 1}–${Math.min(start + BATCH, all.length)} of ${all.length}…`);

        const listing = batch.map((m, i) => `${i}. [${m.type}] ${m.content}`).join('\n');
        let result;
        try {
            const text = await callGemini(MEMORY_CONSOLIDATE_PROMPT, listing, { json: true, temperature: 0.2 });
            result = tryParseJSON(text);
        } catch (e) {
            console.warn('Consolidation batch failed:', e.message);
            continue;
        }

        for (const idx of (result.drop || [])) {
            const victim = batch[idx];
            if (!victim) continue;
            await deleteDoc(doc(db, 'memory', victim.id));
            dropped++;
        }

        for (const g of (result.groups || [])) {
            const members = (g.indices || []).map(i => batch[i]).filter(Boolean);
            if (members.length < 2) continue;
            const [keep, ...rest] = members;
            await updateDoc(doc(db, 'memory', keep.id), {
                type: g.type || keep.type,
                content: g.content || keep.content,
                confidence: Math.min(1, g.strength || Math.max(...members.map(m => m.confidence || 0.5))),
                reinforced_count: members.reduce((s, m) => s + (m.reinforced_count || 1), 0),
                last_seen: new Date().toISOString(),
                consolidated_at: new Date().toISOString(),
            });
            for (const r of rest) {
                await deleteDoc(doc(db, 'memory', r.id));
                merged++;
            }
        }
    }

    const after = (await getMemoryAPI(profile)).length;
    onProgress(`Profile consolidated: ${all.length} → ${after}`);
    return { before: all.length, after, merged, dropped };
}

export async function deleteMemoryItemAPI(id) {
    await deleteDoc(doc(db, 'memory', id));
}

// ============================================================================
// CONCEPTS — the shared vocabulary layer
// ============================================================================

const conceptKey = (name) => (name || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function getConceptsAPI(profile) {
    const profiles = profile === 'combined' ? ['prineeth', 'pramoddini'] : [profile];
    const q = query(collection(db, 'concepts'), where('profile', 'in', profiles));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return docs.sort((a, b) => (b.note_ids?.length || 0) - (a.note_ids?.length || 0));
}

export async function getConceptByNameAPI(profile, name) {
    const all = await getConceptsAPI(profile);
    const key = conceptKey(name);
    return all.find(c => conceptKey(c.name) === key
        || (c.aliases || []).some(a => conceptKey(a) === key)) || null;
}

/**
 * Attach a note to its concepts, creating any that don't exist yet and
 * absorbing near-miss names as aliases rather than spawning new shelves.
 */
export async function syncNoteConceptsAPI(noteId, profile, conceptNames) {
    const names = (conceptNames || []).map(n => (n || '').trim()).filter(Boolean).slice(0, 5);
    const existing = await getConceptsAPI(profile);
    const byKey = new Map();
    for (const c of existing) {
        byKey.set(conceptKey(c.name), c);
        for (const a of (c.aliases || [])) byKey.set(conceptKey(a), c);
    }

    const resolved = [];
    for (const name of names) {
        const hit = byKey.get(conceptKey(name));
        if (hit) {
            resolved.push(hit.name);
            if (!(hit.note_ids || []).includes(noteId)) {
                await updateDoc(doc(db, 'concepts', hit.id), {
                    note_ids: arrayUnion(noteId),
                    last_seen: new Date().toISOString(),
                });
            }
        } else {
            const ref = await addDoc(collection(db, 'concepts'), {
                profile,
                name,
                aliases: [],
                note_ids: [noteId],
                created_at: new Date().toISOString(),
                last_seen: new Date().toISOString(),
            });
            const created = { id: ref.id, name, aliases: [], note_ids: [noteId] };
            byKey.set(conceptKey(name), created);
            resolved.push(name);
        }
    }

    // Detach this note from concepts it no longer belongs to (e.g. after a re-analysis)
    const keep = new Set(resolved.map(conceptKey));
    for (const c of existing) {
        if ((c.note_ids || []).includes(noteId) && !keep.has(conceptKey(c.name))) {
            await updateDoc(doc(db, 'concepts', c.id), { note_ids: arrayRemove(noteId) });
        }
    }

    await updateDoc(doc(db, 'notes', noteId), { concepts: resolved });
    return resolved;
}

export async function mergeConceptsAPI(profile, sourceId, targetId) {
    const [srcSnap, tgtSnap] = await Promise.all([
        getDoc(doc(db, 'concepts', sourceId)),
        getDoc(doc(db, 'concepts', targetId)),
    ]);
    if (!srcSnap.exists() || !tgtSnap.exists()) throw new Error('Concept not found');
    const src = srcSnap.data(), tgt = tgtSnap.data();

    const noteIds = Array.from(new Set([...(tgt.note_ids || []), ...(src.note_ids || [])]));
    const aliases = Array.from(new Set([...(tgt.aliases || []), ...(src.aliases || []), src.name]));

    await updateDoc(doc(db, 'concepts', targetId), { note_ids: noteIds, aliases });

    // Rewrite the denormalised concept names on every affected note
    for (const nid of (src.note_ids || [])) {
        const nSnap = await getDoc(doc(db, 'notes', nid));
        if (!nSnap.exists()) continue;
        const list = (nSnap.data().concepts || []).filter(n => conceptKey(n) !== conceptKey(src.name));
        if (!list.some(n => conceptKey(n) === conceptKey(tgt.name))) list.push(tgt.name);
        await updateDoc(doc(db, 'notes', nid), { concepts: list });
    }

    await deleteDoc(doc(db, 'concepts', sourceId));
    return { name: tgt.name, notes: noteIds.length };
}

export async function renameConceptAPI(conceptId, newName) {
    const snap = await getDoc(doc(db, 'concepts', conceptId));
    if (!snap.exists()) throw new Error('Concept not found');
    const c = snap.data();
    await updateDoc(doc(db, 'concepts', conceptId), {
        name: newName,
        aliases: Array.from(new Set([...(c.aliases || []), c.name])),
    });
    for (const nid of (c.note_ids || [])) {
        const nSnap = await getDoc(doc(db, 'notes', nid));
        if (!nSnap.exists()) continue;
        const list = (nSnap.data().concepts || []).map(n => conceptKey(n) === conceptKey(c.name) ? newName : n);
        await updateDoc(doc(db, 'notes', nid), { concepts: list });
    }
}

export async function deleteConceptAPI(conceptId) {
    const snap = await getDoc(doc(db, 'concepts', conceptId));
    if (snap.exists()) {
        const c = snap.data();
        for (const nid of (c.note_ids || [])) {
            const nSnap = await getDoc(doc(db, 'notes', nid));
            if (!nSnap.exists()) continue;
            const list = (nSnap.data().concepts || []).filter(n => conceptKey(n) !== conceptKey(c.name));
            await updateDoc(doc(db, 'notes', nid), { concepts: list });
        }
    }
    await deleteDoc(doc(db, 'concepts', conceptId));
}

// ============================================================================
// CONNECTIONS — first-class objects, linked incrementally at capture time
// ============================================================================

export function noteTitle(note) {
    if (!note) return 'Untitled';
    const body = stripDerived(note.raw_text || '');
    let first = body.split('\n')[0].trim().replace(/^#+\s+/, '');
    if (!first && note.summary) first = note.summary.split('.')[0];
    return (first || 'Untitled').slice(0, 80);
}

/** Legacy notes have derived markdown fused into raw_text. Never show it as the person's words. */
export function stripDerived(rawText) {
    return (rawText || '').replace(/\n*##\s*Semantic Connections[\s\S]*$/i, '').trim();
}

export async function getConnectionsForNoteAPI(noteId) {
    const [aSnap, bSnap] = await Promise.all([
        getDocs(query(collection(db, 'connections'), where('note_a', '==', noteId))),
        getDocs(query(collection(db, 'connections'), where('note_b', '==', noteId))),
    ]);
    const rows = [
        ...aSnap.docs.map(d => ({ id: d.id, ...d.data(), other: d.data().note_b })),
        ...bSnap.docs.map(d => ({ id: d.id, ...d.data(), other: d.data().note_a })),
    ];
    const seen = new Set();
    return rows
        .filter(r => (seen.has(r.other) ? false : (seen.add(r.other), true)))
        .sort((a, b) => (b.strength || 0) - (a.strength || 0));
}

export async function getAllConnectionsAPI(profile) {
    const profiles = profile === 'combined' ? ['prineeth', 'pramoddini'] : [profile];
    const q = query(collection(db, 'connections'), where('profile', 'in', profiles));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteConnectionAPI(id) {
    await deleteDoc(doc(db, 'connections', id));
}

async function saveConnection(profile, aId, bId, explanation, strength) {
    const [note_a, note_b] = aId < bId ? [aId, bId] : [bId, aId];
    const existing = await getDocs(query(
        collection(db, 'connections'),
        where('note_a', '==', note_a),
        where('note_b', '==', note_b),
    ));
    if (!existing.empty) {
        await updateDoc(doc(db, 'connections', existing.docs[0].id), {
            explanation, strength, updated_at: new Date().toISOString(),
        });
        return existing.docs[0].id;
    }
    const ref = await addDoc(collection(db, 'connections'), {
        profile, note_a, note_b, explanation,
        strength: strength ?? 0.5,
        created_at: new Date().toISOString(),
    });
    return ref.id;
}

const LINK_PROMPT = `You are a semantic link finder for a personal notebook. You are given ONE new note, and a shortlist of existing notes that are already known to be topically nearby.

Your job is to decide which of the candidates share a genuine intellectual bridge with the new note — a bridge worth showing the person because it tells them something they might not have noticed.

CRITICAL: Do not force connections. Topical adjacency is NOT a connection; the candidates are already adjacent, that is why they are on the list. A real connection is one where the two notes say something to each other — one extends, complicates, contradicts, or grounds the other. Returning an empty array is a good and common answer.

Return at most 4. For each:
- "id": the exact candidate id
- "explanation": one sentence, addressed to the person, naming what the bridge actually is. Not "both are about design" — say what passes between them.
- "strength": 0.0-1.0, how strong the bridge is. Below 0.5 means don't bother showing it.

Return JSON array: [{"id": "abc123", "explanation": "...", "strength": 0.8}]
Only return JSON.`;

/**
 * Link ONE note against its nearest neighbours. This replaces the old whole-vault
 * batch: it runs at capture time, costs one small call, and scales indefinitely.
 */
/**
 * A note created by \task, \remind, \calendar or \doc records an errand, not a
 * thought. Linking them produces connections that are technically correct and
 * useless — a calendar entry and its own reminder scored 0.95, the top score in
 * the whole notebook, and led the Connections list because of it.
 */
export function isLogisticsNote(note) {
    if (!note) return false;
    if ((note.tags || []).some(t => /^google(-|$)/i.test(t))) return true;
    return /^\s*\\(remind|task|calendar|doc)\b/i.test(note.raw_text || '');
}

export async function linkNoteAPI(noteId, allNotes = null) {
    const note = await getNoteByIdAPI(noteId);
    if (!note || isDiscoverNote(note) || isLogisticsNote(note)) return [];

    const notes = (allNotes || await getNotesAPI(note.profile)).filter(n => !isLogisticsNote(n));
    const neighbors = rankNeighbors(note, notes, 12);
    if (!neighbors.length) return [];

    const candidates = neighbors.map(({ note: n }) => ({
        id: n.id,
        title: noteTitle(n),
        summary: n.summary || stripDerived(n.raw_text).slice(0, 200),
        concepts: n.concepts || [],
    }));

    const userText = `NEW NOTE\nTitle: ${noteTitle(note)}\n${stripDerived(note.raw_text).slice(0, 1200)}\nSummary: ${note.summary || '—'}\nConcepts: ${(note.concepts || []).join(', ') || '—'}\n\nCANDIDATES\n${JSON.stringify(candidates, null, 1)}`;

    let found;
    try {
        const text = await callGemini(LINK_PROMPT, userText, { json: true, temperature: 0.2 });
        found = tryParseJSON(text);
    } catch (e) {
        console.warn('Linking failed:', e.message);
        return [];
    }
    if (!Array.isArray(found)) return [];

    const saved = [];
    for (const f of found) {
        if (!f.id || (f.strength ?? 0) < 0.5) continue;
        if (!candidates.some(c => c.id === f.id)) continue; // guard against hallucinated ids
        await saveConnection(note.profile, noteId, f.id, f.explanation || '', f.strength);
        saved.push(f);
    }
    return saved;
}

/**
 * One-time repair: pull `## Semantic Connections` blocks out of raw_text into the
 * connections collection, so raw_text goes back to being only what the person typed.
 */
export async function migrateConnectionsAPI(profile, onProgress = () => {}, stripRawText = false) {
    const notes = await getNotesAPI(profile);
    const byTitle = new Map(notes.map(n => [noteTitle(n).toLowerCase(), n]));
    let migrated = 0, cleaned = 0, unresolved = 0, scanned = 0;

    for (const note of notes) {
        const raw = note.raw_text || '';
        const idx = raw.search(/##\s*Semantic Connections/i);
        if (idx === -1) continue;
        scanned++;

        const block = raw.slice(idx);
        for (const line of block.split('\n')) {
            const m = line.match(/^\s*[-*]\s*\[\[(.+?)\]\]\s*:?\s*(.*)$/);
            if (!m) continue;
            const target = byTitle.get(m[1].trim().toLowerCase());
            if (!target) { unresolved++; continue; }
            if (target.id === note.id) continue;
            await saveConnection(note.profile, note.id, target.id, m[2].trim(), 0.7);
            migrated++;
        }

        // The live app at /noteworthy/ still renders connections by parsing this
        // block out of raw_text, and both apps share one Firestore. Copying is
        // safe; stripping would blank out connections over there. So stripping is
        // opt-in, for once the older app is retired. This app reads raw_text
        // through stripDerived(), so the leftover block never shows here.
        if (stripRawText) {
            await updateDoc(doc(db, 'notes', note.id), { raw_text: stripDerived(raw) });
            cleaned++;
        }
        onProgress(`${scanned} notes scanned, ${migrated} connections recovered…`);
    }
    return { cleaned, migrated, unresolved, scanned, stripped: stripRawText };
}

/**
 * Backfill embeddings and concepts for notes captured before this existed, then
 * link them. Resumable — safe to stop and re-run.
 */
export async function backfillAPI(profile, onProgress = () => {}) {
    const notes = (await getNotesAPI(profile)).filter(n => !isDiscoverNote(n));
    let embedded = 0, linked = 0, embedFailed = 0;

    const needEmbedding = notes.filter(n => !n.embedding || n.embedding.length !== EMBED_DIM);
    for (let i = 0; i < needEmbedding.length; i++) {
        const n = needEmbedding[i];
        const vec = await embedText(`${noteTitle(n)}\n${stripDerived(n.raw_text)}\n${n.summary || ''}`);
        if (vec) {
            await updateDoc(doc(db, 'notes', n.id), {
                embedding: vec,
                embedding_model: embedModelName(),
                embedding_dim: vec.length,
            });
            n.embedding = vec;
            embedded++;
        } else {
            embedFailed++;
            // A run that cannot embed the first few will not embed the next 200
            // either; stop and say why rather than hammering a dead endpoint.
            if (embedFailed >= 3 && embedded === 0) {
                onProgress(`Embedding stopped: ${lastEmbedError || 'the embedding endpoint refused every request.'}`);
                break;
            }
        }
        onProgress(`Embedding ${i + 1}/${needEmbedding.length}…`, (i + 1) / needEmbedding.length * 0.6);
    }

    const needLinks = notes.filter(n => !n.linked_at);
    for (let i = 0; i < needLinks.length; i++) {
        const n = needLinks[i];
        const found = await linkNoteAPI(n.id, notes);
        await updateDoc(doc(db, 'notes', n.id), { linked_at: new Date().toISOString() });
        linked += found.length;
        onProgress(`Linking ${i + 1}/${needLinks.length} — ${linked} connections found…`, 0.6 + (i + 1) / needLinks.length * 0.4);
    }

    return {
        embedded, linked, embedFailed,
        embedError: embedded ? null : lastEmbedError,
        model: embedModelName(),
        // "0 connections" reads as "found nothing" when it usually means
        // "every note was already linked, so nothing was looked at".
        linkCandidates: needLinks.length,
    };
}

/**
 * Re-run linking now that every note carries a vector.
 *
 * The first pass ran before embeddings existed, so rankNeighbors fell back to
 * tag overlap to choose which twelve notes the model even got to see — a pool
 * sharing barely a tenth of its members with what similarity picks now, and
 * empty altogether for notes with thin tags. This shows the model the shortlist
 * it should have had.
 *
 * Additive: existing connections stay, and a pair found again has its
 * explanation refreshed rather than duplicated. Resumable via `relinked_at`,
 * so an interrupted run picks up where it stopped instead of paying twice.
 */
export async function relinkAPI(profile, onProgress = () => {}) {
    if (!geminiKey()) throw new MissingKeyError();

    const notes = (await getNotesAPI(profile)).filter(n => !isDiscoverNote(n));
    const withVectors = notes.filter(n => Array.isArray(n.embedding) && n.embedding.length);
    const noVector = notes.length - withVectors.length;
    const todo = withVectors.filter(n => !n.relinked_at);
    const alreadyDone = withVectors.length - todo.length;

    if (!todo.length) {
        return { considered: 0, added: 0, noVector, alreadyDone, stoppedEarly: false };
    }

    const before = (await getAllConnectionsAPI(profile)).length;
    let proposed = 0, quiet = 0;

    for (let i = 0; i < todo.length; i++) {
        const n = todo[i];
        // linkNoteAPI swallows its own errors and returns [], so a dead key
        // would otherwise churn silently through every note finding nothing.
        const made = await linkNoteAPI(n.id, notes);
        proposed += made.length;
        quiet = made.length ? 0 : quiet + 1;
        if (quiet >= 25 && proposed === 0) {
            onProgress(`Stopped after 25 notes in a row returned nothing — check the console for the reason.`);
            return { considered: i + 1, added: 0, noVector, alreadyDone, stoppedEarly: true };
        }
        await updateDoc(doc(db, 'notes', n.id), { relinked_at: new Date().toISOString() });
        n.relinked_at = new Date().toISOString();
        onProgress(`Re-drawing ${i + 1}/${todo.length} — ${proposed} links proposed…`, (i + 1) / todo.length);
    }

    const after = (await getAllConnectionsAPI(profile)).length;
    return { considered: todo.length, added: after - before, proposed, noVector, alreadyDone, stoppedEarly: false };
}

/**
 * Concepts only ever got attached at capture time, and they arrived late — so
 * 235 of 236 notes were never filed against one. Eight concepts covering a
 * single note is not a vocabulary, and it is why the Concepts pane has nothing
 * to show and why Memory can rarely match a question to a concept by name.
 *
 * Filed in batches: one call per twenty-five notes rather than one per note,
 * with the vocabulary re-read between batches so later notes can reuse the
 * concepts earlier ones minted.
 */
const CONCEPT_BACKFILL_PROMPT = `You are filing a backlog of notes into one shared concept vocabulary.

You are given the concepts already in use, then a numbered list of notes. For each note return 1-3 concepts it genuinely belongs to.

VOCABULARY DISCIPLINE — this matters more than anything else here:
- REUSE an existing concept name, copied EXACTLY, whenever one fits, even loosely. Strongly preferred.
- Mint a new concept only when nothing above covers the note. A new concept must be broad enough that other notes will plausibly share it.
- Title Case, 1-3 words. Never a variant of an existing name: if "Design Philosophy" exists, never write "Philosophy of Design".
- A note that is an errand, a link with no comment, or too slight to belong anywhere gets an empty array. Filing everything is not the goal.

Return JSON mapping the note number to its concepts, and nothing else:
{"0": ["Design Philosophy"], "1": [], "2": ["Embodied Knowledge", "Craft"]}`;

export async function backfillConceptsAPI(profile, onProgress = () => {}) {
    if (!geminiKey()) throw new MissingKeyError();
    const target = profile === 'combined' ? 'prineeth' : profile;

    const all = (await getNotesAPI(target)).filter(n => !isDiscoverNote(n) && !isLogisticsNote(n));
    const concepts = await getConceptsAPI(target);
    const filed = new Set(concepts.flatMap(c => c.note_ids || []));
    const todo = all.filter(n => !filed.has(n.id) && !(n.concepts || []).length);

    if (!todo.length) return { considered: 0, filed: 0, minted: 0, vocabulary: concepts.length };

    const BATCH = 25;
    const startedWith = new Set(concepts.map(c => c.name));
    let filedCount = 0;

    for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        onProgress(`Filing ${i + 1}–${Math.min(i + BATCH, todo.length)} of ${todo.length}…`, (i + 1) / todo.length);

        // Re-read between batches so later notes can reuse what earlier ones minted
        const vocab = await getConceptsAPI(target);
        const vocabLine = vocab.length
            ? vocab.map(c => `- ${c.name} (${(c.note_ids || []).length} notes)`).join('\n')
            : '(none yet — you are naming the first ones)';

        const listing = batch.map((n, j) => {
            const body = (n.summary || stripDerived(n.raw_text || '')).replace(/\s+/g, ' ').slice(0, 300);
            return `${j}. "${noteTitle(n)}" — ${body}`;
        }).join('\n');

        let map;
        try {
            const text = await callGemini(
                CONCEPT_BACKFILL_PROMPT,
                `CONCEPTS ALREADY IN USE\n${vocabLine}\n\nNOTES TO FILE\n${listing}`,
                { json: true, temperature: 0.2 },
            );
            map = tryParseJSON(text);
        } catch (e) {
            console.warn('Concept batch failed:', e.message);
            continue;
        }
        if (!map || typeof map !== 'object') continue;

        // syncNoteConceptsAPI re-reads the vocabulary per note, so a batch of
        // twenty-five is a couple of dozen round trips. Report inside the loop
        // or the whole run looks frozen between batches.
        const entries = Object.entries(map);
        for (let k = 0; k < entries.length; k++) {
            const [idx, names] = entries[k];
            const note = batch[Number(idx)];
            if (!note || !Array.isArray(names) || !names.length) continue;
            try {
                await syncNoteConceptsAPI(note.id, target, names);
                filedCount++;
                onProgress(`Filed ${filedCount} of ${todo.length} — "${noteTitle(note).slice(0, 42)}" → ${names.join(', ')}`,
                    (i + k + 1) / todo.length);
            } catch (e) { console.warn('Filing failed for a note:', e.message); }
        }
    }

    const after = await getConceptsAPI(target);
    return {
        considered: todo.length,
        filed: filedCount,
        minted: after.filter(c => !startedWith.has(c.name)).length,
        vocabulary: after.length,
    };
}

const CONCEPT_TIDY_PROMPT = `You are tidying the concept vocabulary of a personal notebook. You are given a numbered list of concept names with how many notes each holds.

Find groups that are the SAME concept under different wording — hyphenation, transliteration, singular/plural, or a phrase reordering ("Design Philosophy" / "Philosophy of Design"). Also merge a very narrow concept into a broader one that fully contains it when the narrow one holds few notes.

Be conservative. Two concepts that merely share a word are NOT the same concept. When in doubt, leave them alone.

For each group choose the best canonical name — the clearest, most standard phrasing, Title Case.

Return JSON: {"merges": [{"canonical": "Design Philosophy", "absorb": [3, 11, 20]}]}
"absorb" holds the indices of every concept in the group INCLUDING the one whose name you chose as canonical.
Return an empty merges array if nothing should change. Only return JSON.`;

/**
 * Offer a set of vocabulary merges. Returns proposals rather than applying them —
 * the person decides what actually collapses.
 */
export async function proposeConceptMergesAPI(profile) {
    const concepts = await getConceptsAPI(profile);
    if (concepts.length < 4) return [];
    const listing = concepts
        .map((c, i) => `${i}. ${c.name} (${(c.note_ids || []).length} notes)`)
        .join('\n');
    const text = await callGemini(CONCEPT_TIDY_PROMPT, listing, { json: true, temperature: 0.1 });
    const parsed = tryParseJSON(text);
    return (parsed.merges || [])
        .map(m => {
            const members = (m.absorb || []).map(i => concepts[i]).filter(Boolean);
            if (members.length < 2) return null;
            const target = members.find(c => conceptKey(c.name) === conceptKey(m.canonical)) || members[0];
            const sources = members.filter(c => c.id !== target.id);
            if (!sources.length) return null;
            return {
                canonical: m.canonical || target.name,
                target,
                sources,
                totalNotes: new Set(members.flatMap(c => c.note_ids || [])).size,
            };
        })
        .filter(Boolean);
}

// ============================================================================
// CHATS API
// ============================================================================

/**
 * Assemble everything the mentor should know before it answers: who it's talking to,
 * the note at hand, the notes around it, and the bridges already drawn between them.
 */
export async function buildMentorContext(profile, noteId) {
    let ctx = CHAT_SYSTEM_PROMPT;

    const [profileBlock, note] = await Promise.all([
        getProfileBlockAPI(profile).catch(() => ''),
        noteId ? getNoteByIdAPI(noteId) : Promise.resolve(null),
    ]);

    if (profileBlock) ctx += `\n\n${profileBlock}`;
    if (!note) return ctx;

    ctx += `\n\nTHE NOTE IN FRONT OF YOU`
        + `\nWritten ${new Date(note.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`
        + `\nTitle: ${noteTitle(note)}`
        + `\n\n${stripDerived(note.raw_text)}`;
    if (note.summary) ctx += `\n\nYour earlier reading of it: ${note.summary}`;
    if (note.concepts?.length) ctx += `\nFiled under: ${note.concepts.join(', ')}`;

    // Explicit connections first — these were already judged meaningful
    try {
        const conns = await getConnectionsForNoteAPI(noteId);
        if (conns.length) {
            const lines = [];
            for (const c of conns.slice(0, 6)) {
                const other = await getNoteByIdAPI(c.other);
                if (other) lines.push(`- "${noteTitle(other)}" — ${c.explanation}`);
            }
            if (lines.length) ctx += `\n\nCONNECTIONS YOU HAVE ALREADY DRAWN FROM THIS NOTE\n${lines.join('\n')}`;
        }
    } catch (e) { console.warn('Connection context failed:', e.message); }

    // Then nearby notes that haven't been explicitly linked
    try {
        const all = await getNotesAPI(profile);
        const near = rankNeighbors(note, all, 6);
        if (near.length) {
            const lines = near.map(({ note: n }) =>
                `- "${noteTitle(n)}" (${new Date(n.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}): ${n.summary || stripDerived(n.raw_text).slice(0, 160)}`);
            ctx += `\n\nOTHER NOTES IN THE SAME TERRITORY\n${lines.join('\n')}`;
        }
    } catch (e) { console.warn('Neighbour context failed:', e.message); }

    return ctx;
}

export async function getChatsAPI(profile, noteId) {
    const filters = [];
    if (profile && profile !== 'combined') filters.push(where("profile", "==", profile));
    if (noteId) filters.push(where("note_id", "==", noteId));

    const q = query(collection(db, "chats"), ...filters);
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort in memory to avoid needing Firestore composite indexes
    return docs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

export async function getChatByIdAPI(id) {
    const snap = await getDoc(doc(db, "chats", id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function sendChatAPI(profile, noteId, chatId, message) {
    let currentChatId = chatId;
    let chatData;

    if (!currentChatId) {
        const title = message.slice(0, 30) + (message.length > 30 ? '...' : '');
        const ref = await addDoc(collection(db, "chats"), {
            profile, note_id: noteId, title, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            messages: [{ role: 'user', content: message }]
        });
        currentChatId = ref.id;
        chatData = { title, messages: [{ role: 'user', content: message }] };
    } else {
        chatData = await getChatByIdAPI(currentChatId);
        chatData.messages.push({ role: 'user', content: message });
        await updateDoc(doc(db, "chats", currentChatId), {
            messages: chatData.messages,
            updated_at: new Date().toISOString()
        });
    }

    const systemContext = await buildMentorContext(profile, noteId);

    const contents = chatData.messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));

    const responseText = await callGemini(systemContext, "", { contents });

    chatData.messages.push({ role: 'assistant', content: responseText });
    await updateDoc(doc(db, "chats", currentChatId), {
        messages: chatData.messages,
        updated_at: new Date().toISOString()
    });

    return { id: currentChatId, response: responseText };
}

// ============================================================================
// MEMORY — one conversation that has read the whole notebook
// ============================================================================

/** Whole-notebook chats live in the same collection, under a reserved note id. */
export const MEMORY_SCOPE = '__memory__';

const MEMORY_SYSTEM_PROMPT = `You are this person's memory. You have read their entire notebook — every note, the concepts they keep returning to, the connections drawn between notes, and the profile the app has been building of them.

You are not a search box and you are not a summariser. You are the person in the room who remembers everything they have written and can tell them what it adds up to.

How to answer:
- Answer from the notebook. Quote or paraphrase specific notes and name them by title and roughly when they were written ("in the note on X, back in March…"). Specificity is the whole value you have.
- Say the thing only you can say: how an idea has moved over time, where they contradict themselves, what they keep circling without naming, which two notes belong together that they have never put together.
- When something is missing from the notebook, say so plainly. Never invent a note, a date, a quotation, or a fact about them.
- If the retrieved notes do not actually answer what was asked, say what you do have and what you would need — do not pad.
- Notes arrive under headings that say why they are there. Only the ones under NOTES THAT MATCH earned their place. Notes under MOST RECENT or A SPREAD are background: they were pulled in by date, not by relevance, and most of them will have nothing to do with the question. Do not build an answer on them, and do not cite one unless it genuinely bears on what was asked.
- Distinguish what they wrote from what you infer. "You wrote X" and "reading across these, it looks like Y" are different sentences.
- Do not flatter, do not open with a compliment, and do not restate the question before answering.
- Conversational prose. Short paragraphs. No headers or bullet lists unless they ask for structure.

At the end of an answer that leaned on specific notes, do not add a sources list — the app shows those itself.`;

/** A cheap read of the shape of the notebook: how big, how old, what it circles. */
export async function getNotebookOverviewAPI(profile) {
    const target = profile === 'combined' ? 'prineeth' : profile;
    const [notes, concepts, memory] = await Promise.all([
        getNotesAPI(target).catch(() => []),
        getConceptsAPI(target).catch(() => []),
        getMemoryAPI(target).catch(() => []),
    ]);
    const real = notes.filter(n => !isDiscoverNote(n));
    const dates = real.map(n => new Date(n.created_at)).filter(d => !isNaN(d)).sort((a, b) => a - b);
    const since30 = Date.now() - 30 * 86400000;
    return {
        noteCount: real.length,
        keptCount: notes.length - real.length,
        conceptCount: concepts.length,
        signalCount: memory.length,
        // Semantic recall only exists once the graph has been built; say so
        // rather than quietly retrieving worse.
        embeddedCount: real.filter(n => Array.isArray(n.embedding) && n.embedding.length).length,
        firstNote: dates[0] || null,
        lastNote: dates[dates.length - 1] || null,
        recentCount: real.filter(n => new Date(n.created_at).getTime() > since30).length,
        topConcepts: concepts.slice(0, 8).map(c => ({ name: c.name, n: (c.note_ids || []).length })),
    };
}

/* ── Lexical retrieval ──────────────────────────────────────────────────────
   Not a fallback in practice: a notebook only has embeddings once "Build the
   graph" has run, so for most notebooks this IS the retrieval. Worth doing
   properly — stopwords out, light stemming, and rare words weighted over
   common ones so "migration" beats "about".
   ────────────────────────────────────────────────────────────────────────── */

const STOPWORDS = new Set(`a about above after again against all also am an and any are aren as at be because been
before being below between both but by can cannot could did do does doing done down during each few for from further
had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my
myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than
that the their theirs them themselves then there these they this those through to too under until up us very was we
were what when where which while who whom why will with would you your yours yourself yourselves
anything something things thing lot really much many maybe stuff kind sort
think thinking thought thoughts note notes notebook wrote written writing write
tell show find give get keep been everever`.split(/\s+/).filter(Boolean));

/** Enough stemming to match plurals and gerunds, and no more. */
function stemWord(w) {
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && w.endsWith('es'))  return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('ed'))  return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
}

function tokenize(text) {
    return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w))
        .map(stemWord);
}

/** One pass over the notebook, reused for every term in the question. */
function buildLexicalIndex(notes) {
    const df = new Map();
    const docs = notes.map(n => {
        const strong = new Set(tokenize(`${noteTitle(n)} ${n.summary || ''} ${(n.tags || []).join(' ')} ${(n.concepts || []).join(' ')}`));
        const body = new Set(tokenize(stripDerived(n.raw_text || '').slice(0, 5000)));
        for (const t of new Set([...strong, ...body])) df.set(t, (df.get(t) || 0) + 1);
        return { note: n, strong, body };
    });
    return { df, docs, n: notes.length || 1 };
}

/** Rank by summed inverse-document-frequency, title and summary hits counting extra. */
function lexicalRank(index, question, k = 14) {
    const terms = [...new Set(tokenize(question))];
    if (!terms.length) return [];
    const idf = (t) => Math.log(1 + index.n / (1 + (index.df.get(t) || 0)));
    const ceiling = terms.reduce((sum, t) => sum + idf(t) * 1.6, 0) || 1;
    return index.docs.map(d => {
        let score = 0;
        for (const t of terms) {
            if (d.strong.has(t)) score += idf(t) * 1.6;
            else if (d.body.has(t)) score += idf(t);
        }
        return { note: d.note, score: score / ceiling };
    }).sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Pull the slice of the notebook that a given question actually needs: the
 * notes that match it semantically and lexically, any concept it names by
 * name, plus a recency anchor so "lately" questions work — and on top of that
 * the standing context: who they are, what they circle, what is already linked.
 */
/** "What have I been circling lately?" wants recency. "What PhD?" does not. */
const TEMPORAL_QUESTION = /\b(lately|recent|recently|these days|nowadays|currently|right now|this week|this month|past few|last few|of late|these past|so far this)\b/i;

/**
 * Pull the slice of the notebook a question needs, and keep track of WHY each
 * note came along.
 *
 * The provenance matters. An earlier version bolted the five newest notes and a
 * spread of older ones onto every answer, then handed the lot to the model
 * under the heading "the notes most relevant to what they asked" — so a
 * question about doctoral study arrived with "Love really is a beautiful thing!"
 * presented as relevant. Filler is sometimes useful, but it has to be labelled
 * as filler, to the model and to the person reading the sources.
 */
export async function buildNotebookContext(profile, question) {
    const target = profile === 'combined' ? 'prineeth' : profile;

    const [allNotes, concepts, profileBlock, syntheses] = await Promise.all([
        getNotesAPI(target).catch(() => []),
        getConceptsAPI(target).catch(() => []),
        getProfileBlockAPI(target).catch(() => ''),
        getSynthesesAPI(target).catch(() => []),
    ]);
    // Cards kept from Discover are searchable too — they were kept on purpose —
    // but they are marked, so nothing gets attributed to them as their own writing.
    const notes = allNotes;
    const written = notes.filter(n => !isDiscoverNote(n));
    if (!notes.length) return { context: '', sources: [], noteCount: 0 };

    const byId = new Map(notes.map(n => [n.id, n]));
    const byDate = [...written].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // why: 'match' (answered the question) | 'recent' | 'sample'
    const picked = new Map();
    const add = (n, why) => {
        if (!n || picked.has(n.id) || picked.size >= 20) return;
        picked.set(n.id, { note: n, why });
    };
    const matchCount = () => [...picked.values()].filter(p => p.why === 'match').length;

    // 1. Semantic, where there are vectors to compare against.
    //
    //    An absolute cosine cut does not work here. Measured over 3000 random
    //    pairs of this notebook's own notes, similarity runs 0.58-0.90 with a
    //    median of 0.72 — everything a person writes is somewhat like
    //    everything else they write. A 0.55 floor passed all 235 notes, which
    //    is to say it did nothing.
    //
    //    What carries signal is distance above the notebook's own baseline, so
    //    score against the mean and spread of this query's own results. That
    //    self-calibrates across models and corpora, which matters because the
    //    last embedding model was retired underneath this app.
    let topZ = 0;
    const embedded = notes.filter(n => Array.isArray(n.embedding) && n.embedding.length);
    if (embedded.length > 8) {
        const qVec = await embedText(question);
        if (qVec) {
            const scored = embedded.map(n => ({ note: n, score: cosineSim(qVec, n.embedding) }));
            const mean = scored.reduce((t, s) => t + s.score, 0) / scored.length;
            const sd = Math.sqrt(scored.reduce((t, s) => t + (s.score - mean) ** 2, 0) / scored.length);
            if (sd > 0) {
                const z = scored.map(s => ({ ...s, z: (s.score - mean) / sd })).sort((a, b) => b.z - a.z);
                topZ = z[0]?.z || 0;
                z.filter(s => s.z >= 1.6).slice(0, 12).forEach(s => add(s.note, 'match'));
            }
        }
    }

    // 2. A concept named in the question brings its own notes with it
    const q = question.toLowerCase();
    for (const c of concepts) {
        const name = (c.name || '').toLowerCase();
        if (name.length > 3 && q.includes(name)) {
            for (const id of (c.note_ids || []).slice(0, 6)) add(byId.get(id), 'match');
        }
    }

    // 3. Lexical, which for a notebook without embeddings is the whole of it
    lexicalRank(buildLexicalIndex(notes), question, 14)
        .filter(s => s.score > 0.08)
        .forEach(s => add(s.note, 'match'));

    const genuineMatches = matchCount();

    // 4. Recency, only when the question is actually about lately — or when so
    //    little matched that the alternative is answering from nothing.
    const wantsRecency = TEMPORAL_QUESTION.test(question);
    if (wantsRecency || genuineMatches < 4) {
        byDate.slice(0, wantsRecency ? 8 : 4).forEach(n => add(n, 'recent'));
    }

    // 5. And a spread through the notebook only when almost nothing matched,
    //    which is what "what have I forgotten?" looks like.
    if (genuineMatches < 3 && byDate.length > 10) {
        const older = byDate.slice(5);
        const want = Math.max(0, 10 - picked.size);
        const step = Math.max(1, Math.floor(older.length / Math.max(want, 1)));
        for (let i = 0; i < older.length && picked.size < 12; i += step) add(older[i], 'sample');
    }

    const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const chosen = [...picked.values()].sort((a, b) => new Date(b.note.created_at) - new Date(a.note.created_at));
    const block = ({ note: n }) => {
        const mark = isDiscoverNote(n) ? ' [kept from Discover — shown to them, not written by them]' : '';
        let b = `--- "${noteTitle(n)}"${mark} · ${fmtDate(n.created_at)}\n${stripDerived(n.raw_text || '').replace(/\s+/g, ' ').slice(0, 1400)}`;
        if (n.summary) b += `\nYour earlier reading of it: ${n.summary}`;
        if (n.concepts?.length) b += `\nFiled under: ${n.concepts.join(', ')}`;
        return b;
    };
    const group = (why) => chosen.filter(c => c.why === why).map(block);
    const matched = group('match');
    const recent = group('recent');
    const sampled = group('sample');

    // Connections that run between the notes actually in view
    let connBlock = '';
    try {
        const conns = await getAllConnectionsAPI(target);
        const lines = conns
            .filter(c => picked.has(c.note_a) && picked.has(c.note_b))
            .slice(0, 14)
            .map(c => `- "${noteTitle(picked.get(c.note_a).note)}" ⟷ "${noteTitle(picked.get(c.note_b).note)}": ${c.explanation}`);
        if (lines.length) connBlock = `CONNECTIONS ALREADY DRAWN BETWEEN THESE NOTES\n${lines.join('\n')}`;
    } catch { /* connections are a bonus, never a blocker */ }

    const span = byDate.length
        ? `${fmtDate(byDate[byDate.length - 1].created_at)} to ${fmtDate(byDate[0].created_at)}`
        : 'no notes written yet';
    const recent30 = byDate.filter(n => Date.now() - new Date(n.created_at) < 30 * 86400000).length;
    const keptCount = notes.length - written.length;
    const conceptLine = concepts.slice(0, 30)
        .map(c => `${c.name} (${(c.note_ids || []).length})`).join(', ');
    const titleCap = 80;
    const recentTitles = byDate.slice(0, titleCap)
        .map(n => `- ${fmtDate(n.created_at)}: ${noteTitle(n)}`).join('\n');
    const titleHeading = byDate.length > titleCap
        ? `THE ${titleCap} MOST RECENT NOTES BY TITLE, NEWEST FIRST (of ${byDate.length} — older ones exist but are not listed here)`
        : `EVERY NOTE THEY HAVE WRITTEN, BY TITLE, NEWEST FIRST`;
    const synthLine = syntheses.slice(0, 4)
        .map(s => `- ${s.label || s.scope}: ${(s.headline || s.summary || '').replace(/\s+/g, ' ').slice(0, 260)}`)
        .filter(l => l.length > 6).join('\n');

    const context = [
        profileBlock,
        `THE SHAPE OF THE NOTEBOOK\n${written.length} notes they wrote, ${span}. ${recent30} in the last 30 days.`
            + (keptCount ? ` Plus ${keptCount} cards they kept from Discover.` : ''),
        conceptLine ? `CONCEPTS THEY KEEP RETURNING TO (with how many notes each)\n${conceptLine}` : '',
        recentTitles ? `${titleHeading}\n${recentTitles}` : '',
        synthLine ? `SYNTHESES ALREADY WRITTEN ACROSS THE NOTEBOOK\n${synthLine}` : '',
        matched.length
            ? (topZ && topZ < 2
                ? `THE CLOSEST NOTES IN THE NOTEBOOK — but none of them sit far above the noise, so the notebook may simply not hold an answer to this. Say so if that is what you find\n${matched.join('\n\n')}`
                : `NOTES THAT MATCH WHAT THEY ASKED — these earned their place, lean on them\n${matched.join('\n\n')}`)
            : `NOTHING IN THE NOTEBOOK MATCHED THIS QUESTION DIRECTLY. Say so rather than making the notes below fit.`,
        recent.length
            ? `THEIR MOST RECENT NOTES — included for background only. These did NOT match the question. Do not treat them as relevant, and do not mention them unless they genuinely bear on the answer\n${recent.join('\n\n')}`
            : '',
        sampled.length
            ? `A SPREAD FROM ACROSS THE NOTEBOOK — little matched directly, so these are a sample, not a selection. Same caution as above\n${sampled.join('\n\n')}`
            : '',
        connBlock,
    ].filter(Boolean).join('\n\n');

    const sources = chosen.map(({ note: n, why }) => ({
        id: n.id, title: noteTitle(n), date: n.created_at, why,
        kind: isDiscoverNote(n) ? 'kept' : 'written',
    }));
    return { context, sources, noteCount: notes.length, matchCount: genuineMatches, topZ };
}

export async function getMemoryChatsAPI(profile) {
    return getChatsAPI(profile === 'combined' ? 'prineeth' : profile, MEMORY_SCOPE);
}

/**
 * A turn in the whole-notebook conversation. Retrieval runs fresh on every
 * message, so the context follows wherever the conversation goes.
 */
export async function sendMemoryChatAPI(profile, chatId, message) {
    const target = profile === 'combined' ? 'prineeth' : profile;

    let prior = [];
    if (chatId) {
        const existing = await getChatByIdAPI(chatId);
        if (!existing) throw new Error('That conversation is gone.');
        prior = existing.messages || [];
    }
    const messages = [...prior, { role: 'user', content: message }];

    const { context, sources, noteCount } = await buildNotebookContext(target, message);

    let responseText;
    if (!noteCount) {
        responseText = "There's nothing in the notebook yet — capture a few notes and I'll have something to remember.";
    } else {
        // Only the last few turns go back up; the retrieved notes are the bulk.
        const contents = messages.slice(-10).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));
        responseText = await callGemini(
            `${MEMORY_SYSTEM_PROMPT}\n\n${context}`,
            '',
            { contents, temperature: 0.55, maxTokens: 4096 },
        );
    }

    // Nothing is written until there is an answer to write, so a failed call
    // leaves no half-conversation behind.
    messages.push({ role: 'assistant', content: responseText, sources: noteCount ? sources : [] });
    const now = new Date().toISOString();

    let currentChatId = chatId;
    if (!currentChatId) {
        const ref = await addDoc(collection(db, 'chats'), {
            profile: target, note_id: MEMORY_SCOPE, scope: 'memory',
            title: message.slice(0, 40) + (message.length > 40 ? '…' : ''),
            created_at: now, updated_at: now, messages,
        });
        currentChatId = ref.id;
    } else {
        await updateDoc(doc(db, 'chats', currentChatId), { messages, updated_at: now });
    }

    return { id: currentChatId, response: responseText, sources: noteCount ? sources : [] };
}

/** Openers that are actually answerable from what is in the notebook. */
export async function suggestMemoryPromptsAPI(profile) {
    const target = profile === 'combined' ? 'prineeth' : profile;
    const concepts = await getConceptsAPI(target).catch(() => []);
    const top = concepts.filter(c => (c.note_ids || []).length > 1).slice(0, 3);
    const prompts = [
        'What have I been circling lately without naming it?',
        'Where do my notes contradict each other?',
    ];
    if (top[0]) prompts.push(`How has my thinking on ${top[0].name} changed?`);
    if (top[1]) prompts.push(`What connects ${top[1].name} to the rest of my notes?`);
    prompts.push('What have I written that I have probably forgotten?');
    return prompts.slice(0, 5);
}

// ============================================================================
// THE WEEKLY LETTER — the notebook writing back
//
// Everything else in here answers a question someone asked. This is the one
// thing that speaks first. It is deliberately prose: a synthesis with headings
// is a report, and nobody reads their own reports.
// ============================================================================

const LETTER_DAYS = 7;
const LETTER_MIN_NOTES = 3;

const LETTER_PROMPT = `You are writing this week's letter to someone whose notebook you have read in full.

You have their profile, everything they wrote this week, the questions they left open in earlier months, the connections already drawn between their notes, and what you wrote in previous letters.

Write a letter. Prose, second person, addressed to them. 220-400 words. No headings, no bullet lists, no bold, no markdown of any kind.

Do some of these — never all of them, and only the ones the material genuinely supports:
- Name what they circled this week, quoting their own words back to them.
- Point at a tension or contradiction between two things they wrote, precisely and without scolding.
- Take ONE question they left open in an earlier month that this week's notes actually speak to, and say what the notebook now says about it. Name the question and roughly when they asked it. Only if the link is real — a forced one is worse than none.
- Offer one thing worth reading, watching or doing, with one sentence on why them specifically. Never the obvious choice, and never anything under ALREADY OFFERED.

Rules:
- Be specific or be silent. "You have been thinking about labour" is worthless. "You asked in July whether carpenters chose their trade, and the Breman you kept says most of them did not" is the entire point.
- A thin week gets a thin letter. If they wrote four notes, say so and write four sentences. Never pad to length.
- Do not flatter. No compliments on their thinking, no opening summary of what you are about to say, no "I noticed that".
- Never invent a note, a date, a quotation, or a fact about them. If you are unsure of a detail, leave it out.
- Do not repeat the substance of previous letters.
- No greeting and no sign-off. Start on the first real sentence and end on the last one.

Return JSON:
{"body": "the letter", "envelope": "6-10 words naming what this letter is about, lowercase, no full stop", "question_revisited": "the exact earlier question you took up, or null", "reading": "the one thing you offered, or null"}
Only return JSON.`;

/** A note that is a question someone left lying around. */
function looksLikeAnOpenQuestion(note) {
    const text = stripDerived(note.raw_text || '').trim();
    return text.includes('?') && text.length < 500;
}

/** Has enough time passed, and enough writing happened, to be worth a letter? */
export async function letterStatusAPI(profile) {
    const target = profile === 'combined' ? 'prineeth' : profile;
    const [letters, allNotes] = await Promise.all([
        getLettersAPI(target).catch(() => []),
        getNotesAPI(target).catch(() => []),
    ]);
    const notes = allNotes.filter(n => !isDiscoverNote(n));
    const last = letters[0] || null;
    const since = last ? new Date(last.period_end) : new Date(Date.now() - LETTER_DAYS * 86400000);
    const fresh = notes.filter(n => new Date(n.created_at) > since);
    const daysSince = Math.floor((Date.now() - since.getTime()) / 86400000);

    return {
        last,
        unread: letters.filter(l => !l.read_at).length,
        since,
        freshCount: fresh.length,
        daysSince,
        due: daysSince >= LETTER_DAYS && fresh.length >= LETTER_MIN_NOTES,
        // Why it is not due yet, so the UI never has to guess
        blockedBy: fresh.length < LETTER_MIN_NOTES ? 'notes' : (daysSince < LETTER_DAYS ? 'time' : null),
    };
}

export async function getLettersAPI(profile) {
    const target = profile === 'combined' ? 'prineeth' : profile;
    const snap = await getDocs(query(collection(db, 'letters'), where('profile', '==', target)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.period_end) - new Date(a.period_end));
}

export async function markLetterReadAPI(id) {
    await updateDoc(doc(db, 'letters', id), { read_at: new Date().toISOString() });
}

export async function deleteLetterAPI(id) {
    await deleteDoc(doc(db, 'letters', id));
}

/**
 * Write the letter covering everything since the last one.
 *
 * `force` writes a letter for whatever is there, however thin — used by the
 * "write it now" control, so the person is never told to come back later.
 */
export async function writeLetterAPI(profile, { force = false } = {}) {
    if (!geminiKey()) throw new MissingKeyError();
    const target = profile === 'combined' ? 'prineeth' : profile;

    const status = await letterStatusAPI(target);
    if (!status.due && !force) return { skipped: true, reason: status.blockedBy, status };

    const [allNotes, profileBlock, concepts, letters, cardsSnap] = await Promise.all([
        getNotesAPI(target),
        getProfileBlockAPI(target).catch(() => ''),
        getConceptsAPI(target).catch(() => []),
        getLettersAPI(target).catch(() => []),
        getDocs(query(collection(db, 'cards'), where('profile', '==', target))).catch(() => ({ docs: [] })),
    ]);

    const notes = allNotes.filter(n => !isDiscoverNote(n));
    if (!notes.length) return { skipped: true, reason: 'empty' };

    const since = status.since;
    const week = notes.filter(n => new Date(n.created_at) > since)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (!week.length && !force) return { skipped: true, reason: 'notes', status };

    const day = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
    const monthYear = (iso) => new Date(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    const weekBlock = week.map(n =>
        `--- ${day(n.created_at)} · "${noteTitle(n)}"\n${stripDerived(n.raw_text || '').replace(/\s+/g, ' ').slice(0, 1200)}`
    ).join('\n\n');

    // The open loops: questions from before this stretch, which is the whole
    // reason a letter can say something a weekly summary cannot.
    const older = notes.filter(n => new Date(n.created_at) <= since);
    const openQuestions = older.filter(looksLikeAnOpenQuestion)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 40)
        .map(n => `- (${monthYear(n.created_at)}) ${stripDerived(n.raw_text).replace(/\s+/g, ' ').slice(0, 220)}`)
        .join('\n');

    // Connections drawn between this week's notes and anything else
    let connBlock = '';
    try {
        const weekIds = new Set(week.map(n => n.id));
        const byId = new Map(notes.map(n => [n.id, n]));
        const lines = (await getAllConnectionsAPI(target))
            .filter(c => weekIds.has(c.note_a) || weekIds.has(c.note_b))
            .slice(0, 16)
            .map(c => {
                const a = byId.get(c.note_a), b = byId.get(c.note_b);
                return a && b ? `- "${noteTitle(a)}" ⟷ "${noteTitle(b)}": ${c.explanation}` : null;
            }).filter(Boolean);
        if (lines.length) connBlock = `CONNECTIONS INVOLVING THIS WEEK'S NOTES\n${lines.join('\n')}`;
    } catch { /* a bonus, never a blocker */ }

    const cards = cardsSnap.docs.map(d => d.data());
    const kept = cards.filter(c => c.status === 'accepted').slice(0, 12)
        .map(c => `- ${(c.content || '').replace(/\s+/g, ' ').slice(0, 120)}${c.source ? ` — ${c.source}` : ''}`).join('\n');

    const priorLetters = letters.slice(0, 6).map(l =>
        `- ${new Date(l.period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${l.envelope || ''}`
        + (l.question_revisited ? ` | took up: ${l.question_revisited}` : '')
        + (l.reading ? ` | offered: ${l.reading}` : '')
    ).join('\n');

    const alreadyOffered = [
        ...letters.map(l => l.reading).filter(Boolean),
        ...cards.map(c => c.source).filter(Boolean).slice(0, 30),
    ].map(x => `- ${x}`).join('\n');

    const conceptLine = concepts.slice(0, 20).map(c => `${c.name} (${(c.note_ids || []).length})`).join(', ');

    const userText = [
        profileBlock,
        `THE STRETCH THIS LETTER COVERS\n${day(since.toISOString())} to ${day(new Date().toISOString())} — ${week.length} note${week.length === 1 ? '' : 's'}. The notebook holds ${notes.length} in total.`,
        weekBlock ? `WHAT THEY WROTE IN THIS STRETCH\n${weekBlock}` : 'WHAT THEY WROTE IN THIS STRETCH\nNothing. Say so plainly and keep it to two or three sentences.',
        openQuestions ? `QUESTIONS THEY LEFT OPEN IN EARLIER MONTHS\n${openQuestions}` : '',
        conceptLine ? `WHAT THEY KEEP RETURNING TO\n${conceptLine}` : '',
        connBlock,
        kept ? `THINGS THEY KEPT WHEN OFFERED — this is what lands with them\n${kept}` : '',
        priorLetters ? `PREVIOUS LETTERS — do not repeat these\n${priorLetters}` : '',
        alreadyOffered ? `ALREADY OFFERED — never recommend these again\n${alreadyOffered}` : '',
    ].filter(Boolean).join('\n\n');

    // The letter is the only prompt in here that returns long prose, so it is the
    // only one that ran into a token ceiling — 2048 truncated it mid-JSON, and
    // tryParseJSON throws rather than returning null, so the whole letter was
    // lost to "Could not parse JSON".
    const text = await callGemini(LETTER_PROMPT, userText, { json: true, temperature: 0.8 });

    // Prose does not deserve to be lost to a missing brace. If the envelope
    // fails to parse, salvage the letter itself and carry on without the
    // metadata — a letter with no footer still reads.
    let parsed = {};
    try {
        parsed = tryParseJSON(text) || {};
    } catch {
        const salvaged = text.match(/"body"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        parsed = salvaged
            ? { body: salvaged[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') }
            : { body: text.replace(/```(?:json)?/gi, '').replace(/^\s*\{[\s\S]*?"body"\s*:\s*"/, '').trim() };
        console.warn('Letter JSON was malformed; salvaged the body.');
    }

    const body = (parsed.body || '').trim();
    if (!body) throw new Error('The letter came back empty. Try again.');

    const payload = {
        profile: target,
        period_start: since.toISOString(),
        period_end: new Date().toISOString(),
        body,
        envelope: (parsed.envelope || '').trim() || null,
        question_revisited: (parsed.question_revisited || '').trim() || null,
        reading: (parsed.reading || '').trim() || null,
        note_ids: week.map(n => n.id),
        note_count: week.length,
        created_at: new Date().toISOString(),
        read_at: null,
    };
    const ref = await addDoc(collection(db, 'letters'), payload);
    return { skipped: false, letter: { id: ref.id, ...payload } };
}

// ============================================================================
// DISCOVER API
// ============================================================================

export async function generateDiscoverAPI(profile, specificType = null) {
    if (profile === 'combined') return 0;
    const notesQ = query(collection(db, "notes"), where("profile", "==", profile));
    const notesSnap = await getDocs(notesQ);
    // Exclude discover notes so they don't loop back into card generation input using robust checker
    const docs = notesSnap.docs.map(d => d.data()).filter(n => !isDiscoverNote(n));
    docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // A wider window than "the last thing you wrote", and a few older notes so a
    // batch can reach back into the notebook rather than orbiting this week.
    const fmtNote = (d) => `- "${noteTitle(d)}" (${new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}): `
        + (d.summary || stripDerived(d.raw_text).replace(/\s+/g, ' ').slice(0, 600));
    const recentNotes = docs.slice(0, 14).map(fmtNote).join('\n');
    const olderPool = docs.slice(14);
    const olderNotes = olderPool
        .filter((_, i) => i % Math.max(1, Math.ceil(olderPool.length / 8)) === 0)
        .slice(0, 8).map(fmtNote).join('\n');

    // The profile this app has been quietly building all along
    const [profileBlock, concepts, seenCards] = await Promise.all([
        getProfileBlockAPI(profile).catch(() => ''),
        getConceptsAPI(profile).catch(() => []),
        getDocs(query(collection(db, 'cards'), where('profile', '==', profile))).catch(() => ({ docs: [] })),
    ]);

    const conceptLine = concepts.slice(0, 24)
        .map(c => `${c.name} (${(c.note_ids || []).length})`).join(', ');

    // Taste, as revealed by what they actually did with the last batches.
    const allCards = seenCards.docs.map(d => d.data());
    const oneLine = (c) => `- [${c.card_type || 'card'}] ${(c.content || '').replace(/\s+/g, ' ').slice(0, 120)}${c.source ? ` — ${c.source}` : ''}`;
    const byStatus = (st, n) => allCards
        .filter(c => c.status === st)
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, n).map(oneLine).join('\n');
    const kept = byStatus('accepted', 14);
    const passed = byStatus('dismissed', 14);
    const alreadyShown = allCards
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 50).map(c => `- ${(c.content || '').replace(/\s+/g, ' ').slice(0, 90)}`).join('\n');

    const prompt = [
        profileBlock,
        conceptLine ? `CONCEPTS THEY KEEP RETURNING TO\n${conceptLine}` : '',
        recentNotes ? `RECENT NOTES\n${recentNotes}` : '',
        olderNotes ? `FURTHER BACK IN THE NOTEBOOK\n${olderNotes}` : '',
        kept ? `CARDS THEY KEPT — this is what lands\n${kept}` : '',
        passed ? `CARDS THEY PASSED ON — do not send more like these\n${passed}` : '',
        alreadyShown ? `ALREADY SHOWN — do not repeat these\n${alreadyShown}` : '',
    ].filter(Boolean).join('\n\n');

    let systemPrompt = CARD_GEN_PROMPT;
    if (specificType && specificType !== 'all' && specificType !== 'stored') {
        systemPrompt = CARD_GEN_PROMPT
            + `\n\nOVERRIDE FOR THIS BATCH: every card must be of type "${specificType}". Return 5-6 of them, all distinct. Ignore the mix described above.`;
    }

    // Nothing about a card is worth showing twice, and the model occasionally
    // rephrases something it has already sent. Compare on a flattened key.
    const key = (t) => (t || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
    const seenKeys = new Set(allCards.map(c => key(c.content)));

    let written = 0;
    try {
        const text = await callGemini(systemPrompt, prompt, { json: true, temperature: 0.85 });
        const cards = tryParseJSON(text);
        if (Array.isArray(cards)) {
            for (const c of cards.slice(0, 8)) {
                const content = (c.content || '').trim();
                if (!content) continue;
                const k = key(content);
                if (seenKeys.has(k)) continue;
                seenKeys.add(k);
                await addDoc(collection(db, "cards"), {
                    profile,
                    card_type: c.card_type || specificType || 'observation',
                    content,
                    source: c.source || null,
                    why: (c.why || '').trim() || null,
                    status: 'unseen',
                    created_at: new Date().toISOString()
                });
                written++;
            }
        }
    } catch (e) {
        console.error("Card generation failed", e);
        throw e;
    }
    return written;
}

export async function getDiscoverCardsAPI(profile) {
    const q = query(collection(db, "cards"), where("profile", "==", profile), where("status", "==", "unseen"));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function getAcceptedDiscoverCardsAPI(profile) {
    const q = query(collection(db, "cards"), where("profile", "==", profile), where("status", "==", "accepted"));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function findNoteByDiscoverCardIdAPI(cardId, cardContent) {
    // 1. Try finding by discover_card_id field
    let q = query(collection(db, "notes"), where("discover_card_id", "==", cardId));
    let snap = await getDocs(q);
    if (!snap.empty) {
        return snap.docs[0].id;
    }

    // 2. Fallback: search for notes with tag 'discover' and content matching the card text
    if (cardContent) {
        const q2 = query(collection(db, "notes"), where("tags", "array-contains", "discover"));
        const snap2 = await getDocs(q2);
        for (const doc of snap2.docs) {
            const data = doc.data();
            if (data.raw_text && data.raw_text.includes(cardContent.trim())) {
                return doc.id;
            }
        }
    }
    return null;
}

export async function updateDiscoverCardAPI(id, status) {
    await updateDoc(doc(db, "cards", id), { status });
}

export async function countUnseenCardsAPI(profile) {
    const q = query(collection(db, "cards"), where("profile", "==", profile), where("status", "==", "unseen"));
    const snap = await getDocs(q);
    return snap.size;
}

// ============================================================================
// IMAGE UPLOAD — Base64 stored inline in Firestore (serverless, no Storage)
// ============================================================================

/**
 * Compress an image File using a canvas element.
 * Returns a Base64 data URL string.
 * @param {File} file
 * @param {number} maxDim - max width or height in pixels (default 900)
 * @param {number} quality - JPEG quality 0–1 (default 0.78)
 */
async function compressImage(file, maxDim = 900, quality = 0.78) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let { width, height } = img;
                const scale = Math.min(1, maxDim / Math.max(width, height));
                canvas.width = Math.round(width * scale);
                canvas.height = Math.round(height * scale);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Upload (compress + store) an image into a Firestore note's images array.
 * @param {string} noteId
 * @param {File} file
 */
export async function uploadImageAPI(noteId, file) {
    try {
        // Validate type
        if (!file.type.startsWith('image/')) {
            return { error: 'Only image files are supported.' };
        }

        // Compress the image client-side
        const dataUrl = await compressImage(file);

        // Rough byte estimate: base64 is ~4/3 of original bytes
        const estimatedBytes = (dataUrl.length * 3) / 4;
        if (estimatedBytes > 800_000) {
            return { error: 'Image is too large even after compression. Please use a smaller image.' };
        }

        const entry = {
            filename: `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
            url: dataUrl,
            type: 'image/jpeg',
            created_at: new Date().toISOString(),
        };

        await updateDoc(doc(db, 'notes', noteId), {
            images: arrayUnion(entry),
        });

        return { ok: true, entry };
    } catch (e) {
        console.error('uploadImageAPI failed:', e);
        return { error: e.message };
    }
}

/**
 * Delete an image from a Firestore note's images array by filename.
 * @param {string} noteId
 * @param {string} filename
 */
export async function deleteImageAPI(noteId, filename) {
    try {
        const snap = await getDoc(doc(db, 'notes', noteId));
        if (!snap.exists()) return;
        const images = snap.data().images || [];
        const updated = images.filter(img => img.filename !== filename);
        await updateDoc(doc(db, 'notes', noteId), { images: updated });
    } catch (e) {
        console.error('deleteImageAPI failed:', e);
    }
}

// ============================================================================
// CLUSTERS API
// ============================================================================

// These point at the stylesheet's palette rather than carrying their own hexes,
// so there is one source of truth for the set and clusters follow the theme.
// The ids are unchanged, so existing clusters keep their colour.
export const CLUSTER_COLORS = [
    { id: 'amber',  hex: 'var(--c-2)', glow: 'var(--c-2)' },
    { id: 'rose',   hex: 'var(--c-1)', glow: 'var(--c-1)' },
    { id: 'violet', hex: 'var(--c-4)', glow: 'var(--c-4)' },
    { id: 'teal',   hex: 'var(--c-3)', glow: 'var(--c-3)' },
    { id: 'sky',    hex: 'var(--c-5)', glow: 'var(--c-5)' },
    { id: 'lime',   hex: 'var(--c-6)', glow: 'var(--c-6)' },
];

export async function getClustersAPI(profile) {
    const q = query(collection(db, 'clusters'), where('profile', '==', profile));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return docs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export async function createClusterAPI(name, profile, colorId = 'violet', emoji = '📁') {
    const ref = await addDoc(collection(db, 'clusters'), {
        name,
        profile,
        color: colorId,
        emoji,
        created_at: new Date().toISOString(),
    });
    return { id: ref.id, name, profile, color: colorId, emoji };
}

export async function deleteClusterAPI(clusterId) {
    // Unassign all notes from this cluster first
    const q = query(collection(db, 'notes'), where('cluster_id', '==', clusterId));
    const snap = await getDocs(q);
    const unassigns = snap.docs.map(d => updateDoc(doc(db, 'notes', d.id), { cluster_id: null }));
    await Promise.all(unassigns);
    await deleteDoc(doc(db, 'clusters', clusterId));
}

export async function updateClusterAPI(clusterId, updates) {
    await updateDoc(doc(db, 'clusters', clusterId), updates);
}

export async function assignNoteToClusterAPI(noteId, clusterId) {
    await updateDoc(doc(db, 'notes', noteId), { cluster_id: clusterId || null });
}

// ============================================================================
// SYNTHESIS — reading across notes instead of generating more of them
// ============================================================================

/**
 * `compact` sends each note's own summary in place of 900 characters of raw
 * text. Most notes here are a line or two and already have one, so a whole
 * notebook costs about what sixty raw notes used to — which is what lets
 * "Everything" mean everything.
 */
function formatNotesForSynthesis(notes, { compact = false } = {}) {
    const budget = compact ? 260 : 900;
    return notes
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map((n, i) => {
            const when = new Date(n.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const raw = stripDerived(n.raw_text);
            if (compact) {
                // The summary if there is one, the note itself if it is short
                // enough to be its own summary, otherwise a trimmed opening.
                const body = (raw.length <= budget ? raw : (n.summary || raw.slice(0, budget) + '…')).replace(/\s+/g, ' ');
                return `[${i + 1} · ${when}] ${noteTitle(n)}\n${body}`;
            }
            return `[${i + 1} · ${when}] ${noteTitle(n)}\n${raw.slice(0, budget)}${n.summary ? `\n(summary: ${n.summary})` : ''}`;
        })
        .join(compact ? '\n\n' : '\n\n---\n\n');
}

/**
 * Persist a synthesis so it becomes a thing you can return to, rather than a
 * modal that evaporates. Keyed by scope so re-running replaces cleanly.
 */
/**
 * A synthesis is a piece of writing about a stretch of the notebook, not a
 * cached value. Re-running used to overwrite the previous one in place, so the
 * only copy of what the notebook said in July vanished the moment you asked
 * again in September. Each run is now its own record, and the ones before it
 * stay readable.
 */
async function saveSynthesis(profile, scope, scopeId, label, result, noteIds) {
    const payload = {
        profile, scope, scope_id: scopeId, label,
        ...result,
        note_ids: noteIds,
        note_count: noteIds.length,
        created_at: new Date().toISOString(),
    };
    const ref = await addDoc(collection(db, 'syntheses'), payload);
    return { id: ref.id, ...payload };
}

/** Every run for a scope, newest first. */
export async function getSynthesisHistoryAPI(scope, scopeId) {
    const snap = await getDocs(query(
        collection(db, 'syntheses'),
        where('scope', '==', scope),
        where('scope_id', '==', scopeId),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function getSynthesesAPI(profile) {
    const profiles = profile === 'combined' ? ['prineeth', 'pramoddini'] : [profile];
    const q = query(collection(db, 'syntheses'), where('profile', 'in', profiles));
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function getSynthesisAPI(scope, scopeId) {
    const all = await getSynthesisHistoryAPI(scope, scopeId);
    return all[0] || null;
}

export async function deleteSynthesisAPI(id) {
    await deleteDoc(doc(db, 'syntheses', id));
}

export async function synthesizeClusterAPI(clusterId) {
    const clusterSnap = await getDoc(doc(db, 'clusters', clusterId));
    if (!clusterSnap.exists()) throw new Error('Cluster not found');
    const cluster = { id: clusterSnap.id, ...clusterSnap.data() };

    const snap = await getDocs(query(collection(db, 'notes'), where('cluster_id', '==', clusterId)));
    const notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!notes.length) throw new Error('No notes in this cluster');

    const profileBlock = await getProfileBlockAPI(cluster.profile).catch(() => '');
    const userText = `${profileBlock ? profileBlock + '\n\n' : ''}Collection: "${cluster.name}"\n\nNotes (${notes.length} total):\n\n${formatNotesForSynthesis(notes)}`;
    const text = await callGemini(CLUSTER_SYNTHESIS_PROMPT, userText, { json: true, temperature: 0.7 });
    const result = tryParseJSON(text);

    return saveSynthesis(cluster.profile, 'cluster', clusterId, cluster.name, result, notes.map(n => n.id));
}

/** Synthesise every note filed under one concept — the payoff of the concept layer. */
export async function synthesizeConceptAPI(conceptId) {
    const snap = await getDoc(doc(db, 'concepts', conceptId));
    if (!snap.exists()) throw new Error('Concept not found');
    const concept = { id: snap.id, ...snap.data() };

    const notes = (await Promise.all(
        (concept.note_ids || []).map(id => getNoteByIdAPI(id))
    )).filter(Boolean);
    if (notes.length < 2) throw new Error('Need at least 2 notes under this concept to synthesise');

    const profileBlock = await getProfileBlockAPI(concept.profile).catch(() => '');
    const userText = `${profileBlock ? profileBlock + '\n\n' : ''}Concept: "${concept.name}"\n\nEvery note filed under it (${notes.length}), oldest first:\n\n${formatNotesForSynthesis(notes)}`;
    const text = await callGemini(CLUSTER_SYNTHESIS_PROMPT, userText, { json: true, temperature: 0.7 });
    const result = tryParseJSON(text);

    return saveSynthesis(concept.profile, 'concept', conceptId, concept.name, result, notes.map(n => n.id));
}

const PERIOD_SYNTHESIS_PROMPT = `You are reading back a stretch of someone's notebook to them. You have every note they captured in this period, oldest first.

This is not a summary and not a list. It is the thing a good friend says after listening for a month: what you actually seem to be working on, what changed, what you keep avoiding.

Return a single valid JSON object:
{
  "narrative": "3-5 sentences, addressed directly to them, naming what this period was really about. Be specific — reference actual notes. Notice movement: what they arrived at, changed their mind about, or kept returning to without resolving.",
  "synthesis_title": "An evocative 3-6 word title for this stretch of thinking",
  "themes": ["3-5 threads that ran through the period"],
  "tensions": ["1-3 genuine contradictions or unresolved questions visible across the notes"],
  "questions": ["3-4 questions worth carrying into the next stretch"],
  "throughline": "One sentence: if this period had a single argument, what was it?"
}

Do not flatter. Do not say the notes are "rich" or "fascinating". If the period was scattered and nothing cohered, say that plainly — that is useful information too.
Return ONLY JSON.`;

/**
 * The periodic read-back: what have I actually been thinking about lately.
 * `days` of 0 means everything.
 */
export async function synthesizePeriodAPI(profile, days = 30, label = null) {
    const all = (await getNotesAPI(profile)).filter(n => !isDiscoverNote(n));
    const cutoff = days ? Date.now() - days * 86400000 : 0;
    const notes = all.filter(n => new Date(n.created_at).getTime() >= cutoff);
    if (notes.length < 3) throw new Error(`Only ${notes.length} notes in this period — need at least 3.`);

    // A button that says Everything used to read the most recent 60 of 236 and
    // call it done. Past a threshold the notes go in compact, which costs about
    // a quarter as much each, so the ceiling stops being reached in practice.
    const COMPACT_ABOVE = 70;
    const HARD_CAP = 400;
    const compact = notes.length > COMPACT_ABOVE;
    const capped = notes.slice(0, HARD_CAP);
    const profileBlock = await getProfileBlockAPI(profile).catch(() => '');
    const periodLabel = label || (days ? `Last ${days} days` : 'Everything');

    const coverage = notes.length > capped.length
        ? `${capped.length} of ${notes.length}, most recent`
        : `all ${capped.length}`;
    const userText = `${profileBlock ? profileBlock + '\n\n' : ''}Period: ${periodLabel}\nNotes captured (${coverage}), oldest first:\n\n${formatNotesForSynthesis(capped, { compact })}`;
    const text = await callGemini(PERIOD_SYNTHESIS_PROMPT, userText, { json: true, temperature: 0.7, maxTokens: 4096 });
    const result = tryParseJSON(text);

    const scopeId = `${profile}:${days}`;
    return saveSynthesis(profile, 'period', scopeId, periodLabel, result, capped.map(n => n.id));
}

const CLUSTER_SUGGEST_PROMPT = `You are proposing collections for a personal notebook whose notes are mostly unfiled.

You are given unfiled notes with their ids, titles and concepts. Propose 3-6 collections that would genuinely help this person navigate their own thinking.

A good collection:
- Holds at least 4 notes that truly belong together
- Has a name that names the actual preoccupation, not the category. "The Cost of Legibility" beats "Design Notes".
- Would still make sense to them in six months

Do NOT propose a collection just to place every note. Leaving notes unfiled is fine and expected. Do not propose collections that merely restate a concept name.

Return JSON: [{"name": "Collection Name", "emoji": "🜂", "rationale": "one sentence on what unites these", "note_ids": ["id1", "id2"]}]
Use a single emoji that fits the theme. Only return JSON.`;

/**
 * Propose collections instead of asking someone to hand-file 232 fragments.
 */
export async function suggestClustersAPI(profile) {
    const all = (await getNotesAPI(profile)).filter(n => !isDiscoverNote(n) && !n.cluster_id);
    if (all.length < 8) throw new Error('Not enough unfiled notes to suggest collections yet.');

    // Prefer notes that already carry concepts — they cluster more meaningfully
    const pool = [...all].sort((a, b) => (b.concepts?.length || 0) - (a.concepts?.length || 0)).slice(0, 120);
    const listing = pool.map(n => ({
        id: n.id,
        title: noteTitle(n),
        concepts: n.concepts || [],
        summary: (n.summary || stripDerived(n.raw_text)).slice(0, 130),
    }));

    const text = await callGemini(CLUSTER_SUGGEST_PROMPT, JSON.stringify(listing, null, 1), { json: true, temperature: 0.5, maxTokens: 4096 });
    const parsed = tryParseJSON(text);
    if (!Array.isArray(parsed)) return [];

    const valid = new Set(pool.map(n => n.id));
    return parsed
        .map(s => ({
            name: s.name,
            emoji: s.emoji || '📁',
            rationale: s.rationale || '',
            note_ids: (s.note_ids || []).filter(id => valid.has(id)),
        }))
        .filter(s => s.name && s.note_ids.length >= 3);
}

/** Accept a proposed collection: create it and file its notes in one go. */
export async function acceptSuggestedClusterAPI(suggestion, profile) {
    const colorId = CLUSTER_COLORS[Math.floor(Math.random() * CLUSTER_COLORS.length)].id;
    const cluster = await createClusterAPI(suggestion.name, profile, colorId, suggestion.emoji || '📁');
    for (const noteId of suggestion.note_ids) {
        await updateDoc(doc(db, 'notes', noteId), { cluster_id: cluster.id });
    }
    return { ...cluster, count: suggestion.note_ids.length };
}

// ============================================================================
// GOOGLE INTEGRATION
// ============================================================================

const GOOGLE_PARSING_PROMPT = `You are a helper that extracts structured data for Google Tasks and Google Calendar from natural language note commands.
Given the command type and user text, analyze the input relative to the current reference date/time.
The current reference date/time is: {CURRENT_TIME} (timezone offset: {OFFSET}).

You must output a single JSON object.

If the command type is "calendar" or "remind" or "task":
Determine:
- "title": The main subject of the event or task (concise, clear, e.g. "Buy milk", "Meeting with Prineeth").
- "description": Any additional notes, instructions or description text.
- "due_date": For Google Tasks, the target due date/time as an RFC 3339 timestamp (e.g. "2026-06-25T17:00:00Z" or "2026-06-25T17:00:00+05:30"). If no time is specified, only include the date at UTC midnight. If no date is specified, use null.
- "start_time": For Google Calendar, the start date/time as an ISO 8601 offset string (e.g. "2026-06-25T17:00:00+05:30"). If no time is specified, default to tomorrow at 9 AM.
- "end_time": For Google Calendar, the end date/time as an ISO 8601 offset string. If not specified, default to 1 hour after start_time.
- "type": "task" or "calendar". Decide which one fits best. A "calendar" event is suited for specific times of day, duration-based events, meetings, appointments, or time-locked schedules. A "task" is suited for general todo list items, things to do on a day without a precise time, or simple chores.

If the command type is "doc":
Determine:
- "title": The title of the document. If user input contains multiple lines, the first line is the title. If only one line, use it as the title.
- "content": The body content of the document. If user input contains multiple lines, everything after the first line is the content. If only one line, content is empty.

Return ONLY a JSON object. No other text.`;

export async function parseGoogleCommandAPI(command, text) {
    const now = new Date();
    const currentTimeStr = now.toString();
    const offsetMinutes = -now.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMinsRemaining = Math.abs(offsetMinutes) % 60;
    const offsetSign = offsetMinutes >= 0 ? '+' : '-';
    const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinsRemaining).padStart(2, '0')}`;

    const prompt = GOOGLE_PARSING_PROMPT
        .replace('{CURRENT_TIME}', currentTimeStr)
        .replace('{OFFSET}', offsetStr);

    const userText = `Command: ${command}\nInput Text:\n"""\n${text}\n"""`;

    const response = await callGemini(prompt, userText, { json: true, temperature: 0.2 });
    return tryParseJSON(response);
}

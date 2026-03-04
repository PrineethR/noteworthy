// ============================================================
// Noteworthy — Server (Memory + Discover Edition)
// PIN auth + Supabase + Gemini + Memory + Discover Cards
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Config ───────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const PIN_CODE = process.env.PIN_CODE;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Supabase Client ──────────────────────────────────────────
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Middleware ──────────────────────────────────────────
function requireAuth(req, res, next) {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || token !== PIN_CODE) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ─── Gemini Helpers ───────────────────────────────────────────
async function callGemini(systemPrompt, userText, opts = {}) {
    const response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: opts.contents || [{ parts: [{ text: userText }] }],
            generationConfig: {
                temperature: opts.temperature ?? 0.3,
                maxOutputTokens: opts.maxTokens ?? 1024,
                ...(opts.json ? { responseMimeType: 'application/json' } : {}),
                thinkingConfig: { thinkingBudget: 0 },
            },
        }),
    });
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini ${response.status}: ${err.slice(0, 200)}`);
    }
    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
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

// ─── Prompts ──────────────────────────────────────────────────
const NOTE_PROMPT = `You are a thoughtful note-analysis assistant. Given raw, unstructured text (often voice-dictated), analyze it deeply and return a single valid JSON object with these keys:

{
  "summary": "A concise 1-2 sentence summary.",
  "tags": ["tag1", "tag2", "tag3"],
  "category": "One of: idea, task, meeting-note, journal, reference, brainstorm, feedback, other",
  "sentiment": "One of: positive, negative, neutral, mixed",
  "insights": {
    "themes": ["theme1", "theme2"],
    "references": ["Concept or framework referenced or related to this note"],
    "books": ["Book Title by Author — why it's relevant"],
    "follow_ups": ["A thoughtful follow-up question to deepen thinking"]
  }
}

Rules:
- Return ONLY the JSON object, no markdown, no code fences.
- Tags: lowercase, hyphenated, 2-5 tags.
- themes: 2-3 high-level themes or domains.
- references: 1-3 relevant concepts, mental models, frameworks.
- books: 1-3 real book recommendations. Format: "Title by Author — reason".
- follow_ups: 2-3 follow-up questions.`;

const MEMORY_EXTRACT_PROMPT = `You analyze notes to extract signals about the person who wrote them. Given a note and the person's existing memory profile, identify new signals about their interests, values, traits, ambitions, or lines of inquiry.

Return a JSON array of signals. Each signal:
{
  "type": "interest" | "value" | "trait" | "ambition" | "inquiry",
  "content": "A concise description of the signal",
  "strength": 0.3 to 0.8
}

Rules:
- Return ONLY a JSON array, no markdown.
- Only extract genuine signals, not generic observations.
- Skip if the note is too short or mundane to reveal anything.
- Return an empty array [] if no meaningful signals are found.
- Be specific. Not "likes technology" but "drawn to the intersection of design and cognitive science".
- 1-3 signals maximum per note.`;

const CARD_GEN_PROMPT = `You generate "Discover" cards for a note-taking app. Based on the user's memory profile (their interests, values, ambitions), create cards that surface interesting things they might resonate with.

Card types:
- "quote": A real, attributed quote from a thinker, writer, designer, or scientist that connects to their interests.
- "question": A thought-provoking question that deepens a thread they've been exploring.
- "recommendation": A specific book, article, talk, or concept they should explore.
- "observation": A pattern or connection you notice across their thinking.
- "excerpt": A brief passage from a real book or essay they'd find compelling.

Return a JSON array of 3-5 cards:
{
  "card_type": "quote" | "question" | "recommendation" | "observation" | "excerpt",
  "content": "The main card text. For quotes, include the quote itself.",
  "source": "Attribution — author, book, year. Or 'Based on your notes about X'."
}

Rules:
- Return ONLY a JSON array, no markdown.
- Quotes and excerpts MUST be from real people/books. Do not fabricate attributions.
- Questions should be genuinely interesting, not generic self-help.
- Recommendations should be specific — a particular book, a specific TED talk, a named concept.
- Vary the card types. Don't give 5 quotes. Mix it up.
- Make each card something worth pausing on.`;

const CHAT_SYSTEM_PROMPT = `You are a helpful, thoughtful assistant embedded in a note-taking app called Noteworthy. The user is discussing one of their captured notes with you. Be concise but insightful. Keep responses under 200 words unless asked for more. Be warm and conversational.`;

// ─── Note Processing ──────────────────────────────────────────
async function processWithGemini(noteId, rawText, profile) {
    await sb.from('raw_notes').update({ status: 'processing' }).eq('id', noteId);

    try {
        const text = await callGemini(NOTE_PROMPT, rawText, { json: true });
        const parsed = tryParseJSON(text);

        const updatePayload = {
            summary: parsed.summary ?? null,
            tags: parsed.tags ?? [],
            category: parsed.category ?? null,
            sentiment: parsed.sentiment ?? null,
            status: 'processed',
            processed_at: new Date().toISOString(),
        };
        if (parsed.insights) updatePayload.insights = parsed.insights;

        const { error } = await sb.from('raw_notes').update(updatePayload).eq('id', noteId);
        if (error && String(error.message).includes('insights')) {
            delete updatePayload.insights;
            await sb.from('raw_notes').update(updatePayload).eq('id', noteId);
        }

        console.log(`[✓] Processed note ${noteId}`);

        // Fire-and-forget memory extraction
        if (profile) extractMemorySignals(noteId, rawText, profile).catch(() => { });
    } catch (err) {
        console.error(`[✗] Failed note ${noteId}:`, err.message);
        await sb.from('raw_notes').update({ status: 'error' }).eq('id', noteId);
    }
}

// ─── Memory Extraction ───────────────────────────────────────
async function extractMemorySignals(noteId, rawText, profile) {
    try {
        // Get existing memories for context
        const { data: memories } = await sb
            .from('user_memory')
            .select('type, content, confidence')
            .eq('profile', profile)
            .order('confidence', { ascending: false })
            .limit(20);

        const existingProfile = memories?.length
            ? `Existing profile:\n${memories.map(m => `- [${m.type}] ${m.content} (confidence: ${m.confidence})`).join('\n')}`
            : 'No existing profile yet.';

        const prompt = `${existingProfile}\n\nNew note:\n"""\n${rawText}\n"""`;
        const text = await callGemini(MEMORY_EXTRACT_PROMPT, prompt, { json: true, temperature: 0.4 });

        let signals;
        try { signals = tryParseJSON(text); } catch { return; }
        if (!Array.isArray(signals) || !signals.length) return;

        for (const signal of signals) {
            if (!signal.type || !signal.content) continue;

            // Check for similar existing memory
            const existing = memories?.find(m =>
                m.type === signal.type &&
                m.content.toLowerCase().includes(signal.content.toLowerCase().slice(0, 20))
            );

            if (existing) {
                // Boost confidence of existing memory
                const newConf = Math.min(1, (existing.confidence || 0.5) + 0.1);
                await sb.from('user_memory')
                    .update({ confidence: newConf })
                    .eq('profile', profile)
                    .eq('type', existing.type)
                    .ilike('content', `%${signal.content.slice(0, 20)}%`);
            } else {
                await sb.from('user_memory').insert({
                    id: uuidv4(),
                    profile,
                    type: signal.type,
                    content: signal.content,
                    confidence: signal.strength ?? 0.5,
                    evidence: [noteId],
                });
            }
        }

        console.log(`[🧠] Extracted ${signals.length} memory signal(s) for ${profile}`);
    } catch (err) {
        console.error(`[🧠✗] Memory extraction failed:`, err.message);
    }
}

// ─── Card Generation ─────────────────────────────────────────
async function bootstrapMemoryForProfile(profile) {
    console.log(`[🧠] Bootstrapping memory for ${profile}…`);
    const { data: notes } = await sb
        .from('raw_notes')
        .select('id, raw_text, profile')
        .eq('profile', profile)
        .eq('status', 'processed')
        .order('created_at', { ascending: false })
        .limit(20);

    if (!notes?.length) { console.log(`[🧠] No processed notes for ${profile}`); return; }

    for (const note of notes) {
        await extractMemorySignals(note.id, note.raw_text, profile);
        await new Promise(r => setTimeout(r, 500)); // rate-limit
    }
    console.log(`[🧠] Bootstrap done for ${profile}`);
}

async function generateCardsForProfile(profile) {
    try {
        // Get memory profile
        const { data: memories } = await sb
            .from('user_memory')
            .select('*')
            .eq('profile', profile)
            .order('confidence', { ascending: false })
            .limit(30);

        // If no memories yet, get recent notes to use as direct context
        let profileContext = '';
        if (!memories?.length) {
            console.log(`[✨] No memories yet for ${profile} — using notes directly`);
            const { data: fallbackNotes } = await sb
                .from('raw_notes')
                .select('raw_text, tags, summary')
                .eq('profile', profile)
                .eq('status', 'processed')
                .order('created_at', { ascending: false })
                .limit(10);
            if (!fallbackNotes?.length) { console.log(`[✨] No notes for ${profile} — skipping`); return; }
            profileContext = `Recent notes by this person:\n${fallbackNotes.map(n => `- ${n.raw_text.slice(0, 120)}`).join('\n')}`;
        } else {
            profileContext = `User memory profile:\n${memories.map(m => `[${m.type}] ${m.content} (confidence: ${m.confidence.toFixed(2)})`).join('\n')}`;
        }

        // Get recent notes for freshness
        const { data: recentNotes } = await sb
            .from('raw_notes')
            .select('raw_text, tags, category')
            .eq('profile', profile)
            .eq('status', 'processed')
            .order('created_at', { ascending: false })
            .limit(5);

        // Get recent accepted/dismissed for feedback
        const { data: recentCards } = await sb
            .from('memory_cards')
            .select('card_type, content, status')
            .eq('profile', profile)
            .in('status', ['accepted', 'dismissed'])
            .order('created_at', { ascending: false })
            .limit(10);

        const notesContext = recentNotes?.map(n =>
            `- ${n.raw_text.slice(0, 100)}... [${(n.tags || []).join(', ')}]`
        ).join('\n') || 'No recent notes.';

        const feedbackContext = recentCards?.length
            ? `Recent card feedback:\n${recentCards.map(c => `- ${c.status.toUpperCase()}: [${c.card_type}] ${c.content.slice(0, 60)}…`).join('\n')}`
            : '';

        const prompt = `${profileContext}\n\nRecent notes:\n${notesContext}\n\n${feedbackContext}\n\nGenerate 3-5 discovery cards. Avoid repeating dismissed topics. Lean into accepted themes.`;

        const text = await callGemini(CARD_GEN_PROMPT, prompt, { json: true, temperature: 0.7 });
        let cards;
        try { cards = tryParseJSON(text); } catch { return; }
        if (!Array.isArray(cards)) {
            // Might be wrapped in an object
            if (cards && Array.isArray(cards.cards)) cards = cards.cards;
            else return;
        }

        let inserted = 0;
        for (const card of cards) {
            if (!card.card_type || !card.content) continue;
            const { error } = await sb.from('memory_cards').insert({
                id: uuidv4(),
                profile,
                card_type: card.card_type,
                content: card.content,
                source: card.source || null,
                metadata: card.metadata || {},
                status: 'unseen',
            });
            if (!error) inserted++;
        }

        console.log(`[✨] Generated ${inserted} card(s) for ${profile}`);
    } catch (err) {
        console.error(`[✨✗] Card generation failed for ${profile}:`, err.message);
    }
}

async function generateAllCards() {
    console.log('[⏰] Hourly card generation starting…');
    await generateCardsForProfile('prineeth');
    await generateCardsForProfile('pramoddini');
}

// ─── API Routes ───────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth', (req, res) => {
    const { pin } = req.body;
    if (pin && pin === PIN_CODE) res.json({ ok: true });
    else res.status(401).json({ error: 'Wrong PIN' });
});

// ── Notes ────
app.post('/api/notes', requireAuth, async (req, res) => {
    const { raw_text, profile } = req.body;
    if (!raw_text?.trim()) return res.status(400).json({ error: 'raw_text is required' });
    if (!['prineeth', 'pramoddini'].includes(profile))
        return res.status(400).json({ error: 'profile must be prineeth or pramoddini' });

    const note = { id: uuidv4(), profile, raw_text: raw_text.trim(), status: 'pending' };
    const { error } = await sb.from('raw_notes').insert(note);
    if (error) return res.status(500).json({ error: error.message });

    console.log(`[+] ${profile}: ${raw_text.length} chars`);
    res.status(201).json({ success: true, id: note.id });
    if (GEMINI_API_KEY) processWithGemini(note.id, raw_text.trim(), profile);
});

app.get('/api/notes', requireAuth, async (req, res) => {
    const { profile } = req.query;
    let query = sb.from('raw_notes').select('*')
        .order('created_at', { ascending: false }).limit(100);
    if (profile && profile !== 'combined') query = query.eq('profile', profile);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/notes/:id/reprocess', requireAuth, async (req, res) => {
    const { data: note, error } = await sb.from('raw_notes')
        .select('raw_text, profile').eq('id', req.params.id).single();
    if (error || !note) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
    processWithGemini(req.params.id, note.raw_text, note.profile);
});

// ── Chat (persistent) ─────
app.post('/api/chat', requireAuth, async (req, res) => {
    const { noteId, chatId, message, history } = req.body;
    if (!noteId || !message?.trim()) return res.status(400).json({ error: 'noteId and message required' });

    const { data: note, error } = await sb.from('raw_notes').select('*').eq('id', noteId).single();
    if (error || !note) return res.status(404).json({ error: 'Note not found' });

    const noteContext = `Note:\n"""\n${note.raw_text}\n"""\n${note.summary ? `Summary: ${note.summary}` : ''}\n${note.tags?.length ? `Tags: ${note.tags.join(', ')}` : ''}`;
    const contents = [
        { role: 'user', parts: [{ text: noteContext }] },
        { role: 'model', parts: [{ text: "I've read the note. How can I help?" }] },
    ];
    if (Array.isArray(history)) {
        for (const m of history) contents.push({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] });
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    try {
        const reply = await callGemini(CHAT_SYSTEM_PROMPT, '', { contents, temperature: 0.7 });
        res.json({ reply });

        // Auto-save chat to DB (fire and forget)
        const newMessages = [...(history || []), { role: 'user', text: message }, { role: 'model', text: reply }];
        if (chatId) {
            await sb.from('chats').update({ messages: newMessages }).eq('id', chatId);
        } else {
            // Create new chat
            const newChatId = uuidv4();
            const title = message.length > 50 ? message.slice(0, 50) + '…' : message;
            await sb.from('chats').insert({
                id: newChatId, profile: note.profile, note_id: noteId,
                title, messages: newMessages,
            });
            // Generate a better title in background
            generateChatTitle(newChatId, message, reply).catch(() => { });
        }
    } catch (err) {
        console.error('[Chat Error]', err.message);
        res.status(500).json({ error: 'Chat failed' });
    }
});

async function generateChatTitle(chatId, firstMessage, firstReply) {
    try {
        const title = await callGemini(
            'Generate a short, descriptive title (3-6 words max) for a conversation that starts with this exchange. Return ONLY the title text, nothing else.',
            `User: ${firstMessage}\nAssistant: ${firstReply}`,
            { temperature: 0.3 }
        );
        const cleaned = title.replace(/["']/g, '').trim().slice(0, 60);
        if (cleaned) await sb.from('chats').update({ title: cleaned }).eq('id', chatId);
    } catch { }
}

// ── Chat CRUD ─────
app.get('/api/chats', requireAuth, async (req, res) => {
    const { profile, noteId } = req.query;
    if (!profile) return res.status(400).json({ error: 'profile required' });

    let query = sb.from('chats').select('id, profile, note_id, title, created_at, updated_at')
        .eq('profile', profile).order('updated_at', { ascending: false }).limit(50);
    if (noteId) query = query.eq('note_id', noteId);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

app.get('/api/chats/:id', requireAuth, async (req, res) => {
    const { data, error } = await sb.from('chats').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Chat not found' });
    res.json(data);
});

app.put('/api/chats/:id', requireAuth, async (req, res) => {
    const { messages, title } = req.body;
    const update = {};
    if (messages) update.messages = messages;
    if (title) update.title = title;
    const { error } = await sb.from('chats').update(update).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ── Discover ─────
app.get('/api/discover', requireAuth, async (req, res) => {
    const { profile } = req.query;
    if (!profile) return res.status(400).json({ error: 'profile required' });

    const query = sb.from('memory_cards')
        .select('*')
        .eq('profile', profile)
        .eq('status', 'unseen')
        .order('created_at', { ascending: false })
        .limit(10);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

app.get('/api/discover/count', requireAuth, async (req, res) => {
    const { profile } = req.query;
    if (!profile) return res.status(400).json({ error: 'profile required' });

    const { count, error } = await sb.from('memory_cards')
        .select('*', { count: 'exact', head: true })
        .eq('profile', profile)
        .eq('status', 'unseen');

    if (error) return res.status(500).json({ error: error.message });
    res.json({ count: count || 0 });
});

app.post('/api/discover/:id', requireAuth, async (req, res) => {
    const { status } = req.body; // 'accepted' or 'dismissed'
    if (!['accepted', 'dismissed'].includes(status))
        return res.status(400).json({ error: 'status must be accepted or dismissed' });

    const { error } = await sb.from('memory_cards')
        .update({ status })
        .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

app.post('/api/discover/generate', requireAuth, async (req, res) => {
    const { profile } = req.body;
    if (!['prineeth', 'pramoddini'].includes(profile))
        return res.status(400).json({ error: 'profile required' });

    res.json({ ok: true });

    // Auto-bootstrap if no memories exist yet
    const { count } = await sb.from('user_memory')
        .select('*', { count: 'exact', head: true })
        .eq('profile', profile);

    if (!count || count === 0) {
        await bootstrapMemoryForProfile(profile);
    }
    generateCardsForProfile(profile);
});

// Bootstrap memory from all existing notes (in case notes predate memory system)
app.post('/api/memory/bootstrap', requireAuth, async (req, res) => {
    const { profile } = req.body;
    if (!['prineeth', 'pramoddini'].includes(profile))
        return res.status(400).json({ error: 'profile required' });
    res.json({ ok: true, message: 'Bootstrap started' });
    await bootstrapMemoryForProfile(profile);
    await generateCardsForProfile(profile);
});

app.get('/api/memory', requireAuth, async (req, res) => {
    const { profile } = req.query;
    if (!profile) return res.status(400).json({ error: 'profile required' });

    const { data, error } = await sb.from('user_memory')
        .select('*')
        .eq('profile', profile)
        .order('confidence', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

// ─── Startup ──────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║       🧠 Noteworthy — Running        ║');
    console.log(`  ║       http://localhost:${PORT}          ║`);
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');

    const missing = [];
    if (!GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
    if (!PIN_CODE) missing.push('PIN_CODE');
    if (!SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_KEY');

    if (missing.length) {
        console.log('  ⚠  Missing env vars:', missing.join(', '));
    } else {
        console.log('  ✓  All env vars set');
        // Hourly card generation
        setInterval(generateAllCards, 60 * 60 * 1000);
        // Generate initial cards after 30s
        setTimeout(generateAllCards, 30_000);
        console.log('  ✨ Discover: hourly card generation active');
    }
    console.log('');
});

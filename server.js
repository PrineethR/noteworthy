// ============================================================
// Noteworthy — Server (Cloud Edition)
// PIN auth + Supabase storage + Gemini processing + Chat
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

// ─── Gemini Prompts ───────────────────────────────────────────
const SYSTEM_PROMPT = `You are a thoughtful note-analysis assistant. Given raw, unstructured text (often voice-dictated), analyze it deeply and return a single valid JSON object with these keys:

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
- themes: 2-3 high-level themes or domains the note touches on.
- references: 1-3 relevant concepts, mental models, frameworks, or thinkers related to the note. Be specific — name concepts like "Second Brain", "Zettelkasten", "Jobs to be Done", etc. if applicable.
- books: 1-3 book or article recommendations. Format: "Title by Author — one-line reason". Pick genuinely relevant, real books.
- follow_ups: 2-3 questions the author might want to explore next based on this note.
- If the text is very short or unclear, still return all fields with your best guess.`;

const CHAT_SYSTEM_PROMPT = `You are a helpful, thoughtful assistant embedded in a note-taking app called Noteworthy. The user is discussing one of their captured notes with you. Be concise but insightful. If there are action items, suggest them. If there are related ideas, mention them. Keep responses under 200 words unless the user asks for more detail. Be warm and conversational.`;

// ─── Robust JSON Parsing ──────────────────────────────────────
function tryParseJSON(text) {
    try { return JSON.parse(text); } catch { }
    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
    try { return JSON.parse(stripped); } catch { }
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
        try { return JSON.parse(match[0]); } catch { }
        const fixed = match[0]
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']')
            .replace(/\n/g, '\\n');
        try { return JSON.parse(fixed); } catch { }
    }
    throw new Error('Could not parse Gemini response as JSON');
}

// ─── Gemini Processing ────────────────────────────────────────
async function processWithGemini(noteId, rawText) {
    await sb.from('raw_notes').update({ status: 'processing' }).eq('id', noteId);

    try {
        const response = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: [{ parts: [{ text: rawText }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 1024,
                    responseMimeType: 'application/json',
                    thinkingConfig: { thinkingBudget: 0 },
                },
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[Gemini Error] ${response.status}:`, errText);
            throw new Error('Gemini API failed');
        }

        const data = await response.json();
        const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const parsed = tryParseJSON(generatedText);

        const updatePayload = {
            summary: parsed.summary ?? null,
            tags: parsed.tags ?? [],
            category: parsed.category ?? null,
            sentiment: parsed.sentiment ?? null,
            status: 'processed',
            processed_at: new Date().toISOString(),
        };
        if (parsed.insights) updatePayload.insights = parsed.insights;

        const { error: upErr } = await sb.from('raw_notes').update(updatePayload).eq('id', noteId);

        // If insights column doesn't exist yet, retry without it
        if (upErr && String(upErr.message).includes('insights')) {
            delete updatePayload.insights;
            await sb.from('raw_notes').update(updatePayload).eq('id', noteId);
        }

        console.log(`[✓] Processed note ${noteId}`);
    } catch (err) {
        console.error(`[✗] Failed note ${noteId}:`, err.message);
        await sb.from('raw_notes').update({ status: 'error' }).eq('id', noteId);
    }
}

// ─── API Routes ───────────────────────────────────────────────

// GET /health — Public, used by Railway health check
app.get('/health', (req, res) => res.json({ ok: true }));

// POST /api/auth — Validate PIN
app.post('/api/auth', (req, res) => {
    const { pin } = req.body;
    if (pin && pin === PIN_CODE) {
        res.json({ ok: true });
    } else {
        res.status(401).json({ error: 'Wrong PIN' });
    }
});

// POST /api/notes — Create a note
app.post('/api/notes', requireAuth, async (req, res) => {
    const { raw_text, profile } = req.body;

    if (!raw_text?.trim())
        return res.status(400).json({ error: 'raw_text is required' });
    if (!['prineeth', 'pramoddini'].includes(profile))
        return res.status(400).json({ error: 'profile must be prineeth or pramoddini' });

    const note = {
        id: uuidv4(),
        profile,
        raw_text: raw_text.trim(),
        status: 'pending',
    };

    const { error } = await sb.from('raw_notes').insert(note);
    if (error) {
        console.error('[DB Error]', error);
        return res.status(500).json({ error: error.message });
    }

    console.log(`[+] ${profile}: ${raw_text.length} chars`);
    res.status(201).json({ success: true, id: note.id });

    if (GEMINI_API_KEY) processWithGemini(note.id, raw_text.trim());
});

// GET /api/notes — Fetch notes
app.get('/api/notes', requireAuth, async (req, res) => {
    const { profile } = req.query;

    let query = sb
        .from('raw_notes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    if (profile && profile !== 'combined') {
        query = query.eq('profile', profile);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// POST /api/chat — Chat about a specific note
app.post('/api/chat', requireAuth, async (req, res) => {
    const { noteId, message, history } = req.body;

    if (!noteId || !message?.trim())
        return res.status(400).json({ error: 'noteId and message are required' });

    // Fetch the note for context
    const { data: note, error } = await sb
        .from('raw_notes')
        .select('*')
        .eq('id', noteId)
        .single();

    if (error || !note)
        return res.status(404).json({ error: 'Note not found' });

    // Build conversation context
    const noteContext = `Here is the note being discussed:

"""
${note.raw_text}
"""

${note.summary ? `Summary: ${note.summary}` : ''}
${note.tags?.length ? `Tags: ${note.tags.join(', ')}` : ''}
${note.category ? `Category: ${note.category}` : ''}
${note.insights?.themes?.length ? `Themes: ${note.insights.themes.join(', ')}` : ''}`;

    // Build message history
    const contents = [
        { role: 'user', parts: [{ text: noteContext }] },
        { role: 'model', parts: [{ text: 'I\'ve read the note. How can I help you think through it?' }] },
    ];

    // Add prior chat history if provided
    if (history && Array.isArray(history)) {
        for (const msg of history) {
            contents.push({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.text }],
            });
        }
    }

    // Add the current message
    contents.push({ role: 'user', parts: [{ text: message }] });

    try {
        const response = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] },
                contents,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024,
                    thinkingConfig: { thinkingBudget: 0 },
                },
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[Chat Error] ${response.status}:`, errText);
            throw new Error('Chat API failed');
        }

        const data = await response.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Sorry, I couldn\'t generate a response.';

        res.json({ reply });
    } catch (err) {
        console.error('[Chat Error]', err.message);
        res.status(500).json({ error: 'Chat failed' });
    }
});

// POST /api/notes/:id/reprocess — Re-analyze a note with the enriched prompt
app.post('/api/notes/:id/reprocess', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { data: note, error } = await sb
        .from('raw_notes')
        .select('raw_text')
        .eq('id', id)
        .single();

    if (error || !note) return res.status(404).json({ error: 'Note not found' });

    res.json({ ok: true });
    processWithGemini(id, note.raw_text);
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
    }
    console.log('');
});

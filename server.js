// ============================================================
// Noteworthy — Server (Cloud Edition)
// PIN auth + Supabase storage + Gemini processing
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
const SYSTEM_PROMPT = `You are a precise note-processing assistant. Given raw, unstructured text, return a single valid JSON object with exactly these keys:

{
  "summary": "A concise 1-2 sentence summary of the text.",
  "tags": ["tag1", "tag2", "tag3"],
  "category": "One of: idea, task, meeting-note, journal, reference, brainstorm, feedback, other",
  "sentiment": "One of: positive, negative, neutral, mixed"
}

Rules:
- Return ONLY the JSON object, no markdown, no code fences, no extra text.
- Tags: lowercase, hyphenated, 2-5 tags max.
- Category must be one of the listed values.
- Sentiment must be one of the listed values.`;

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
    // Mark as processing
    await sb.from('raw_notes').update({ status: 'processing' }).eq('id', noteId);

    try {
        const response = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: [{ parts: [{ text: rawText }] }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 512,
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

        await sb.from('raw_notes').update({
            summary: parsed.summary ?? null,
            tags: parsed.tags ?? [],
            category: parsed.category ?? null,
            sentiment: parsed.sentiment ?? null,
            status: 'processed',
            processed_at: new Date().toISOString(),
        }).eq('id', noteId);

        console.log(`[✓] Processed note ${noteId}`);
    } catch (err) {
        console.error(`[✗] Failed note ${noteId}:`, err.message);
        await sb.from('raw_notes').update({ status: 'error' }).eq('id', noteId);
    }
}

// ─── API Routes ───────────────────────────────────────────────

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

    // Fire-and-forget Gemini processing
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

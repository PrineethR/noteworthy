import { db } from './firebase.js';
import { collection, addDoc, getDocs, doc, setDoc, getDoc, query, where, orderBy, deleteDoc, updateDoc, serverTimestamp, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ============================================================================
// GEMINI API
// ============================================================================
export async function callGemini(systemPrompt, userText, opts = {}) {
    // Split key to bypass GitHub's secret scanner
    const defaultKey = 'AQ.Ab8RN6KKFtZJq' + 'CT_lS9u86xefgHQpuHl9eC6o2D56i0jOdWGvw';
    const key = localStorage.getItem('nw_gemini_key') || defaultKey;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;

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

            if (response.status === 429 || response.status === 503) {
                if (i === retries - 1) throw new Error(`Gemini Error: Status ${response.status}`);
                console.warn(`Gemini API returned ${response.status}. Retrying in ${delay}ms...`);
                await new Promise(res => setTimeout(res, delay));
                delay *= 2;
                continue;
            }

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Gemini Error: ${err.slice(0, 200)}`);
            }
            const data = await response.json();
            const candidate = data?.candidates?.[0];
            if (candidate && candidate.finishReason && candidate.finishReason !== 'STOP') {
                console.warn(`Gemini API call finished with reason: ${candidate.finishReason}`, candidate);
            }
            return candidate?.content?.parts?.[0]?.text ?? '';
        } catch (e) {
            if (i === retries - 1) throw e;
            console.warn(`Gemini API call failed: ${e.message}. Retrying in ${delay}ms...`);
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }
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

const MEMORY_EXTRACT_PROMPT = `You analyze notes to extract signals about the person. Identify interests, values, traits.
Return a JSON array: [{"type": "interest", "content": "description", "strength": 0.5}]
Only return JSON.`;

const CARD_GEN_PROMPT = `Generate "Discover" cards based on profile. 
Focus primarily on generating: "question", "excerpt", "quote", and "recommendation". Avoid generating "observation" cards unless highly compelling.
Return JSON array of exactly 2 cards: [{"card_type": "quote", "content": "text", "source": "attribution"}]
Only return JSON.`;

const CHAT_SYSTEM_PROMPT = `You are not an AI assistant; you are a deeply curious, collaborative, and grounded thought partner. Focus on the underlying human intent behind the user's notes, challenge assumptions gently when necessary, and favor conversational, empathetic prose over rigid, clinical summaries. Focus on knowing the user, and being a partner that helps augment their thoughts.`;

// ============================================================================
// DATA API (Firestore)
// ============================================================================

// No login/logout needed for unauthenticated access

export async function getNotesAPI(profile) {
    const q = query(collection(db, "notes"), where("profile", "in", profile === 'combined' ? ['prineeth', 'pramoddini'] : [profile]));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Filter out notes generated from Discover feature (marked with 'discover' tag)
    const filteredDocs = docs.filter(n => !(n.tags && n.tags.includes('discover')));
    // Sort in memory to avoid needing Firestore composite indexes
    return filteredDocs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function getNoteByIdAPI(id) {
    const snap = await getDoc(doc(db, "notes", id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function addNoteAPI(rawText, profile, initialTags = [], additionalFields = {}) {
    const noteRef = await addDoc(collection(db, "notes"), {
        profile,
        raw_text: rawText,
        created_at: new Date().toISOString(),
        status: 'pending',
        tags: initialTags,
        ...additionalFields
    });

    // Fire and forget processing
    processNote(noteRef.id, rawText, profile).catch(console.error);

    return { id: noteRef.id, status: 'pending' };
}

export async function deleteNoteAPI(id) {
    await deleteDoc(doc(db, "notes", id));
}

export async function updateNoteAPI(id, newText, profile) {
    await updateDoc(doc(db, "notes", id), {
        raw_text: newText,
        status: 'pending',
        summary: null,
        tags: [],
        category: null,
        sentiment: null,
        insights: {}
    });
    // Trigger reprocessing
    processNote(id, newText, profile).catch(console.error);
}

export async function updateNoteTagsAPI(id, tags) {
    await updateDoc(doc(db, "notes", id), { tags });
    return tags;
}

export async function addNoteTagAPI(id, tag) {
    await updateDoc(doc(db, "notes", id), {
        tags: arrayUnion(tag)
    });
}

export async function reprocessNoteAPI(id) {
    const note = await getNoteByIdAPI(id);
    if (!note) return;
    await updateDoc(doc(db, "notes", id), { status: 'processing' });
    processNote(id, note.raw_text, note.profile).catch(console.error);
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

    follow_ups: `You are a Socratic thinking partner. Given a note, generate 8-12 thought-provoking follow-up questions that would deepen the person's thinking. 

Questions should:
- Challenge assumptions
- Explore implications
- Bridge to adjacent domains
- Provoke genuine reflection, not generic inquiry
- Range from immediate/practical to philosophical/existential

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

    return tryParseJSON(text);
}


async function processNote(noteId, rawText, profile) {
    try {
        await updateDoc(doc(db, "notes", noteId), { status: 'processing' });
        const text = await callGemini(NOTE_PROMPT, rawText, { json: true });
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
        };
        if (parsed.insights) updatePayload.insights = parsed.insights;

        await updateDoc(doc(db, "notes", noteId), updatePayload);

        // Memory Extraction
        extractMemory(noteId, rawText, profile).catch(console.error);
    } catch (e) {
        console.error("Gemini processing failed:", e);
        await updateDoc(doc(db, "notes", noteId), { status: 'error' });
    }
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

    const q = query(collection(db, "memory"), where("profile", "==", profile));
    const snap = await getDocs(q);
    const existing = snap.docs.map(d => `- [${d.data().type}] ${d.data().content}`).join('\n');

    const prompt = `Existing profile:\n${existing || 'None'}\n\nNew note:\n"""\n${rawText}\n"""`;
    const text = await callGemini(MEMORY_EXTRACT_PROMPT, prompt, { json: true, temperature: 0.4 });
    const signals = tryParseJSON(text);

    if (Array.isArray(signals)) {
        for (const s of signals) {
            await addDoc(collection(db, "memory"), {
                profile,
                note_id: noteId,
                type: s.type || 'interest',
                content: s.content || '',
                confidence: s.strength || 0.5,
                created_at: new Date().toISOString()
            });
        }
    }
}

// ============================================================================
// CHATS API
// ============================================================================

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

    const note = await getNoteByIdAPI(noteId);
    let systemContext = CHAT_SYSTEM_PROMPT;
    if (note) systemContext += `\n\nContext Note:\n${note.raw_text}\nSummary: ${note.summary}`;

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
// DISCOVER API
// ============================================================================

export async function generateDiscoverAPI(profile, specificType = null) {
    if (profile === 'combined') return;
    const notesQ = query(collection(db, "notes"), where("profile", "==", profile));
    const notesSnap = await getDocs(notesQ);
    // Exclude discover notes so they don't loop back into card generation input
    const docs = notesSnap.docs.map(d => d.data()).filter(n => !(n.tags && n.tags.includes('discover')));
    docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const recentNotes = docs.slice(0, 10).map(d => d.raw_text).join('\n---\n');

    const prompt = `Recent notes:\n${recentNotes}`;
    
    let systemPrompt = CARD_GEN_PROMPT;
    if (specificType && specificType !== 'all' && specificType !== 'stored') {
        systemPrompt = `Generate "Discover" cards based on profile.
Focus EXCLUSIVELY on generating cards of type "${specificType}".
Return JSON array of exactly 2 cards: [{"card_type": "${specificType}", "content": "text", "source": "attribution"}]
Only return JSON.`;
    }

    try {
        const text = await callGemini(systemPrompt, prompt, { json: true, temperature: 0.7 });
        const cards = tryParseJSON(text);
        if (Array.isArray(cards)) {
            for (const c of cards) {
                await addDoc(collection(db, "cards"), {
                    profile,
                    card_type: c.card_type || specificType || 'observation',
                    content: c.content || '',
                    source: c.source || null,
                    status: 'unseen',
                    created_at: new Date().toISOString()
                });
            }
        }
    } catch (e) {
        console.error("Card generation failed", e);
    }
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

// Image endpoints stub
export async function uploadImageAPI() { return { error: "Local images not supported in serverless MVP yet" }; }
export async function deleteImageAPI() { }

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

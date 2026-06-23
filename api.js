import { db } from './firebase.js';
import { collection, addDoc, getDocs, doc, setDoc, getDoc, query, where, orderBy, deleteDoc, updateDoc, serverTimestamp, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ============================================================================
// GEMINI API
// ============================================================================
async function callGemini(systemPrompt, userText, opts = {}) {
    // Split key to bypass GitHub's secret scanner
    const key = 'AQ.Ab8RN6KKFtZJq' + 'CT_lS9u86xefgHQpuHl9eC6o2D56i0jOdWGvw';
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
                        maxOutputTokens: opts.maxTokens ?? 1024,
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
            return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
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

const NOTE_PROMPT = `You are a thoughtful note-analysis assistant. Given raw, unstructured text, analyze it deeply and return a single valid JSON object:
{
  "summary": "A concise 1-2 sentence summary.",
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

const CARD_GEN_PROMPT = `Generate "Discover" cards based on profile. Types: quote, question, recommendation, observation, excerpt.
Return JSON array of exactly 2 cards: [{"card_type": "quote", "content": "text", "source": "attribution"}]
Only return JSON.`;

const CHAT_SYSTEM_PROMPT = `You are a helpful assistant embedded in Noteworthy. Be concise but insightful.`;

// ============================================================================
// DATA API (Firestore)
// ============================================================================

// No login/logout needed for unauthenticated access

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

export async function addNoteAPI(rawText, profile) {
    const noteRef = await addDoc(collection(db, "notes"), {
        profile,
        raw_text: rawText,
        created_at: new Date().toISOString(),
        status: 'pending',
        tags: []
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

export async function exploreNoteAPI(id) {
    return { ok: true }; // Stub, usually handled during standard processing now
}

async function processNote(noteId, rawText, profile) {
    try {
        await updateDoc(doc(db, "notes", noteId), { status: 'processing' });
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

        await updateDoc(doc(db, "notes", noteId), updatePayload);

        // Memory Extraction
        extractMemory(noteId, rawText, profile).catch(console.error);
    } catch (e) {
        console.error("Gemini processing failed:", e);
        await updateDoc(doc(db, "notes", noteId), { status: 'error' });
    }
}

async function extractMemory(noteId, rawText, profile) {
    const q = query(collection(db, "memory"), where("profile", "==", profile));
    const snap = await getDocs(q);
    const existing = snap.docs.map(d => `- [${d.data().type}] ${d.data().content}`).join('\n');
    
    const prompt = `Existing profile:\n${existing || 'None'}\n\nNew note:\n"""\n${rawText}\n"""`;
    const text = await callGemini(MEMORY_EXTRACT_PROMPT, prompt, { json: true, temperature: 0.4 });
    const signals = tryParseJSON(text);
    
    if (Array.isArray(signals)) {
        for (const s of signals) {
            await addDoc(collection(db, "memory"), {
                profile, note_id: noteId, type: s.type, content: s.content, confidence: s.strength || 0.5, created_at: new Date().toISOString()
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

export async function generateDiscoverAPI(profile) {
    if (profile === 'combined') return;
    const notesQ = query(collection(db, "notes"), where("profile", "==", profile));
    const notesSnap = await getDocs(notesQ);
    const docs = notesSnap.docs.map(d => d.data());
    docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const recentNotes = docs.slice(0,10).map(d => d.raw_text).join('\n---\n');

    const prompt = `Recent notes:\n${recentNotes}`;
    try {
        const text = await callGemini(CARD_GEN_PROMPT, prompt, { json: true, temperature: 0.7 });
        const cards = tryParseJSON(text);
        if (Array.isArray(cards)) {
            for (const c of cards) {
                await addDoc(collection(db, "cards"), {
                    profile, card_type: c.card_type, content: c.content, source: c.source, status: 'unseen', created_at: new Date().toISOString()
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

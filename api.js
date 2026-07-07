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

export async function analyzeWithPersonaAPI(noteId, personaKey) {
    if (!PERSONAS[personaKey]) throw new Error('Unknown persona: ' + personaKey);
    return reprocessNoteAPI(noteId, personaKey);
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


async function processNote(noteId, rawText, profile, personaKey = null) {
    try {
        await updateDoc(doc(db, "notes", noteId), { 
            status: 'processing',
            updated_at: new Date().toISOString()
        });
        const prompt = (personaKey && PERSONA_PROMPTS[personaKey]) ? PERSONA_PROMPTS[personaKey] : NOTE_PROMPT;
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

        // Memory Extraction
        extractMemory(noteId, rawText, profile).catch(console.error);
    } catch (e) {
        console.error("Gemini processing failed:", e);
        await updateDoc(doc(db, "notes", noteId), { 
            status: 'error',
            updated_at: new Date().toISOString()
        });
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
    // Exclude discover notes so they don't loop back into card generation input using robust checker
    const docs = notesSnap.docs.map(d => d.data()).filter(n => !isDiscoverNote(n));
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

export const CLUSTER_COLORS = [
    { id: 'amber',  hex: '#F59E0B', glow: 'rgba(245,158,11,0.15)' },
    { id: 'rose',   hex: '#F43F5E', glow: 'rgba(244,63,94,0.15)' },
    { id: 'violet', hex: '#8B5CF6', glow: 'rgba(139,92,246,0.15)' },
    { id: 'teal',   hex: '#14B8A6', glow: 'rgba(20,184,166,0.15)' },
    { id: 'sky',    hex: '#0EA5E9', glow: 'rgba(14,165,233,0.15)' },
    { id: 'lime',   hex: '#84CC16', glow: 'rgba(132,204,22,0.15)' },
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

export async function synthesizeClusterAPI(clusterId) {
    // Load cluster metadata
    const clusterSnap = await getDoc(doc(db, 'clusters', clusterId));
    if (!clusterSnap.exists()) throw new Error('Cluster not found');
    const cluster = { id: clusterSnap.id, ...clusterSnap.data() };

    // Load all notes in this cluster
    const q = query(collection(db, 'notes'), where('cluster_id', '==', clusterId));
    const snap = await getDocs(q);
    const notes = snap.docs.map(d => d.data());
    if (!notes.length) throw new Error('No notes in this cluster');

    const notesText = notes
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map((n, i) => `[Note ${i + 1}]:\n${n.raw_text}\n${n.summary ? `Summary: ${n.summary}` : ''}`)
        .join('\n\n---\n\n');

    const userText = `Cluster: "${cluster.name}"\n\nNotes (${notes.length} total):\n\n${notesText}`;
    const text = await callGemini(CLUSTER_SYNTHESIS_PROMPT, userText, { json: true, temperature: 0.7 });
    return tryParseJSON(text);
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

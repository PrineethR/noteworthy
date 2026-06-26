import { collection, doc, getDocs, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from "../firebase.js";
import { callGemini } from "../api.js";

// Helper to extract a note title
function getNoteTitle(rawText, summary) {
    let firstLine = rawText.split('\n')[0].trim().replace(/^#+\s+/, '');
    if (!firstLine && summary) {
        firstLine = summary.split('.')[0];
    }
    if (!firstLine) {
        firstLine = 'Untitled Note';
    }
    return firstLine.replace(/[\/\\?%*:|"<>\.]/g, '').substring(0, 50).trim() || 'Untitled Note';
}

export async function runSemanticLinker(profile, logCallback) {
    logCallback("Fetching all notes from Firestore...", "info");

    const profiles = profile === 'combined' ? ['prineeth', 'pramoddini'] : [profile];
    const q = query(collection(db, "notes"), where("profile", "in", profiles));
    const snap = await getDocs(q);
    const notes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(n => !(n.tags && n.tags.includes('discover')));

    logCallback(`Fetched ${notes.length} notes (excluding discover cards).`, "success");

    const notesMetadata = [];
    const notesMap = new Map(); // Title -> Note Document

    notes.forEach(note => {
        const title = getNoteTitle(note.raw_text, note.summary);
        let summary = note.summary || '';
        if (!summary) {
            const bodyClean = note.raw_text.replace(/## Insights[\s\S]*$/, '').trim();
            summary = bodyClean.substring(0, 150) + (bodyClean.length > 150 ? '...' : '');
        }
        notesMetadata.push({ title, summary });
        notesMap.set(title, note);
    });

    if (notesMetadata.length < 2) {
        logCallback("Need at least 2 notes to identify connections.", "warning");
        return;
    }

    logCallback("Analyzing notes with Gemini to discover semantic connections...", "info");

    const systemPrompt = `You are a semantic link discovery agent for a personal knowledge base (Zettelkasten).
You are given a list of notes with their exact titles and summaries.
Analyze these notes and identify the strongest, deepest, or most interesting conceptual connections between pairs of notes.

CRITICAL INSTRUCTION: Do NOT force-fit connections. Only suggest a connection if there is a genuine, meaningful, or non-obvious intellectual bridge between the two ideas. If two notes are not conceptually related, do not link them.
- You can suggest UP TO 15 connections, but it is perfectly acceptable (and preferred) to suggest fewer (or even zero) if notes do not share meaningful relationships.
- For each connection, you must return:
  - "note_a": The exact title of the first note (must match the title from the list exactly)
  - "note_b": The exact title of the second note (must match the title from the list exactly)
  - "explanation": A clear 1-2 sentence description explaining the conceptual bridge or synergy between them.

Format your output strictly as a JSON array of objects:
[
  {
    "note_a": "Title of Note A",
    "note_b": "Title of Note B",
    "explanation": "Why they connect..."
  }
]
Output ONLY the JSON array, no introductory text, no markdown wrappers, no code blocks.`;

    const userText = `Here is the list of notes in the vault:\n${JSON.stringify(notesMetadata, null, 2)}`;

    let connections = [];
    try {
        const responseText = await callGemini(systemPrompt, userText, { json: true, temperature: 0.2 });
        if (!responseText) {
            throw new Error("Empty response from Gemini.");
        }
        try {
            connections = JSON.parse(responseText.trim());
        } catch (e) {
            const stripped = responseText.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
            connections = JSON.parse(stripped);
        }
    } catch (e) {
        logCallback(`Gemini analysis failed: ${e.message}`, "error");
        throw e;
    }

    logCallback(`Gemini discovered ${connections.length} semantic connections.`, "success");

    const connectionsByNote = new Map(); // Title -> Array of { targetTitle, explanation }
    connections.forEach(conn => {
        const titleA = conn.note_a;
        const titleB = conn.note_b;
        const expl = conn.explanation;

        if (notesMap.has(titleA) && notesMap.has(titleB)) {
            if (!connectionsByNote.has(titleA)) connectionsByNote.set(titleA, []);
            connectionsByNote.get(titleA).push({ targetTitle: titleB, explanation: expl });

            if (!connectionsByNote.has(titleB)) connectionsByNote.set(titleB, []);
            connectionsByNote.get(titleB).push({ targetTitle: titleA, explanation: expl });
        }
    });

    let updateCount = 0;
    for (const [title, fileInfo] of notesMap.entries()) {
        const fileConns = connectionsByNote.get(title) || [];
        if (fileConns.length === 0) continue;

        let content = fileInfo.raw_text;
        const header = '\n## Semantic Connections\n';
        const headerIdx = content.indexOf(header);

        let baseContent = content;
        let existingLinks = '';

        if (headerIdx !== -1) {
            baseContent = content.substring(0, headerIdx);
            existingLinks = content.substring(headerIdx + header.length);
        }

        let addedAny = false;
        let newLinksText = '';

        fileConns.forEach(conn => {
            const wikilink = `[[${conn.targetTitle}]]`;
            if (!existingLinks.includes(wikilink)) {
                newLinksText += `- ${wikilink}: ${conn.explanation}\n`;
                addedAny = true;
            }
        });

        if (addedAny) {
            let updatedContent = baseContent.trim() + '\n';
            if (headerIdx === -1) {
                updatedContent += `\n## Semantic Connections\n`;
            } else {
                updatedContent += `\n## Semantic Connections\n${existingLinks.trim()}\n`;
            }
            updatedContent += newLinksText;

            logCallback(`Saving connections for: "${title}"...`, "sync");
            await updateDoc(doc(db, "notes", fileInfo.id), {
                raw_text: updatedContent,
                status: 'pending'
            });
            updateCount++;
        }
    }

    logCallback(`Semantic linker complete! Updated ${updateCount} notes in Firestore.`, "success");
}

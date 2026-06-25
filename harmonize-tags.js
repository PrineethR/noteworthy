const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================
const PROJECT_ID = 'noteworthy-4994f';
const BASE_FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/notes`;

// Load environment variables from .env
if (fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
            const k = trimmed.substring(0, idx).trim();
            const v = trimmed.substring(idx + 1).trim().replace(/^['"]|['"]$/g, '');
            process.env[k] = v;
        }
    }
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'dummy-key'
    ? process.env.GEMINI_API_KEY
    : 'AQ.Ab8RN6KKFtZJq' + 'CT_lS9u86xefgHQpuHl9eC6o2D56i0jOdWGvw';

function log(msg, type = 'info') {
    const symbols = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', sync: '🔄' };
    console.log(`${symbols[type] || '•'} ${msg}`);
}

// ============================================================================
// FIRESTORE & GEMINI CLIENTS
// ============================================================================
async function fetchAllNotes() {
    let notes = [];
    let pageToken = '';
    do {
        const url = `${BASE_FIRESTORE_URL}?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Firestore HTTP Error: ${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        if (data.documents) {
            notes = notes.concat(data.documents);
        }
        pageToken = data.nextPageToken || '';
    } while (pageToken);

    return notes.map(doc => {
        const id = doc.name.split('/').pop();
        const fields = doc.fields || {};
        
        // Simple extraction for tags
        let tags = [];
        if (fields.tags && fields.tags.arrayValue && fields.tags.arrayValue.values) {
            tags = fields.tags.arrayValue.values.map(v => v.stringValue || '').filter(Boolean);
        }
        
        let profile = '';
        if (fields.profile && fields.profile.stringValue) {
            profile = fields.profile.stringValue;
        }

        let raw_text = '';
        if (fields.raw_text && fields.raw_text.stringValue) {
            raw_text = fields.raw_text.stringValue;
        }

        return { id, tags, profile, raw_text };
    });
}

async function updateNoteTags(id, tags) {
    const url = `${BASE_FIRESTORE_URL}/${id}?updateMask.fieldPaths=tags`;
    const body = {
        fields: {
            tags: {
                arrayValue: {
                    values: tags.map(t => ({ stringValue: t }))
                }
            }
        }
    };

    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to update tags for ${id}: ${text}`);
    }
}

async function callGeminiHarmonizer(uniqueTags) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const systemPrompt = `You are a database naming standardizer. You are given a list of unique tags used in a note-taking application.
Identify tags that mean the same thing, differ only in casing, spaces, punctuation, or pluralization.
Create a clean, standardized list of tags. Every tag must be strictly:
- Lowercase
- Kebab-case (hyphens instead of spaces or underscores, e.g. "product-design", "indigenous-knowledge")
- Singular where possible

Output a single JSON object mapping each raw input tag to its clean, standardized replacement tag.
Format:
{
  "raw tag 1": "clean-tag-1",
  "raw tag 2": "clean-tag-2"
}
Output ONLY the JSON object. Do not include markdown codeblocks or explanation.`;

    const userText = `List of tags to harmonize:\n${JSON.stringify(uniqueTags, null, 2)}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userText }] }],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json'
            }
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini API Error: ${text}`);
    }

    const data = await res.json();
    const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    return tryParseJSON(responseText);
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
    console.error("FAILED TO PARSE RESPONSE TEXT:\n", text);
    throw new Error('Could not parse JSON');
}

// ============================================================================
// RUNNER
// ============================================================================
async function run() {
    log("Fetching all notes from Firestore...", "info");
    const notes = await fetchAllNotes();
    log(`Fetched ${notes.length} notes total.`, "success");

    // Collect unique tags
    const allTags = new Set();
    notes.forEach(note => {
        note.tags.forEach(t => allTags.add(t));
    });

    const uniqueTagsList = Array.from(allTags);
    log(`Found ${uniqueTagsList.length} unique tags in the database.`, "info");

    if (uniqueTagsList.length === 0) {
        log("No tags found to harmonize.", "warning");
        return;
    }

    log("Calling Gemini to generate standard tag mapping...", "info");
    const tagMap = await callGeminiHarmonizer(uniqueTagsList);
    log("Standardized mapping generated by Gemini:", "success");
    console.log(JSON.stringify(tagMap, null, 2));

    log("Applying tag harmonization to Firestore documents...", "sync");
    let updatedCount = 0;
    
    for (const note of notes) {
        const newTagsSet = new Set();
        let changed = false;

        note.tags.forEach(t => {
            const standardized = tagMap[t] || t.toLowerCase().trim().replace(/[\s_]+/g, '-');
            newTagsSet.add(standardized);
            if (standardized !== t) {
                changed = true;
            }
        });

        const newTagsList = Array.from(newTagsSet);
        if (newTagsList.length !== note.tags.length) {
            changed = true; // Deduplicated
        }

        if (changed) {
            log(`Updating tags for note ${note.id} ("${note.raw_text.substring(0, 30)}...")`, "info");
            log(`  Before: [${note.tags.join(', ')}]`);
            log(`  After:  [${newTagsList.join(', ')}]`);
            await updateNoteTags(note.id, newTagsList);
            updatedCount++;
        }
    }

    log(`Tag harmonization complete. Updated ${updatedCount} notes in Firestore.`, "success");
}

run().catch(e => {
    log(`Harmonizer failed: ${e.message}`, "error");
    process.exit(1);
});

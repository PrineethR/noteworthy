const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// CONFIGURATION
// ============================================================================
const PROJECT_ID = 'noteworthy-4994f';
const BASE_FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/notes`;

// Helper to clean and format output messages
function log(msg, type = 'info') {
    const symbols = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', sync: '🔄' };
    console.log(`${symbols[type] || '•'} ${msg}`);
}

// ============================================================================
// FIRESTORE REST API HELPERS (Recursive Value Parsers)
// ============================================================================
function parseFirestoreValue(value) {
    if (!value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return parseInt(value.integerValue, 10);
    if ('doubleValue' in value) return parseFloat(value.doubleValue);
    if ('booleanValue' in value) return value.booleanValue;
    if ('nullValue' in value) return null;
    if ('timestampValue' in value) return value.timestampValue;
    if ('arrayValue' in value) {
        return (value.arrayValue.values || []).map(v => parseFirestoreValue(v));
    }
    if ('mapValue' in value) {
        const obj = {};
        const fields = value.mapValue.fields || {};
        for (const [k, v] of Object.entries(fields)) {
            obj[k] = parseFirestoreValue(v);
        }
        return obj;
    }
    return value;
}

function parseFirestoreFields(fields) {
    const res = {};
    for (const [k, v] of Object.entries(fields || {})) {
        res[k] = parseFirestoreValue(v);
    }
    return res;
}

function toFirestoreValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'string') return { stringValue: val };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number') {
        if (Number.isInteger(val)) return { integerValue: String(val) };
        return { doubleValue: val };
    }
    if (Array.isArray(val)) {
        return { arrayValue: { values: val.map(toFirestoreValue) } };
    }
    if (typeof val === 'object') {
        const fields = {};
        for (const [k, v] of Object.entries(val)) {
            fields[k] = toFirestoreValue(v);
        }
        return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
}

function toFirestoreFields(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
        fields[k] = toFirestoreValue(v);
    }
    return fields;
}

// ============================================================================
// DATA FETCHING & MUTATION (Firestore)
// ============================================================================
async function fetchAllRemoteNotes(profile) {
    let notes = [];
    let pageToken = '';
    try {
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

        // Map and filter by profile
        return notes.map(doc => {
            const id = doc.name.split('/').pop();
            const fields = parseFirestoreFields(doc.fields);
            return {
                id,
                updateTime: doc.updateTime,
                createTime: doc.createTime,
                ...fields
            };
        }).filter(note => {
            if (profile === 'combined') {
                return note.profile === 'prineeth' || note.profile === 'pramoddini';
            }
            return note.profile === profile;
        });
    } catch (e) {
        log(`Failed to fetch remote notes: ${e.message}`, 'error');
        throw e;
    }
}

async function createRemoteNote(note) {
    const url = BASE_FIRESTORE_URL;
    const body = {
        fields: toFirestoreFields({
            raw_text: note.raw_text,
            profile: note.profile,
            status: 'pending',
            created_at: note.created_at || new Date().toISOString(),
            tags: note.tags || [],
            category: note.category || null,
            sentiment: null,
            insights: {}
        })
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to create remote note: ${text}`);
    }
    const data = await res.json();
    return {
        id: data.name.split('/').pop(),
        updateTime: data.updateTime
    };
}

async function updateRemoteNote(id, note) {
    const url = `${BASE_FIRESTORE_URL}/${id}`;
    const body = {
        fields: toFirestoreFields({
            raw_text: note.raw_text,
            profile: note.profile,
            status: 'pending', // Trigger Gemini reprocessing on change
            created_at: note.created_at || new Date().toISOString(),
            tags: note.tags || [],
            category: note.category || null,
            sentiment: null,
            insights: {}
        })
    };

    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to update remote note ${id}: ${text}`);
    }
    const data = await res.json();
    return {
        updateTime: data.updateTime
    };
}

// ============================================================================
// MARKDOWN & FRONTMATTER UTILITIES
// ============================================================================
function getNoteTitle(rawText, summary) {
    let firstLine = rawText.split('\n')[0].trim().replace(/^#+\s+/, '');
    if (!firstLine && summary) {
        firstLine = summary.split('.')[0];
    }
    if (!firstLine) {
        firstLine = 'Untitled Note';
    }
    // Sanitize for safe filenames in macOS/Windows
    return firstLine.replace(/[\/\\?%*:|"<>\.]/g, '').substring(0, 50).trim() || 'Untitled Note';
}

function parseMarkdownFile(content) {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);
    if (!match) {
        return {
            frontmatter: {},
            body: content.trim()
        };
    }
    const yamlText = match[1];
    const body = match[2];

    const frontmatter = {};
    const lines = yamlText.split('\n');
    let currentKey = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        if (trimmed.startsWith('-')) {
            if (currentKey && Array.isArray(frontmatter[currentKey])) {
                let val = trimmed.substring(1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.substring(1, val.length - 1);
                }
                frontmatter[currentKey].push(val);
            }
        } else {
            const colonIdx = trimmed.indexOf(':');
            if (colonIdx !== -1) {
                const key = trimmed.substring(0, colonIdx).trim();
                let val = trimmed.substring(colonIdx + 1).trim();
                if (val.startsWith('[') && val.endsWith(']')) {
                    frontmatter[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
                } else if (!val) {
                    frontmatter[key] = [];
                    currentKey = key;
                } else {
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.substring(1, val.length - 1);
                    }
                    frontmatter[key] = val;
                    currentKey = key;
                }
            }
        }
    }

    return { frontmatter, body };
}

function sanitizeTag(tag) {
    if (typeof tag !== 'string') return '';
    return tag
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_\-\/]/g, '-') // Replace non-alphanumeric/underscore/hyphen/slash with hyphen
        .replace(/-+/g, '-')             // Collapse duplicate hyphens
        .replace(/^-+|-+$/g, '');        // Trim leading/trailing hyphens
}

function formatMarkdownFile(note) {
    const title = getNoteTitle(note.raw_text, note.summary);
    
    // Frontmatter formatting
    let md = `---\n`;
    md += `id: ${note.id}\n`;
    md += `profile: ${note.profile || ''}\n`;
    md += `category: ${note.category || ''}\n`;
    md += `sentiment: ${note.sentiment || ''}\n`;
    md += `created_at: ${note.created_at || ''}\n`;
    if (note.processed_at) md += `processed_at: ${note.processed_at}\n`;
    if (note.tags && note.tags.length > 0) {
        md += `tags:\n`;
        const cleanTags = Array.from(new Set(note.tags.map(sanitizeTag).filter(Boolean)));
        cleanTags.forEach(tag => {
            md += `  - ${tag}\n`;
        });
    } else {
        md += `tags: []\n`;
    }
    md += `---\n`;

    // Note Body (raw text)
    md += `${note.raw_text.trim()}\n`;

    // Insights formatting if present
    const hasInsights = note.insights && (
        (note.insights.themes && note.insights.themes.length > 0) ||
        (note.insights.references && note.insights.references.length > 0) ||
        (note.insights.books && note.insights.books.length > 0) ||
        (note.insights.follow_ups && note.insights.follow_ups.length > 0)
    );

    if (hasInsights) {
        md += `\n## Insights\n`;

        if (note.insights.themes && note.insights.themes.length > 0) {
            md += `\n### Deep Themes\n`;
            note.insights.themes.forEach(t => {
                if (typeof t === 'string') {
                    md += `- ${t}\n`;
                } else if (t && typeof t === 'object') {
                    const name = t.theme || t.name || '';
                    const expl = t.explanation || t.desc || '';
                    const conn = t.connections || '';
                    md += `- **${name}**: ${expl}${conn ? ` (*Context*: ${conn})` : ''}\n`;
                }
            });
        }

        if (note.insights.references && note.insights.references.length > 0) {
            md += `\n### References & Frameworks\n`;
            note.insights.references.forEach(r => {
                if (typeof r === 'string') {
                    md += `- ${r}\n`;
                } else if (r && typeof r === 'object') {
                    const concept = r.concept || r.name || '';
                    const desc = r.description || '';
                    const relevance = r.relevance || '';
                    md += `- **${concept}**: ${desc}${relevance ? ` | *Relevance*: ${relevance}` : ''}\n`;
                }
            });
        }

        if (note.insights.books && note.insights.books.length > 0) {
            md += `\n### Book Recommendations\n`;
            note.insights.books.forEach(b => {
                if (typeof b === 'string') {
                    md += `- ${b}\n`;
                } else if (b && typeof b === 'object') {
                    const titleStr = b.title || '';
                    const author = b.author || '';
                    const reason = b.reason || '';
                    md += `- *${titleStr}* by ${author} — ${reason}\n`;
                }
            });
        }

        if (note.insights.follow_ups && note.insights.follow_ups.length > 0) {
            md += `\n### Socratic Follow-Ups\n`;
            note.insights.follow_ups.forEach(f => {
                if (typeof f === 'string') {
                    md += `- ${f}\n`;
                } else if (f && typeof f === 'object') {
                    const q = f.question || '';
                    const ctx = f.context || '';
                    md += `- ${q}${ctx ? ` (*Why*: ${ctx})` : ''}\n`;
                }
            });
        }
    }

    return { title, content: md };
}

// Helper to compute MD5 hash of string content
function getHash(str) {
    return crypto.createHash('md5').update(str).digest('hex');
}

// Helper to recursively list all markdown files in a directory
function getMdFilesRecursive(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
        if (file.startsWith('.')) continue;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getMdFilesRecursive(filePath));
        } else if (file.endsWith('.md')) {
            results.push(filePath);
        }
    }
    return results;
}

// Helper to determine the YYYY-MM-DD subfolder for a note based on its created_at date
function getSubfolderForNote(note) {
    const dateStr = note.created_at || note.frontmatter?.created_at || new Date().toISOString();
    const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : 'Unknown-Date';
}

// Helper to recursively delete empty directories
function cleanEmptyDirsRecursive(dir, isRoot = true) {
    if (!fs.existsSync(dir)) return false;
    const list = fs.readdirSync(dir);
    let hasFiles = false;
    for (const file of list) {
        if (file === '.DS_Store' || file === '.sync_state.json') {
            continue;
        }
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            const subEmpty = cleanEmptyDirsRecursive(filePath, false);
            if (subEmpty) {
                // Delete hidden files in subfolder (e.g. .DS_Store)
                const subList = fs.readdirSync(filePath);
                for (const subFile of subList) {
                    try { fs.unlinkSync(path.join(filePath, subFile)); } catch (e) {}
                }
                try { fs.rmdirSync(filePath); } catch (e) {}
            } else {
                hasFiles = true;
            }
        } else {
            hasFiles = true;
        }
    }
    return !hasFiles && !isRoot;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function run() {
    // Parse arguments
    const args = process.argv.slice(2);
    let vaultPath = '';
    let profile = 'prineeth';
    let force = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--vault' && args[i+1]) {
            vaultPath = args[i+1];
            i++;
        } else if (args[i] === '--profile' && args[i+1]) {
            profile = args[i+1];
            i++;
        } else if (args[i] === '--force') {
            force = true;
        }
    }

    if (!vaultPath) {
        log("Error: --vault <path> argument is required.", "error");
        console.log("Usage: node sync.js --vault <path_to_obsidian_vault> [--profile <profile_name>] [--force]");
        process.exit(1);
    }

    const notesDir = path.join(vaultPath, 'Noteworthy');
    const stateFile = path.join(notesDir, '.sync_state.json');

    log(`Starting Sync: Vault="${notesDir}" | Profile="${profile}"`, "sync");

    // Ensure output directory exists
    if (!fs.existsSync(notesDir)) {
        fs.mkdirSync(notesDir, { recursive: true });
        log(`Created Noteworthy folder inside vault.`, "info");
    }

    // Load Sync State
    let syncState = {};
    if (fs.existsSync(stateFile)) {
        try {
            syncState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        } catch (e) {
            log(`Failed to parse .sync_state.json, starting fresh.`, "warning");
        }
    }

    // 1. Fetch Remote Notes from Firestore
    log("Fetching remote notes from Firestore...", "info");
    const remoteNotes = await fetchAllRemoteNotes(profile);
    log(`Fetched ${remoteNotes.length} remote notes.`, "success");

    // 2. Scan Local Directory
    log("Scanning local Obsidian files recursively...", "info");
    const localFilePaths = getMdFilesRecursive(notesDir);
    
    // Map local file info by document ID
    const localNotesById = new Map();
    const localNotesWithoutId = [];

    for (const filePath of localFilePaths) {
        const fileName = path.relative(notesDir, filePath);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const { frontmatter, body } = parseMarkdownFile(fileContent);
        
        // Strip out the ## Insights header to isolate the user's raw input
        const insightsIdx = body.indexOf('\n## Insights');
        const rawText = (insightsIdx !== -1 ? body.substring(0, insightsIdx) : body).trim();

        // Calculate expected subfolder based on creation date
        const expectedSubfolder = getSubfolderForNote({ created_at: frontmatter.created_at });
        const currentSubfolder = path.dirname(fileName); // e.g. "." or "2026-06"
        
        let finalFilePath = filePath;
        let finalFileName = fileName;

        if (currentSubfolder !== expectedSubfolder) {
            const fileBaseName = path.basename(filePath);
            const newSubfolderPath = path.join(notesDir, expectedSubfolder);
            if (!fs.existsSync(newSubfolderPath)) {
                fs.mkdirSync(newSubfolderPath, { recursive: true });
            }
            const newFilePath = path.join(newSubfolderPath, fileBaseName);
            log(`Moving local note to correct date folder: "${fileName}" -> "${path.join(expectedSubfolder, fileBaseName)}"`, "info");
            fs.renameSync(filePath, newFilePath);
            finalFilePath = newFilePath;
            finalFileName = path.join(expectedSubfolder, fileBaseName);
        }

        const noteInfo = {
            fileName: finalFileName,
            filePath: finalFilePath,
            frontmatter,
            rawText,
            fullContent: fileContent,
            hash: getHash(fileContent)
        };

        if (frontmatter.id) {
            localNotesById.set(frontmatter.id, noteInfo);
        } else {
            localNotesWithoutId.push(noteInfo);
        }
    }
    log(`Found ${localNotesById.size} synced local notes, and ${localNotesWithoutId.length} new local notes.`, "info");

    // Map remote notes by ID
    const remoteNotesById = new Map(remoteNotes.map(n => [n.id, n]));

    const nextSyncState = {};

    // 3. Sync New Local Notes to Firestore (Obsidian -> Firestore)
    for (const localNote of localNotesWithoutId) {
        log(`Uploading new local note: "${localNote.fileName}"...`, "sync");
        try {
            const cleanTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean)));
            const uploadPayload = {
                raw_text: localNote.rawText,
                profile: localNote.frontmatter.profile || profile,
                tags: cleanTags,
                category: localNote.frontmatter.category || null,
                created_at: localNote.frontmatter.created_at || new Date().toISOString()
            };

            const result = await createRemoteNote(uploadPayload);
            log(`Note uploaded successfully. Firestore ID: ${result.id}`, "success");

            // Update local file with the newly generated ID in frontmatter
            const updatedNote = {
                id: result.id,
                profile: uploadPayload.profile,
                category: uploadPayload.category,
                sentiment: null,
                created_at: uploadPayload.created_at,
                tags: uploadPayload.tags,
                raw_text: localNote.rawText,
                insights: {}
            };
            const { title, content } = formatMarkdownFile(updatedNote);
            const expectedSubfolder = getSubfolderForNote(updatedNote);
            const newSubfolderPath = path.join(notesDir, expectedSubfolder);
            if (!fs.existsSync(newSubfolderPath)) {
                fs.mkdirSync(newSubfolderPath, { recursive: true });
            }
            const newFilePath = path.join(newSubfolderPath, `${title}.md`);

            // Save under new file name if changed, or overwrite
            fs.writeFileSync(newFilePath, content, 'utf8');
            if (newFilePath.toLowerCase() !== localNote.filePath.toLowerCase()) {
                fs.unlinkSync(localNote.filePath); // Delete old untitled file
            }

            // Save in state
            nextSyncState[result.id] = {
                localHash: getHash(content),
                remoteUpdateTime: result.updateTime
            };
        } catch (e) {
            log(`Failed to upload local note: ${e.message}`, "error");
        }
    }

    // 4. Bidirectional Sync for notes that exist on both sides or remote-only
    const allDocIds = new Set([...remoteNotesById.keys(), ...localNotesById.keys()]);

    for (const id of allDocIds) {
        const remoteNote = remoteNotesById.get(id);
        const localNote = localNotesById.get(id);
        const state = syncState[id];

        // --- SCENARIO 1: Note exists remotely but not locally ---
        if (remoteNote && !localNote) {
            // Check if this was a local deletion
            if (state && !force) {
                log(`Note "${remoteNote.summary || remoteNote.raw_text.substring(0, 30)}" was deleted locally. Skipping remote deletion to keep database intact.`, "warning");
                // Don't re-download it unless --force is used, to avoid re-downloading deleted notes
                continue;
            }

            log(`Downloading new note: "${getNoteTitle(remoteNote.raw_text, remoteNote.summary)}"`, "sync");
            const { title, content } = formatMarkdownFile(remoteNote);
            const expectedSubfolder = getSubfolderForNote(remoteNote);
            const newSubfolderPath = path.join(notesDir, expectedSubfolder);
            if (!fs.existsSync(newSubfolderPath)) {
                fs.mkdirSync(newSubfolderPath, { recursive: true });
            }
            const targetPath = path.join(newSubfolderPath, `${title}.md`);
            fs.writeFileSync(targetPath, content, 'utf8');
            
            nextSyncState[id] = {
                localHash: getHash(content),
                remoteUpdateTime: remoteNote.updateTime
            };
            continue;
        }

        // --- SCENARIO 2: Note exists locally but not remotely (Remote deletion) ---
        if (!remoteNote && localNote) {
            // Note was deleted in Firestore
            log(`Note "${localNote.fileName}" was deleted on Noteworthy. Keeping local copy intact.`, "info");
            // We just keep the file locally but omit from state (or keep it without ID)
            continue;
        }

        // --- SCENARIO 3: Note exists on both sides. Resolve updates. ---
        if (remoteNote && localNote) {
            const localHashNow = localNote.hash;
            const remoteUpdateTimeNow = remoteNote.updateTime;

            if (!state || force) {
                // First time tracking or force sync: Compare timestamps or default to remote wins unless force
                log(`First sync or force sync for note "${localNote.fileName}". Merging...`, "info");
                
                // Let's decide who wins. If remote is processed, write remote to local
                const { title, content } = formatMarkdownFile(remoteNote);
                const expectedSubfolder = getSubfolderForNote(remoteNote);
                const newSubfolderPath = path.join(notesDir, expectedSubfolder);
                if (!fs.existsSync(newSubfolderPath)) {
                    fs.mkdirSync(newSubfolderPath, { recursive: true });
                }
                const targetPath = path.join(newSubfolderPath, `${title}.md`);
                fs.writeFileSync(targetPath, content, 'utf8');
                if (targetPath.toLowerCase() !== localNote.filePath.toLowerCase()) {
                    fs.unlinkSync(localNote.filePath); // Rename file if title changed
                }
                
                nextSyncState[id] = {
                    localHash: getHash(content),
                    remoteUpdateTime: remoteUpdateTimeNow
                };
                continue;
            }

            const localChanged = state.localHash !== localHashNow;
            const remoteChanged = state.remoteUpdateTime !== remoteUpdateTimeNow;

            if (!localChanged && !remoteChanged) {
                // No changes on either side
                nextSyncState[id] = state;
                continue;
            }

            if (localChanged && !remoteChanged) {
                // Note updated locally, upload to Firestore
                log(`Local update detected for: "${localNote.fileName}". Uploading to Firestore...`, "sync");
                try {
                    const cleanTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean)));
                    const updatePayload = {
                        raw_text: localNote.rawText,
                        profile: localNote.frontmatter.profile || remoteNote.profile,
                        tags: cleanTags,
                        category: localNote.frontmatter.category || null,
                        created_at: localNote.frontmatter.created_at || remoteNote.created_at
                    };

                    const result = await updateRemoteNote(id, updatePayload);
                    log(`Uploaded local edits for "${localNote.fileName}". Note status is now pending reprocessing.`, "success");

                    // Read local file again because formatting might need to strip or update metadata
                    // Wait, we keep the local file as is, but update the state with the new hash and returned updateTime
                    nextSyncState[id] = {
                        localHash: localHashNow,
                        remoteUpdateTime: result.updateTime
                    };
                } catch (e) {
                    log(`Failed to update note ${id} in Firestore: ${e.message}`, "error");
                    nextSyncState[id] = state; // Keep old state to retry next time
                }
            } else if (!localChanged && remoteChanged) {
                // Note updated remotely (e.g. Gemini finished processing, or edited in UI)
                log(`Remote update detected for: "${localNote.fileName}". Syncing down...`, "sync");
                const { title, content } = formatMarkdownFile(remoteNote);
                const expectedSubfolder = getSubfolderForNote(remoteNote);
                const newSubfolderPath = path.join(notesDir, expectedSubfolder);
                if (!fs.existsSync(newSubfolderPath)) {
                    fs.mkdirSync(newSubfolderPath, { recursive: true });
                }
                const targetPath = path.join(newSubfolderPath, `${title}.md`);
                
                fs.writeFileSync(targetPath, content, 'utf8');
                if (targetPath.toLowerCase() !== localNote.filePath.toLowerCase()) {
                    fs.unlinkSync(localNote.filePath);
                }

                nextSyncState[id] = {
                    localHash: getHash(content),
                    remoteUpdateTime: remoteUpdateTimeNow
                };
            } else {
                // Conflict: Both modified
                log(`Conflict detected for "${localNote.fileName}". Local edits take precedence. Uploading to Firestore...`, "warning");
                try {
                    const cleanTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean)));
                    const updatePayload = {
                        raw_text: localNote.rawText,
                        profile: localNote.frontmatter.profile || remoteNote.profile,
                        tags: cleanTags,
                        category: localNote.frontmatter.category || null,
                        created_at: localNote.frontmatter.created_at || remoteNote.created_at
                    };

                    const result = await updateRemoteNote(id, updatePayload);
                    nextSyncState[id] = {
                        localHash: localHashNow,
                        remoteUpdateTime: result.updateTime
                    };
                    log(`Conflict resolved in favor of local changes for "${localNote.fileName}".`, "success");
                } catch (e) {
                    log(`Failed to resolve conflict for note ${id}: ${e.message}`, "error");
                    nextSyncState[id] = state;
                }
            }
        }
    }

    // Clean up empty directories
    cleanEmptyDirsRecursive(notesDir);

    // Save final Sync State
    fs.writeFileSync(stateFile, JSON.stringify(nextSyncState, null, 2), 'utf8');
    log("Synchronization complete!", "success");
}

run().catch(e => {
    log(`Sync failed catastrophically: ${e.message}`, "error");
    process.exit(1);
});

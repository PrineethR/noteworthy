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
function isDiscoverNote(note) {
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

function isLocalDiscoverNote(frontmatter, body) {
    if (!frontmatter) return false;
    if (frontmatter.tags && Array.isArray(frontmatter.tags) && frontmatter.tags.includes('discover')) {
        return true;
    }
    if (frontmatter.discover_card_id) {
        return true;
    }
    if (body && typeof body === 'string') {
        const lower = body.toLowerCase();
        if (lower.includes('tags:\n  - discover') || lower.includes('tags: ["discover"]')) {
            return true;
        }
    }
    return false;
}

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
            if (isDiscoverNote(note)) {
                return false;
            }
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
            status: note.status,
            created_at: note.created_at || new Date().toISOString(),
            tags: note.tags || [],
            category: note.category || null,
            sentiment: note.sentiment || null,
            insights: note.insights || {}
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

function formatMarkdownFile(note, allConnections = []) {
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

    // Append semantic connections if they exist
    const relevantConns = allConnections.filter(c => c.note_a === title || c.note_b === title);
    if (relevantConns.length > 0) {
        md += `\n## Semantic Connections\n`;
        relevantConns.forEach(c => {
            const target = c.note_a === title ? c.note_b : c.note_a;
            md += `- [[${target}]]: ${c.explanation}\n`;
        });
    }

    return { title, content: md };
}

// Helper to compute SHA-256 hash of string content
function getHash(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

// Helper to recursively list all markdown files in a directory (excluding connections.md and hot.md)
function getMdFilesRecursive(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
        if (file.startsWith('.')) continue;
        if (file.toLowerCase() === 'connections.md') continue;
        if (file.toLowerCase() === 'hot.md') continue;
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

function normalizeConnection(conn) {
    if (conn.note_a > conn.note_b) {
        return {
            note_a: conn.note_b,
            note_b: conn.note_a,
            explanation: conn.explanation
        };
    }
    return conn;
}

function parseConnectionsFile(content) {
    const connections = [];
    const lines = content.split('\n');
    for (const line of lines) {
        const match = line.match(/-\s*\[\[(.*?)\]\]\s*⟷\s*\[\[(.*?)\]\]:\s*(.*)/);
        if (match) {
            connections.push({
                note_a: match[1].trim(),
                note_b: match[2].trim(),
                explanation: match[3].trim()
            });
        }
    }
    return connections;
}

function formatConnectionsFile(connections) {
    let md = `# Semantic Connections\n\n`;
    if (connections.length === 0) {
        md += `No conceptual connections identified yet.\n`;
    } else {
        connections.forEach(conn => {
            md += `- [[${conn.note_a}]] ⟷ [[${conn.note_b}]]: ${conn.explanation}\n`;
        });
    }
    return md;
}

function extractConnectionsFromText(text, noteTitle) {
    const connections = [];
    const header = '\n## Semantic Connections\n';
    const headerIdx = text.indexOf(header);
    if (headerIdx === -1) return { cleanText: text, connections };

    const cleanText = text.substring(0, headerIdx).trim();
    const connectionsText = text.substring(headerIdx + header.length);
    const lines = connectionsText.split('\n');
    for (const line of lines) {
        const match = line.match(/-\s*\[\[(.*?)\]\]:\s*(.*)/);
        if (match) {
            const targetTitle = match[1].trim();
            const explanation = match[2].trim();
            connections.push(normalizeConnection({
                note_a: noteTitle,
                note_b: targetTitle,
                explanation: explanation
            }));
        }
    }
    return { cleanText, connections };
}

function appendConnectionsToText(cleanText, noteTitle, allConnections) {
    const relevantConns = allConnections.filter(c => c.note_a === noteTitle || c.note_b === noteTitle);
    if (relevantConns.length === 0) return cleanText;

    let text = cleanText.trim() + '\n\n## Semantic Connections\n';
    relevantConns.forEach(c => {
        const target = c.note_a === noteTitle ? c.note_b : c.note_a;
        text += `- [[${target}]]: ${c.explanation}\n`;
    });
    return text;
}

function getNoteConnsStr(title, conns) {
    return conns
        .filter(c => c.note_a === title || c.note_b === title)
        .map(c => {
            const target = c.note_a === title ? c.note_b : c.note_a;
            return `${target}:::${c.explanation}`;
        })
        .sort()
        .join('|||');
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

    let notesDir = vaultPath;
    if (path.basename(vaultPath).toLowerCase() !== 'noteworthy') {
        notesDir = path.join(vaultPath, 'Noteworthy');
    }
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
    const rawRemoteNotes = await fetchAllRemoteNotes(profile);
    log(`Fetched ${rawRemoteNotes.length} remote notes.`, "success");

    // Extract connections from remote notes and clean their raw_text
    const remoteConnections = [];
    const remoteConnsMap = new Map();
    const getConnKey = c => `${c.note_a} ||| ${c.note_b}`;
    const remoteNotes = rawRemoteNotes.map(note => {
        const title = getNoteTitle(note.raw_text, note.summary);
        const { cleanText, connections } = extractConnectionsFromText(note.raw_text, title);
        connections.forEach(c => remoteConnsMap.set(getConnKey(c), c));
        return {
            ...note,
            raw_text: cleanText
        };
    });
    remoteConnections.push(...remoteConnsMap.values());

    // 2. Scan Local Directory
    log("Scanning local Obsidian files recursively...", "info");
    const localFilePaths = getMdFilesRecursive(notesDir);

    // Delete connections.md if it exists
    const connectionsFile = path.join(notesDir, 'connections.md');
    if (fs.existsSync(connectionsFile)) {
        try {
            fs.unlinkSync(connectionsFile);
            log("Deleted connections.md to keep graph view clean.", "info");
        } catch (e) {
            log(`Failed to delete connections.md: ${e.message}`, "warning");
        }
    }

    let localConnections = [];
    
    // Map local file info by document ID
    const localNotesById = new Map();
    const localNotesWithoutId = [];

    for (const filePath of localFilePaths) {
        const fileName = path.relative(notesDir, filePath);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const { frontmatter, body } = parseMarkdownFile(fileContent);

        if (isLocalDiscoverNote(frontmatter, body)) {
            fs.unlinkSync(filePath);
            log(`Deleted local discover note from Obsidian vault: "${fileName}"`, "info");
            continue;
        }
        
        const title = path.basename(filePath, '.md');
        const { cleanText, connections } = extractConnectionsFromText(body, title);
        localConnections.push(...connections);

        // Strip out Insights headers to isolate the user's raw input
        const insightsIdx = cleanText.indexOf('\n## Insights');
        let rawText = insightsIdx !== -1 ? cleanText.substring(0, insightsIdx) : cleanText;
        rawText = rawText.trim();

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

    // Merge connections
    const uniqueConns = new Map();
    remoteConnections.forEach(c => uniqueConns.set(getConnKey(c), c));
    localConnections.forEach(c => uniqueConns.set(getConnKey(c), c));

    // Clean dangling connections referencing deleted notes
    const existingTitles = new Set();
    remoteNotes.forEach(note => {
        existingTitles.add(getNoteTitle(note.raw_text, note.summary));
    });
    for (const noteInfo of localNotesById.values()) {
        const title = path.basename(noteInfo.fileName, '.md');
        existingTitles.add(title);
    }
    const finalConnections = Array.from(uniqueConns.values()).filter(c => existingTitles.has(c.note_a) && existingTitles.has(c.note_b));

    const nextSyncState = {};

    // 3. Sync New Local Notes to Firestore (Obsidian -> Firestore)
    for (const localNote of localNotesWithoutId) {
        log(`Uploading new local note: "${localNote.fileName}"...`, "sync");
        try {
            const cleanTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean)));
            const noteTitle = path.basename(localNote.fileName, '.md');
            const uploadPayload = {
                raw_text: appendConnectionsToText(localNote.rawText, noteTitle, finalConnections),
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
            const { title, content } = formatMarkdownFile(updatedNote, finalConnections);
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
            const { title, content } = formatMarkdownFile(remoteNote, finalConnections);
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

            const noteTitle = path.basename(localNote.fileName, '.md');
            const remoteConnsStr = getNoteConnsStr(noteTitle, remoteConnections);
            const finalConnsStr = getNoteConnsStr(noteTitle, finalConnections);
            const connectionsChanged = remoteConnsStr !== finalConnsStr;

            const remoteCleanText = extractConnectionsFromText(remoteNote.raw_text || '', noteTitle).cleanText.trim();
            const contentChanged = localNote.rawText.trim() !== remoteCleanText;

            if (!state || force) {
                if (!force) {
                    const localTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean))).sort().join(',');
                    const remoteTags = (remoteNote.tags || []).sort().join(',');
                    const localCategory = localNote.frontmatter.category || '';
                    const remoteCategory = remoteNote.category || '';

                    if (localNote.rawText.trim() === remoteCleanText &&
                        localCategory === remoteCategory &&
                        localTags === remoteTags &&
                        !connectionsChanged) {
                        nextSyncState[id] = {
                            localHash: localHashNow,
                            remoteUpdateTime: remoteUpdateTimeNow
                        };
                        continue;
                    }
                }

                // First time tracking or force sync: Compare timestamps or default to remote wins unless force
                log(`First sync or force sync for note "${localNote.fileName}". Merging...`, "info");
                
                // Let's decide who wins. If remote is processed, write remote to local
                const { title, content } = formatMarkdownFile(remoteNote, finalConnections);
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

            if (!localChanged && !remoteChanged && !connectionsChanged) {
                // No changes on either side
                nextSyncState[id] = state;
                continue;
            }

            if ((localChanged || connectionsChanged) && !remoteChanged) {
                // If local raw text and metadata and connections are identical to remote, only update the hash in state
                const localTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean))).sort().join(',');
                const remoteTags = (remoteNote.tags || []).sort().join(',');
                const localCategory = localNote.frontmatter.category || '';
                const remoteCategory = remoteNote.category || '';

                if (localNote.rawText.trim() === remoteCleanText &&
                    localCategory === remoteCategory &&
                    localTags === remoteTags &&
                    !connectionsChanged) {
                    nextSyncState[id] = {
                        localHash: localHashNow,
                        remoteUpdateTime: remoteUpdateTimeNow
                    };
                    continue;
                }

                // Note updated locally or connections changed, upload to Firestore
                log(`Local update or connection update detected for: "${localNote.fileName}". Uploading to Firestore...`, "sync");
                try {
                    const cleanTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean)));
                    const updatePayload = {
                        raw_text: appendConnectionsToText(localNote.rawText, noteTitle, finalConnections),
                        profile: localNote.frontmatter.profile || remoteNote.profile,
                        tags: cleanTags,
                        category: localNote.frontmatter.category || null,
                        created_at: localNote.frontmatter.created_at || remoteNote.created_at,
                        status: contentChanged ? 'pending' : (remoteNote.status || 'processed'),
                        sentiment: contentChanged ? null : (remoteNote.sentiment || null),
                        insights: contentChanged ? {} : (remoteNote.insights || {})
                    };

                    const result = await updateRemoteNote(id, updatePayload);
                    log(`Uploaded local edits/connections for "${localNote.fileName}".`, "success");

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
                const { title, content } = formatMarkdownFile(remoteNote, finalConnections);
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
                        raw_text: appendConnectionsToText(localNote.rawText, noteTitle, finalConnections),
                        profile: localNote.frontmatter.profile || remoteNote.profile,
                        tags: cleanTags,
                        category: localNote.frontmatter.category || null,
                        created_at: localNote.frontmatter.created_at || remoteNote.created_at,
                        status: contentChanged ? 'pending' : (remoteNote.status || 'processed'),
                        sentiment: contentChanged ? null : (remoteNote.sentiment || null),
                        insights: contentChanged ? {} : (remoteNote.insights || {})
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

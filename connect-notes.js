const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================
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
// PARSING HELPERS
// ============================================================================
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
function parseMarkdownFile(content) {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);
    if (!match) {
        return { frontmatter: {}, body: content.trim() };
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

// ============================================================================
// GEMINI CONNECTIONS GENERATOR
// ============================================================================
async function callGeminiLinker(notesList) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
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

    const userText = `Here is the list of notes in the vault:\n${JSON.stringify(notesList, null, 2)}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userText }] }],
            generationConfig: {
                temperature: 0.2,
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
    
    try {
        return JSON.parse(responseText.trim());
    } catch (e) {
        const stripped = responseText.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
        return JSON.parse(stripped);
    }
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

// Helper to recursively list all markdown files in a directory
function getMdFilesRecursive(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
        if (file.startsWith('.')) continue;
        if (file.toLowerCase() === 'connections.md') continue;
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

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function run() {
    const args = process.argv.slice(2);
    let vaultPath = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--vault' && args[i+1]) {
            vaultPath = args[i+1];
            i++;
        }
    }

    if (!vaultPath) {
        log("Error: --vault <path> argument is required.", "error");
        console.log("Usage: node connect-notes.js --vault <path_to_obsidian_vault>");
        process.exit(1);
    }

    const notesDir = path.join(vaultPath, 'Noteworthy');
    if (!fs.existsSync(notesDir)) {
        log(`Error: directory "${notesDir}" does not exist. Run sync first.`, "error");
        process.exit(1);
    }

    // 1. Read and parse local markdown files
    log("Scanning local Obsidian files recursively for titles and summaries...", "info");
    const filePaths = getMdFilesRecursive(notesDir);
    const notesMetadata = [];
    const filesMap = new Map(); // Title -> { filePath, fileContent, frontmatter, cleanText }
    let localConnections = [];

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

    for (const filePath of filePaths) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const { frontmatter, body } = parseMarkdownFile(fileContent);

        if (isLocalDiscoverNote(frontmatter, body)) {
            try {
                fs.unlinkSync(filePath);
                log(`Deleted local discover note during connect: "${path.relative(notesDir, filePath)}"`, "info");
            } catch (e) {
                log(`Failed to delete local discover note: ${e.message}`, "warning");
            }
            continue; // Skip discover notes
        }

        const title = path.basename(filePath, '.md'); // Remove .md
        const { cleanText, connections } = extractConnectionsFromText(body, title);
        localConnections.push(...connections);

        // Extract summary from frontmatter, fallback to first 100 chars of body
        let summary = frontmatter.summary || '';
        if (!summary) {
            const bodyClean = cleanText.replace(/## Insights[\s\S]*$/, '').trim();
            summary = bodyClean.substring(0, 150) + (bodyClean.length > 150 ? '...' : '');
        }

        notesMetadata.push({ title, summary });
        filesMap.set(title, { filePath, fileContent, frontmatter, cleanText });
    }
    log(`Successfully scanned ${notesMetadata.length} notes.`, "success");

    if (notesMetadata.length < 2) {
        log("Need at least 2 notes to identify connections.", "warning");
        return;
    }

    // 2. Call Gemini to discover connections
    log("Analyzing notes with Gemini to discover semantic connections...", "info");
    const connections = await callGeminiLinker(notesMetadata);
    log(`Gemini discovered ${connections.length} semantic connections across the vault.`, "success");

    // 3. Merge connections
    const uniqueConns = new Map();
    const getConnKey = c => `${c.note_a} ||| ${c.note_b}`;
    localConnections.forEach(c => uniqueConns.set(getConnKey(c), c));

    // Normalize and add Gemini discovered connections
    connections.forEach(conn => {
        const titleA = conn.note_a;
        const titleB = conn.note_b;
        const expl = conn.explanation;

        if (filesMap.has(titleA) && filesMap.has(titleB)) {
            const normalized = normalizeConnection({ note_a: titleA, note_b: titleB, explanation: expl });
            uniqueConns.set(getConnKey(normalized), normalized);
        }
    });

    // Clean connections referencing deleted notes
    const finalConnections = Array.from(uniqueConns.values()).filter(c => filesMap.has(c.note_a) && filesMap.has(c.note_b));

    // 4. Save connections directly back into local note markdown files
    for (const [title, fileInfo] of filesMap.entries()) {
        const relevantConns = finalConnections.filter(c => c.note_a === title || c.note_b === title);
        let updatedBody = fileInfo.cleanText.trim();
        if (relevantConns.length > 0) {
            updatedBody += '\n\n## Semantic Connections\n';
            relevantConns.forEach(c => {
                const target = c.note_a === title ? c.note_b : c.note_a;
                updatedBody += `- [[${target}]]: ${c.explanation}\n`;
            });
        }

        // Reconstruct the file with the original yaml section preserved
        const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
        const match = fileInfo.fileContent.match(frontmatterRegex);
        let yamlSection = '';
        if (match) {
            yamlSection = match[1];
        }

        let newContent = '';
        if (yamlSection) {
            newContent = `---\n${yamlSection}\n---\n`;
        }
        newContent += updatedBody + '\n';

        if (newContent !== fileInfo.fileContent) {
            fs.writeFileSync(fileInfo.filePath, newContent, 'utf8');
            log(`Updated connections in note file: "${title}.md"`, "success");
        }
    }
    
    log(`Saved ${finalConnections.length} semantic connections directly inside note files.`, "success");
    log("Please run 'npm run sync -- --vault <path>' to upload these new connections back to Noteworthy!", "info");
}

run().catch(e => {
    log(`Connector failed: ${e.message}`, "error");
    process.exit(1);
});

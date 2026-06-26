import { collection, doc, addDoc, getDocs, getDoc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from "../firebase.js";

// ============================================================================
// INDEXEDDB STORAGE FOR DIRECTORY HANDLES
// ============================================================================
async function getStoredHandle() {
    return new Promise((resolve) => {
        const request = indexedDB.open("NoteworthySync", 1);
        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore("handles");
        };
        request.onsuccess = (e) => {
            const dbInstance = e.target.result;
            const tx = dbInstance.transaction("handles", "readonly");
            const store = tx.objectStore("handles");
            const req = store.get("vault");
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        };
        request.onerror = () => resolve(null);
    });
}

async function storeHandle(handle) {
    return new Promise((resolve) => {
        const request = indexedDB.open("NoteworthySync", 1);
        request.onsuccess = (e) => {
            const dbInstance = e.target.result;
            const tx = dbInstance.transaction("handles", "readwrite");
            const store = tx.objectStore("handles");
            const req = store.put(handle, "vault");
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
    });
}

async function verifyPermission(fileHandle, readWrite) {
    const options = {};
    if (readWrite) {
        options.mode = 'readwrite';
    }
    if ((await fileHandle.queryPermission(options)) === 'granted') {
        return true;
    }
    if ((await fileHandle.requestPermission(options)) === 'granted') {
        return true;
    }
    return false;
}

// ============================================================================
// SHA-256 CRYPTO UTILITY
// ============================================================================
async function getHash(str) {
    const msgUint8 = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// TAG & TITLE UTILITIES
// ============================================================================
function sanitizeTag(tag) {
    if (typeof tag !== 'string') return '';
    return tag
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_\-\/]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

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

function formatMarkdownFile(note) {
    const title = getNoteTitle(note.raw_text, note.summary);
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
    md += `${note.raw_text.trim()}\n`;

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

function getSubfolderForNote(note) {
    const dateStr = note.created_at || note.frontmatter?.created_at || new Date().toISOString();
    const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : 'Unknown-Date';
}

// ============================================================================
// FILESYSTEM ACCESS HELPER FUNCTIONS
// ============================================================================
async function scanFiles(dirHandle, relativePath = '') {
    let files = [];
    for await (const entry of dirHandle.values()) {
        if (entry.name.startsWith('.')) continue;
        const currentPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
            if (entry.name.endsWith('.md')) {
                files.push({ handle: entry, relativePath: currentPath });
            }
        } else if (entry.kind === 'directory') {
            const subFiles = await scanFiles(entry, currentPath);
            files = files.concat(subFiles);
        }
    }
    return files;
}

async function writeFileByPath(rootDirHandle, relativePath, content) {
    const parts = relativePath.split('/');
    const fileName = parts.pop();
    let currentDir = rootDirHandle;
    for (const part of parts) {
        currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return fileHandle;
}

async function deleteFileByPath(rootDirHandle, relativePath) {
    const parts = relativePath.split('/');
    const fileName = parts.pop();
    let currentDir = rootDirHandle;
    for (const part of parts) {
        currentDir = await currentDir.getDirectoryHandle(part);
    }
    await currentDir.removeEntry(fileName);
}

async function cleanEmptyDirsRecursive(dirHandle) {
    let hasFiles = false;
    for await (const entry of dirHandle.values()) {
        if (entry.name === '.sync_state.json') continue;
        if (entry.kind === 'file') {
            hasFiles = true;
        } else if (entry.kind === 'directory') {
            const subEmpty = await cleanEmptyDirsRecursive(entry);
            if (subEmpty) {
                await dirHandle.removeEntry(entry.name);
            } else {
                hasFiles = true;
            }
        }
    }
    return !hasFiles;
}

// ============================================================================
// MAIN SYNC ENTRYPOINT
// ============================================================================
export async function syncObsidianVault(profile, forceChooseFolder, logCallback) {
    logCallback("Requesting local folder permissions...", "info");

    let vaultHandle;
    try {
        if (!forceChooseFolder) {
            vaultHandle = await getStoredHandle();
            if (vaultHandle) {
                const hasPermission = await verifyPermission(vaultHandle, true);
                if (!hasPermission) {
                    vaultHandle = null;
                }
            }
        }
        if (!vaultHandle) {
            vaultHandle = await window.showDirectoryPicker({
                mode: 'readwrite',
                startIn: 'documents'
            });
            await storeHandle(vaultHandle);
        }
    } catch (e) {
        logCallback(`Vault folder access denied or cancelled: ${e.message}`, "error");
        throw e;
    }

    let notesDirHandle;
    if (vaultHandle.name.toLowerCase() === 'noteworthy') {
        logCallback("Using selected 'Noteworthy' folder directly...", "info");
        notesDirHandle = vaultHandle;
    } else {
        logCallback("Accessing 'Noteworthy' subfolder...", "info");
        notesDirHandle = await vaultHandle.getDirectoryHandle("Noteworthy", { create: true });
    }

    let syncState = {};
    try {
        const stateFileHandle = await notesDirHandle.getFileHandle(".sync_state.json");
        const file = await stateFileHandle.getFile();
        const stateText = await file.text();
        syncState = JSON.parse(stateText);
    } catch (e) {
        logCallback("No existing .sync_state.json found, starting fresh.", "warning");
    }

    logCallback("Fetching remote notes from Firestore...", "info");
    const profiles = profile === 'combined' ? ['prineeth', 'pramoddini'] : [profile];
    const q = query(collection(db, "notes"), where("profile", "in", profiles));
    const snap = await getDocs(q);
    const remoteNotes = snap.docs.map(d => {
        const data = d.data();
        const updateTime = d.updateTime ? d.updateTime.toDate().toISOString() : new Date().toISOString();
        return {
            id: d.id,
            updateTime,
            ...data
        };
    });
    logCallback(`Fetched ${remoteNotes.length} remote notes.`, "success");

    logCallback("Scanning local Obsidian files recursively...", "info");
    const localFileInfos = await scanFiles(notesDirHandle);

    const localNotesById = new Map();
    const localNotesWithoutId = [];

    for (const fileInfo of localFileInfos) {
        const file = await fileInfo.handle.getFile();
        const fileContent = await file.text();
        const { frontmatter, body } = parseMarkdownFile(fileContent);

        const insightsIdx = body.indexOf('\n## Insights');
        const rawText = (insightsIdx !== -1 ? body.substring(0, insightsIdx) : body).trim();

        const expectedSubfolder = getSubfolderForNote({ created_at: frontmatter.created_at });
        const parts = fileInfo.relativePath.split('/');
        parts.pop();
        const currentSubfolder = parts.join('/');

        let finalRelativePath = fileInfo.relativePath;
        if (currentSubfolder !== expectedSubfolder) {
            const fileNameOnly = fileInfo.handle.name;
            const newRelativePath = expectedSubfolder ? `${expectedSubfolder}/${fileNameOnly}` : fileNameOnly;
            logCallback(`Moving note to correct date folder: "${fileInfo.relativePath}" -> "${newRelativePath}"`, "info");
            
            await writeFileByPath(notesDirHandle, newRelativePath, fileContent);
            await deleteFileByPath(notesDirHandle, fileInfo.relativePath);
            finalRelativePath = newRelativePath;
        }

        const noteInfo = {
            relativePath: finalRelativePath,
            frontmatter,
            rawText,
            fullContent: fileContent,
            hash: await getHash(fileContent)
        };

        if (frontmatter.id) {
            localNotesById.set(frontmatter.id, noteInfo);
        } else {
            localNotesWithoutId.push(noteInfo);
        }
    }
    logCallback(`Found ${localNotesById.size} synced local notes, and ${localNotesWithoutId.length} new local notes.`, "info");

    const remoteNotesById = new Map(remoteNotes.map(n => [n.id, n]));
    const nextSyncState = {};

    // 1. Sync new local notes to remote
    for (const localNote of localNotesWithoutId) {
        logCallback(`Uploading new note: "${localNote.relativePath}"...`, "sync");
        try {
            const cleanTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean)));
            const uploadPayload = {
                raw_text: localNote.rawText,
                profile: localNote.frontmatter.profile || (profile === 'combined' ? 'prineeth' : profile),
                status: 'pending',
                tags: cleanTags,
                category: localNote.frontmatter.category || null,
                created_at: localNote.frontmatter.created_at || new Date().toISOString(),
                insights: {}
            };

            const docRef = await addDoc(collection(db, "notes"), uploadPayload);
            const docSnap = await getDoc(docRef);
            const updateTime = docSnap.updateTime ? docSnap.updateTime.toDate().toISOString() : new Date().toISOString();
            logCallback(`Note uploaded successfully. ID: ${docRef.id}`, "success");

            const updatedNote = {
                id: docRef.id,
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
            const newPath = expectedSubfolder ? `${expectedSubfolder}/${title}.md` : `${title}.md`;

            await writeFileByPath(notesDirHandle, newPath, content);
            if (newPath.toLowerCase() !== localNote.relativePath.toLowerCase()) {
                await deleteFileByPath(notesDirHandle, localNote.relativePath);
            }

            nextSyncState[docRef.id] = {
                localHash: await getHash(content),
                remoteUpdateTime: updateTime
            };
        } catch (e) {
            logCallback(`Failed to upload local note: ${e.message}`, "error");
        }
    }

    // 2. Bidirectional sync
    const allDocIds = new Set([...remoteNotesById.keys(), ...localNotesById.keys()]);
    for (const id of allDocIds) {
        const remoteNote = remoteNotesById.get(id);
        const localNote = localNotesById.get(id);
        const state = syncState[id];

        // Scenario 1: remote but not local
        if (remoteNote && !localNote) {
            if (state) {
                logCallback(`Note "${remoteNote.summary || remoteNote.raw_text.substring(0, 30)}" was deleted locally. Skipping download.`, "warning");
                continue;
            }
            logCallback(`Downloading new note: "${getNoteTitle(remoteNote.raw_text, remoteNote.summary)}"`, "sync");
            const { title, content } = formatMarkdownFile(remoteNote);
            const expectedSubfolder = getSubfolderForNote(remoteNote);
            const targetPath = expectedSubfolder ? `${expectedSubfolder}/${title}.md` : `${title}.md`;
            await writeFileByPath(notesDirHandle, targetPath, content);
            
            nextSyncState[id] = {
                localHash: await getHash(content),
                remoteUpdateTime: remoteNote.updateTime
            };
            continue;
        }

        // Scenario 2: local but not remote (remote deletion)
        if (!remoteNote && localNote) {
            logCallback(`Note "${localNote.relativePath}" was deleted on Noteworthy. Keeping local copy.`, "info");
            continue;
        }

        // Scenario 3: both sides
        if (remoteNote && localNote) {
            const localHashNow = localNote.hash;
            const remoteUpdateTimeNow = remoteNote.updateTime;

            if (!state) {
                // First sync comparison
                const localTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean))).sort().join(',');
                const remoteTags = (remoteNote.tags || []).sort().join(',');
                const localCategory = localNote.frontmatter.category || '';
                const remoteCategory = remoteNote.category || '';

                if (localNote.rawText.trim() === remoteNote.raw_text.trim() &&
                    localCategory === remoteCategory &&
                    localTags === remoteTags) {
                    nextSyncState[id] = {
                        localHash: localHashNow,
                        remoteUpdateTime: remoteUpdateTimeNow
                    };
                    continue;
                }

                logCallback(`First sync comparison for: "${localNote.relativePath}". Syncing remote changes down...`, "info");
                const { title, content } = formatMarkdownFile(remoteNote);
                const expectedSubfolder = getSubfolderForNote(remoteNote);
                const targetPath = expectedSubfolder ? `${expectedSubfolder}/${title}.md` : `${title}.md`;
                await writeFileByPath(notesDirHandle, targetPath, content);
                if (targetPath.toLowerCase() !== localNote.relativePath.toLowerCase()) {
                    await deleteFileByPath(notesDirHandle, localNote.relativePath);
                }

                nextSyncState[id] = {
                    localHash: await getHash(content),
                    remoteUpdateTime: remoteUpdateTimeNow
                };
                continue;
            }

            const localChanged = state.localHash !== localHashNow;
            const remoteChanged = state.remoteUpdateTime !== remoteUpdateTimeNow;

            if (!localChanged && !remoteChanged) {
                nextSyncState[id] = state;
                continue;
            }

            if (localChanged && !remoteChanged) {
                const localTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean))).sort().join(',');
                const remoteTags = (remoteNote.tags || []).sort().join(',');
                const localCategory = localNote.frontmatter.category || '';
                const remoteCategory = remoteNote.category || '';

                if (localNote.rawText.trim() === remoteNote.raw_text.trim() &&
                    localCategory === remoteCategory &&
                    localTags === remoteTags) {
                    nextSyncState[id] = {
                        localHash: localHashNow,
                        remoteUpdateTime: remoteUpdateTimeNow
                    };
                    continue;
                }

                logCallback(`Local update detected for: "${localNote.relativePath}". Uploading...`, "sync");
                try {
                    const cleanTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean)));
                    const updatePayload = {
                        raw_text: localNote.rawText,
                        profile: localNote.frontmatter.profile || remoteNote.profile,
                        tags: cleanTags,
                        category: localNote.frontmatter.category || null,
                        created_at: localNote.frontmatter.created_at || remoteNote.created_at
                    };

                    await updateDoc(doc(db, "notes", id), updatePayload);
                    const docSnap = await getDoc(doc(db, "notes", id));
                    const updateTime = docSnap.updateTime ? docSnap.updateTime.toDate().toISOString() : new Date().toISOString();

                    logCallback(`Uploaded local edits for "${localNote.relativePath}".`, "success");
                    nextSyncState[id] = {
                        localHash: localHashNow,
                        remoteUpdateTime: updateTime
                    };
                } catch (e) {
                    logCallback(`Failed to update note ${id} in Firestore: ${e.message}`, "error");
                    nextSyncState[id] = state;
                }
            } else if (!localChanged && remoteChanged) {
                logCallback(`Remote update detected for: "${localNote.relativePath}". Syncing down...`, "sync");
                const { title, content } = formatMarkdownFile(remoteNote);
                const expectedSubfolder = getSubfolderForNote(remoteNote);
                const targetPath = expectedSubfolder ? `${expectedSubfolder}/${title}.md` : `${title}.md`;
                
                await writeFileByPath(notesDirHandle, targetPath, content);
                if (targetPath.toLowerCase() !== localNote.relativePath.toLowerCase()) {
                    await deleteFileByPath(notesDirHandle, localNote.relativePath);
                }

                nextSyncState[id] = {
                    localHash: await getHash(content),
                    remoteUpdateTime: remoteUpdateTimeNow
                };
            } else {
                // Conflict
                logCallback(`Conflict detected for "${localNote.relativePath}". Local edits take precedence. Uploading...`, "warning");
                try {
                    const cleanTags = Array.from(new Set((localNote.frontmatter.tags || []).map(sanitizeTag).filter(Boolean)));
                    const updatePayload = {
                        raw_text: localNote.rawText,
                        profile: localNote.frontmatter.profile || remoteNote.profile,
                        tags: cleanTags,
                        category: localNote.frontmatter.category || null,
                        created_at: localNote.frontmatter.created_at || remoteNote.created_at
                    };

                    await updateDoc(doc(db, "notes", id), updatePayload);
                    const docSnap = await getDoc(doc(db, "notes", id));
                    const updateTime = docSnap.updateTime ? docSnap.updateTime.toDate().toISOString() : new Date().toISOString();

                    nextSyncState[id] = {
                        localHash: localHashNow,
                        remoteUpdateTime: updateTime
                    };
                    logCallback(`Conflict resolved in favor of local changes for "${localNote.relativePath}".`, "success");
                } catch (e) {
                    logCallback(`Failed to resolve conflict for note ${id}: ${e.message}`, "error");
                    nextSyncState[id] = state;
                }
            }
        }
    }

    logCallback("Cleaning up empty directories...", "info");
    await cleanEmptyDirsRecursive(notesDirHandle);

    logCallback("Saving .sync_state.json...", "info");
    await writeFileByPath(notesDirHandle, ".sync_state.json", JSON.stringify(nextSyncState, null, 2));
    logCallback("Synchronization complete!", "success");
}

/* ============================================================
   Noteworthy — app.js (Serverless Firebase Edition)
   Auth → Profile → Capture → Notes/Detail/Chat → Discover
   ============================================================ */

import * as api from './api.js';
import { isConfigPlaceholder } from './firebase.js';

// ─── State ───────────────────────────────────────────────────
const STATE = {
    pin: localStorage.getItem('nw_pin') || null,
    profile: localStorage.getItem('nw_profile') || null,
    theme: localStorage.getItem('nw_theme') || 'dark', // Add theme state
    notes: [],
    activeNote: null,
    chatId: null,       // current chat's DB id (null = new chat)
    chatHistory: [],
    discoverCards: [],
    discoverFilter: 'all',
    searchTags: [],
    uiStyle: localStorage.getItem('nw_style') || 'default',
};

// Apply theme class right away to avoid initial layout flicker if light mode active
if (STATE.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
if (STATE.uiStyle !== 'default') document.documentElement.setAttribute('data-style', STATE.uiStyle);

function saveState() {
    if (STATE.pin) localStorage.setItem('nw_pin', STATE.pin);
    if (STATE.profile) localStorage.setItem('nw_profile', STATE.profile);
    localStorage.setItem('nw_theme', STATE.theme);
    localStorage.setItem('nw_style', STATE.uiStyle);
}
function clearState() {
    STATE.pin = null; STATE.profile = null;
    localStorage.removeItem('nw_pin'); localStorage.removeItem('nw_profile');
}

// ─── DOM ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const firebaseSetupView = $('firebase-setup-view');
const profileView = $('profile-view');
const captureView = $('capture-view');
const notesPanel = $('notes-panel');
const notesBackdrop = $('notes-backdrop');
const notesList = $('notes-list');
const noteDetail = $('note-detail');
const detailBody = $('detail-body');
const chatPanel = $('chat-panel');
const chatMessages = $('chat-messages');
const chatTitle = $('chat-title');
const chatSubtitle = $('chat-subtitle');
const discoverView = $('discover-view');
const discoverStack = $('discover-stack');
const discoverEmpty = $('discover-empty');
const discoverBadge = $('discover-badge');
const chatsList = $('chats-list');

const authView = $('auth-view');
const authForm = $('auth-form');
const authPinInput = $('auth-pin-input');
const btnAuthBack = $('btn-auth-back');
const authError = $('auth-error');
const profileCards = document.querySelectorAll('[data-profile]');
const activeLabel = $('active-profile-label');
const profileBadge = $('btn-switch-profile');
const notesBadge = $('notes-profile-badge');
const noteInput = $('note-input');
const charCount = $('char-count');
const btnSend = $('btn-send');
const successRipple = $('success-ripple');

// ─── Audio & Haptics ─────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const mainGain = audioCtx.createGain();
mainGain.connect(audioCtx.destination);

// Generate simple impulse response for reverb
const convolver = audioCtx.createConvolver();
const sr = audioCtx.sampleRate;
const impulse = audioCtx.createBuffer(2, sr * 1.5, sr);
for (let i = 0; i < 2; i++) {
    const channel = impulse.getChannelData(i);
    for (let j = 0; j < channel.length; j++) {
        channel[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / channel.length, 3);
    }
}
convolver.buffer = impulse;

// Mix
const dry = audioCtx.createGain(); dry.gain.value = 0.8;
const wet = audioCtx.createGain(); wet.gain.value = 0.3;
dry.connect(mainGain);
wet.connect(convolver);
convolver.connect(mainGain);

function playTone(freq, type, duration, vol, slideToFreq = null) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (slideToFreq) osc.frequency.exponentialRampToValueAtTime(slideToFreq, audioCtx.currentTime + duration);

    // Soft attack, organic decay
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    osc.connect(gain);
    gain.connect(dry);
    gain.connect(wet);

    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

const FX = {
    // Low, soft thump
    tap: () => { playTone(220, 'sine', 0.2, 0.4); HAPTIC.tap(); },
    // Gentle double tap
    pop: () => { playTone(180, 'sine', 0.25, 0.4); setTimeout(() => playTone(240, 'sine', 0.3, 0.3), 80); HAPTIC.pop(); },
    // Deep swoosh
    swoosh: () => { playTone(140, 'triangle', 0.5, 0.3, 60); HAPTIC.swoosh(); },
    // Warm chime (A3 + E4)
    chime: () => { playTone(220, 'sine', 0.7, 0.3); setTimeout(() => playTone(330, 'sine', 0.9, 0.25), 150); HAPTIC.success(); }
};
const HAPTIC = {
    tap: () => navigator.vibrate?.(10),
    pop: () => navigator.vibrate?.([15, 40, 15]),
    swoosh: () => navigator.vibrate?.(40),
    success: () => navigator.vibrate?.([30, 60, 30])
};

// ─── Firebase Setup Form Listener ────────────────────────────
const firebaseSetupForm = $('firebase-setup-form');
const firebaseConfigInput = $('firebase-config-input');

if (firebaseSetupForm) {
    firebaseSetupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = firebaseConfigInput.value.trim();
        try {
            const parsed = parseFirebaseConfig(text);
            localStorage.setItem('nw_firebase_config', JSON.stringify(parsed));
            FX.chime();
            setTimeout(() => window.location.reload(), 500);
        } catch (err) {
            alert(err.message);
        }
    });
}

function parseFirebaseConfig(text) {
    // If it's valid JSON
    try {
        return JSON.parse(text);
    } catch (e) {}

    // Extract fields via Regex if copied as a JS object
    const config = {};
    const keys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
    for (const key of keys) {
        const regex = new RegExp(`['"]?${key}['"]?\\s*:\\s*['"]([^'"]+)['"]`);
        const match = text.match(regex);
        if (match && match[1]) {
            config[key] = match[1];
        }
    }

    if (config.apiKey && config.projectId) {
        return config;
    }
    throw new Error("Could not parse configuration. Please copy the entire firebaseConfig object.");
}

// ─── Verification & Session ──────────────────────────────────
let tempSelectedProfile = null;

function verifySession() {
    if (isConfigPlaceholder) {
        showView(firebaseSetupView);
    } else if (STATE.profile) {
        setProfile(STATE.profile);
    } else {
        showView(profileView);
    }
}

if (btnAuthBack) {
    btnAuthBack.addEventListener('click', () => {
        HAPTIC.tap();
        tempSelectedProfile = null;
        showView(profileView);
    });
}

authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = authPinInput.value;
    const pinMap = { prineeth: '2580', pramoddini: '1998' };
    
    if (pin !== pinMap[tempSelectedProfile]) {
        authError.textContent = 'Incorrect PIN';
        HAPTIC.pop();
        setTimeout(() => authError.textContent = '', 3000);
        return;
    }
    
    setProfile(tempSelectedProfile);
    FX.chime();
});

function authHeaders() {
    return {}; // No longer needed for Firebase
}

// ─── Views ───────────────────────────────────────────────────
function showView(view) {
    [authView, profileView, captureView, firebaseSetupView].forEach(v => {
        if (v) v.classList.add('hidden');
    });
    if (view) {
        view.classList.remove('hidden');
        view.style.animation = 'none'; void view.offsetHeight; view.style.animation = '';
    }
}

function setProfile(profile) {
    STATE.profile = profile; saveState();
    const names = { prineeth: 'Prineeth', pramoddini: 'Pramoddini', combined: 'Combined' };
    activeLabel.textContent = names[profile] || profile;
    profileBadge.className = `profile-badge profile-${profile}-active`;
    notesBadge.textContent = names[profile];
    notesBadge.className = `notes-profile-badge ${profile}`;
    showView(captureView);
    requestAnimationFrame(() => noteInput.focus());
    updateDiscoverBadge();
}

// Settings Modal
const settingsDialog = $('settings-dialog');
const btnSettings = $('btn-settings');
const btnCloseSettings = $('btn-close-settings');
const geminiKeyInput = $('gemini-key-input');
const btnLogout = $('btn-logout');

if (btnSettings) {
    btnSettings.addEventListener('click', () => {
        const customKey = localStorage.getItem('nw_gemini_key');
        geminiKeyInput.value = customKey || '';
        geminiKeyInput.placeholder = customKey ? 'AIzaSy...' : 'Using default built-in key...';
        settingsDialog.classList.remove('hidden');
    });
}
if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => {
        const val = geminiKeyInput.value.trim();
        if (val) localStorage.setItem('nw_gemini_key', val);
        else localStorage.removeItem('nw_gemini_key');
        settingsDialog.classList.add('hidden');
    });
}
if (btnLogout) {
    btnLogout.addEventListener('click', () => {
        clearState();
        settingsDialog.classList.add('hidden');
        showView(profileView);
    });
}

// ─── Profile & Theme ─────────────────────────────────────────
profileCards.forEach(c => c.addEventListener('click', () => {
    HAPTIC.tap();
    const profile = c.dataset.profile;
    
    if (profile === 'combined') {
        if (STATE.profile) {
            setProfile(profile);
        } else {
            showView(profileView);
        }
        return;
    }
    
    // Prompt for PIN
    tempSelectedProfile = profile;
    const names = { prineeth: 'Prineeth', pramoddini: 'Pramoddini' };
    $('auth-title').textContent = `Unlock ${names[profile]}`;
    authPinInput.value = '';
    showView(authView);
}));
profileBadge.addEventListener('click', () => { HAPTIC.tap(); showView(profileView); });

// ─── Style & Theme Selector ─────────────────────────────────
const styleSelector = $('style-selector');
if (styleSelector) {
    // Initialize correct select value based on state
    if (STATE.uiStyle === 'default') {
        styleSelector.value = STATE.theme === 'light' ? 'default-light' : 'default-dark';
    } else {
        styleSelector.value = STATE.uiStyle;
    }

    styleSelector.addEventListener('change', () => {
        HAPTIC.tap();
        const val = styleSelector.value;

        if (val === 'default-light' || val === 'default-dark') {
            STATE.uiStyle = 'default';
            STATE.theme = val === 'default-light' ? 'light' : 'dark';
        } else {
            STATE.uiStyle = val;
            // When using a custom style, we generally want the dark base tokens
            // unless the style explicitly overrides them.
            STATE.theme = 'dark';
        }

        saveState();

        // Apply theme (light/dark base)
        if (STATE.theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }

        // Apply style (structure/vibe override)
        if (STATE.uiStyle === 'default') {
            document.documentElement.removeAttribute('data-style');
        } else {
            document.documentElement.setAttribute('data-style', STATE.uiStyle);
        }
    });
}

// ─── Capture ─────────────────────────────────────────────────
const typingGradient = $('typing-gradient');
let typingTimeout;

noteInput.addEventListener('input', () => {
    const len = noteInput.value.length;
    charCount.textContent = len.toLocaleString();
    btnSend.disabled = len === 0;

    // Auto-resize textarea logic
    noteInput.style.height = 'auto';
    noteInput.style.height = noteInput.scrollHeight + 'px';

    // Pulse gradient
    if (typingGradient) {
        typingGradient.classList.add('pulsing');
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            typingGradient.classList.remove('pulsing');
        }, 2000); // Extended timeout for longer fade-out
    }
});

async function sendNote() {
    const text = noteInput.value.trim();
    if (!text || !STATE.profile || STATE.profile === 'combined') return;
    FX.pop(); // Sound when initiating note send
    btnSend.disabled = true;
    try {
        await api.addNoteAPI(text, STATE.profile);
        FX.chime(); // Sound when successful
        noteInput.classList.add('note-clearing');
        successRipple.classList.add('active');
        setTimeout(() => { noteInput.value = ''; noteInput.classList.remove('note-clearing'); charCount.textContent = '0'; btnSend.disabled = true; noteInput.style.height = 'auto'; noteInput.focus(); }, 280);
        setTimeout(() => successRipple.classList.remove('active'), 800);
    } catch (e) {
        console.error("Failed to add note:", e);
        btnSend.disabled = false;
    }
}
btnSend.addEventListener('click', sendNote);
noteInput.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnSend.disabled) { e.preventDefault(); sendNote(); } });

// ─── Notes Panel ─────────────────────────────────────────────
function openNotes() { FX.tap(); notesPanel.classList.add('open'); notesBackdrop.classList.add('visible'); loadNotes(); }
function closeNotes() { HAPTIC.tap(); notesPanel.classList.remove('open'); notesBackdrop.classList.remove('visible'); STATE.searchTags = []; const si = $('notes-search-input'); if (si) si.value = ''; renderSearchTags(); }

$('btn-notes').addEventListener('click', openNotes);
$('btn-close-notes').addEventListener('click', closeNotes);
notesBackdrop.addEventListener('click', closeNotes);

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (!discoverView.classList.contains('hidden')) { closeDiscover(); return; }
        if (!chatPanel.classList.contains('hidden')) { closeChat(); return; }
        if (!noteDetail.classList.contains('hidden')) { closeDetail(); return; }
        if (notesPanel.classList.contains('open')) { closeNotes(); }
    }
});

async function loadNotes() {
    notesList.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">⌛</div><div class="notes-empty-text">Loading…</div></div>';
    try {
        const profile = STATE.profile || 'combined';
        const searchInput = $('notes-search-input');
        const queryText = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const activeTags = STATE.searchTags || [];

        let notes = await api.getNotesAPI(profile);
        
        // Filter by tags and search query locally
        if (activeTags.length) {
            notes = notes.filter(n => activeTags.every(t => n.tags && n.tags.includes(t)));
        }
        if (queryText) {
            notes = notes.filter(n => 
                (n.raw_text && n.raw_text.toLowerCase().includes(queryText)) ||
                (n.summary && n.summary.toLowerCase().includes(queryText))
            );
        }

        STATE.notes = notes;
        if (!notes.length) {
            const emptyMsg = (queryText || activeTags.length) ? 'No matching notes.' : 'No notes yet.<br/>Start capturing!';
            notesList.innerHTML = `<div class="notes-empty"><div class="notes-empty-icon">${(queryText || activeTags.length) ? '🔍' : '📝'}</div><div class="notes-empty-text">${emptyMsg}</div></div>`;
            return;
        }
        notesList.innerHTML = notes.map((n, i) => renderCard(n, i)).join('');
        notesList.querySelectorAll('.note-card').forEach(card => {
            card.addEventListener('click', () => {
                HAPTIC.tap();
                const note = STATE.notes.find(n => n.id === card.dataset.noteId);
                if (note) openDetail(note);
            });
        });
        // Make tags in cards clickable as search filters
        notesList.querySelectorAll('.tag[data-tag]').forEach(tag => {
            tag.addEventListener('click', e => {
                e.stopPropagation();
                HAPTIC.tap();
                addSearchTag(tag.dataset.tag);
            });
        });
    } catch (e) {
        console.error("Failed to load notes:", e);
        notesList.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">⚠️</div><div class="notes-empty-text">Failed to load.<br/><span style="font-size:0.7rem;opacity:0.7;">Check console for errors</span></div></div>';
    }
}

function renderCard(note, i) {
    const time = new Date(note.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const tags = (note.tags || []).slice(0, 3).map(t => `<span class="tag" data-tag="${esc(t)}">#${esc(t)}</span>`).join('');
    const who = STATE.profile === 'combined' ? `<span class="notes-profile-badge ${note.profile === 'prineeth' ? 'prineeth' : 'pramoddini'}">${note.profile[0].toUpperCase()}</span>` : '';
    const imgCount = (note.images || []).length;
    const imgBadge = imgCount ? `<span class="note-img-badge">📷 ${imgCount}</span>` : '';
    return `<article class="note-card profile-${note.profile} status-${note.status}" data-note-id="${note.id}" style="animation-delay:${i * 40}ms">
        ${who ? `<div class="note-card-top" style="justify-content: flex-end;">${who}</div>` : ''}
        <div class="note-card-raw">${esc(note.raw_text)}</div>
        ${tags || imgBadge ? `<div class="note-card-tags">${tags}${imgBadge}</div>` : ''}
        <div class="note-card-meta"><span>${time}</span></div>
    </article>`;
}

// ─── Note Detail ─────────────────────────────────────────────
function openDetail(note) {
    STATE.activeNote = note;
    noteDetail.classList.remove('hidden');
    renderDetail(note);
    loadChatsForNote(note.id);
}
function closeDetail() { HAPTIC.tap(); noteDetail.classList.add('hidden'); STATE.activeNote = null; }
$('btn-detail-back').addEventListener('click', closeDetail);

function renderDetail(note) {
    const time = new Date(note.created_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const SE = { positive: '😊', negative: '😔', neutral: '😐', mixed: '🤔' };
    const tags = (note.tags || []).map(t => `<span class="tag tag-editable" data-tag="${esc(t)}">#${esc(t)}<button class="tag-remove" data-tag="${esc(t)}" aria-label="Remove tag">×</button></span>`).join('');
    const ins = note.insights || {};
    let iHTML = '';
    if (ins.themes?.length) iHTML += insightCard('🎯', 'Key Themes', 'themes', ins.themes, note.id);
    if (ins.references?.length) iHTML += insightCard('🔗', 'Related Concepts', 'references', ins.references, note.id);
    if (ins.books?.length) iHTML += insightCard('📚', 'Recommended Reading', 'books', ins.books, note.id);
    if (ins.follow_ups?.length) iHTML += insightCard('💭', 'Questions to Explore', 'follow_ups', ins.follow_ups, note.id);

    // Build images section
    const images = note.images || [];
    let imagesHTML = '';
    if (images.length || (STATE.profile !== 'combined')) {
        imagesHTML = `<div class="detail-section"><div class="detail-section-label">Images</div><div class="detail-images">
            ${images.map(img => `<div class="detail-image-wrap">
                <img src="${esc(img.url)}" alt="Note image" class="detail-image" loading="lazy" />
                <button class="detail-image-delete" data-filename="${esc(img.filename)}" aria-label="Remove image">×</button>
            </div>`).join('')}
            ${STATE.profile !== 'combined' ? `<button class="detail-image-upload" id="btn-upload-image" aria-label="Add image">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                Add
            </button>` : ''}
        </div></div>`;
    }

    // Keep the chats-list div at the bottom (we populate it separately)
    detailBody.innerHTML = `
        <div class="detail-section"><div class="detail-section-label">Your note</div><div class="detail-raw-text" id="detail-raw-text">${esc(note.raw_text)}</div></div>
        ${imagesHTML}
        ${note.summary ? `<div class="detail-section"><div class="detail-section-label">AI Summary</div><div class="detail-summary">${esc(note.summary)}</div></div>` : ''}
        <div class="detail-section"><div class="detail-section-label">Tags</div><div class="detail-tags" id="detail-tags-container">${tags}<button class="tag tag-add" id="btn-add-tag" aria-label="Add tag">+ Add</button></div></div>
        <div class="detail-section"><div class="detail-section-label">Details</div><div class="detail-meta">
            ${note.category ? `<span class="detail-meta-item"><span class="category-badge">${note.category}</span></span>` : ''}
            ${note.sentiment ? `<span class="detail-meta-item">${SE[note.sentiment] || ''} ${note.sentiment}</span>` : ''}
            <span class="detail-meta-item">📅 ${time}</span><span class="detail-meta-item">👤 ${note.profile}</span>
        </div></div>
        ${iHTML ? `<div class="detail-divider"></div>${iHTML}` : ''}
        <div class="detail-divider"></div>
        <div id="chats-list" class="chats-list"></div>`;

    // Bind explore buttons
    detailBody.querySelectorAll('.btn-explore').forEach(btn => {
        btn.addEventListener('click', () => { FX.pop(); exploreSection(btn.dataset.section, btn.dataset.noteId, btn); });
    });

    // Bind tag remove buttons
    detailBody.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            HAPTIC.tap();
            const tagToRemove = btn.dataset.tag;
            const newTags = (STATE.activeNote.tags || []).filter(t => t !== tagToRemove);
            updateNoteTags(STATE.activeNote.id, newTags);
        });
    });

    // Bind add tag button
    const addBtn = $('btn-add-tag');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            HAPTIC.tap();
            addBtn.style.display = 'none';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'tag-input';
            input.placeholder = 'new-tag';
            input.maxLength = 30;
            $('detail-tags-container').appendChild(input);
            input.focus();

            const commitTag = () => {
                const val = input.value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                input.remove();
                addBtn.style.display = '';
                if (val && !(STATE.activeNote.tags || []).includes(val)) {
                    const newTags = [...(STATE.activeNote.tags || []), val];
                    updateNoteTags(STATE.activeNote.id, newTags);
                }
            };
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); commitTag(); }
                if (e.key === 'Escape') { input.remove(); addBtn.style.display = ''; }
            });
            input.addEventListener('blur', commitTag);
        });
    }

    // Bind image upload button
    const uploadBtn = $('btn-upload-image');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => { HAPTIC.tap(); triggerImageUpload(note.id); });
    }

    // Bind image delete buttons
    detailBody.querySelectorAll('.detail-image-delete').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            deleteImage(note.id, btn.dataset.filename);
        });
    });
}

function insightCard(emoji, title, sectionKey, items, noteId) {
    return `<div class="insight-card" id="insight-${sectionKey}">
        <div class="insight-card-header">
            <div class="insight-card-title"><span class="insight-emoji">${emoji}</span> ${title}</div>
            <button class="btn-explore" data-section="${sectionKey}" data-note-id="${noteId}">
                <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                Explore more
            </button>
        </div>
        <ul class="insight-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        <div class="explore-results" id="explore-${sectionKey}"></div>
    </div>`;
}

async function exploreSection(section, noteId, btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="explore-spinner"></span> Researching…';

    const container = document.getElementById(`explore-${section}`);
    if (!container) return;

    try {
        const results = await api.exploreNoteAPI(noteId, section);
        FX.chime();
        container.innerHTML = renderExploreResults(section, results);
        btn.innerHTML = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Done';
    } catch (e) {
        console.error("Explore section failed:", e);
        btn.disabled = false;
        btn.innerHTML = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Try again';
    }
}

function renderExploreResults(section, results) {
    if (!Array.isArray(results) || !results.length) return '<p class="explore-empty">No additional results found.</p>';

    switch (section) {
        case 'themes':
            return `<div class="explore-grid">${results.map(r => `
                <div class="explore-item">
                    <div class="explore-item-title">${esc(r.theme || r.name || '')}</div>
                    <div class="explore-item-desc">${esc(r.explanation || '')}</div>
                    ${r.connections ? `<div class="explore-item-meta">${esc(r.connections)}</div>` : ''}
                </div>`).join('')}</div>`;

        case 'references':
            return `<div class="explore-grid">${results.map(r => `
                <div class="explore-item">
                    <div class="explore-item-title">${esc(r.concept || r.name || '')}</div>
                    <div class="explore-item-desc">${esc(r.description || '')}</div>
                    ${r.relevance ? `<div class="explore-item-meta">↳ ${esc(r.relevance)}</div>` : ''}
                </div>`).join('')}</div>`;

        case 'books':
            return `<div class="explore-grid">${results.map(r => `
                <div class="explore-item explore-book">
                    <div class="explore-item-title">📖 ${esc(r.title || '')}</div>
                    <div class="explore-item-author">by ${esc(r.author || 'Unknown')}</div>
                    <div class="explore-item-desc">${esc(r.reason || '')}</div>
                </div>`).join('')}</div>`;

        case 'follow_ups':
            return `<ul class="explore-questions">${results.map(q =>
                `<li class="explore-question">${esc(typeof q === 'string' ? q : q.question || '')}</li>`
            ).join('')}</ul>`;

        default:
            return '';
    }
}

async function loadChatsForNote(noteId) {
    const container = document.getElementById('chats-list');
    if (!container) return;

    const profile = STATE.profile === 'combined' ? '' : STATE.profile;
    try {
        const res = { ok: true, json: async () => await api.getChatsAPI(profile, noteId) };
        if (!res.ok) { container.innerHTML = ''; return; }
        const chats = await res.json();

        if (!chats.length) {
            container.innerHTML = `<div class="chats-list-label">💬 Conversations</div><div style="font-size:0.82rem;color:var(--text-muted);padding:0.5rem 0">No chats yet — tap Chat to start one.</div>`;
            return;
        }

        container.innerHTML = `
            <div class="chats-list-label">💬 Previous Conversations</div>
            ${chats.map(c => {
            const time = new Date(c.updated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            return `<div class="chat-card" data-chat-id="${c.id}">
                    <span class="chat-card-icon">💬</span>
                    <div class="chat-card-body">
                        <div class="chat-card-title">${esc(c.title)}</div>
                        <div class="chat-card-meta">${time}</div>
                    </div>
                </div>`;
        }).join('')}`;

        container.querySelectorAll('.chat-card').forEach(card => {
            card.addEventListener('click', () => resumeChat(card.dataset.chatId));
        });
    } catch { container.innerHTML = ''; }
}

// ─── Reprocess ───────────────────────────────────────────────
$('btn-reprocess').addEventListener('click', async () => {
    if (!STATE.activeNote) return;
    $('btn-reprocess').disabled = true;
    try {
        await api.reprocessNoteAPI(STATE.activeNote.id);
        const poll = setInterval(async () => {
            if (!STATE.activeNote) { clearInterval(poll); $('btn-reprocess').disabled = false; return; }
            const notes = await api.getNotesAPI(STATE.profile);
            if (!STATE.activeNote) { clearInterval(poll); $('btn-reprocess').disabled = false; return; }
            const upd = notes.find(n => n.id === STATE.activeNote.id);
            if (upd && upd.status === 'processed') { clearInterval(poll); STATE.activeNote = upd; STATE.notes = notes; renderDetail(upd); loadChatsForNote(upd.id); $('btn-reprocess').disabled = false; }
        }, 2000);
        setTimeout(() => { clearInterval(poll); $('btn-reprocess').disabled = false; }, 30000);
    } catch { $('btn-reprocess').disabled = false; }
});

// ─── Edit Note ───────────────────────────────────────────────
$('btn-edit-note').addEventListener('click', () => {
    if (!STATE.activeNote || STATE.profile === 'combined') return;
    HAPTIC.tap();
    const rawEl = $('detail-raw-text');
    if (!rawEl) return;

    // Replace the text with an editable textarea
    const currentText = STATE.activeNote.raw_text;
    rawEl.innerHTML = `<textarea class="edit-note-textarea" id="edit-note-textarea">${esc(currentText)}</textarea>
        <div class="edit-note-actions">
            <button class="btn btn-ghost btn-sm" id="edit-cancel">Cancel</button>
            <button class="btn btn-accent btn-sm" id="edit-save">Save & Re-analyze</button>
        </div>`;

    const ta = $('edit-note-textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    $('edit-cancel').addEventListener('click', () => {
        HAPTIC.tap();
        renderDetail(STATE.activeNote);
        loadChatsForNote(STATE.activeNote.id);
    });

    $('edit-save').addEventListener('click', async () => {
        const newText = ta.value.trim();
        if (!newText) return;
        $('edit-save').disabled = true;
        $('edit-save').textContent = 'Saving…';
        try {
            await api.updateNoteAPI(STATE.activeNote.id, newText, STATE.profile);
            FX.chime();
            STATE.activeNote.raw_text = newText;
            STATE.activeNote.status = 'pending';
            STATE.activeNote.summary = null;
            STATE.activeNote.tags = [];
            STATE.activeNote.category = null;
            STATE.activeNote.sentiment = null;
            STATE.activeNote.insights = {};
            renderDetail(STATE.activeNote);
            loadChatsForNote(STATE.activeNote.id);
            // Poll for re-processing
            const poll = setInterval(async () => {
                if (!STATE.activeNote) { clearInterval(poll); return; }
                const notes = await api.getNotesAPI(STATE.profile);
                if (!STATE.activeNote) { clearInterval(poll); return; }
                const upd = notes.find(n => n.id === STATE.activeNote.id);
                if (upd && upd.status === 'processed') {
                    clearInterval(poll); STATE.activeNote = upd; STATE.notes = notes;
                    renderDetail(upd); loadChatsForNote(upd.id);
                }
            }, 2000);
            setTimeout(() => clearInterval(poll), 30000);
        } catch {
            $('edit-save').disabled = false;
            $('edit-save').textContent = 'Save & Re-analyze';
        }
    });
});

// ─── Delete Note ─────────────────────────────────────────────
let confirmResolve = null;
function showConfirmDialog(title, text, okLabel = 'Delete') {
    $('confirm-dialog-title').textContent = title;
    $('confirm-dialog-text').textContent = text;
    $('confirm-ok').textContent = okLabel;
    $('confirm-dialog').classList.remove('hidden');
    return new Promise(resolve => { confirmResolve = resolve; });
}
$('confirm-cancel').addEventListener('click', () => {
    HAPTIC.tap();
    $('confirm-dialog').classList.add('hidden');
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
});
$('confirm-ok').addEventListener('click', () => {
    HAPTIC.pop();
    $('confirm-dialog').classList.add('hidden');
    if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
});

$('btn-delete-note').addEventListener('click', async () => {
    if (!STATE.activeNote) return;
    const ok = await showConfirmDialog('Delete this note?', 'This will also remove any linked chats and memory references. This cannot be undone.');
    if (!ok) return;

    try {
        await api.deleteNoteAPI(STATE.activeNote.id);
        FX.swoosh();
        closeDetail();
        loadNotes();
    } catch (e) {
        console.error("Failed to delete note:", e);
    }
});

// ─── Update Tags Helper ──────────────────────────────────────
async function updateNoteTags(noteId, newTags) {
    try {
        const tags = await api.updateNoteTagsAPI(noteId, newTags);
        STATE.activeNote.tags = tags;
        // Update the note in the notes list too
        const idx = STATE.notes.findIndex(n => n.id === noteId);
        if (idx >= 0) STATE.notes[idx].tags = tags;
        renderDetail(STATE.activeNote);
        loadChatsForNote(STATE.activeNote.id);
        FX.tap();
    } catch { }
}

// ─── Chat ────────────────────────────────────────────────────
function openChat() {
    // Only haptic when opening chat from Notes
    HAPTIC.tap();
    STATE.chatId = null;
    STATE.chatHistory = [];
    chatTitle.textContent = 'New Chat';
    chatSubtitle.textContent = STATE.activeNote ? STATE.activeNote.raw_text.slice(0, 40) + '…' : '';
    chatPanel.classList.remove('hidden');
    chatMessages.innerHTML = `<div class="chat-bubble chat-bubble-ai">Hi! I've read your note. What would you like to explore?</div>`;
    requestAnimationFrame(() => $('chat-input').focus());
}

async function resumeChat(chatId) {
    HAPTIC.tap();
    try {
        const res = { ok: true, json: async () => await api.getChatByIdAPI(chatId) };
        if (!res.ok) return;
        const chat = await res.json();

        STATE.chatId = chat.id;
        STATE.chatHistory = chat.messages || [];
        chatTitle.textContent = chat.title || 'Chat';
        chatSubtitle.textContent = STATE.activeNote ? STATE.activeNote.raw_text.slice(0, 40) + '…' : '';
        chatPanel.classList.remove('hidden');

        // Render existing messages
        chatMessages.innerHTML = STATE.chatHistory.map(m =>
            `<div class="chat-bubble ${m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}">${m.role === 'user' ? esc(m.text) : fmtReply(m.text)}</div>`
        ).join('');
        chatMessages.scrollTop = chatMessages.scrollHeight;
        requestAnimationFrame(() => $('chat-input').focus());
    } catch { }
}

function closeChat() {
    HAPTIC.tap();
    chatPanel.classList.add('hidden');
    // Refresh the chats list in detail view
    if (STATE.activeNote && !noteDetail.classList.contains('hidden')) {
        loadChatsForNote(STATE.activeNote.id);
    }
}

$('btn-open-chat').addEventListener('click', openChat);
$('btn-close-chat').addEventListener('click', closeChat);
$('btn-new-chat').addEventListener('click', () => {
    // Start a fresh chat even if we're resuming one
    openChat();
});

$('chat-form').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text || !STATE.activeNote) return;
    // Removed sound from chat submit, just keep haptic
    HAPTIC.pop();
    chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-user">${esc(text)}</div>`;
    $('chat-input').value = '';
    chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-thinking" id="thinking-indicator"><div class="thinking-dots"><span></span><span></span><span></span></div></div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const res = await api.sendChatAPI(STATE.profile, STATE.activeNote.id, STATE.chatId, text);
        const ti = $('thinking-indicator'); if (ti) ti.remove();
        const reply = res.response;

        // Update local state
        STATE.chatHistory.push({ role: 'user', content: text, text: text });
        STATE.chatHistory.push({ role: 'assistant', content: reply, text: reply });

        // Update active chatId if this is a new conversation
        if (!STATE.chatId) {
            STATE.chatId = res.id;
            fetchLatestChatId(STATE.activeNote.id);
        }

        chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-ai">${fmtReply(reply)}</div>`;
        chatMessages.scrollTop = chatMessages.scrollHeight;
        FX.chime(); // Sound on reply
    } catch (err) {
        console.error("Chat error:", err);
        const ti = $('thinking-indicator'); if (ti) ti.remove();
        chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-ai" style="color:var(--error)">Something went wrong. Try again.</div>`;
    }
});

async function fetchLatestChatId(noteId) {
    try {
        const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
        const chats = await api.getChatsAPI(profile, noteId);
        if (chats.length) {
            STATE.chatId = chats[0].id; // most recent
            const c = chats[0];
            if (c.title) chatTitle.textContent = c.title;
        }
    } catch { }
}

function fmtReply(t) { return esc(t).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>'); }

// ─── Discover ────────────────────────────────────────────────
const CARD_EMOJI = { quote: '📖', question: '💭', recommendation: '📚', observation: '🔮', excerpt: '✍️' };

function openDiscover() { FX.tap(); discoverView.classList.remove('hidden'); loadDiscoverCards(); }
function closeDiscover() { HAPTIC.tap(); discoverView.classList.add('hidden'); }

$('btn-discover').addEventListener('click', openDiscover);
$('btn-close-discover').addEventListener('click', closeDiscover);
$('btn-gen-cards').addEventListener('click', generateCards);

// Discover filter pills
document.querySelectorAll('.discover-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        HAPTIC.tap();
        document.querySelectorAll('.discover-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        STATE.discoverFilter = pill.dataset.filter;
        renderDiscoverStack();
    });
});
$('btn-gen-cards-empty').addEventListener('click', generateCards);

$('btn-dismiss-card').addEventListener('click', () => {
    const top = discoverStack.lastElementChild;
    if (!top) return;
    FX.swoosh();
    top.classList.add('fly-left');
    respondToCard(top.dataset.id, 'dismissed');
    setTimeout(removeTopCard, 400);
});
$('btn-accept-card').addEventListener('click', () => {
    const top = discoverStack.lastElementChild;
    if (!top) return;
    FX.swoosh();
    top.classList.add('fly-right');
    respondToCard(top.dataset.id, 'accepted');
    setTimeout(removeTopCard, 400);
});

async function generateCards() {
    const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
    $('btn-gen-cards').disabled = true;
    try {
        await api.generateDiscoverAPI(profile);
        setTimeout(async () => { await loadDiscoverCards(); $('btn-gen-cards').disabled = false; }, 8000);
    } catch { $('btn-gen-cards').disabled = false; }
}

async function loadDiscoverCards() {
    const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
    try {
        const res = { ok: true, json: async () => await api.getDiscoverCardsAPI(profile) };
        const cards = await res.json();
        STATE.discoverCards = cards;
        renderDiscoverStack();
    } catch { }
}

function getFilteredDiscoverCards() {
    if (STATE.discoverFilter === 'all') return STATE.discoverCards;
    return STATE.discoverCards.filter(c => c.card_type === STATE.discoverFilter);
}

function renderDiscoverStack() {
    const cards = getFilteredDiscoverCards();
    if (!cards.length) {
        discoverStack.classList.add('hidden');
        discoverEmpty.classList.remove('hidden');
        // Update empty text based on filter
        const emptyText = discoverEmpty.querySelector('.discover-empty-text');
        if (STATE.discoverFilter !== 'all' && STATE.discoverCards.length > 0) {
            emptyText.innerHTML = `No <strong>${STATE.discoverFilter}</strong> cards right now.<br/>Try another filter or generate more.`;
        } else {
            emptyText.innerHTML = 'No new cards yet.<br/>Keep capturing notes — your feed will grow.';
        }
        return;
    }
    discoverStack.classList.remove('hidden');
    discoverEmpty.classList.add('hidden');
    discoverStack.innerHTML = '';
    const visible = cards.slice(0, 3).reverse();
    visible.forEach(card => {
        const el = document.createElement('div');
        el.className = 'swipe-card';
        el.dataset.id = card.id;
        el.dataset.type = card.card_type;
        el.innerHTML = `
            <div class="card-type-label"><span class="card-type-emoji">${CARD_EMOJI[card.card_type] || '✨'}</span> ${card.card_type}</div>
            <div class="card-content">${esc(card.content)}</div>
            ${card.source ? `<div class="card-source">${esc(card.source)}</div>` : ''}`;
        discoverStack.appendChild(el);
    });
    const topCard = discoverStack.lastElementChild;
    if (topCard) attachSwipe(topCard);
}

// ─── Swipe Gesture Handler ───────────────────────────────────
function attachSwipe(card) {
    let startX = 0, currentX = 0, dragging = false;
    const THRESHOLD = 80;

    function onStart(e) {
        if (e.button && e.button !== 0) return; // Only left click
        dragging = true;
        startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        currentX = 0;
        card.style.transition = 'none';
    }
    function onMove(e) {
        if (!dragging) return;
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        currentX = clientX - startX;

        if (Math.abs(currentX) > 5 && e.cancelable) {
            e.preventDefault(); // Stop scrolling/dragging selection when swiping
        }

        const rot = currentX * 0.05;
        const opacity = Math.max(0.4, 1 - Math.abs(currentX) / 500);
        card.style.transform = `translateX(${currentX}px) rotate(${rot}deg)`;
        card.style.opacity = opacity;
        card.classList.toggle('swiping-left', currentX < -40);
        card.classList.toggle('swiping-right', currentX > 40);
    }
    function onEnd() {
        if (!dragging) return;
        dragging = false;
        card.classList.remove('swiping-left', 'swiping-right');
        card.style.transition = '';
        if (currentX > THRESHOLD) {
            FX.swoosh();
            card.classList.add('fly-right');
            respondToCard(card.dataset.id, 'accepted');
            setTimeout(removeTopCard, 400);
        } else if (currentX < -THRESHOLD) {
            FX.swoosh();
            card.classList.add('fly-left');
            respondToCard(card.dataset.id, 'dismissed');
            setTimeout(removeTopCard, 400);
        } else {
            card.style.transform = ''; card.style.opacity = '';
        }
    }

    card.addEventListener('mousedown', onStart);
    card.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('mousemove', onMove, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);

    card._swipeCleanup = () => {
        card.removeEventListener('mousedown', onStart);
        card.removeEventListener('touchstart', onStart);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchend', onEnd);
        document.removeEventListener('touchcancel', onEnd);
    };
}

function removeTopCard() {
    STATE.discoverCards.shift();
    const top = discoverStack.lastElementChild;
    if (top?._swipeCleanup) top._swipeCleanup();
    renderDiscoverStack();
    updateDiscoverBadge();
}

async function respondToCard(cardId, status) {
    try { await api.updateDiscoverCardAPI(cardId, status); } catch { }
}

async function updateDiscoverBadge() {
    const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
    if (!profile || !STATE.pin) return;
    try {
        const res = { ok: true, json: async () => ({ count: await api.countUnseenCardsAPI(profile) }) };
        const { count } = await res.json();
        discoverBadge.textContent = count;
        discoverBadge.classList.toggle('hidden', count === 0);
    } catch { }
}

setInterval(() => { if (STATE.pin && STATE.profile) updateDiscoverBadge(); }, 5 * 60 * 1000);

// ─── Search ──────────────────────────────────────────────────
let searchTimeout = null;
const searchInput = $('notes-search-input');
if (searchInput) {
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => loadNotes(), 300);
    });
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') { searchInput.value = ''; STATE.searchTags = []; renderSearchTags(); loadNotes(); }
    });
}

function addSearchTag(tag) {
    if (!STATE.searchTags.includes(tag)) {
        STATE.searchTags.push(tag);
        renderSearchTags();
        loadNotes();
    }
}

function removeSearchTag(tag) {
    STATE.searchTags = STATE.searchTags.filter(t => t !== tag);
    renderSearchTags();
    loadNotes();
}

function renderSearchTags() {
    const container = $('notes-tag-filters');
    if (!container) return;
    if (!STATE.searchTags.length) { container.classList.add('hidden'); container.innerHTML = ''; return; }
    container.classList.remove('hidden');
    container.innerHTML = STATE.searchTags.map(t =>
        `<span class="search-tag-chip">#${esc(t)}<button class="search-tag-remove" data-tag="${esc(t)}">×</button></span>`
    ).join('');
    container.querySelectorAll('.search-tag-remove').forEach(btn => {
        btn.addEventListener('click', () => { HAPTIC.tap(); removeSearchTag(btn.dataset.tag); });
    });
}

// ─── Image Upload ────────────────────────────────────────────
const imageUploadInput = $('image-upload-input');

function triggerImageUpload(noteId) {
    imageUploadInput.dataset.noteId = noteId;
    imageUploadInput.click();
}

if (imageUploadInput) {
    imageUploadInput.addEventListener('change', async e => {
        const noteId = imageUploadInput.dataset.noteId;
        if (!noteId || !e.target.files.length) return;

        for (const file of e.target.files) {
            await uploadImage(noteId, file);
        }
        imageUploadInput.value = '';
        // Refresh detail view
        await refreshActiveNote();
    });
}

async function uploadImage(noteId, file) {
    try {
        const res = await api.uploadImageAPI(noteId, file);
        if (res.error) {
            alert(res.error);
            return null;
        }
        FX.tap();
        return res;
    } catch {
        return null;
    }
}

async function deleteImage(noteId, filename) {
    const ok = await showConfirmDialog('Remove this image?', 'The image will be permanently deleted.', 'Remove');
    if (!ok) return;
    try {
        await api.deleteImageAPI(noteId, filename);
        FX.swoosh();
        await refreshActiveNote();
    } catch { }
}

async function refreshActiveNote() {
    if (!STATE.activeNote) return;
    const res = { ok: true, json: async () => await api.getNotesAPI(STATE.profile) };
    const notes = await res.json();
    if (!STATE.activeNote) return;
    const upd = notes.find(n => n.id === STATE.activeNote.id);
    if (upd) { STATE.activeNote = upd; STATE.notes = notes; renderDetail(upd); loadChatsForNote(upd.id); }
}

// ─── Utils ───────────────────────────────────────────────────
function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// ─── Init ────────────────────────────────────────────────────
async function init() {
    // Apply styling/theme
    if (STATE.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    if (STATE.uiStyle !== 'default') document.documentElement.setAttribute('data-style', STATE.uiStyle);
    
    verifySession();
}

init();

/* ============================================================
   Noteworthy — app.js (Persistent Chat Edition)
   PIN → Profile → Capture → Notes/Detail/Chat → Discover
   ============================================================ */

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
};

// Apply theme class right away to avoid initial layout flicker if light mode active
if (STATE.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');

function saveState() {
    if (STATE.pin) localStorage.setItem('nw_pin', STATE.pin);
    if (STATE.profile) localStorage.setItem('nw_profile', STATE.profile);
    localStorage.setItem('nw_theme', STATE.theme);
}
function clearState() {
    STATE.pin = null; STATE.profile = null;
    localStorage.removeItem('nw_pin'); localStorage.removeItem('nw_profile');
}

// ─── DOM ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const pinView = $('pin-view');
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

const pinDots = document.querySelectorAll('.pin-dot');
const pinKeys = document.querySelectorAll('.pin-key[data-digit]');
const pinBackspace = $('pin-backspace');
const pinError = $('pin-error');
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

// ─── Auth ────────────────────────────────────────────────────
async function validatePin(pin) {
    const r = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
    });
    return r.ok;
}
function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${STATE.pin}` };
}

// ─── Views ───────────────────────────────────────────────────
function showView(view) {
    [pinView, profileView, captureView].forEach(v => v.classList.add('hidden'));
    view.classList.remove('hidden');
    view.style.animation = 'none'; void view.offsetHeight; view.style.animation = '';
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

// ─── PIN ─────────────────────────────────────────────────────
let pinEntry = '';
function updateDots() {
    pinDots.forEach((d, i) => { d.classList.toggle('filled', i < pinEntry.length); d.classList.remove('error'); });
}
function flashError(msg) {
    pinError.textContent = msg;
    pinDots.forEach(d => { d.classList.remove('filled'); d.classList.add('error'); });
    pinEntry = '';
    setTimeout(() => { pinDots.forEach(d => d.classList.remove('error')); pinError.textContent = ''; }, 1200);
}
async function submitPin() {
    if (await validatePin(pinEntry).catch(() => false)) {
        STATE.pin = pinEntry; saveState(); pinEntry = ''; updateDots(); showView(profileView);
    } else { flashError('Wrong PIN'); }
}
pinKeys.forEach(k => k.addEventListener('click', () => {
    FX.tap();
    if (pinEntry.length >= 6) return;
    pinEntry += k.dataset.digit; updateDots();
    if (pinEntry.length === 6) submitPin();
}));
pinBackspace.addEventListener('click', () => { FX.tap(); pinEntry = pinEntry.slice(0, -1); updateDots(); });
document.addEventListener('keydown', e => {
    if (!pinView.classList.contains('hidden')) {
        if (/^[0-9]$/.test(e.key) && pinEntry.length < 6) { pinEntry += e.key; updateDots(); if (pinEntry.length === 6) submitPin(); }
        else if (e.key === 'Backspace') { pinEntry = pinEntry.slice(0, -1); updateDots(); }
    }
});

// ─── Profile & Theme ─────────────────────────────────────────
profileCards.forEach(c => c.addEventListener('click', () => { FX.tap(); setProfile(c.dataset.profile); }));
profileBadge.addEventListener('click', () => { FX.tap(); showView(profileView); });

$('btn-theme-toggle').addEventListener('click', () => {
    FX.tap();
    STATE.theme = STATE.theme === 'light' ? 'dark' : 'light';
    saveState();
    if (STATE.theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
});

// ─── Capture ─────────────────────────────────────────────────
noteInput.addEventListener('input', () => {
    const len = noteInput.value.length;
    charCount.textContent = len.toLocaleString(); btnSend.disabled = len === 0;
});

async function sendNote() {
    const text = noteInput.value.trim();
    if (!text || !STATE.profile || STATE.profile === 'combined') return;
    FX.pop();
    btnSend.disabled = true;
    try {
        const res = await fetch('/api/notes', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ raw_text: text, profile: STATE.profile }) });
        if (res.status === 401) { clearState(); showView(pinView); return; }
        if (!res.ok) throw new Error('Failed');
        FX.chime();
        noteInput.classList.add('note-clearing');
        successRipple.classList.add('active');
        setTimeout(() => { noteInput.value = ''; noteInput.classList.remove('note-clearing'); charCount.textContent = '0'; btnSend.disabled = true; noteInput.focus(); }, 280);
        setTimeout(() => successRipple.classList.remove('active'), 800);
    } catch { btnSend.disabled = false; }
}
btnSend.addEventListener('click', sendNote);
noteInput.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnSend.disabled) { e.preventDefault(); sendNote(); } });

// ─── Notes Panel ─────────────────────────────────────────────
function openNotes() { FX.tap(); notesPanel.classList.add('open'); notesBackdrop.classList.add('visible'); loadNotes(); }
function closeNotes() { FX.tap(); notesPanel.classList.remove('open'); notesBackdrop.classList.remove('visible'); }

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
    notesList.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">⏳</div><div class="notes-empty-text">Loading…</div></div>';
    try {
        const profile = STATE.profile || 'combined';
        const res = await fetch(`/api/notes?profile=${profile}`, { headers: authHeaders() });
        if (res.status === 401) { clearState(); showView(pinView); return; }
        const notes = await res.json();
        STATE.notes = notes;
        if (!notes.length) {
            notesList.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">📝</div><div class="notes-empty-text">No notes yet.<br/>Start capturing!</div></div>';
            return;
        }
        notesList.innerHTML = notes.map((n, i) => renderCard(n, i)).join('');
        notesList.querySelectorAll('.note-card').forEach(card => {
            card.addEventListener('click', () => {
                FX.tap();
                const note = STATE.notes.find(n => n.id === card.dataset.noteId);
                if (note) openDetail(note);
            });
        });
    } catch {
        notesList.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">⚠️</div><div class="notes-empty-text">Failed to load.</div></div>';
    }
}

function renderCard(note, i) {
    const time = new Date(note.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const tags = (note.tags || []).slice(0, 3).map(t => `<span class="tag">#${esc(t)}</span>`).join('');
    const who = STATE.profile === 'combined' ? `<span class="notes-profile-badge ${note.profile === 'prineeth' ? 'prineeth' : 'pramoddini'}">${note.profile[0].toUpperCase()}</span>` : '';
    return `<article class="note-card profile-${note.profile} status-${note.status}" data-note-id="${note.id}" style="animation-delay:${i * 40}ms">
        ${who ? `<div class="note-card-top" style="justify-content: flex-end;">${who}</div>` : ''}
        <div class="note-card-raw">${esc(note.raw_text)}</div>
        ${tags ? `<div class="note-card-tags">${tags}</div>` : ''}
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
function closeDetail() { FX.tap(); noteDetail.classList.add('hidden'); STATE.activeNote = null; }
$('btn-detail-back').addEventListener('click', closeDetail);

function renderDetail(note) {
    const time = new Date(note.created_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const SE = { positive: '😊', negative: '😔', neutral: '😐', mixed: '🤔' };
    const tags = (note.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('');
    const ins = note.insights || {};
    let iHTML = '';
    if (ins.themes?.length) iHTML += insightCard('🎯', 'Key Themes', 'themes', ins.themes, note.id);
    if (ins.references?.length) iHTML += insightCard('🔗', 'Related Concepts', 'references', ins.references, note.id);
    if (ins.books?.length) iHTML += insightCard('📚', 'Recommended Reading', 'books', ins.books, note.id);
    if (ins.follow_ups?.length) iHTML += insightCard('💭', 'Questions to Explore', 'follow_ups', ins.follow_ups, note.id);

    // Keep the chats-list div at the bottom (we populate it separately)
    detailBody.innerHTML = `
        <div class="detail-section"><div class="detail-section-label">Your note</div><div class="detail-raw-text">${esc(note.raw_text)}</div></div>
        ${note.summary ? `<div class="detail-section"><div class="detail-section-label">AI Summary</div><div class="detail-summary">${esc(note.summary)}</div></div>` : ''}
        ${tags ? `<div class="detail-section"><div class="detail-section-label">Tags</div><div class="detail-tags">${tags}</div></div>` : ''}
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
        const res = await fetch(`/api/notes/${noteId}/explore`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ section }),
        });
        if (!res.ok) throw new Error('Failed');
        const { results } = await res.json();
        FX.chime();
        container.innerHTML = renderExploreResults(section, results);
        btn.innerHTML = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Done';
    } catch {
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
        const res = await fetch(`/api/chats?profile=${profile}&noteId=${noteId}`, { headers: authHeaders() });
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
        await fetch(`/api/notes/${STATE.activeNote.id}/reprocess`, { method: 'POST', headers: authHeaders() });
        const poll = setInterval(async () => {
            const res = await fetch(`/api/notes?profile=${STATE.profile || 'combined'}`, { headers: authHeaders() });
            const notes = await res.json();
            const upd = notes.find(n => n.id === STATE.activeNote.id);
            if (upd && upd.status === 'processed') { clearInterval(poll); STATE.activeNote = upd; STATE.notes = notes; renderDetail(upd); loadChatsForNote(upd.id); $('btn-reprocess').disabled = false; }
        }, 2000);
        setTimeout(() => { clearInterval(poll); $('btn-reprocess').disabled = false; }, 30000);
    } catch { $('btn-reprocess').disabled = false; }
});

// ─── Chat ────────────────────────────────────────────────────
function openChat() {
    FX.tap();
    STATE.chatId = null;
    STATE.chatHistory = [];
    chatTitle.textContent = 'New Chat';
    chatSubtitle.textContent = STATE.activeNote ? STATE.activeNote.raw_text.slice(0, 40) + '…' : '';
    chatPanel.classList.remove('hidden');
    chatMessages.innerHTML = `<div class="chat-bubble chat-bubble-ai">Hi! I've read your note. What would you like to explore?</div>`;
    requestAnimationFrame(() => $('chat-input').focus());
}

async function resumeChat(chatId) {
    try {
        const res = await fetch(`/api/chats/${chatId}`, { headers: authHeaders() });
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
    FX.tap();
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
    FX.pop();
    chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-user">${esc(text)}</div>`;
    $('chat-input').value = '';
    chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-thinking" id="thinking-indicator"><div class="thinking-dots"><span></span><span></span><span></span></div></div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                noteId: STATE.activeNote.id,
                chatId: STATE.chatId,
                message: text,
                history: STATE.chatHistory,
            }),
        });
        const ti = $('thinking-indicator'); if (ti) ti.remove();
        if (!res.ok) throw new Error();
        const { reply } = await res.json();

        // Update local state
        STATE.chatHistory.push({ role: 'user', text });
        STATE.chatHistory.push({ role: 'model', text: reply });

        // If this was a new chat (first message), the server created it
        // We don't have the chatId yet, but next message will create another
        // Let's fetch the latest chat for this note to get the ID
        if (!STATE.chatId) {
            fetchLatestChatId(STATE.activeNote.id);
        }

        chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-ai">${fmtReply(reply)}</div>`;
        chatMessages.scrollTop = chatMessages.scrollHeight;
        FX.chime();
    } catch {
        const ti = $('thinking-indicator'); if (ti) ti.remove();
        chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-ai" style="color:var(--error)">Something went wrong. Try again.</div>`;
    }
});

async function fetchLatestChatId(noteId) {
    try {
        const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
        const res = await fetch(`/api/chats?profile=${profile}&noteId=${noteId}`, { headers: authHeaders() });
        const chats = await res.json();
        if (chats.length) {
            STATE.chatId = chats[0].id; // most recent
            // Update title after a moment (server generates it in background)
            setTimeout(async () => {
                try {
                    const r = await fetch(`/api/chats/${STATE.chatId}`, { headers: authHeaders() });
                    const c = await r.json();
                    if (c.title) chatTitle.textContent = c.title;
                } catch { }
            }, 5000);
        }
    } catch { }
}

function fmtReply(t) { return esc(t).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>'); }

// ─── Discover ────────────────────────────────────────────────
const CARD_EMOJI = { quote: '📖', question: '💭', recommendation: '📚', observation: '🔮', excerpt: '✍️' };

function openDiscover() { FX.tap(); discoverView.classList.remove('hidden'); loadDiscoverCards(); }
function closeDiscover() { FX.tap(); discoverView.classList.add('hidden'); }

$('btn-discover').addEventListener('click', openDiscover);
$('btn-close-discover').addEventListener('click', closeDiscover);
$('btn-gen-cards').addEventListener('click', generateCards);
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
        await fetch('/api/discover/generate', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ profile }) });
        setTimeout(async () => { await loadDiscoverCards(); $('btn-gen-cards').disabled = false; }, 8000);
    } catch { $('btn-gen-cards').disabled = false; }
}

async function loadDiscoverCards() {
    const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
    try {
        const res = await fetch(`/api/discover?profile=${profile}`, { headers: authHeaders() });
        const cards = await res.json();
        STATE.discoverCards = cards;
        renderDiscoverStack();
    } catch { }
}

function renderDiscoverStack() {
    const cards = STATE.discoverCards;
    if (!cards.length) {
        discoverStack.classList.add('hidden');
        discoverEmpty.classList.remove('hidden');
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
    try { await fetch(`/api/discover/${cardId}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ status }) }); } catch { }
}

async function updateDiscoverBadge() {
    const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
    if (!profile || !STATE.pin) return;
    try {
        const res = await fetch(`/api/discover/count?profile=${profile}`, { headers: authHeaders() });
        const { count } = await res.json();
        discoverBadge.textContent = count;
        discoverBadge.classList.toggle('hidden', count === 0);
    } catch { }
}

setInterval(() => { if (STATE.pin && STATE.profile) updateDiscoverBadge(); }, 5 * 60 * 1000);

// ─── Utils ───────────────────────────────────────────────────
function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// ─── Init ────────────────────────────────────────────────────
async function init() {
    if (STATE.pin) {
        const ok = await validatePin(STATE.pin).catch(() => false);
        if (ok) {
            if (STATE.profile) setProfile(STATE.profile); else showView(profileView);
            return;
        }
        clearState();
    }
    showView(pinView);
}

init();

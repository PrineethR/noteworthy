/* ============================================================
   Noteworthy — app.js (Detail View + Chat Edition)
   PIN → Profile → Capture → Notes → Detail → Chat
   ============================================================ */

// ─── State ───────────────────────────────────────────────────
const STATE = {
    pin: localStorage.getItem('nw_pin') || null,
    profile: localStorage.getItem('nw_profile') || null,
    notes: [],       // cached notes list
    activeNote: null,  // currently viewed note
    chatHistory: [],   // current chat messages [{role,text}]
};

function saveState() {
    if (STATE.pin) localStorage.setItem('nw_pin', STATE.pin);
    if (STATE.profile) localStorage.setItem('nw_profile', STATE.profile);
}

function clearState() {
    STATE.pin = null; STATE.profile = null;
    localStorage.removeItem('nw_pin');
    localStorage.removeItem('nw_profile');
}

// ─── DOM ─────────────────────────────────────────────────────
const pinView = document.getElementById('pin-view');
const profileView = document.getElementById('profile-view');
const captureView = document.getElementById('capture-view');
const notesPanel = document.getElementById('notes-panel');
const notesBackdrop = document.getElementById('notes-backdrop');
const notesList = document.getElementById('notes-list');
const noteDetail = document.getElementById('note-detail');
const detailBody = document.getElementById('detail-body');
const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');

const pinDots = document.querySelectorAll('.pin-dot');
const pinKeys = document.querySelectorAll('.pin-key[data-digit]');
const pinBackspace = document.getElementById('pin-backspace');
const pinError = document.getElementById('pin-error');

const profileCards = document.querySelectorAll('[data-profile]');
const activeLabel = document.getElementById('active-profile-label');
const profileBadge = document.getElementById('btn-switch-profile');
const notesBadge = document.getElementById('notes-profile-badge');

const noteInput = document.getElementById('note-input');
const charCount = document.getElementById('char-count');
const btnSend = document.getElementById('btn-send');
const successRipple = document.getElementById('success-ripple');
const btnNotes = document.getElementById('btn-notes');
const btnCloseNotes = document.getElementById('btn-close-notes');

const btnDetailBack = document.getElementById('btn-detail-back');
const btnReprocess = document.getElementById('btn-reprocess');
const btnOpenChat = document.getElementById('btn-open-chat');

const btnCloseChat = document.getElementById('btn-close-chat');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

// ─── Auth ────────────────────────────────────────────────────
async function validatePin(pin) {
    const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
    });
    return res.ok;
}

function authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${STATE.pin}` };
}

// ─── Views ───────────────────────────────────────────────────
function showView(view) {
    [pinView, profileView, captureView].forEach(v => v.classList.add('hidden'));
    view.classList.remove('hidden');
    view.style.animation = 'none';
    void view.offsetHeight;
    view.style.animation = '';
}

function setProfile(profile) {
    STATE.profile = profile;
    saveState();

    const names = { prineeth: 'Prineeth', pramoddini: 'Pramoddini', combined: 'Combined' };
    activeLabel.textContent = names[profile] || profile;
    profileBadge.className = `profile-badge profile-${profile}-active`;
    notesBadge.textContent = names[profile];
    notesBadge.className = `notes-profile-badge ${profile}`;

    showView(captureView);
    requestAnimationFrame(() => noteInput.focus());
}

// ─── PIN ─────────────────────────────────────────────────────
let pinEntry = '';

function updateDots() {
    pinDots.forEach((dot, i) => {
        dot.classList.toggle('filled', i < pinEntry.length);
        dot.classList.remove('error');
    });
}

function flashError(msg) {
    pinError.textContent = msg;
    pinDots.forEach(d => { d.classList.remove('filled'); d.classList.add('error'); });
    pinEntry = '';
    setTimeout(() => {
        pinDots.forEach(d => d.classList.remove('error'));
        pinError.textContent = '';
    }, 1200);
}

async function submitPin() {
    const ok = await validatePin(pinEntry).catch(() => false);
    if (ok) {
        STATE.pin = pinEntry;
        saveState();
        pinEntry = '';
        updateDots();
        showView(profileView);
    } else {
        flashError('Wrong PIN');
    }
}

pinKeys.forEach(key => {
    key.addEventListener('click', () => {
        if (pinEntry.length >= 6) return;
        pinEntry += key.dataset.digit;
        updateDots();
        if (pinEntry.length === 6) submitPin();
    });
});

pinBackspace.addEventListener('click', () => { pinEntry = pinEntry.slice(0, -1); updateDots(); });

document.addEventListener('keydown', (e) => {
    if (!pinView.classList.contains('hidden')) {
        if (/^[0-9]$/.test(e.key) && pinEntry.length < 6) {
            pinEntry += e.key; updateDots();
            if (pinEntry.length === 6) submitPin();
        } else if (e.key === 'Backspace') {
            pinEntry = pinEntry.slice(0, -1); updateDots();
        }
    }
});

// ─── Profile ─────────────────────────────────────────────────
profileCards.forEach(card => {
    card.addEventListener('click', () => setProfile(card.dataset.profile));
});
profileBadge.addEventListener('click', () => showView(profileView));

// ─── Capture ─────────────────────────────────────────────────
noteInput.addEventListener('input', () => {
    const len = noteInput.value.length;
    charCount.textContent = len.toLocaleString();
    btnSend.disabled = len === 0;
});

async function sendNote() {
    const text = noteInput.value.trim();
    if (!text || !STATE.profile || STATE.profile === 'combined') return;
    btnSend.disabled = true;

    try {
        const res = await fetch('/api/notes', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ raw_text: text, profile: STATE.profile }),
        });
        if (res.status === 401) { clearState(); showView(pinView); return; }
        if (!res.ok) throw new Error('Failed');

        noteInput.classList.add('note-clearing');
        successRipple.classList.add('active');

        setTimeout(() => {
            noteInput.value = '';
            noteInput.classList.remove('note-clearing');
            charCount.textContent = '0';
            btnSend.disabled = true;
            noteInput.focus();
        }, 280);
        setTimeout(() => successRipple.classList.remove('active'), 800);
    } catch (err) {
        console.error('Send error:', err);
        btnSend.disabled = false;
    }
}

btnSend.addEventListener('click', sendNote);
noteInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnSend.disabled) {
        e.preventDefault(); sendNote();
    }
});

// ─── Notes Panel ─────────────────────────────────────────────
function openNotes() {
    notesPanel.classList.add('open');
    notesBackdrop.classList.add('visible');
    loadNotes();
}

function closeNotes() {
    notesPanel.classList.remove('open');
    notesBackdrop.classList.remove('visible');
}

btnNotes.addEventListener('click', openNotes);
btnCloseNotes.addEventListener('click', closeNotes);
notesBackdrop.addEventListener('click', closeNotes);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
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

        // Attach click handlers
        notesList.querySelectorAll('.note-card').forEach(card => {
            card.addEventListener('click', () => {
                const note = STATE.notes.find(n => n.id === card.dataset.noteId);
                if (note) openDetail(note);
            });
        });
    } catch {
        notesList.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">⚠️</div><div class="notes-empty-text">Failed to load.</div></div>';
    }
}

// ─── Card Renderer (simplified) ──────────────────────────────
function renderCard(note, i) {
    const time = new Date(note.created_at).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });

    const tags = (note.tags || []).slice(0, 3).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
    const who = STATE.profile === 'combined'
        ? `<span class="note-who">${note.profile}</span>` : '';

    return `
        <article class="note-card profile-${note.profile}" data-note-id="${note.id}" style="animation-delay:${i * 40}ms">
            <div class="note-card-top">
                <span class="note-card-status status-${note.status}">
                    <span class="status-dot"></span>${note.status}
                </span>
                ${who}
            </div>
            <div class="note-card-raw">${escapeHtml(note.raw_text)}</div>
            ${tags ? `<div class="note-card-tags">${tags}</div>` : ''}
            <div class="note-card-meta"><span>${time}</span></div>
        </article>`;
}

// ─── Note Detail ─────────────────────────────────────────────
function openDetail(note) {
    STATE.activeNote = note;
    noteDetail.classList.remove('hidden');
    renderDetail(note);
}

function closeDetail() {
    noteDetail.classList.add('hidden');
    STATE.activeNote = null;
}

btnDetailBack.addEventListener('click', closeDetail);

function renderDetail(note) {
    const time = new Date(note.created_at).toLocaleString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    const SENTIMENT_EMOJI = { positive: '😊', negative: '😔', neutral: '😐', mixed: '🤔' };

    const tags = (note.tags || []).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
    const insights = note.insights || {};

    let insightsHTML = '';

    if (insights.themes?.length) {
        insightsHTML += renderInsightCard('🎯', 'Key Themes', insights.themes);
    }
    if (insights.references?.length) {
        insightsHTML += renderInsightCard('🔗', 'Related Concepts', insights.references);
    }
    if (insights.books?.length) {
        insightsHTML += renderInsightCard('📚', 'Recommended Reading', insights.books);
    }
    if (insights.follow_ups?.length) {
        insightsHTML += renderInsightCard('💭', 'Questions to Explore', insights.follow_ups);
    }

    detailBody.innerHTML = `
        <div class="detail-section">
            <div class="detail-section-label">Your note</div>
            <div class="detail-raw-text">${escapeHtml(note.raw_text)}</div>
        </div>

        ${note.summary ? `
        <div class="detail-section">
            <div class="detail-section-label">AI Summary</div>
            <div class="detail-summary">${escapeHtml(note.summary)}</div>
        </div>` : ''}

        ${tags ? `
        <div class="detail-section">
            <div class="detail-section-label">Tags</div>
            <div class="detail-tags">${tags}</div>
        </div>` : ''}

        <div class="detail-section">
            <div class="detail-section-label">Details</div>
            <div class="detail-meta">
                ${note.category ? `<span class="detail-meta-item"><span class="category-badge">${note.category}</span></span>` : ''}
                ${note.sentiment ? `<span class="detail-meta-item">${SENTIMENT_EMOJI[note.sentiment] || ''} ${note.sentiment}</span>` : ''}
                <span class="detail-meta-item">📅 ${time}</span>
                <span class="detail-meta-item">👤 ${note.profile}</span>
            </div>
        </div>

        ${insightsHTML ? `<div class="detail-divider"></div>${insightsHTML}` : ''}

        ${note.status === 'pending' || note.status === 'error' ? `
        <div class="detail-section" style="text-align:center; padding:1rem 0">
            <span style="color:var(--text-muted); font-size:0.85rem">
                ${note.status === 'pending' ? '⏳ Processing with AI…' : '⚠️ Processing failed. Tap re-analyze to retry.'}
            </span>
        </div>` : ''}
    `;
}

function renderInsightCard(emoji, title, items) {
    const listItems = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
    return `
        <div class="insight-card">
            <div class="insight-card-title">
                <span class="insight-emoji">${emoji}</span> ${title}
            </div>
            <ul class="insight-list">${listItems}</ul>
        </div>`;
}

// ─── Reprocess ───────────────────────────────────────────────
btnReprocess.addEventListener('click', async () => {
    if (!STATE.activeNote) return;
    btnReprocess.disabled = true;

    try {
        await fetch(`/api/notes/${STATE.activeNote.id}/reprocess`, {
            method: 'POST', headers: authHeaders(),
        });

        // Poll for completion
        const poll = setInterval(async () => {
            const res = await fetch(`/api/notes?profile=${STATE.profile || 'combined'}`, { headers: authHeaders() });
            const notes = await res.json();
            const updated = notes.find(n => n.id === STATE.activeNote.id);
            if (updated && updated.status === 'processed') {
                clearInterval(poll);
                STATE.activeNote = updated;
                STATE.notes = notes;
                renderDetail(updated);
                btnReprocess.disabled = false;
            }
        }, 2000);

        // Timeout after 30s
        setTimeout(() => { clearInterval(poll); btnReprocess.disabled = false; }, 30000);
    } catch {
        btnReprocess.disabled = false;
    }
});

// ─── Chat ────────────────────────────────────────────────────
function openChat() {
    chatPanel.classList.remove('hidden');
    STATE.chatHistory = [];
    chatMessages.innerHTML = `
        <div class="chat-bubble chat-bubble-ai">
            Hi! I've read your note. What would you like to explore or discuss about it?
        </div>`;
    requestAnimationFrame(() => chatInput.focus());
}

function closeChat() {
    chatPanel.classList.add('hidden');
    STATE.chatHistory = [];
}

btnOpenChat.addEventListener('click', openChat);
btnCloseChat.addEventListener('click', closeChat);

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !STATE.activeNote) return;

    // Show user message
    chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-user">${escapeHtml(text)}</div>`;
    chatInput.value = '';

    // Show thinking indicator
    chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-thinking" id="thinking-indicator"><div class="thinking-dots"><span></span><span></span><span></span></div></div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Add to history
    STATE.chatHistory.push({ role: 'user', text });

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                noteId: STATE.activeNote.id,
                message: text,
                history: STATE.chatHistory,
            }),
        });

        // Remove thinking indicator
        const thinking = document.getElementById('thinking-indicator');
        if (thinking) thinking.remove();

        if (!res.ok) throw new Error('Chat failed');
        const { reply } = await res.json();

        STATE.chatHistory.push({ role: 'model', text: reply });

        chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-ai">${formatChatReply(reply)}</div>`;
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch {
        const thinking = document.getElementById('thinking-indicator');
        if (thinking) thinking.remove();
        chatMessages.innerHTML += `<div class="chat-bubble chat-bubble-ai" style="color:var(--error)">Sorry, something went wrong. Try again.</div>`;
    }
});

function formatChatReply(text) {
    // Basic markdown-ish formatting
    return escapeHtml(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

// ─── Utils ───────────────────────────────────────────────────
function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ─── Init ────────────────────────────────────────────────────
async function init() {
    if (STATE.pin) {
        const ok = await validatePin(STATE.pin).catch(() => false);
        if (ok) {
            if (STATE.profile) { setProfile(STATE.profile); }
            else { showView(profileView); }
            return;
        } else {
            clearState();
        }
    }
    showView(pinView);
}

init();

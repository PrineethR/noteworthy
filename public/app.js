/* ============================================================
   Noteworthy — app.js (Cloud Edition)
   PIN auth → Profile picker → Capture + History
   ============================================================ */

// ─── State ───────────────────────────────────────────────────
const STATE = {
    pin: localStorage.getItem('nw_pin') || null,
    profile: localStorage.getItem('nw_profile') || null,
};

function saveState() {
    if (STATE.pin) localStorage.setItem('nw_pin', STATE.pin);
    if (STATE.profile) localStorage.setItem('nw_profile', STATE.profile);
}

function clearState() {
    STATE.pin = null;
    STATE.profile = null;
    localStorage.removeItem('nw_pin');
    localStorage.removeItem('nw_profile');
}

// ─── DOM ─────────────────────────────────────────────────────
const pinView = document.getElementById('pin-view');
const profileView = document.getElementById('profile-view');
const captureView = document.getElementById('capture-view');
const historyPanel = document.getElementById('history-panel');
const historyBackdrop = document.getElementById('history-backdrop');
const historyList = document.getElementById('history-list');

const pinDots = document.querySelectorAll('.pin-dot');
const pinKeys = document.querySelectorAll('.pin-key[data-digit]');
const pinBackspace = document.getElementById('pin-backspace');
const pinError = document.getElementById('pin-error');

const profileCards = document.querySelectorAll('[data-profile]');
const activeLabel = document.getElementById('active-profile-label');
const profileBadge = document.getElementById('btn-switch-profile');
const historyBadge = document.getElementById('history-profile-badge');

const noteInput = document.getElementById('note-input');
const charCount = document.getElementById('char-count');
const btnSend = document.getElementById('btn-send');
const successRipple = document.getElementById('success-ripple');
const btnHistory = document.getElementById('btn-history');
const btnCloseHistory = document.getElementById('btn-close-history');

// ─── Auth API ────────────────────────────────────────────────
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

// ─── View Management ─────────────────────────────────────────
function showView(view) {
    [pinView, profileView, captureView].forEach(v => v.classList.add('hidden'));
    view.classList.remove('hidden');
    // Re-trigger animation
    view.style.animation = 'none';
    void view.offsetHeight;
    view.style.animation = '';
}

function setProfile(profile) {
    STATE.profile = profile;
    saveState();

    const names = { prineeth: 'Prineeth', pramoddini: 'Pramoddini', combined: 'Combined' };
    activeLabel.textContent = names[profile] || profile;

    // Update badge color
    profileBadge.className = `profile-badge profile-${profile}-active`;

    // Update history badge
    historyBadge.textContent = names[profile];
    historyBadge.className = `history-profile-badge ${profile}`;

    showView(captureView);
    requestAnimationFrame(() => noteInput.focus());
}

// ─── PIN Logic ────────────────────────────────────────────────
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

pinBackspace.addEventListener('click', () => {
    pinEntry = pinEntry.slice(0, -1);
    updateDots();
});

// Physical keyboard support on PIN screen
document.addEventListener('keydown', (e) => {
    if (!pinView.classList.contains('hidden')) {
        if (/^[0-9]$/.test(e.key) && pinEntry.length < 6) {
            pinEntry += e.key;
            updateDots();
            if (pinEntry.length === 6) submitPin();
        } else if (e.key === 'Backspace') {
            pinEntry = pinEntry.slice(0, -1);
            updateDots();
        }
    }
});

// ─── Profile Selection ────────────────────────────────────────
profileCards.forEach(card => {
    card.addEventListener('click', () => setProfile(card.dataset.profile));
});

// Switch profile badge → go back to profile picker
profileBadge.addEventListener('click', () => showView(profileView));

// ─── Note Capture ─────────────────────────────────────────────
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
        if (!res.ok) throw new Error('Failed to save');

        // ✨ Clear with animation
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
        e.preventDefault();
        sendNote();
    }
});

// ─── History Panel ────────────────────────────────────────────
function openHistory() {
    historyPanel.classList.add('open');
    historyBackdrop.classList.add('visible');
    loadNotes();
}

function closeHistory() {
    historyPanel.classList.remove('open');
    historyBackdrop.classList.remove('visible');
}

btnHistory.addEventListener('click', openHistory);
btnCloseHistory.addEventListener('click', closeHistory);
historyBackdrop.addEventListener('click', closeHistory);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && historyPanel.classList.contains('open')) closeHistory();
});

async function loadNotes() {
    historyList.innerHTML = '<div class="history-empty"><div class="history-empty-icon">⏳</div><div class="history-empty-text">Loading…</div></div>';

    try {
        const profile = STATE.profile || 'combined';
        const res = await fetch(`/api/notes?profile=${profile}`, { headers: authHeaders() });

        if (res.status === 401) { clearState(); showView(pinView); return; }
        const notes = await res.json();

        if (!notes.length) {
            historyList.innerHTML = `
                <div class="history-empty">
                    <div class="history-empty-icon">📝</div>
                    <div class="history-empty-text">No notes yet.<br/>Start capturing!</div>
                </div>`;
            return;
        }

        historyList.innerHTML = notes.map((note, i) => renderCard(note, i)).join('');
    } catch (err) {
        historyList.innerHTML = `<div class="history-empty"><div class="history-empty-icon">⚠️</div><div class="history-empty-text">Failed to load.</div></div>`;
    }
}

// ─── Note Card Renderer ───────────────────────────────────────
const SENTIMENT_EMOJI = { positive: '😊', negative: '😔', neutral: '😐', mixed: '🤔' };

function renderCard(note, i) {
    const time = new Date(note.created_at).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });

    const tags = (note.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    const summary = note.summary ? `<div class="note-card-summary">${escapeHtml(note.summary)}</div>` : '';
    const who = STATE.profile === 'combined'
        ? `<span class="note-who">${note.profile}</span>` : '';

    const meta = note.status === 'processed'
        ? `<div class="note-card-meta">
            ${note.category ? `<span class="category-badge">${note.category}</span>` : ''}
            ${note.sentiment ? `<span>${SENTIMENT_EMOJI[note.sentiment] || ''} ${note.sentiment}</span>` : ''}
            <span>${time}</span>
           </div>`
        : `<div class="note-card-meta"><span>${time}</span></div>`;

    return `
        <article class="note-card profile-${note.profile}" style="animation-delay:${i * 40}ms">
            <div class="note-card-top">
                <span class="note-card-status status-${note.status}">
                    <span class="status-dot"></span>${note.status}
                </span>
                ${who}
            </div>
            ${summary}
            <div class="note-card-raw">${escapeHtml(note.raw_text)}</div>
            ${tags ? `<div class="note-card-tags">${tags}</div>` : ''}
            ${meta}
        </article>`;
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
    // If we have a stored PIN, silently validate it
    if (STATE.pin) {
        const ok = await validatePin(STATE.pin).catch(() => false);
        if (ok) {
            if (STATE.profile) {
                setProfile(STATE.profile);
            } else {
                showView(profileView);
            }
            return;
        } else {
            clearState();
        }
    }
    showView(pinView);
}

init();

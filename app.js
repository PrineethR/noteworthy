/* ============================================================
   Noteworthy — app.js (Serverless Firebase Edition)
   Auth → Profile → Capture → Notes/Detail/Chat → Discover
   ============================================================ */

import * as api from './api.js';
import { isConfigPlaceholder } from './firebase.js';
import * as google from './google.js';

// ─── State ───────────────────────────────────────────────────
const STATE = {
    pin: localStorage.getItem('nw_pin') || null,
    profile: localStorage.getItem('nw_profile') || null,
    theme: localStorage.getItem('nw_theme') || 'dark', // Add theme state
    notes: [],
    clusters: [],          // loaded cluster objects
    activeClusterFilter: null, // cluster ID to filter notes panel, or null for all
    activeNote: null,
    chatId: null,       // current chat's DB id (null = new chat)
    chatHistory: [],
    discoverCards: [],
    discoverFilter: 'all',
    searchTags: [],
    audioMute: localStorage.getItem('nw_audio_mute') === 'true',
    audioVolume: parseFloat(localStorage.getItem('nw_audio_volume') ?? '0.5'),
    fontFamily: localStorage.getItem('nw_font_family') || 'nunito',
    fontSize: parseInt(localStorage.getItem('nw_font_size') || '16'),
    letterSpacing: parseFloat(localStorage.getItem('nw_letter_spacing') || '0'),
    selectedNoteIds: new Set(), // Keep track of selected notes in selection mode
};

// Apply theme class right away to avoid initial layout flicker if light mode active
if (STATE.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
else document.documentElement.setAttribute('data-theme', 'dark');

function applyTypefaceSettings() {
    const root = document.documentElement;
    root.style.setProperty('--user-font-size', `${STATE.fontSize}px`);
    root.style.setProperty('--user-letter-spacing', `${STATE.letterSpacing}em`);
    
    let fontSans = "'Nunito', 'Inter', -apple-system, sans-serif";
    if (STATE.fontFamily === 'inter') {
        fontSans = "'Inter', -apple-system, sans-serif";
    } else if (STATE.fontFamily === 'monospace') {
        fontSans = "'JetBrains Mono', monospace";
    } else if (STATE.fontFamily === 'serif') {
        fontSans = "Georgia, Cambria, serif";
    }
    root.style.setProperty('--font-sans', fontSans);
}

applyTypefaceSettings();

function saveState() {
    if (STATE.pin) localStorage.setItem('nw_pin', STATE.pin);
    if (STATE.profile) localStorage.setItem('nw_profile', STATE.profile);
    localStorage.setItem('nw_theme', STATE.theme);
    localStorage.setItem('nw_audio_mute', STATE.audioMute ? 'true' : 'false');
    localStorage.setItem('nw_audio_volume', STATE.audioVolume.toString());
    localStorage.setItem('nw_font_family', STATE.fontFamily);
    localStorage.setItem('nw_font_size', STATE.fontSize.toString());
    localStorage.setItem('nw_letter_spacing', STATE.letterSpacing.toString());
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

const batchBar = $('notes-batch-bar');
const batchCount = $('batch-select-count');
const batchClusterSelect = $('batch-cluster-assign-select');
const btnBatchApply = $('btn-batch-apply');
const btnBatchCancel = $('btn-batch-cancel');
const chatPanel = $('chat-panel');
const chatMessages = $('chat-messages');
const chatTitle = $('chat-title');
const chatSubtitle = $('chat-subtitle');
const discoverView = $('discover-view');
const dashboardView = $('dashboard-view');
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
const btnAttachImage = $('btn-attach-image');
const noteAttachInput = $('note-attach-input');
const pendingImagesStrip = $('pending-images-strip');

// ─── Pending image attachments (pre-send) ──────────────────────
let pendingImages = []; // Array of { file: File, previewUrl: string }

// ─── Audio & Haptics ─────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const mainGain = audioCtx.createGain();
mainGain.connect(audioCtx.destination);

// Generate simple impulse response for reverb (longer tail)
const convolver = audioCtx.createConvolver();
const sr = audioCtx.sampleRate;
const impulse = audioCtx.createBuffer(2, sr * 3.2, sr); // 3.2s tail
for (let i = 0; i < 2; i++) {
    const channel = impulse.getChannelData(i);
    for (let j = 0; j < channel.length; j++) {
        channel[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / channel.length, 2.5);
    }
}
convolver.buffer = impulse;

// Mix & Lowpass Filter to cut high ends
const dry = audioCtx.createGain(); dry.gain.value = 0.6;
const wet = audioCtx.createGain(); wet.gain.value = 0.7; // higher wet mix
const lowpass = audioCtx.createBiquadFilter();
lowpass.type = 'lowpass';
lowpass.frequency.setValueAtTime(850, audioCtx.currentTime); // Cut high ends at 850Hz

dry.connect(lowpass);
wet.connect(convolver);
convolver.connect(lowpass);
lowpass.connect(mainGain);

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
    tap: () => { if (!STATE.audioMute) playTone(220, 'sine', 0.2, 0.4 * STATE.audioVolume); HAPTIC.tap(); },
    // Gentle double tap
    pop: () => { if (!STATE.audioMute) { playTone(180, 'sine', 0.25, 0.4 * STATE.audioVolume); setTimeout(() => playTone(240, 'sine', 0.3, 0.3 * STATE.audioVolume), 80); } HAPTIC.pop(); },
    // Deep swoosh
    swoosh: () => { if (!STATE.audioMute) playTone(140, 'triangle', 0.5, 0.3 * STATE.audioVolume, 60); HAPTIC.swoosh(); },
    // Uniform, simple reverberated calming piano + synth chord
    chime: () => { if (!STATE.audioMute) playCalmingChord(3.6); HAPTIC.success(); }
};

function playCalmingChord(duration = 3.6) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const freqs = [220, 277.18, 329.63, 415.30]; // AMaj7 chord (A3, C#4, E4, G#4)
    const baseVol = STATE.audioVolume * 0.18;

    freqs.forEach((freq) => {
        // 1. Piano-like Sine element (very mellow)
        const oscSine = audioCtx.createOscillator();
        const gainSine = audioCtx.createGain();
        oscSine.type = 'sine';
        oscSine.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        // Attack (0.35s) for a soft organic bloom
        gainSine.gain.setValueAtTime(0, audioCtx.currentTime);
        gainSine.gain.linearRampToValueAtTime(baseVol * 0.7, audioCtx.currentTime + 0.35);
        gainSine.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        
        oscSine.connect(gainSine);
        gainSine.connect(dry);
        gainSine.connect(wet);
        oscSine.start();
        oscSine.stop(audioCtx.currentTime + duration);

        // 2. Warm Synth-like Triangle element
        const oscTri = audioCtx.createOscillator();
        const gainTri = audioCtx.createGain();
        oscTri.type = 'triangle';
        oscTri.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        // Attack (0.40s)
        gainTri.gain.setValueAtTime(0, audioCtx.currentTime);
        gainTri.gain.linearRampToValueAtTime(baseVol * 0.3, audioCtx.currentTime + 0.40);
        gainTri.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration + 0.3);
        
        oscTri.connect(gainTri);
        gainTri.connect(dry);
        gainTri.connect(wet);
        oscTri.start();
        oscTri.stop(audioCtx.currentTime + duration + 0.3);

        // 3. Lower Octave Square wave (sub-bass warmth)
        const oscSquare = audioCtx.createOscillator();
        const gainSquare = audioCtx.createGain();
        oscSquare.type = 'square';
        oscSquare.frequency.setValueAtTime(freq / 2, audioCtx.currentTime); // 1 octave lower
        
        // Attack (0.45s)
        gainSquare.gain.setValueAtTime(0, audioCtx.currentTime);
        gainSquare.gain.linearRampToValueAtTime(baseVol * 0.12, audioCtx.currentTime + 0.45);
        gainSquare.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration + 0.5);
        
        oscSquare.connect(gainSquare);
        gainSquare.connect(dry);
        gainSquare.connect(wet);
        oscSquare.start();
        oscSquare.stop(audioCtx.currentTime + duration + 0.3);
    });
}
const HAPTIC = {
    tap: () => navigator.vibrate?.(10),
    pop: () => navigator.vibrate?.([15, 40, 15]),
    swoosh: () => navigator.vibrate?.(40),
    success: () => navigator.vibrate?.([30, 60, 30])
};

function playTypingSound(key) {
    if (STATE.audioMute || STATE.audioVolume === 0) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const vol = STATE.audioVolume;
    const isEnter = key === 'Enter';
    const isSpace = key === ' ';

    // Default membrane click
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    
    // Enter and Space keys sound slightly deeper for a more satisfying tactile layout
    let freq = 1100 + Math.random() * 300;
    if (isEnter) freq = 800 + Math.random() * 200;
    else if (isSpace) freq = 900 + Math.random() * 200;
    
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    
    const volumeMultiplier = isEnter ? 0.16 : (isSpace ? 0.14 : 0.11);
    gain.gain.setValueAtTime(vol * volumeMultiplier, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.018);
    
    osc.connect(gain);
    gain.connect(mainGain);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.018);
}

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
    updateThreadsBadge();
    updateMemoryCount();
    renderResurface();
}

// Settings Modal
const settingsDialog = $('settings-dialog');
const btnSettings = $('btn-settings');
const btnCloseSettings = $('btn-close-settings');
const geminiKeyInput = $('gemini-key-input');
const btnLogout = $('btn-logout');

const googleClientIdInput = $('google-client-id-input');
const btnGoogleConnect = $('btn-google-connect');
const btnGoogleDisconnect = $('btn-google-disconnect');

// Main view tasks list select listener
const mainTaskListSelect = $('main-task-list-select');

if (mainTaskListSelect) {
    mainTaskListSelect.addEventListener('change', () => {
        const val = mainTaskListSelect.value;
        localStorage.setItem('nw_google_tasks_list_id', val);
    });
}

async function updateGoogleStatus() {
    const label = $('google-status-label');
    const mainSelect = $('main-task-list-select');
    
    if (!label || !btnGoogleConnect || !btnGoogleDisconnect) return;

    const token = google.getStoredToken();
    if (token) {
        label.textContent = "Google: Connected";
        label.style.color = "var(--success)";
        btnGoogleConnect.textContent = "Re-connect";
        btnGoogleDisconnect.classList.remove('hidden');
        
        try {
            if (mainSelect) mainSelect.innerHTML = '<option value="@default">Loading...</option>';
            
            const lists = await google.getGoogleTaskLists(token);
            
            const optionsHTML = lists.map(list => 
                `<option value="${list.id}">${esc(list.title)}</option>`
            ).join('');
            
            const savedListId = localStorage.getItem('nw_google_tasks_list_id') || '@default';
            const hasSavedList = lists.some(l => l.id === savedListId) || savedListId === '@default';
            const finalValue = hasSavedList ? savedListId : '@default';
            
            if (mainSelect) {
                mainSelect.innerHTML = optionsHTML;
                mainSelect.value = finalValue;
                setupCustomDropdown('main-task-list-select');
            }
        } catch (e) {
            console.error("Failed to load task lists:", e);
            if (mainSelect) {
                mainSelect.innerHTML = '<option value="@default">Default</option>';
                setupCustomDropdown('main-task-list-select');
            }
        }
    } else {
        label.textContent = "Google: Disconnected";
        label.style.color = "var(--text-dim)";
        btnGoogleConnect.textContent = "Connect";
        btnGoogleDisconnect.classList.add('hidden');
        const mainWrapper = $('main-task-list-wrapper');
        if (mainWrapper) mainWrapper.classList.add('hidden');
    }
}

if (btnGoogleConnect) {
    btnGoogleConnect.addEventListener('click', async () => {
        const clientId = googleClientIdInput.value.trim();
        if (!clientId) {
            alert("Please enter a Google OAuth Client ID first.");
            return;
        }
        
        // Save the client ID
        localStorage.setItem('nw_google_client_id', clientId);
        
        btnGoogleConnect.disabled = true;
        btnGoogleConnect.textContent = "Connecting...";
        
        try {
            await google.requestGoogleToken(clientId);
            FX.chime();
            updateGoogleStatus();
        } catch (err) {
            console.error("Google authentication failed:", err);
            alert("Google authentication failed. Please make sure the Client ID is correct and configured for this domain.");
            updateGoogleStatus();
        } finally {
            btnGoogleConnect.disabled = false;
        }
    });
}

if (btnGoogleDisconnect) {
    btnGoogleDisconnect.addEventListener('click', () => {
        google.clearStoredToken();
        updateGoogleStatus();
        FX.pop();
    });
}

if (btnSettings) {
    btnSettings.addEventListener('click', () => {
        const customKey = localStorage.getItem('nw_gemini_key');
        geminiKeyInput.value = customKey || '';
        geminiKeyInput.placeholder = customKey ? 'AIzaSy...' : 'Using default built-in key...';
        
        if (googleClientIdInput) {
            googleClientIdInput.value = localStorage.getItem('nw_google_client_id') || '';
        }
        updateGoogleStatus();
        
        const audioEnableInput = $('audio-enable-input');
        const audioVolumeInput = $('audio-volume-input');
        if (audioEnableInput) audioEnableInput.checked = !STATE.audioMute;
        if (audioVolumeInput) audioVolumeInput.value = STATE.audioVolume;

        settingsDialog.classList.remove('hidden');
    });
}
if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => {
        const val = geminiKeyInput.value.trim();
        if (val) localStorage.setItem('nw_gemini_key', val);
        else localStorage.removeItem('nw_gemini_key');
        
        if (googleClientIdInput) {
            const googleClientIdVal = googleClientIdInput.value.trim();
            if (googleClientIdVal) localStorage.setItem('nw_google_client_id', googleClientIdVal);
            else localStorage.removeItem('nw_google_client_id');
        }
        
        const audioEnableInput = $('audio-enable-input');
        const audioVolumeInput = $('audio-volume-input');
        if (audioEnableInput) STATE.audioMute = !audioEnableInput.checked;
        if (audioVolumeInput) STATE.audioVolume = parseFloat(audioVolumeInput.value);
        saveState();

        settingsDialog.classList.add('hidden');
    });
}

// ─── Notebook maintenance ────────────────────────────────────

function maintLog(msg, tone = 'info') {
    const box = $('maintenance-log');
    if (!box) return;
    box.classList.remove('hidden');
    const line = document.createElement('div');
    line.className = `maint-line maint-${tone}`;
    line.textContent = msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 60) box.removeChild(box.firstChild);
}

function bindMaintenance(id, label, runner) {
    const btn = $(id);
    if (!btn) return;
    btn.addEventListener('click', async () => {
        FX.tap();
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Working…';
        maintLog(`${label} started…`);
        try {
            const summary = await runner(msg => maintLog(msg));
            maintLog(summary || `${label} complete.`, 'success');
            FX.chime();
        } catch (e) {
            maintLog(friendlyError(e), 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    });
}

bindMaintenance('btn-migrate', 'Repair', async (log) => {
    const r = await api.migrateConnectionsAPI(STATE.profile || 'prineeth', log);
    THREADS_CACHE.connections = null;
    if (notesPanel.classList.contains('open')) await loadNotes();
    return `Cleaned ${r.cleaned} notes and recovered ${r.migrated} connections.`
        + (r.unresolved ? ` ${r.unresolved} pointed at notes that no longer exist.` : '');
});

bindMaintenance('btn-backfill', 'Build the graph', async (log) => {
    const r = await api.backfillAPI(STATE.profile || 'prineeth', (msg) => log(msg));
    THREADS_CACHE.connections = null;
    THREADS_CACHE.concepts = null;
    return `Embedded ${r.embedded} notes and found ${r.linked} connections.`;
});

bindMaintenance('btn-consolidate', 'Consolidate profile', async (log) => {
    const r = await api.consolidateMemoryAPI(STATE.profile || 'prineeth', log);
    await updateMemoryCount();
    return `Profile went from ${r.before} signals to ${r.after} — merged ${r.merged}, dropped ${r.dropped}.`;
});

bindMaintenance('btn-suggest-clusters', 'Suggest collections', async (log) => {
    const suggestions = await api.suggestClustersAPI(STATE.profile || 'prineeth');
    if (!suggestions.length) return 'Nothing coherent enough to suggest yet — capture a few more notes.';

    let accepted = 0;
    for (const s of suggestions) {
        const ok = await showConfirmDialog(
            `${s.emoji} ${s.name}`,
            `${s.rationale}\n\n${s.note_ids.length} notes would be filed here.`,
            'Create'
        );
        if (!ok) continue;
        await api.acceptSuggestedClusterAPI(s, STATE.profile || 'prineeth');
        accepted++;
        log(`Created "${s.name}" with ${s.note_ids.length} notes.`);
    }
    if (notesPanel.classList.contains('open')) await loadNotes();
    return accepted
        ? `Created ${accepted} collection${accepted === 1 ? '' : 's'}.`
        : 'No collections created.';
});

async function updateMemoryCount() {
    const label = $('memory-count-label');
    if (!label || !STATE.profile) return;
    try {
        const items = await api.getMemoryAPI(STATE.profile);
        label.textContent = `${items.length} signals about you. Merges duplicates into one clean profile.`;
    } catch { /* leave the default copy */ }
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

// ─── Theme Switcher ──────────────────────────────────────────
const btnThemeLight = $('btn-theme-light');
const btnThemeDark = $('btn-theme-dark');

function updateThemeIcons() {
    const btnLight = $('btn-theme-light');
    const btnDark = $('btn-theme-dark');
    if (btnLight && btnDark) {
        if (STATE.theme === 'light') {
            btnLight.classList.add('active');
            btnDark.classList.remove('active');
        } else {
            btnDark.classList.add('active');
            btnLight.classList.remove('active');
        }
    }
}

function applyTheme(theme) {
    STATE.theme = theme;
    saveState();
    
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    updateThemeIcons();
}

if (btnThemeLight) {
    btnThemeLight.addEventListener('click', () => {
        HAPTIC.tap();
        applyTheme('light');
        FX.tap();
    });
}
if (btnThemeDark) {
    btnThemeDark.addEventListener('click', () => {
        HAPTIC.tap();
        applyTheme('dark');
        FX.tap();
    });
}

// ─── Capture ─────────────────────────────────────────────────
const typingGradient = $('typing-gradient');
let typingTimeout;

const PERSONA_KEYS = Object.keys(api.PERSONAS);

const COMMANDS = [
    // Slash-only: Google integrations
    { key: '\\remind',   label: '\\remind <text>',  desc: 'Add task or calendar reminder', trigger: '\\' },
    { key: '\\task',     label: '\\task <text>',    desc: 'Add a Google Task',              trigger: '\\' },
    { key: '\\calendar', label: '\\calendar <text>', desc: 'Schedule a Google Calendar event', trigger: '\\' },
    { key: '\\doc',      label: '\\doc <title>',    desc: 'Create a Google Doc',            trigger: '\\' },
    // @-only: Expert personas
    { key: '@philosopher', label: '@philosopher', desc: `${api.PERSONAS.philosopher.emoji} ${api.PERSONAS.philosopher.desc}`, trigger: '@' },
    { key: '@scientist',   label: '@scientist',   desc: `${api.PERSONAS.scientist.emoji} ${api.PERSONAS.scientist.desc}`,   trigger: '@' },
    { key: '@designer',    label: '@designer',    desc: `${api.PERSONAS.designer.emoji} ${api.PERSONAS.designer.desc}`,    trigger: '@' },
    { key: '@strategist',  label: '@strategist',  desc: `${api.PERSONAS.strategist.emoji} ${api.PERSONAS.strategist.desc}`,trigger: '@' },
    { key: '@therapist',   label: '@therapist',   desc: `${api.PERSONAS.therapist.emoji} ${api.PERSONAS.therapist.desc}`,  trigger: '@' },
    { key: '@historian',   label: '@historian',   desc: `${api.PERSONAS.historian.emoji} ${api.PERSONAS.historian.desc}`,  trigger: '@' },
    { key: '@poet',        label: '@poet',        desc: `${api.PERSONAS.poet.emoji} ${api.PERSONAS.poet.desc}`,            trigger: '@' },
    { key: '@economist',   label: '@economist',   desc: `${api.PERSONAS.economist.emoji} ${api.PERSONAS.economist.desc}`, trigger: '@' },
];

let activeSuggestionIndex = 0;
let filteredCommands = [];
let triggerAndQuery = '';

function showSuggestions(commands, textSegment) {
    filteredCommands = commands;
    triggerAndQuery = textSegment;
    activeSuggestionIndex = Math.min(activeSuggestionIndex, commands.length - 1);
    if (activeSuggestionIndex < 0) activeSuggestionIndex = 0;

    const box = $('command-suggestions');
    if (!box) return;
    box.innerHTML = commands.map((cmd, i) => `
        <div class="suggestion-item ${i === activeSuggestionIndex ? 'active' : ''}" data-index="${i}">
            <span class="suggestion-command">${esc(cmd.key)}</span>
            <span class="suggestion-desc">${esc(cmd.desc)}</span>
        </div>
    `).join('');
    
    // Position the suggestions box right below the textarea
    box.style.top = (noteInput.offsetTop + noteInput.offsetHeight) + 'px';
    box.classList.remove('hidden');

    // Add click listeners to items
    box.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            selectSuggestion(parseInt(item.dataset.index, 10));
        });
    });
}

function hideSuggestions() {
    const box = $('command-suggestions');
    if (box) box.classList.add('hidden');
    filteredCommands = [];
    activeSuggestionIndex = 0;
}

function selectSuggestion(index) {
    const cmd = filteredCommands[index];
    if (!cmd) return;

    const cursor = noteInput.selectionStart;
    const textVal = noteInput.value;
    const before = textVal.slice(0, cursor);
    const after = textVal.slice(cursor);

    // Replace the triggerAndQuery text with the command key + space
    const beforeReplaced = before.slice(0, before.length - triggerAndQuery.length) + cmd.key + ' ';
    noteInput.value = beforeReplaced + after;
    
    // Set selection cursor back after autocomplete text
    const newCursorPos = beforeReplaced.length;
    noteInput.setSelectionRange(newCursorPos, newCursorPos);
    noteInput.focus();

    hideSuggestions();
    
    // Trigger height adjustment
    noteInput.dispatchEvent(new Event('input'));
}

function checkSuggestions() {
    const cursor = noteInput.selectionStart;
    const textBeforeCursor = noteInput.value.slice(0, cursor);
    const lines = textBeforeCursor.split('\n');
    const currentLine = lines[lines.length - 1];
    
    // Check if the current line has a command trigger being typed
    const match = currentLine.match(/(?:^|\s)([\\]|[@])([a-zA-Z]*)$/);
    
    if (match) {
        const trigger = match[1]; // '\' or '@'
        const query = match[2].toLowerCase();
        
        // @ shows only personas, \ shows only Google commands
        const filtered = COMMANDS.filter(cmd =>
            cmd.trigger === trigger &&
            cmd.key.slice(1).startsWith(query)
        );
        
        if (filtered.length > 0) {
            showSuggestions(filtered, trigger + query);
        } else {
            hideSuggestions();
        }
    } else {
        hideSuggestions();
    }
}

function checkTaskCommandActive() {
    const text = noteInput.value.trim();
    // Only slash commands trigger the task list selector
    const isTaskActive = text.match(/^[\\](task|remind)\b/i);
    const mainWrapper = $('main-task-list-wrapper');
    
    if (isTaskActive && google.getStoredToken()) {
        if (mainWrapper) mainWrapper.classList.remove('hidden');
    } else {
        if (mainWrapper) mainWrapper.classList.add('hidden');
    }
}

noteInput.addEventListener('input', () => {
    const len = noteInput.value.length;
    updateCharMeter(len);
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

    // Check suggestions
    checkSuggestions();

    // Check if task list dropdown should show
    checkTaskCommandActive();
});

async function sendNote() {
    const text = noteInput.value.trim();
    if (!text || !STATE.profile || STATE.profile === 'combined') return;
    
    FX.pop(); // Sound when initiating note send
    btnSend.disabled = true;

    // Check if it starts with a SLASH command (Google integrations only)
    const commandMatch = text.match(/^[\\](remind|task|calendar|doc)\b/i);
    // Check if it starts with a PERSONA @ mention
    const personaMatch = text.match(new RegExp(`^@(${PERSONA_KEYS.join('|')})\\b`, 'i'));

    if (commandMatch) {
        const cmdName = commandMatch[1].toLowerCase();
        const token = google.getStoredToken();
        if (!token) {
            alert("This note starts with a Google command, but you are not connected to Google.\n\nPlease open Settings (gear icon) and connect your Google account.");
            btnSend.disabled = false;
            // Open settings dialog
            settingsDialog.classList.remove('hidden');
            if (googleClientIdInput) googleClientIdInput.focus();
            return;
        }

        noteInput.classList.add('note-clearing');
        try {
            const commandArg = text.slice(commandMatch[0].length).trim();
            const parsed = await api.parseGoogleCommandAPI(cmdName, commandArg);
            
            let noteContentOverride = text;
            let noteTags = [];

            if (cmdName === 'doc') {
                const docResult = await google.createGoogleDoc(token, {
                    title: parsed.title || 'Untitled Document',
                    content: parsed.content || ''
                });
                noteContentOverride = `${text}\n\n📝 Google Doc created: ${docResult.alternateLink}`;
                noteTags = ['google-doc', 'google'];
            } else {
                const targetType = parsed.type || (cmdName === 'calendar' ? 'calendar' : 'task');
                
                if (targetType === 'calendar') {
                    const eventResult = await google.createGoogleCalendarEvent(token, {
                        title: parsed.title,
                        description: parsed.description,
                        start_time: parsed.start_time,
                        end_time: parsed.end_time
                    });
                    noteContentOverride = `${text}\n\n📅 Google Calendar Event created: ${eventResult.htmlLink}`;
                    noteTags = ['google-calendar', 'google', 'reminder'];
                } else {
                    const listId = localStorage.getItem('nw_google_tasks_list_id') || '@default';
                    const taskResult = await google.createGoogleTask(token, {
                        title: parsed.title,
                        notes: parsed.description,
                        due: parsed.due_date
                    }, listId);
                    noteContentOverride = `${text}\n\n✓ Google Task created: ${parsed.title}`;
                    noteTags = ['google-task', 'google', 'reminder'];
                }
            }

            // Save note to Firestore in Noteworthy with updated text & tags
            await api.addNoteAPI(noteContentOverride, STATE.profile, noteTags);
            
            FX.chime(); // Sound when successful
            const rect = btnSend.getBoundingClientRect();
            triggerRisographRipple(rect.left + rect.width / 2, rect.top + rect.height / 2);
            successRipple.classList.add('active');
            setTimeout(() => { 
                noteInput.value = ''; 
                noteInput.classList.remove('note-clearing'); 
                updateCharMeter(0); 
                btnSend.disabled = true; 
                noteInput.style.height = 'auto'; 
                noteInput.focus(); 
                checkTaskCommandActive();
            }, 280);
            setTimeout(() => successRipple.classList.remove('active'), 800);
        } catch (err) {
            console.error("Google integration command failed:", err);
            alert("Google Integration Failed: " + err.message);
            noteInput.classList.remove('note-clearing');
            btnSend.disabled = false;
        }
        return;
    }

    // @Persona path — addNoteAPI handles prefix detection internally
    if (personaMatch) {
        const personaKey = personaMatch[1].toLowerCase();
        const persona = api.PERSONAS[personaKey];
        try {
            // Pass the full text; addNoteAPI will strip the @persona prefix
            const { id: noteId } = await api.addNoteAPI(text, STATE.profile);
            FX.chime();
            const rect = btnSend.getBoundingClientRect();
            triggerRisographRipple(rect.left + rect.width / 2, rect.top + rect.height / 2);
            noteInput.classList.add('note-clearing');
            successRipple.classList.add('active');

            // Show persona badge toast
            showPersonaToast(persona);

            // Upload any pending images
            if (pendingImages.length) {
                const toUpload = [...pendingImages];
                pendingImages = [];
                renderPendingStrip();
                for (const { file } of toUpload) {
                    await api.uploadImageAPI(noteId, file);
                }
            }

            setTimeout(() => {
                noteInput.value = '';
                noteInput.classList.remove('note-clearing');
                updateCharMeter(0);
                btnSend.disabled = true;
                noteInput.style.height = 'auto';
                noteInput.focus();
                checkTaskCommandActive();
            }, 280);
            setTimeout(() => successRipple.classList.remove('active'), 800);
        } catch (e) {
            console.error("Failed to add persona note:", e);
            btnSend.disabled = false;
        }
        return;
    }

    // Normal note save path
    try {
        const { id: noteId } = await api.addNoteAPI(text, STATE.profile);
        FX.chime(); // Sound when successful
        const rect = btnSend.getBoundingClientRect();
        triggerRisographRipple(rect.left + rect.width / 2, rect.top + rect.height / 2);
        noteInput.classList.add('note-clearing');
        successRipple.classList.add('active');

        // Upload any pending images to the newly created note
        if (pendingImages.length) {
            const toUpload = [...pendingImages];
            pendingImages = [];
            renderPendingStrip();
            for (const { file } of toUpload) {
                await api.uploadImageAPI(noteId, file);
            }
        }

        setTimeout(() => { 
            noteInput.value = ''; 
            noteInput.classList.remove('note-clearing'); 
            updateCharMeter(0); 
            btnSend.disabled = true; 
            noteInput.style.height = 'auto'; 
            noteInput.focus(); 
            checkTaskCommandActive();
        }, 280);
        setTimeout(() => successRipple.classList.remove('active'), 800);
    } catch (e) {
        console.error("Failed to add note:", e);
        btnSend.disabled = false;
    }
}

function showPersonaToast(persona) {
    let toast = document.getElementById('persona-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'persona-toast';
        toast.className = 'persona-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<span class="persona-toast-emoji">${persona.emoji}</span> Analyzing as <strong>${persona.name}</strong>`;
    toast.classList.add('visible');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('visible'), 3000);
}

btnSend.addEventListener('click', sendNote);

// ─── Attach Image (pre-send) ──────────────────────────────────
function renderPendingStrip() {
    if (!pendingImagesStrip) return;
    if (!pendingImages.length) {
        pendingImagesStrip.classList.add('hidden');
        pendingImagesStrip.innerHTML = '';
        return;
    }
    pendingImagesStrip.classList.remove('hidden');
    pendingImagesStrip.innerHTML = pendingImages.map((img, idx) => `
        <div class="pending-image-thumb" data-idx="${idx}">
            <img src="${img.previewUrl}" alt="Attachment ${idx + 1}" />
            <button class="pending-image-remove" data-idx="${idx}" aria-label="Remove attachment">&times;</button>
        </div>
    `).join('');
    pendingImagesStrip.querySelectorAll('.pending-image-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx, 10);
            URL.revokeObjectURL(pendingImages[idx]?.previewUrl);
            pendingImages.splice(idx, 1);
            renderPendingStrip();
        });
    });
}

if (btnAttachImage) {
    btnAttachImage.addEventListener('click', () => {
        HAPTIC.tap();
        if (noteAttachInput) noteAttachInput.click();
    });
}

if (noteAttachInput) {
    noteAttachInput.addEventListener('change', e => {
        const MAX_IMAGES = 4;
        const files = Array.from(e.target.files || []);
        for (const file of files) {
            if (pendingImages.length >= MAX_IMAGES) {
                alert(`You can attach up to ${MAX_IMAGES} images per note.`);
                break;
            }
            if (!file.type.startsWith('image/')) continue;
            pendingImages.push({
                file,
                previewUrl: URL.createObjectURL(file),
            });
        }
        noteAttachInput.value = '';
        renderPendingStrip();
    });
}


noteInput.addEventListener('keydown', e => {
    const IGNORED_KEYS = new Set([
        'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'PageUp', 'PageDown', 'Home', 'End', 'Insert', 'NumLock', 'Tab'
    ]);
    if (!IGNORED_KEYS.has(e.key)) {
        playTypingSound(e.key);
    }

    const box = $('command-suggestions');
    const isSuggestionsVisible = box && !box.classList.contains('hidden');

    if (isSuggestionsVisible) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeSuggestionIndex = (activeSuggestionIndex + 1) % filteredCommands.length;
            showSuggestions(filteredCommands, triggerAndQuery);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeSuggestionIndex = (activeSuggestionIndex - 1 + filteredCommands.length) % filteredCommands.length;
            showSuggestions(filteredCommands, triggerAndQuery);
            return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            selectSuggestion(activeSuggestionIndex);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            hideSuggestions();
            return;
        }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btnSend.disabled) {
        e.preventDefault();
        sendNote();
    }
});

// ─── Notes Panel ─────────────────────────────────────────────
function openNotes() { FX.tap(); notesPanel.classList.add('open'); notesBackdrop.classList.add('visible'); loadNotes(); }
function closeNotes() { HAPTIC.tap(); notesPanel.classList.remove('open'); notesBackdrop.classList.remove('visible'); STATE.searchTags = []; const si = $('notes-search-input'); if (si) si.value = ''; renderSearchTags(); clearNoteSelection(); }

// Notes opens from the tab bar (see setupTabBar)
$('btn-close-notes').addEventListener('click', closeNotes);
notesBackdrop.addEventListener('click', closeNotes);

// ─── Cluster Creation ─────────────────────────────────────────
const btnNewCluster = $('btn-new-cluster');
const clusterCreateForm = $('cluster-create-form');
const clusterNameInput = $('cluster-name-input');
const clusterColorRow = $('cluster-color-row');

// Populate color swatches
if (clusterColorRow) {
    clusterColorRow.innerHTML = api.CLUSTER_COLORS.map((cc, i) =>
        `<button class="cluster-color-swatch ${i === 2 ? 'selected' : ''}" data-color="${cc.id}" style="background: ${cc.hex}" title="${cc.id}"></button>`
    ).join('');
    clusterColorRow.querySelectorAll('.cluster-color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            clusterColorRow.querySelectorAll('.cluster-color-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
        });
    });
}

if (btnNewCluster) {
    btnNewCluster.addEventListener('click', () => {
        HAPTIC.tap();
        if (!clusterCreateForm) return;
        clusterCreateForm.classList.toggle('hidden');
        if (!clusterCreateForm.classList.contains('hidden')) {
            clusterNameInput?.focus();
        }
    });
}

if ($('btn-cluster-create-cancel')) {
    $('btn-cluster-create-cancel').addEventListener('click', () => {
        HAPTIC.tap();
        clusterCreateForm.classList.add('hidden');
        if (clusterNameInput) clusterNameInput.value = '';
    });
}

if ($('btn-cluster-create-save')) {
    $('btn-cluster-create-save').addEventListener('click', async () => {
        const name = clusterNameInput?.value.trim();
        if (!name) { clusterNameInput?.focus(); return; }
        const selectedColor = clusterColorRow?.querySelector('.cluster-color-swatch.selected')?.dataset.color || 'violet';
        HAPTIC.pop();
        $('btn-cluster-create-save').disabled = true;
        try {
            await api.createClusterAPI(name, STATE.profile, selectedColor, '📁');
            FX.chime();
            clusterCreateForm.classList.add('hidden');
            if (clusterNameInput) clusterNameInput.value = '';
            await loadNotes();
        } catch (e) {
            console.error('Failed to create cluster:', e);
            alert('Failed to create cluster: ' + e.message);
        } finally {
            $('btn-cluster-create-save').disabled = false;
        }
    });
}

if (clusterNameInput) {
    clusterNameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') $('btn-cluster-create-save')?.click();
        if (e.key === 'Escape') $('btn-cluster-create-cancel')?.click();
    });
}

// Helper to print sync messages with status indicators
function logSyncMessage(msg, type = 'info') {
    const symbols = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', sync: '🔄' };
    const prefix = symbols[type] || '•';
    console.log(`${prefix} [Sync] ${msg}`);
}

// Manual Sync Button Event Listener
const btnSync = $('btn-sync');
if (btnSync) {
    // Add title attribute to help users discover Shift-click re-selection
    btnSync.title = "Sync Notes (Shift-click to select a different folder)";

    btnSync.addEventListener('click', async (e) => {
        FX.tap();

        const forceChooseFolder = e.shiftKey;

        // Check if running in a local environment
        const hn = window.location.hostname;
        const isLocal = hn === 'localhost' || 
                        hn === '127.0.0.1' || 
                        hn === '0.0.0.0' || 
                        hn === '[::1]' || 
                        hn === '::1' ||
                        hn.endsWith('.local') ||
                        hn.endsWith('.test') ||
                        hn.endsWith('.localhost') ||
                        hn.includes('local') ||
                        hn.startsWith('192.168.') || 
                        hn.startsWith('10.') || 
                        (hn.startsWith('172.') && (() => {
                            const parts = hn.split('.');
                            const second = parseInt(parts[1], 10);
                            return second >= 16 && second <= 31;
                        })());
                        
        btnSync.disabled = true;
        btnSync.classList.add('syncing');
        const label = btnSync.querySelector('.sync-label');
        const originalLabel = label ? label.textContent : 'Sync';
        if (label) label.textContent = 'Syncing...';

        try {
            const profile = STATE.profile || 'prineeth';

            if (isLocal && !forceChooseFolder) {
                logSyncMessage("Attempting local server sync...", "info");
                try {
                    const res = await fetch('/api/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ profile })
                    });
                    const contentType = res.headers.get('content-type');
                    if (res.status === 404 || (contentType && contentType.includes('text/html'))) {
                        throw new Error("Local sync server endpoint not found.");
                    }
                    let data;
                    try {
                        data = await res.json();
                    } catch (jsonErr) {
                        throw new Error("Invalid response from sync server.");
                    }
                    if (data.success) {
                        if (label) label.textContent = 'Done!';
                        if (notesPanel.classList.contains('open')) {
                            await loadNotes();
                        }
                        return;
                    } else {
                        throw new Error(data.error || "Sync failed on local server.");
                    }
                } catch (localErr) {
                    console.warn("Local sync server failed, falling back to browser folder sync.", localErr);
                    logSyncMessage("Local sync server unavailable. Falling back to browser folder sync...", "warning");
                }
            }

            // Verify if FileSystem Access API is supported
            if (!window.showDirectoryPicker) {
                throw new Error("Your browser does not support browser-based folder sync. Please use a modern desktop browser (Chrome, Edge, Safari) or run the app locally using 'npm run dev'.");
            }

            // Dynamically import client-side folder sync
            const { syncObsidianVault } = await import("./js/sync-client.js");

            await syncObsidianVault(profile, forceChooseFolder, (msg, type) => {
                logSyncMessage(msg, type);
            });

            if (label) label.textContent = 'Done!';
            if (notesPanel.classList.contains('open')) {
                await loadNotes();
            }
        } catch (e) {
            if (label) label.textContent = 'Error';
            console.error('Error during sync:', e);
            alert(`Sync failed: ${e.message}`);
        } finally {
            setTimeout(() => {
                btnSync.disabled = false;
                btnSync.classList.remove('syncing');
                if (label) label.textContent = originalLabel;
            }, 2000);
        }
    });
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (!dashboardView.classList.contains('hidden')) { closeDashboard(); return; }
        if (!discoverView.classList.contains('hidden')) { closeDiscover(); return; }
        if (!chatPanel.classList.contains('hidden')) { closeChat(); return; }
        if (!noteDetail.classList.contains('hidden')) { closeDetail(); return; }
        if (notesPanel.classList.contains('open')) { closeNotes(); }
    }
});

async function loadNotes() {
    const profile = STATE.profile || 'combined';
    notesList.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">⌛</div><div class="notes-empty-text">Loading…</div></div>';
    try {
        const searchInput = $('notes-search-input');
        const queryText = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const activeTags = STATE.searchTags || [];

        // Load notes and clusters in parallel
        const [notesRaw, clusters] = await Promise.all([
            api.getNotesAPI(profile),
            profile !== 'combined' ? api.getClustersAPI(profile) : Promise.resolve([])
        ]);
        STATE.clusters = clusters;
        renderClusterPills();

        let notes = notesRaw;

        // Auto-recover stuck notes (pending/processing)
        const now = new Date();
        if (!STATE.reprocessingNotes) STATE.reprocessingNotes = new Set();
        notes.forEach(note => {
            if ((note.status === 'pending' || note.status === 'processing') && note.created_at) {
                const lastActive = note.updated_at || note.created_at;
                const age = (now - new Date(lastActive)) / 1000;
                
                // If it is actively processing and status changed < 2 mins ago, assume active client is working on it
                if (note.status === 'processing' && age < 120) {
                    return;
                }
                
                // If it is pending and status changed < 5s ago, it's fresh, let the active client finish
                if (note.status === 'pending' && age < 5) {
                    return;
                }

                if (!STATE.reprocessingNotes.has(note.id)) {
                    STATE.reprocessingNotes.add(note.id);
                    console.warn(`Auto-reprocessing note ${note.id} (status: ${note.status}, age: ${Math.round(age)}s)`);
                    api.reprocessNoteAPI(note.id).catch(err => {
                        console.error(`Reprocessing failed for note ${note.id}`, err);
                        STATE.reprocessingNotes.delete(note.id);
                    });
                    note.status = 'processing';
                    note.updated_at = now.toISOString();
                }
            }
        });

        // Apply tag + search filters
        if (activeTags.length) notes = notes.filter(n => activeTags.every(t => n.tags && n.tags.includes(t)));
        if (queryText) notes = notes.filter(n =>
            (n.raw_text && n.raw_text.toLowerCase().includes(queryText)) ||
            (n.summary && n.summary.toLowerCase().includes(queryText))
        );

        STATE.notes = notes;

        // Clean up selected IDs that no longer exist
        const activeIds = new Set(notes.map(n => n.id));
        for (const id of STATE.selectedNoteIds) {
            if (!activeIds.has(id)) {
                STATE.selectedNoteIds.delete(id);
            }
        }
        notesPanel.classList.toggle('selection-mode', STATE.selectedNoteIds.size > 0);
        updateBatchActionBar();

        if (!notes.length) {
            const emptyMsg = (queryText || activeTags.length) ? 'No matching notes.' : 'No notes yet.<br/>Start capturing!';
            notesList.innerHTML = `<div class="notes-empty"><div class="notes-empty-icon">${(queryText || activeTags.length) ? '🔍' : '📝'}</div><div class="notes-empty-text">${emptyMsg}</div></div>`;
            return;
        }

        // Build clustered view (skip if search/tag active or combined profile)
        const hasFilters = queryText || activeTags.length || profile === 'combined';
        if (!hasFilters && clusters.length) {
            renderClusteredNotes(notes, clusters);
        } else {
            notesList.innerHTML = notes.slice(0, PAGE_SIZE).map((n, i) => renderCard(n, i)).join('')
                + (notes.length > PAGE_SIZE ? `<div class="notes-sentinel" data-remaining="${notes.length - PAGE_SIZE}"></div>` : '');
            bindNoteCardEvents();
            setupInfiniteScroll(notes, PAGE_SIZE);
        }

    } catch (e) {
        console.error("Failed to load notes:", e);
        notesList.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">⚠️</div><div class="notes-empty-text">Failed to load.<br/><span style="font-size:0.7rem;opacity:0.7;">Check console for errors</span></div></div>';
    }
}

function renderClusteredNotes(notes, clusters) {
    // Build cluster map
    const clusterColors = {};
    api.CLUSTER_COLORS.forEach(c => { clusterColors[c.id] = c; });

    // Group notes by cluster_id
    const clusteredNotes = {};
    const unclustered = [];
    notes.forEach(n => {
        if (n.cluster_id) {
            if (!clusteredNotes[n.cluster_id]) clusteredNotes[n.cluster_id] = [];
            clusteredNotes[n.cluster_id].push(n);
        } else {
            unclustered.push(n);
        }
    });

    let html = '';
    let cardIdx = 0;

    // Render each cluster section
    clusters.forEach(cluster => {
        const clusterNotes = clusteredNotes[cluster.id] || [];
        const cc = clusterColors[cluster.color] || clusterColors['violet'];
        html += `
        <div class="cluster-section" data-cluster-id="${esc(cluster.id)}">
            <div class="cluster-header" style="--cluster-color: ${esc(cc.hex)}; --cluster-glow: ${esc(cc.glow)}">
                <button class="cluster-toggle" aria-expanded="false" data-cluster-id="${esc(cluster.id)}">
                    <span class="cluster-emoji">${esc(cluster.emoji || '📁')}</span>
                    <span class="cluster-name">${esc(cluster.name)}</span>
                    <span class="cluster-count">${clusterNotes.length}</span>
                    <svg class="cluster-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </button>
                <div class="cluster-actions">
                    <button class="btn-cluster-synthesize" data-cluster-id="${esc(cluster.id)}" title="AI Synthesis">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                        Synthesize
                    </button>
                    <button class="btn-cluster-delete" data-cluster-id="${esc(cluster.id)}" title="Delete cluster">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
            <div class="cluster-notes collapsed" data-cluster-id="${esc(cluster.id)}">
                ${clusterNotes.length ? clusterNotes.map(n => renderCard(n, cardIdx++)).join('') : '<div class="cluster-empty">No notes yet — add notes to this cluster from their detail view.</div>'}
            </div>
        </div>`;
    });

    // Unclustered notes section
    if (unclustered.length) {
        html += `<div class="cluster-section cluster-section-unclustered">
            <div class="cluster-header cluster-header-unclustered">
                <button class="cluster-toggle" aria-expanded="true" data-cluster-id="__unclustered__">
                    <span class="cluster-emoji">🗒️</span>
                    <span class="cluster-name">Unclustered Notes</span>
                    <span class="cluster-count">${unclustered.length}</span>
                    <svg class="cluster-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </button>
            </div>
            <div class="cluster-notes" data-cluster-id="__unclustered__">
                ${unclustered.slice(0, PAGE_SIZE).map(n => renderCard(n, cardIdx++)).join('')}
            </div>
            ${unclustered.length > PAGE_SIZE ? '<div class="notes-sentinel" data-remaining="' + (unclustered.length - PAGE_SIZE) + '"></div>' : ''}
        </div>`;
    }

    if (!html) {
        html = '<div class="notes-empty"><div class="notes-empty-icon">📝</div><div class="notes-empty-text">No notes yet.<br/>Start capturing!</div></div>';
    }

    notesList.innerHTML = html;
    bindNoteCardEvents();
    bindClusterEvents();
    setupInfiniteScroll(unclustered, PAGE_SIZE);
}

// ─── Windowed rendering ──────────────────────────────────────
// The list used to build every card up front. Now it renders a screenful and
// appends the rest as you reach them.

const PAGE_SIZE = 30;
let scrollObserver = null;

function setupInfiniteScroll(allNotes, alreadyRendered) {
    scrollObserver?.disconnect();
    const sentinel = notesList.querySelector('.notes-sentinel');
    if (!sentinel || allNotes.length <= alreadyRendered) return;

    let rendered = alreadyRendered;
    scrollObserver = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;
        const next = allNotes.slice(rendered, rendered + PAGE_SIZE);
        if (!next.length) { sentinel.remove(); scrollObserver.disconnect(); return; }
        sentinel.insertAdjacentHTML('beforebegin', next.map((n, i) => renderCard(n, rendered + i)).join(''));
        rendered += next.length;
        if (rendered >= allNotes.length) {
            sentinel.remove();
            scrollObserver.disconnect();
        } else {
            sentinel.dataset.remaining = String(allNotes.length - rendered);
        }
        bindNoteCardEvents();
    }, { root: notesList, rootMargin: '600px' });

    scrollObserver.observe(sentinel);
}

function bindNoteCardEvents() {
    notesList.querySelectorAll('.note-card').forEach(card => {
        // Cards get appended as you scroll, so only bind each one once.
        if (card.dataset.bound === '1') return;
        card.dataset.bound = '1';

        let pressTimer = null;
        let isLongPress = false;

        const startPress = () => {
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                HAPTIC.success();
                toggleNoteSelection(card.dataset.noteId);
            }, 600);
        };

        const cancelPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        card.addEventListener('mousedown', startPress);
        card.addEventListener('mouseup', cancelPress);
        card.addEventListener('mouseleave', cancelPress);

        card.addEventListener('touchstart', startPress, { passive: true });
        card.addEventListener('touchend', cancelPress, { passive: true });
        card.addEventListener('touchmove', cancelPress, { passive: true });

        card.addEventListener('click', (e) => {
            if (isLongPress) return;
            
            if (STATE.selectedNoteIds.size > 0) {
                HAPTIC.tap();
                toggleNoteSelection(card.dataset.noteId);
            } else {
                HAPTIC.tap();
                const note = STATE.notes.find(n => n.id === card.dataset.noteId);
                if (note) openDetail(note);
            }
        });
    });

    notesList.querySelectorAll('.tag[data-tag]').forEach(tag => {
        tag.addEventListener('click', e => {
            e.stopPropagation();
            HAPTIC.tap();
            addSearchTag(tag.dataset.tag);
        });
    });
}

function toggleNoteSelection(noteId) {
    if (STATE.selectedNoteIds.has(noteId)) {
        STATE.selectedNoteIds.delete(noteId);
    } else {
        STATE.selectedNoteIds.add(noteId);
    }

    const cardEl = notesList.querySelector(`.note-card[data-note-id="${noteId}"]`);
    if (cardEl) {
        cardEl.classList.toggle('selected', STATE.selectedNoteIds.has(noteId));
    }

    const isSelectionActive = STATE.selectedNoteIds.size > 0;
    notesPanel.classList.toggle('selection-mode', isSelectionActive);
    updateBatchActionBar();
}

function updateBatchActionBar() {
    const isSelectionActive = STATE.selectedNoteIds.size > 0;
    if (!isSelectionActive) {
        batchBar.classList.add('hidden');
        return;
    }

    batchBar.classList.remove('hidden');
    batchCount.textContent = `${STATE.selectedNoteIds.size} selected`;

    // Populate cluster select
    batchClusterSelect.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Add to cluster…';
    batchClusterSelect.appendChild(defaultOpt);

    const removeOpt = document.createElement('option');
    removeOpt.value = 'unclustered';
    removeOpt.textContent = 'None (Unclustered)';
    batchClusterSelect.appendChild(removeOpt);

    STATE.clusters.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.emoji || '📁'} ${c.name}`;
        batchClusterSelect.appendChild(opt);
    });
    setupCustomDropdown('batch-cluster-assign-select');
}

function clearNoteSelection() {
    STATE.selectedNoteIds.clear();
    notesPanel.classList.remove('selection-mode');
    notesList.querySelectorAll('.note-card.selected').forEach(card => {
        card.classList.remove('selected');
    });
    updateBatchActionBar();
}

function bindClusterEvents() {
    // Collapse/expand toggle
    notesList.querySelectorAll('.cluster-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            HAPTIC.tap();
            const clusterId = btn.dataset.clusterId;
            const notesEl = notesList.querySelector(`.cluster-notes[data-cluster-id="${clusterId}"]`);
            const expanded = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', !expanded);
            if (notesEl) notesEl.classList.toggle('collapsed', expanded);
        });
    });

    // Synthesize button
    notesList.querySelectorAll('.btn-cluster-synthesize').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const clusterId = btn.dataset.clusterId;
            const cluster = STATE.clusters.find(c => c.id === clusterId);
            await runClusterSynthesis(clusterId, cluster?.name || 'Cluster', btn);
        });
    });

    // Delete cluster button
    notesList.querySelectorAll('.btn-cluster-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const clusterId = btn.dataset.clusterId;
            const cluster = STATE.clusters.find(c => c.id === clusterId);
            const ok = await showConfirmDialog(
                `Delete cluster "${cluster?.name || 'this cluster'}"?`,
                'Notes will be unassigned but not deleted.',
                'Delete'
            );
            if (!ok) return;
            await api.deleteClusterAPI(clusterId);
            FX.swoosh();
            await loadNotes();
        });
    });
}

async function runClusterSynthesis(clusterId, clusterName, btn) {
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="explore-spinner"></span> Synthesizing…';
    FX.tap();

    try {
        const result = await api.synthesizeClusterAPI(clusterId);
        FX.chime();
        showSynthesisModal(clusterName, result);
    } catch (e) {
        console.error('Synthesis failed:', e);
        alert('Synthesis failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

function showSynthesisModal(clusterName, result) {
    let modal = document.getElementById('synthesis-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'synthesis-modal';
        modal.className = 'synthesis-modal';
        modal.innerHTML = `
            <div class="synthesis-modal-card">
                <button class="synthesis-modal-close" id="synthesis-close">×</button>
                <div class="synthesis-modal-body" id="synthesis-body"></div>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('synthesis-close').addEventListener('click', () => {
            modal.classList.remove('visible');
        });
        modal.addEventListener('click', e => {
            if (e.target === modal) modal.classList.remove('visible');
        });
    }

    const body = document.getElementById('synthesis-body');
    body.innerHTML = `
        <div class="synthesis-header">
            <div class="synthesis-title-label">Synthesis: ${esc(clusterName)}</div>
            ${result.synthesis_title ? `<div class="synthesis-evocative-title">${esc(result.synthesis_title)}</div>` : ''}
        </div>
        <div class="synthesis-narrative">${renderMarkdown(result.narrative || '')}</div>
        ${result.themes?.length ? `<div class="synthesis-section"><div class="synthesis-section-label">🎯 Themes</div><ul class="synthesis-list">${result.themes.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
        ${result.tensions?.length ? `<div class="synthesis-section"><div class="synthesis-section-label">⚡ Tensions</div><ul class="synthesis-list">${result.tensions.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
        ${result.questions?.length ? `<div class="synthesis-section"><div class="synthesis-section-label">💭 Questions</div><ul class="synthesis-list">${result.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    `;
    modal.classList.add('visible');
    FX.chime();
}

function renderClusterPills() {
    // Render cluster pill filters in the notes header
    let pillsBar = document.getElementById('notes-cluster-pills');
    if (!pillsBar) return;
    if (!STATE.clusters.length) {
        pillsBar.innerHTML = '';
        return;
    }
    const clusterColors = {};
    api.CLUSTER_COLORS.forEach(c => { clusterColors[c.id] = c; });
    pillsBar.innerHTML = STATE.clusters.map(c => {
        const cc = clusterColors[c.color] || clusterColors['violet'];
        return `<button class="cluster-pill ${STATE.activeClusterFilter === c.id ? 'active' : ''}" data-cluster-id="${esc(c.id)}" style="--cluster-color: ${esc(cc.hex)}">${esc(c.emoji || '📁')} ${esc(c.name)}</button>`;
    }).join('');
    pillsBar.querySelectorAll('.cluster-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            HAPTIC.tap();
            STATE.activeClusterFilter = STATE.activeClusterFilter === pill.dataset.clusterId ? null : pill.dataset.clusterId;
            loadNotes();
        });
    });
}

function renderCard(note, i) {
    const time = new Date(note.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const tags = (note.tags || []).slice(0, 3).map(t => `<span class="tag" data-tag="${esc(t)}">#${esc(t)}</span>`).join('');
    const who = STATE.profile === 'combined' ? `<span class="notes-profile-badge ${note.profile === 'prineeth' ? 'prineeth' : 'pramoddini'}">${note.profile[0].toUpperCase()}</span>` : '';
    const imgCount = (note.images || []).length;
    const imgBadge = imgCount ? `<span class="note-img-badge">📷 ${imgCount}</span>` : '';
    // Persona badge
    const personaBadge = note.persona && api.PERSONAS[note.persona]
        ? `<span class="note-persona-badge" title="Analyzed by ${api.PERSONAS[note.persona].name}">${api.PERSONAS[note.persona].emoji}</span>` : '';
    const topRow = (who || personaBadge) ? `<div class="note-card-top">${personaBadge}<div style="flex:1"></div>${who}</div>` : '';
    
    const isSelected = STATE.selectedNoteIds.has(note.id);

    // Lead with the reading, keep the person's own words underneath.
    const body = api.stripDerived(note.raw_text);
    const title = api.noteTitle(note);
    const summary = note.summary;
    const head = summary
        ? `<div class="note-card-summary">${esc(summary)}</div>
           <div class="note-card-raw">${esc(body)}</div>`
        : `<div class="note-card-summary note-card-summary-raw">${esc(title)}</div>
           ${body.length > title.length ? `<div class="note-card-raw">${esc(body)}</div>` : ''}`;

    const concepts = (note.concepts || []).slice(0, 2)
        .map(c => `<span class="note-card-concept">${esc(c)}</span>`).join('');

    return `<article class="note-card profile-${note.profile} status-${note.status}${isSelected ? ' selected' : ''}" data-note-id="${note.id}" style="animation-delay:${Math.min(i, 10) * 40}ms">
        ${topRow}
        ${head}
        ${concepts ? `<div class="note-card-concepts">${concepts}</div>` : ''}
        ${tags || imgBadge ? `<div class="note-card-tags">${tags}${imgBadge}</div>` : ''}
        <div class="note-card-meta"><span>${time}</span></div>
    </article>`;
}

// ─── Note Workbench Helpers ──────────────────────────────────
function renderWorkbenchUI(note) {
    const wbContainer = document.getElementById('wb-items-container');
    if (!wbContainer) return;
    
    const wb = note.workbench || { items: [], notes: "" };
    const items = wb.items || [];
    
    if (items.length === 0) {
        wbContainer.innerHTML = `<div class="wb-empty-msg">No items collected yet. Click "+ Collect" in the explore sections below, or add a custom entry.</div>`;
    } else {
        wbContainer.innerHTML = items.map((item, idx) => `
            <div class="wb-item ${item.type || 'thought'}" data-idx="${idx}">
                <div class="wb-item-left">
                    <span class="wb-item-badge ${item.type || 'thought'}">${esc(item.type || 'thought')}</span>
                    <div class="wb-item-content">
                        <div class="wb-item-title">${esc(item.title)}</div>
                        ${item.desc ? `<div class="wb-item-desc">${esc(item.desc)}</div>` : ''}
                    </div>
                </div>
                <button class="btn-wb-remove" data-idx="${idx}" aria-label="Remove item">×</button>
            </div>
        `).join('');
    }
    
    // Bind removal handlers
    wbContainer.querySelectorAll('.btn-wb-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            HAPTIC.tap();
            const idx = parseInt(btn.dataset.idx, 10);
            if (!STATE.activeNote) return;
            const currentWb = STATE.activeNote.workbench || { items: [], notes: "" };
            if (currentWb.items && currentWb.items[idx]) {
                currentWb.items.splice(idx, 1);
                STATE.activeNote.workbench = currentWb;
                await api.updateNoteWorkbenchAPI(STATE.activeNote.id, currentWb);
                renderWorkbenchUI(STATE.activeNote);
            }
        });
    });
}

function bindCollectButtons(container) {
    container.querySelectorAll('.btn-collect:not([data-bound])').forEach(btn => {
        btn.setAttribute('data-bound', 'true');
        btn.addEventListener('click', async () => {
            HAPTIC.pop();
            const type = btn.dataset.type;
            const title = btn.dataset.title;
            const desc = btn.dataset.desc;
            
            if (!STATE.activeNote) return;
            
            const wb = STATE.activeNote.workbench || { items: [], notes: "" };
            if (!wb.items) wb.items = [];
            
            // Check if already exists
            const exists = wb.items.some(item => item.title === title && item.type === type);
            if (!exists) {
                wb.items.push({
                    type,
                    title,
                    desc,
                    added_at: new Date().toISOString()
                });
                STATE.activeNote.workbench = wb;
                await api.updateNoteWorkbenchAPI(STATE.activeNote.id, wb);
                renderWorkbenchUI(STATE.activeNote);
                FX.chime();
                btn.innerHTML = '✓ Collected';
                btn.disabled = true;
            }
        });
    });
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

    // Persona lens switcher section
    // Suggest the lens that fits this note; keep the rest one tap away.
    const suggestion = api.suggestPersona(note);
    const readings = note.persona_readings || {};
    const readKeys = Object.keys(readings);
    const suggested = api.PERSONAS[suggestion.key];
    const otherKeys = Object.keys(api.PERSONAS).filter(k => k !== suggestion.key);

    const personaHTML = `<div class="detail-section persona-section">
        <div class="detail-section-label">Read it another way</div>
        <button class="persona-suggested" data-persona="${esc(suggestion.key)}">
            <span class="persona-pill-emoji">${suggested.emoji}</span>
            <span class="persona-suggested-text">
                <strong>${esc(suggested.name)}</strong>
                <span>${esc(suggestion.why)}</span>
            </span>
            <span class="persona-suggested-go">${readings[suggestion.key] ? 'Again' : 'Read'}</span>
        </button>
        <details class="persona-more">
            <summary>Other lenses</summary>
            <div class="persona-lens-pills" id="persona-lens-pills">
                ${otherKeys.map(key => {
                    const p = api.PERSONAS[key];
                    const done = !!readings[key];
                    return `<button class="persona-pill ${done ? 'has-reading' : ''}" data-persona="${esc(key)}" title="${esc(p.desc)}">
                        <span class="persona-pill-emoji">${p.emoji}</span>
                        <span class="persona-pill-name">${esc(p.name)}</span>
                        ${done ? '<span class="persona-pill-dot" aria-label="already read"></span>' : ''}
                    </button>`;
                }).join('')}
            </div>
        </details>
        ${readKeys.length ? `<div class="persona-readings" id="persona-readings">
            ${readKeys.map(k => {
                const p = api.PERSONAS[k];
                const r = readings[k];
                return `<article class="persona-reading" data-persona-reading="${esc(k)}">
                    <div class="persona-reading-head">
                        <span>${p.emoji} ${esc(p.name)}</span>
                        <button class="persona-reading-remove" data-persona="${esc(k)}" aria-label="Remove this reading">×</button>
                    </div>
                    <p class="persona-reading-text">${esc(r.summary || '')}</p>
                </article>`;
            }).join('')}
        </div>` : ''}
    </div>`;

    // Cluster assignment section (only for non-combined, owned notes)
    let clusterHTML = '';
    if (STATE.profile !== 'combined' && STATE.clusters.length) {
        const currentCluster = STATE.clusters.find(c => c.id === note.cluster_id);
        const clusterColors = {};
        api.CLUSTER_COLORS.forEach(c => { clusterColors[c.id] = c; });
        clusterHTML = `<div class="detail-section cluster-assign-section">
            <div class="detail-section-label">Cluster</div>
            <div class="cluster-assign-row">
                <select class="cluster-assign-select" id="cluster-assign-select">
                    <option value="">— No cluster —</option>
                    ${STATE.clusters.map(c => `<option value="${esc(c.id)}" ${c.id === note.cluster_id ? 'selected' : ''}>${esc(c.emoji || '📁')} ${esc(c.name)}</option>`).join('')}
                </select>
            </div>
        </div>`;
    }

    // Build Workbench Section
    const wb = note.workbench || { items: [], notes: "" };
    const workbenchHTML = `
        <div class="detail-divider"></div>
        <div class="detail-section workbench-section" id="note-workbench">
            <div class="detail-section-label">🧠 Note Workbench</div>
            <div class="workbench-card">
                <div class="wb-subheader">Collected Materials</div>
                <div id="wb-items-container"></div>
                
                <div class="wb-add-custom">
                    <input type="text" id="wb-custom-input" placeholder="Add custom thought or task..." class="wb-custom-input" />
                    <button id="btn-wb-add-custom" class="btn btn-ghost btn-sm">Add</button>
                </div>
                
                <div class="wb-subheader">Synthesis Workspace</div>
                <textarea id="wb-synthesis-textarea" class="wb-synthesis-textarea" placeholder="Outline your ideas, write drafts, or synthesize notes. Auto-saves...">${esc(wb.notes || '')}</textarea>
                <div class="wb-autosave-indicator" id="wb-autosave-indicator">Saved</div>
            </div>
        </div>
    `;

    // Keep the chats-list div at the bottom (we populate it separately)
    detailBody.innerHTML = `
        <div class="detail-section"><div class="detail-section-label">Your note</div><div class="detail-raw-text" id="detail-raw-text">${renderMarkdown(api.stripDerived(note.raw_text))}</div></div>
        ${imagesHTML}
        ${note.summary ? `<div class="detail-section"><div class="detail-section-label">AI Summary${note.persona && api.PERSONAS[note.persona] ? ` <span class="persona-summary-badge">${api.PERSONAS[note.persona].emoji} ${api.PERSONAS[note.persona].name}</span>` : ''}</div><div class="detail-summary">${renderMarkdown(note.summary)}</div></div>` : ''}
        ${personaHTML}
        ${clusterHTML}
        <div class="detail-section"><div class="detail-section-label">Tags</div><div class="detail-tags" id="detail-tags-container">${tags}<button class="tag tag-add" id="btn-add-tag" aria-label="Add tag">+ Add</button></div></div>
        <div class="detail-section"><div class="detail-section-label">Details</div><div class="detail-meta">
            ${note.category ? `<span class="detail-meta-item"><span class="category-badge">${note.category}</span></span>` : ''}
            ${note.sentiment ? `<span class="detail-meta-item">${SE[note.sentiment] || ''} ${note.sentiment}</span>` : ''}
            <span class="detail-meta-item">📅 ${time}</span><span class="detail-meta-item">👤 ${note.profile}</span>
        </div></div>
        ${workbenchHTML}
        ${iHTML ? `<div class="detail-divider"></div>${iHTML}` : ''}
        <div id="detail-connections" class="detail-connections"></div>
        <div class="detail-divider"></div>
        <div id="chats-list" class="chats-list"></div>`;


    // Render initial workbench items
    renderWorkbenchUI(note);
    renderNoteConnections(note);
    renderNoteConcepts(note);

    // Bind custom thought addition
    const customInput = $('wb-custom-input');
    const addCustomBtn = $('btn-wb-add-custom');
    if (customInput && addCustomBtn) {
        const addCustom = async () => {
            const val = customInput.value.trim();
            if (val && STATE.activeNote) {
                HAPTIC.tap();
                const currentWb = STATE.activeNote.workbench || { items: [], notes: "" };
                if (!currentWb.items) currentWb.items = [];
                currentWb.items.push({
                    type: 'thought',
                    title: val,
                    desc: '',
                    added_at: new Date().toISOString()
                });
                STATE.activeNote.workbench = currentWb;
                customInput.value = '';
                await api.updateNoteWorkbenchAPI(STATE.activeNote.id, currentWb);
                renderWorkbenchUI(STATE.activeNote);
                FX.chime();
            }
        };
        addCustomBtn.addEventListener('click', addCustom);
        customInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
        });
    }

    // Bind synthesis workspace textarea autosave
    const synthesisTextarea = $('wb-synthesis-textarea');
    const autosaveIndicator = $('wb-autosave-indicator');
    if (synthesisTextarea && autosaveIndicator) {
        let saveTimeout;
        synthesisTextarea.addEventListener('input', () => {
            autosaveIndicator.textContent = 'Saving...';
            autosaveIndicator.classList.add('saving');
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                if (!STATE.activeNote) return;
                const textVal = synthesisTextarea.value;
                const currentWb = STATE.activeNote.workbench || { items: [], notes: "" };
                currentWb.notes = textVal;
                STATE.activeNote.workbench = currentWb;
                await api.updateNoteWorkbenchAPI(STATE.activeNote.id, currentWb);
                autosaveIndicator.textContent = 'Saved';
                autosaveIndicator.classList.remove('saving');
            }, 800);
        });
    }

    // Bind collect buttons for initial/loaded items
    bindCollectButtons(detailBody);

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

    // Bind transit map click handlers
    detailBody.querySelectorAll('.transit-card[data-note-id]').forEach(card => {
        card.addEventListener('click', () => {
            HAPTIC.tap();
            const targetNote = STATE.notes.find(n => n.id === card.dataset.noteId);
            if (targetNote) {
                openDetail(targetNote);
            }
        });
    });

    // ── Persona lenses ──
    // Readings now accumulate side by side instead of overwriting each other,
    // so running one is additive and never destroys the previous analysis.
    const runPersona = async (personaKey, el) => {
        if (!STATE.activeNote) return;
        FX.tap();
        const label = el.querySelector('.persona-suggested-go');
        const originalLabel = label?.textContent;
        el.disabled = true;
        el.classList.add('loading');
        if (label) label.textContent = 'Reading…';
        try {
            await api.analyzeWithPersonaAPI(STATE.activeNote.id, personaKey);
            const upd = await api.getNoteByIdAPI(STATE.activeNote.id);
            if (upd) {
                STATE.activeNote = upd;
                renderDetail(upd);
                loadChatsForNote(upd.id);
            }
            FX.chime();
        } catch (e) {
            showToast(friendlyError(e));
        } finally {
            el.disabled = false;
            el.classList.remove('loading');
            if (label && originalLabel) label.textContent = originalLabel;
        }
    };

    detailBody.querySelector('.persona-suggested')?.addEventListener('click', (e) => {
        runPersona(e.currentTarget.dataset.persona, e.currentTarget);
    });

    detailBody.querySelectorAll('.persona-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            HAPTIC.pop();
            runPersona(pill.dataset.persona, pill);
        });
    });

    detailBody.querySelectorAll('.persona-reading-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            HAPTIC.tap();
            await api.deletePersonaReadingAPI(STATE.activeNote.id, btn.dataset.persona);
            const upd = await api.getNoteByIdAPI(STATE.activeNote.id);
            if (upd) { STATE.activeNote = upd; renderDetail(upd); }
        });
    });

    // ── Cluster assignment select ──
    const clusterSelect = document.getElementById('cluster-assign-select');
    if (clusterSelect) {
        clusterSelect.addEventListener('change', async () => {
            const clusterId = clusterSelect.value || null;
            HAPTIC.tap();
            await api.assignNoteToClusterAPI(STATE.activeNote.id, clusterId);
            STATE.activeNote.cluster_id = clusterId || undefined;
            FX.chime();
            // Refresh notes list if open
            if (notesPanel.classList.contains('open')) loadNotes();
        });
        setupCustomDropdown('cluster-assign-select');
    }
}


function insightCard(emoji, title, sectionKey, items, noteId) {
    const isCollected = (title, type) => {
        if (!STATE.activeNote || !STATE.activeNote.workbench || !STATE.activeNote.workbench.items) return false;
        return STATE.activeNote.workbench.items.some(item => item.title === title && item.type === type);
    };

    const renderItem = (i) => {
        if (typeof i === 'string') {
            return `<li>${esc(i)}</li>`;
        }
        
        switch (sectionKey) {
            case 'themes':
                const tTitle = i.theme || i.name || '';
                const tDesc = i.explanation || i.description || '';
                return `<li>
                    <div style="font-family:var(--font-serif);font-size:0.92rem;font-weight:600;color:var(--text-primary)">${esc(tTitle)}</div>
                    <div style="font-size:0.84rem;color:var(--text-secondary);margin:0.2rem 0">${esc(tDesc)}</div>
                    ${i.connections ? `<div style="font-size:0.78rem;color:var(--text-muted)">↳ Connections: ${esc(i.connections)}</div>` : ''}
                    <button class="btn btn-ghost btn-sm btn-collect" data-type="theme" data-title="${esc(tTitle)}" data-desc="${esc(tDesc)}" ${isCollected(tTitle, 'theme') ? 'disabled' : ''}>
                        ${isCollected(tTitle, 'theme') ? '✓ Collected' : '+ Collect'}
                    </button>
                </li>`;
            case 'references':
                const rTitle = i.concept || i.name || '';
                const rDesc = i.description || '';
                return `<li>
                    <div style="font-family:var(--font-serif);font-size:0.92rem;font-weight:600;color:var(--text-primary)">${esc(rTitle)}</div>
                    <div style="font-size:0.84rem;color:var(--text-secondary);margin:0.2rem 0">${esc(rDesc)}</div>
                    ${i.relevance ? `<div style="font-size:0.78rem;color:var(--text-muted)">↳ Relevance: ${esc(i.relevance)}</div>` : ''}
                    <button class="btn btn-ghost btn-sm btn-collect" data-type="reference" data-title="${esc(rTitle)}" data-desc="${esc(rDesc)}" ${isCollected(rTitle, 'reference') ? 'disabled' : ''}>
                        ${isCollected(rTitle, 'reference') ? '✓ Collected' : '+ Collect'}
                    </button>
                </li>`;
            case 'books':
                const bTitle = i.title || '';
                const bAuthor = i.author || 'Unknown';
                const bDesc = `by ${bAuthor} — ${i.reason || ''}`;
                return `<li>
                    <div style="font-family:var(--font-serif);font-size:0.92rem;font-weight:600;color:var(--text-primary)">📖 ${esc(bTitle)}</div>
                    <div style="font-size:0.84rem;color:var(--text-secondary);margin:0.2rem 0">by ${esc(bAuthor)}</div>
                    ${i.reason ? `<div style="font-size:0.8rem;color:var(--text-muted);font-style:italic">${esc(i.reason)}</div>` : ''}
                    <button class="btn btn-ghost btn-sm btn-collect" data-type="book" data-title="${esc(bTitle)}" data-desc="${esc(bDesc)}" ${isCollected(bTitle, 'book') ? 'disabled' : ''}>
                        ${isCollected(bTitle, 'book') ? '✓ Collected' : '+ Collect'}
                    </button>
                </li>`;
            case 'follow_ups':
                const qText = i.question || '';
                return `<li class="explore-question-item" style="flex-direction:column;align-items:flex-start;gap:0.3rem">
                    <span class="explore-question-text" style="font-weight:600">${esc(qText)}</span>
                    ${i.context ? `<span style="font-size:0.8rem;color:var(--text-muted)">${esc(i.context)}</span>` : ''}
                    <button class="btn btn-ghost btn-sm btn-collect" data-type="question" data-title="${esc(qText)}" data-desc="" ${isCollected(qText, 'question') ? 'disabled' : ''}>
                        ${isCollected(qText, 'question') ? '✓ Collected' : '+ Collect'}
                    </button>
                </li>`;
            default:
                return `<li>${esc(JSON.stringify(i))}</li>`;
        }
    };

    return `<div class="insight-card" id="insight-${sectionKey}">
        <div class="insight-card-header">
            <div class="insight-card-title"><span class="insight-emoji">${emoji}</span> ${title}</div>
            <button class="btn-explore btn-explore-quiet" data-section="${sectionKey}" data-note-id="${noteId}">
                <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                More
            </button>
        </div>
        <ul class="insight-list">${items.map(renderItem).join('')}</ul>
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
        
        // Merge results into local STATE variables so they sync and update the primary list in this session
        if (STATE.activeNote && STATE.activeNote.id === noteId) {
            if (!STATE.activeNote.insights) STATE.activeNote.insights = {};
            const existing = STATE.activeNote.insights[section] || [];
            
            const merged = [...existing];
            results.forEach(newItem => {
                const titleOf = (x) => {
                    if (typeof x === 'string') return x.trim().toLowerCase();
                    return (x.theme || x.concept || x.title || x.question || '').trim().toLowerCase();
                };
                const newTitle = titleOf(newItem);
                if (!merged.some(e => titleOf(e) === newTitle)) {
                    merged.push(newItem);
                }
            });
            STATE.activeNote.insights[section] = merged;
            
            const stateNote = STATE.notes.find(n => n.id === noteId);
            if (stateNote) {
                if (!stateNote.insights) stateNote.insights = {};
                stateNote.insights[section] = merged;
            }
        }

        container.innerHTML = renderExploreResults(section, results);
        bindCollectButtons(container);
        
        // Re-enable the button so the user can explore more
        btn.disabled = false;
        btn.innerHTML = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> More';
    } catch (e) {
        console.error("Explore section failed:", e);
        btn.disabled = false;
        btn.innerHTML = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Try again';
    }
}

function renderExploreResults(section, results) {
    if (!Array.isArray(results) || !results.length) return '<p class="explore-empty">No additional results found.</p>';

    const isCollected = (title, type) => {
        if (!STATE.activeNote || !STATE.activeNote.workbench || !STATE.activeNote.workbench.items) return false;
        return STATE.activeNote.workbench.items.some(i => i.title === title && i.type === type);
    };

    switch (section) {
        case 'themes':
            return `<div class="explore-grid">${results.map(r => {
                const title = r.theme || r.name || '';
                const desc = r.explanation || r.description || '';
                const collected = isCollected(title, 'theme');
                return `
                <div class="explore-item">
                    <div class="explore-item-title">${esc(title)}</div>
                    <div class="explore-item-desc">${esc(desc)}</div>
                    ${r.connections ? `<div class="explore-item-meta">${esc(r.connections)}</div>` : ''}
                    <button class="btn btn-ghost btn-sm btn-collect" data-type="theme" data-title="${esc(title)}" data-desc="${esc(desc)}" ${collected ? 'disabled' : ''}>
                        ${collected ? '✓ Collected' : '+ Collect'}
                    </button>
                </div>`;
            }).join('')}</div>`;

        case 'references':
            return `<div class="explore-grid">${results.map(r => {
                const title = r.concept || r.name || '';
                const desc = r.description || '';
                const collected = isCollected(title, 'reference');
                return `
                <div class="explore-item">
                    <div class="explore-item-title">${esc(title)}</div>
                    <div class="explore-item-desc">${esc(desc)}</div>
                    ${r.relevance ? `<div class="explore-item-meta">↳ ${esc(r.relevance)}</div>` : ''}
                    <button class="btn btn-ghost btn-sm btn-collect" data-type="reference" data-title="${esc(title)}" data-desc="${esc(desc)}" ${collected ? 'disabled' : ''}>
                        ${collected ? '✓ Collected' : '+ Collect'}
                    </button>
                </div>`;
            }).join('')}</div>`;

        case 'books':
            return `<div class="explore-grid">${results.map(r => {
                const title = r.title || '';
                const author = r.author || 'Unknown';
                const desc = `by ${author} — ${r.reason || ''}`;
                const collected = isCollected(title, 'book');
                return `
                <div class="explore-item explore-book">
                    <div class="explore-item-title">📖 ${esc(title)}</div>
                    <div class="explore-item-author">by ${esc(author)}</div>
                    <div class="explore-item-desc">${esc(r.reason || '')}</div>
                    <button class="btn btn-ghost btn-sm btn-collect" data-type="book" data-title="${esc(title)}" data-desc="${esc(desc)}" ${collected ? 'disabled' : ''}>
                        ${collected ? '✓ Collected' : '+ Collect'}
                    </button>
                </div>`;
            }).join('')}</div>`;

        case 'follow_ups':
            return `<ul class="explore-questions">${results.map(q => {
                const title = typeof q === 'string' ? q : q.question || '';
                const collected = isCollected(title, 'question');
                return `
                <li class="explore-question-item">
                    <span class="explore-question-text">${esc(title)}</span>
                    <button class="btn btn-ghost btn-sm btn-collect" data-type="question" data-title="${esc(title)}" data-desc="" ${collected ? 'disabled' : ''}>
                        ${collected ? '✓ Collected' : '+ Collect'}
                    </button>
                </li>`;
            }).join('')}</ul>`;

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
    const btn = $('btn-reprocess');
    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<span class="explore-spinner" style="border-color: var(--border-subtle); border-top-color: currentColor; width: 14px; height: 14px;"></span>`;
    try {
        await api.reprocessNoteAPI(STATE.activeNote.id);
        const poll = setInterval(async () => {
            if (!STATE.activeNote) { clearInterval(poll); btn.disabled = false; btn.innerHTML = originalContent; return; }
            const notes = await api.getNotesAPI(STATE.profile);
            if (!STATE.activeNote) { clearInterval(poll); btn.disabled = false; btn.innerHTML = originalContent; return; }
            const upd = notes.find(n => n.id === STATE.activeNote.id);
            if (upd && (upd.status === 'processed' || upd.status === 'error')) { clearInterval(poll); STATE.activeNote = upd; STATE.notes = notes; renderDetail(upd); loadChatsForNote(upd.id); btn.disabled = false; btn.innerHTML = originalContent; }
        }, 2000);
        setTimeout(() => { clearInterval(poll); btn.disabled = false; btn.innerHTML = originalContent; }, 30000);
    } catch { btn.disabled = false; btn.innerHTML = originalContent; }
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
        chatMessages.innerHTML = STATE.chatHistory.map(m => {
            const msgText = m.content || m.text || '';
            return `<div class="chat-bubble ${m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}">${m.role === 'user' ? esc(msgText) : fmtReply(msgText)}</div>`;
        }).join('');
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
    $('chat-input').style.height = '38px';
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

const chatInput = $('chat-input');
if (chatInput) {
    // Dynamic height resize based on content length
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = chatInput.scrollHeight + 'px';
    });

    // Enter submits the message, Shift+Enter inserts a new line
    chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            $('chat-form').requestSubmit();
        }
    });
}

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
function renderMarkdown(str) {
    if (!str) return '';
    let html = esc(str);

    // Split into lines for block-level parsing
    const lines = html.split('\n');
    let inList = null; // null, 'ul', 'ol'
    let result = [];

    for (let line of lines) {
        const trimmed = line.trim();

        // 1. Headers (### Heading)
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            if (inList) {
                result.push(inList === 'ul' ? '</ul>' : '</ol>');
                inList = null;
            }
            const level = headerMatch[1].length;
            const content = parseInlineMarkdown(headerMatch[2]);
            result.push(`<h${level}>${content}</h${level}>`);
            continue;
        }

        // 2. Unordered lists (* item or - item)
        const listMatch = line.match(/^(\s*)[*\-]\s+(.+)$/);
        if (listMatch) {
            if (inList !== 'ul') {
                if (inList) result.push(inList === 'ul' ? '</ul>' : '</ol>');
                result.push('<ul>');
                inList = 'ul';
            }
            const content = parseInlineMarkdown(listMatch[2]);
            result.push(`<li>${content}</li>`);
            continue;
        }

        // 3. Ordered lists (1. item)
        const numListMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (numListMatch) {
            if (inList !== 'ol') {
                if (inList) result.push(inList === 'ul' ? '</ul>' : '</ol>');
                result.push('<ol>');
                inList = 'ol';
            }
            const content = parseInlineMarkdown(numListMatch[2]);
            result.push(`<li>${content}</li>`);
            continue;
        }

        // Close list if we exit list context and encounter non-empty text
        if (inList && trimmed !== '') {
            result.push(inList === 'ul' ? '</ul>' : '</ol>');
            inList = null;
        }

        // 4. Blockquotes (> text)
        const quoteMatch = line.match(/^&gt;\s+(.+)$/);
        if (quoteMatch) {
            const content = parseInlineMarkdown(quoteMatch[1]);
            result.push(`<blockquote>${content}</blockquote>`);
            continue;
        }

        // 5. Horizontal rules (---)
        if (/^[-*_]{3,}$/.test(trimmed)) {
            result.push('<hr>');
            continue;
        }

        // 6. Regular line
        if (trimmed === '') {
            result.push('<br>');
        } else {
            const content = parseInlineMarkdown(line);
            result.push(`<div>${content}</div>`);
        }
    }

    if (inList) {
        result.push(inList === 'ul' ? '</ul>' : '</ol>');
    }

    return result.join('\n');
}

function parseInlineMarkdown(str) {
    if (!str) return '';
    // 1. Inline code: `code`
    str = str.replace(/`(.*?)`/g, '<code>$1</code>');
    // 2. Bold: **text** or __text__
    str = str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    str = str.replace(/__(.*?)__/g, '<strong>$1</strong>');
    // 3. Italic: *text* or _text_
    str = str.replace(/\*(.*?)\*/g, '<em>$1</em>');
    str = str.replace(/_(.*?)_/g, '<em>$1</em>');
    return str;
}

function fmtReply(t) { return renderMarkdown(t); }

// ─── Dashboard ────────────────────────────────────────────────
function openDashboard() {
    FX.tap();
    dashboardView.classList.remove('hidden');
    renderDashboard();
}

function closeDashboard() {
    HAPTIC.tap();
    dashboardView.classList.add('hidden');
}

function renderDashboard() {
    const notes = STATE.notes || [];
    
    // Group notes by YYYY-MM-DD local date
    const notesCountByDate = {};
    notes.forEach(note => {
        if (!note.created_at) return;
        const d = new Date(note.created_at);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        notesCountByDate[dateStr] = (notesCountByDate[dateStr] || 0) + 1;
    });

    // Generate last 28 days (4 weeks) ending today
    // To align with Sun-Sat columns, let's find the Sunday of the week 3 weeks ago
    const days = [];
    const today = new Date();
    const currentDayOfWeek = today.getDay(); // 0 is Sunday, 6 is Saturday
    
    const startDate = new Date();
    startDate.setDate(today.getDate() - currentDayOfWeek - 21); // Sunday of 3 weeks ago
    
    let totalNotesInPeriod = 0;
    
    for (let i = 0; i < 28; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const count = notesCountByDate[dateStr] || 0;
        totalNotesInPeriod += count;
        days.push({
            date: d,
            count: count,
            dateStr: dateStr
        });
    }

    // Update Summary Text
    const summaryTextEl = document.getElementById('db-summary-text');
    if (summaryTextEl) {
        let percent = 100;
        if (totalNotesInPeriod > 10) percent = 18;
        else if (totalNotesInPeriod > 5) percent = 35;
        else if (totalNotesInPeriod > 2) percent = 60;
        else percent = 88;
        
        summaryTextEl.innerHTML = `YOU ARE AMONG THE TOP ${percent}% OF MOST ACTIVE MEMBERS.<br>YOU CAPTURED ${totalNotesInPeriod} NOTES OVER THE LAST 28 DAYS.`;
    }

    // Populate grid
    const gridEl = document.getElementById('db-calendar-grid');
    if (gridEl) {
        gridEl.innerHTML = days.map(day => {
            const count = day.count;
            let dotClass = 'dot-zero';
            let label = 'No captures';
            if (count === 1) { dotClass = 'dot-one'; label = '1 capture'; }
            else if (count === 2) { dotClass = 'dot-two'; label = '2 captures'; }
            else if (count >= 3) { dotClass = 'dot-three'; label = '3+ captures'; }
            
            const titleDate = day.date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
            return `
                <div class="db-grid-cell" title="${titleDate}: ${label}">
                    <span class="db-circle ${dotClass}"></span>
                </div>
            `;
        }).join('');
    }
}

// Bind button clicks
// Activity opens from the tab bar (see setupTabBar)
$('btn-close-dashboard').addEventListener('click', closeDashboard);

// Swipe navigation for Capture View and Dashboard View
let touchStartX = 0;
let touchStartY = 0;

window.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

window.addEventListener('touchend', e => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        return; // Ignore swipes when user is actively typing!
    }

    const diffX = e.changedTouches[0].screenX - touchStartX;
    const diffY = e.changedTouches[0].screenY - touchStartY;
    
    // Check if swipe is horizontal and large enough (> 100px) and vertical deviation is small (< 60px)
    if (Math.abs(diffX) > 100 && Math.abs(diffY) < 60) {
        if (diffX < 0) {
            // Swipe Left: Show Dashboard if not already visible and not inside modal/detail
            if (dashboardView.classList.contains('hidden') && 
                noteDetail.classList.contains('hidden') && 
                discoverView.classList.contains('hidden')) {
                openDashboard();
            }
        } else {
            // Swipe Right: Close Dashboard if visible
            if (!dashboardView.classList.contains('hidden')) {
                closeDashboard();
            }
        }
    }
}, { passive: true });

// ─── Discover ────────────────────────────────────────────────
const CARD_EMOJI = { quote: '📖', question: '💭', recommendation: '📚', observation: '🔮', excerpt: '✍️' };

function openDiscover() { FX.tap(); discoverView.classList.remove('hidden'); loadDiscoverCards(); }
function closeDiscover() { HAPTIC.tap(); discoverView.classList.add('hidden'); }

// Discover opens from the tab bar (see setupTabBar)
$('btn-close-discover').addEventListener('click', closeDiscover);
$('btn-gen-cards').addEventListener('click', generateCards);

// Discover filter pills
document.querySelectorAll('.discover-filter-pill').forEach(pill => {
    pill.addEventListener('click', async () => {
        HAPTIC.tap();
        document.querySelectorAll('.discover-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        STATE.discoverFilter = pill.dataset.filter;
        if (STATE.discoverFilter === 'stored') {
            await loadDiscoverCards();
        } else {
            renderDiscoverStack();
        }
    });
});
$('btn-gen-cards-empty').addEventListener('click', generateCards);

$('btn-dismiss-card').addEventListener('click', () => {
    const top = discoverStack.firstElementChild;
    if (!top || top.classList.contains('fade-out')) return;
    FX.swoosh();
    top.classList.add('fade-out');
    respondToCard(top.dataset.id, 'dismissed');
    setTimeout(removeTopCard, 300);
});
$('btn-accept-card').addEventListener('click', () => {
    const top = discoverStack.firstElementChild;
    if (!top || top.classList.contains('fade-out')) return;
    FX.chime();
    top.classList.add('fade-out');
    respondToCard(top.dataset.id, 'accepted');
    setTimeout(removeTopCard, 300);
});

async function generateCards() {
    const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
    const filter = STATE.discoverFilter;
    const specificType = (filter !== 'all' && filter !== 'stored') ? filter : null;
    
    const btnHeader = $('btn-gen-cards');
    const btnEmpty = $('btn-gen-cards-empty');
    
    if (btnHeader) {
        btnHeader.disabled = true;
        btnHeader.innerHTML = `<span class="explore-spinner" style="width: 14px; height: 14px; border-color: var(--text-muted); border-top-color: currentColor; vertical-align: middle;"></span>`;
    }
    if (btnEmpty) {
        btnEmpty.disabled = true;
        btnEmpty.textContent = 'Generating…';
    }

    try {
        await api.generateDiscoverAPI(profile, specificType);
        setTimeout(async () => {
            await loadDiscoverCards();
            if (btnHeader) {
                btnHeader.disabled = false;
                btnHeader.innerHTML = `
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                    </svg>`;
            }
            if (btnEmpty) {
                btnEmpty.disabled = false;
                btnEmpty.textContent = 'Generate now';
            }
        }, 8000);
    } catch {
        if (btnHeader) {
            btnHeader.disabled = false;
            btnHeader.innerHTML = `
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                </svg>`;
        }
        if (btnEmpty) {
            btnEmpty.disabled = false;
            btnEmpty.textContent = 'Generate now';
        }
    }
}

async function loadDiscoverCards() {
    const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
    try {
        if (STATE.discoverFilter === 'stored') {
            const cards = await api.getAcceptedDiscoverCardsAPI(profile);
            STATE.storedDiscoverCards = cards;
        } else {
            const res = { ok: true, json: async () => await api.getDiscoverCardsAPI(profile) };
            const cards = await res.json();
            STATE.discoverCards = cards;
        }
        renderDiscoverStack();
    } catch { }
}

function getFilteredDiscoverCards() {
    if (STATE.discoverFilter === 'stored') return STATE.storedDiscoverCards || [];
    if (STATE.discoverFilter === 'all') return STATE.discoverCards;
    return STATE.discoverCards.filter(c => c.card_type === STATE.discoverFilter);
}

// Procedural swipe gestures helper
function setupSwipeCardDragging() {
    const topCard = discoverStack.firstElementChild;
    if (!topCard || STATE.discoverFilter === 'stored') return;

    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    let isDragging = false;

    function handleStart(clientX, clientY) {
        isDragging = true;
        startX = clientX;
        startY = clientY;
        currentX = clientX;
        currentY = clientY;
        topCard.style.transition = 'none';
        topCard.style.cursor = 'grabbing';
        
        // Temporarily disable transition on background cards while dragging
        const secondCard = topCard.nextElementSibling;
        const thirdCard = secondCard ? secondCard.nextElementSibling : null;
        if (secondCard) secondCard.style.transition = 'none';
        if (thirdCard) thirdCard.style.transition = 'none';
    }

    function handleMove(clientX, clientY) {
        if (!isDragging) return;
        currentX = clientX;
        currentY = clientY;
        const dx = currentX - startX;
        const dy = currentY - startY;

        // Rotate based on horizontal displacement
        const rotate = dx * 0.08;
        topCard.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${rotate}deg)`;

        // Visual swipe feedback overlay classes and stamp controls
        const stampKeep = topCard.querySelector('.stamp-keep');
        const stampPass = topCard.querySelector('.stamp-pass');

        if (dx > 30) {
            topCard.classList.add('swiping-right');
            topCard.classList.remove('swiping-left');
        } else if (dx < -30) {
            topCard.classList.add('swiping-left');
            topCard.classList.remove('swiping-right');
        } else {
            topCard.classList.remove('swiping-left', 'swiping-right');
        }

        if (stampKeep && stampPass) {
            if (dx > 0) {
                const opacity = Math.min(dx / 80, 1);
                stampKeep.style.opacity = opacity;
                stampKeep.style.transform = `rotate(12deg) scale(${0.6 + opacity * 0.4})`;
                
                stampPass.style.opacity = '0';
                stampPass.style.transform = 'rotate(-12deg) scale(0.6)';
            } else {
                const opacity = Math.min(-dx / 80, 1);
                stampPass.style.opacity = opacity;
                stampPass.style.transform = `rotate(-12deg) scale(${0.6 + opacity * 0.4})`;
                
                stampKeep.style.opacity = '0';
                stampKeep.style.transform = 'rotate(12deg) scale(0.6)';
            }
        }

        // Scale and position underlying cards relative to swipe distance
        const dragRatio = Math.min(Math.abs(dx) / 120, 1);
        const secondCard = topCard.nextElementSibling;
        const thirdCard = secondCard ? secondCard.nextElementSibling : null;

        if (secondCard) {
            const currentScale = 0.96 + (0.04 * dragRatio);
            const currentTranslateY = 12 - (12 * dragRatio);
            const currentTranslateZ = -20 + (20 * dragRatio);
            secondCard.style.transform = `translate3d(0, ${currentTranslateY}px, ${currentTranslateZ}px) scale(${currentScale})`;
            secondCard.style.opacity = (0.9 + (0.1 * dragRatio)).toString();
        }
        if (thirdCard) {
            const currentScale = 0.92 + (0.04 * dragRatio);
            const currentTranslateY = 24 - (12 * dragRatio);
            const currentTranslateZ = -40 + (20 * dragRatio);
            thirdCard.style.transform = `translate3d(0, ${currentTranslateY}px, ${currentTranslateZ}px) scale(${currentScale})`;
            thirdCard.style.opacity = (0.75 + (0.15 * dragRatio)).toString();
        }
    }

    async function handleEnd() {
        if (!isDragging) return;
        isDragging = false;
        topCard.style.cursor = 'grab';

        const dx = currentX - startX;
        const dy = currentY - startY;
        const threshold = 120;

        // Reset transitions for all cards
        topCard.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.2), opacity 0.3s ease';
        const secondCard = topCard.nextElementSibling;
        const thirdCard = secondCard ? secondCard.nextElementSibling : null;
        if (secondCard) secondCard.style.transition = 'transform 0.4s ease, opacity 0.4s ease';
        if (thirdCard) thirdCard.style.transition = 'transform 0.4s ease, opacity 0.4s ease';

        if (dx > threshold) {
            // Swipe right: Accept / Store
            topCard.style.transform = `translate3d(500px, ${dy}px, 0) rotate(${dx * 0.08}deg)`;
            topCard.style.opacity = '0';
            FX.chime();
            respondToCard(topCard.dataset.id, 'accepted');
            setTimeout(removeTopCard, 300);
        } else if (dx < -threshold) {
            // Swipe left: Dismiss
            topCard.style.transform = `translate3d(-500px, ${dy}px, 0) rotate(${dx * 0.08}deg)`;
            topCard.style.opacity = '0';
            FX.swoosh();
            respondToCard(topCard.dataset.id, 'dismissed');
            setTimeout(removeTopCard, 300);
        } else {
            // Snap back
            topCard.classList.remove('swiping-left', 'swiping-right');
            topCard.style.transform = 'translate3d(0, 0, 0) scale(1)';

            // Reset stamps
            const stampKeep = topCard.querySelector('.stamp-keep');
            const stampPass = topCard.querySelector('.stamp-pass');
            if (stampKeep) {
                stampKeep.style.opacity = '0';
                stampKeep.style.transform = 'rotate(12deg) scale(0.6)';
            }
            if (stampPass) {
                stampPass.style.opacity = '0';
                stampPass.style.transform = 'rotate(-12deg) scale(0.6)';
            }

            // Reset underlying cards
            if (secondCard) {
                secondCard.style.transform = 'translate3d(0, 12px, -20px) scale(0.96)';
                secondCard.style.opacity = '0.9';
            }
            if (thirdCard) {
                thirdCard.style.transform = 'translate3d(0, 24px, -40px) scale(0.92)';
                thirdCard.style.opacity = '0.75';
            }
            
            // Clean up transition styles after animations complete
            setTimeout(() => {
                if (secondCard) secondCard.style.transition = '';
                if (thirdCard) thirdCard.style.transition = '';
            }, 400);
        }
    }

    // Touch Event Listeners
    topCard.addEventListener('touchstart', e => {
        if (e.touches.length === 1) handleStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    topCard.addEventListener('touchmove', e => {
        if (e.touches.length === 1) handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    topCard.addEventListener('touchend', handleEnd);

    // Mouse Event Listeners
    topCard.addEventListener('mousedown', e => {
        handleStart(e.clientX, e.clientY);
        
        const onMouseMove = ev => handleMove(ev.clientX, ev.clientY);
        const onMouseUp = () => {
            handleEnd();
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function renderDiscoverStack() {
    const cards = getFilteredDiscoverCards();
    const actionsEl = document.querySelector('.discover-actions');
    
    if (STATE.discoverFilter === 'stored') {
        if (actionsEl) actionsEl.classList.add('hidden');
        discoverStack.classList.add('stored-list');
        
        if (!cards.length) {
            discoverStack.classList.add('hidden');
            discoverEmpty.classList.remove('hidden');
            const emptyText = discoverEmpty.querySelector('.discover-empty-text');
            emptyText.innerHTML = 'No stored cards yet.<br/>Swipe cards right (Store) to save them here!';
            return;
        }
        
        discoverStack.classList.remove('hidden');
        discoverEmpty.classList.add('hidden');
        discoverStack.innerHTML = '';
        
        cards.forEach(card => {
            const el = document.createElement('div');
            el.className = 'stored-card-item';
            el.innerHTML = `
                <div class="card-header-row">
                    <span class="card-type-label"><span class="card-type-emoji">${CARD_EMOJI[card.card_type] || '✨'}</span> ${card.card_type}</span>
                    <button class="btn-delete-stored" data-id="${card.id}" aria-label="Remove stored card">✕</button>
                </div>
                <div class="card-content">${esc(card.content)}</div>
                ${card.source ? `<div class="card-source">${esc(card.source)}</div>` : ''}
            `;
            
            // Wire delete button
            const btnDel = el.querySelector('.btn-delete-stored');
            if (btnDel) {
                btnDel.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    HAPTIC.tap();
                    if (confirm("Remove this card from stored items?")) {
                        await api.updateDiscoverCardAPI(card.id, 'dismissed');
                        
                        // Also delete the corresponding note in Firestore
                        try {
                            const noteId = await api.findNoteByDiscoverCardIdAPI(card.id, card.content);
                            if (noteId) {
                                await api.deleteNoteAPI(noteId);
                                console.log(`[Discover] Deleted corresponding note ${noteId} for card ${card.id}`);
                            }
                        } catch (err) {
                            console.error("Failed to delete corresponding note:", err);
                        }
                        
                        STATE.storedDiscoverCards = STATE.storedDiscoverCards.filter(c => c.id !== card.id);
                        renderDiscoverStack();
                        updateDiscoverBadge();
                    }
                });
            }
            
            discoverStack.appendChild(el);
        });
        
    } else {
        if (actionsEl) actionsEl.classList.remove('hidden');
        discoverStack.classList.remove('stored-list');
        
        if (!cards.length) {
            discoverStack.classList.add('hidden');
            discoverEmpty.classList.remove('hidden');
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
        const visible = cards.slice(0, 3);
        visible.forEach(card => {
            const el = document.createElement('div');
            el.className = 'swipe-card';
            el.dataset.id = card.id;
            el.dataset.type = card.card_type;
            el.innerHTML = `
                <div class="swipe-stamp stamp-keep">KEEP</div>
                <div class="swipe-stamp stamp-pass">PASS</div>
                <div class="card-type-label"><span class="card-type-emoji">${CARD_EMOJI[card.card_type] || '✨'}</span> ${card.card_type}</div>
                <div class="card-content">${esc(card.content)}</div>
                ${card.source ? `<div class="card-source">${esc(card.source)}</div>` : ''}`;
            discoverStack.appendChild(el);
        });
        
        // Setup Tinder-style physics dragging
        setupSwipeCardDragging();
    }
}

function removeTopCard() {
    STATE.discoverCards.shift();
    renderDiscoverStack();
    updateDiscoverBadge();
}

async function respondToCard(cardId, status) {
    try {
        await api.updateDiscoverCardAPI(cardId, status);
        
        if (status === 'accepted') {
            const card = STATE.discoverCards.find(c => c.id === cardId);
            if (card) {
                const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
                const cardTypeTag = card.card_type ? card.card_type.toLowerCase() : 'discover';
                const initialTags = ['discover', cardTypeTag];
                
                let noteText = `${card.content}`;
                if (card.source) {
                    noteText += `\n\n— ${card.source}`;
                }
                
                await api.addNoteAPI(noteText, profile, initialTags, { discover_card_id: cardId });
                console.log(`[Discover] Stored card ${cardId} as a new note with associated discover_card_id.`);
            }
        }
    } catch (e) {
        console.error("Failed to update card status:", e);
    }
}

async function updateDiscoverBadge() {
    const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
    if (!profile) return;
    try {
        const res = { ok: true, json: async () => ({ count: await api.countUnseenCardsAPI(profile) }) };
        const { count } = await res.json();
        discoverBadge.textContent = count;
        discoverBadge.classList.toggle('hidden', count === 0);
    } catch { }
}

setInterval(() => { if (STATE.profile) updateDiscoverBadge(); }, 5 * 60 * 1000);

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

// ─── Custom Dropdown Helper ──────────────────────────────────
function setupCustomDropdown(selectId) {
    const select = $(selectId);
    if (!select) return;

    // Check if custom dropdown already initialized for this element
    let container = select.nextElementSibling;
    if (container && container.classList.contains('custom-dropdown-container')) {
        syncCustomDropdown(select);
        return;
    }

    // Hide original select
    select.style.display = 'none';

    // Create custom elements
    container = document.createElement('div');
    container.className = 'custom-dropdown-container';
    if (select.className) {
        container.classList.add(select.className);
    }

    const toggle = document.createElement('div');
    toggle.className = 'custom-dropdown-toggle';

    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';

    container.appendChild(toggle);
    container.appendChild(menu);
    select.parentNode.insertBefore(container, select.nextSibling);

    // Toggle menu visibility
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = container.classList.contains('open');
        closeAllCustomDropdowns();
        if (!isOpen) {
            container.classList.add('open');
        }
    });

    select._customDropdown = container;
    syncCustomDropdown(select);
}

function syncCustomDropdown(select) {
    const container = select._customDropdown;
    if (!container) return;

    const toggle = container.querySelector('.custom-dropdown-toggle');
    const menu = container.querySelector('.custom-dropdown-menu');
    if (!toggle || !menu) return;

    menu.innerHTML = '';
    const options = Array.from(select.options);
    const selectedOption = select.options[select.selectedIndex] || options[0];

    toggle.textContent = selectedOption ? selectedOption.textContent : 'Select...';

    options.forEach((opt, idx) => {
        const item = document.createElement('div');
        item.className = 'custom-dropdown-item';
        if (opt.value === select.value) item.classList.add('selected');
        item.textContent = opt.textContent;

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            select.selectedIndex = idx;

            // Dispatch native change event
            const event = new Event('change', { bubbles: true });
            select.dispatchEvent(event);

            syncCustomDropdown(select);
            closeAllCustomDropdowns();
        });
        menu.appendChild(item);
    });
}

function closeAllCustomDropdowns() {
    document.querySelectorAll('.custom-dropdown-container').forEach(c => {
        c.classList.remove('open');
    });
}

// Close custom dropdowns on clicking outside
document.addEventListener('click', closeAllCustomDropdowns);

function updateCharMeter(len) {
    if (charCount) charCount.textContent = len.toLocaleString();
    const fill = $('char-meter-fill');
    if (fill) {
        const maxChars = 2000;
        const pct = Math.min((len / maxChars) * 100, 100);
        fill.style.width = pct + '%';
        if (len > maxChars) {
            fill.style.background = 'var(--error)';
        } else {
            fill.style.background = ''; // Revert to standard var(--accent-glow)
        }
    }
}

function getNoteTitle(rawText, summary) {
    if (!rawText) return 'Untitled Note';
    let firstLine = rawText.split('\n')[0].trim().replace(/^#+\s+/, '');
    if (!firstLine && summary) {
        firstLine = summary.split('.')[0];
    }
    if (!firstLine) {
        firstLine = 'Untitled Note';
    }
    return firstLine.replace(/[\/\\?%*:|"<>\.]/g, '').substring(0, 50).trim() || 'Untitled Note';
}

function triggerRisographRipple(x, y) {
    const ripple = $('risograph-ripple');
    if (!ripple) return;

    let color = 'var(--accent)';
    if (STATE.profile === 'prineeth') color = 'var(--prineeth)';
    else if (STATE.profile === 'pramoddini') color = 'var(--pramoddini)';

    ripple.style.setProperty('--x', `${x}px`);
    ripple.style.setProperty('--y', `${y}px`);
    ripple.style.setProperty('--ripple-color', color);

    ripple.classList.remove('active');
    void ripple.offsetWidth; // Trigger reflow
    ripple.classList.add('active');
}

// ═════════════════════════════════════════════════════════════
//  NOTE DETAIL — connections & concepts
// ═════════════════════════════════════════════════════════════

/**
 * Connections used to render as literal [[wikilink]] text you couldn't follow.
 * They're real records now, and every one is a button into the other note.
 */
async function renderNoteConnections(note) {
    const slot = $('detail-connections');
    if (!slot) return;
    slot.innerHTML = '';

    let conns = [];
    try {
        conns = await api.getConnectionsForNoteAPI(note.id);
    } catch (e) {
        console.warn('Connections failed:', e.message);
        return;
    }
    if (!conns.length) {
        slot.innerHTML = `<div class="detail-section">
            <div class="detail-section-label">Connections</div>
            <div class="conn-empty">
                <p>Nothing linked yet.</p>
                <button id="btn-find-links" class="btn btn-ghost btn-sm">Look for connections</button>
            </div>
        </div>`;
        slot.querySelector('#btn-find-links')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Looking…';
            try {
                const found = await api.linkNoteAPI(note.id);
                if (found.length) { FX.chime(); renderNoteConnections(note); }
                else { btn.textContent = 'Nothing found yet'; btn.disabled = false; }
            } catch (err) {
                showToast(friendlyError(err));
                btn.textContent = 'Look for connections';
                btn.disabled = false;
            }
        });
        return;
    }

    const others = await Promise.all(conns.map(c => api.getNoteByIdAPI(c.other)));
    const rows = conns.map((c, i) => ({ c, other: others[i] })).filter(r => r.other);

    slot.innerHTML = `<div class="detail-section">
        <div class="detail-section-label">Connections <span class="detail-count">${rows.length}</span></div>
        <div class="detail-conn-list">
            ${rows.map(({ c, other }) => `
                <button class="detail-conn" data-note-id="${esc(other.id)}">
                    <span class="detail-conn-title">${esc(api.noteTitle(other))}</span>
                    <span class="detail-conn-why">${esc(c.explanation || '')}</span>
                    <span class="detail-conn-date">${new Date(other.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </button>`).join('')}
        </div>
    </div>`;

    slot.querySelectorAll('.detail-conn').forEach(el => {
        el.addEventListener('click', async () => {
            FX.tap();
            const target = await api.getNoteByIdAPI(el.dataset.noteId);
            if (target) openDetail(target);
        });
    });
}

/** Concepts are shelves you can walk to, not decoration. */
async function renderNoteConcepts(note) {
    const host = $('detail-connections');
    if (!host || !(note.concepts || []).length) return;

    const block = document.createElement('div');
    block.className = 'detail-section';
    block.innerHTML = `<div class="detail-section-label">Filed under</div>
        <div class="detail-concepts">
            ${note.concepts.map(c => `<button class="detail-concept" data-concept="${esc(c)}">${esc(c)}</button>`).join('')}
        </div>`;
    host.prepend(block);

    block.querySelectorAll('.detail-concept').forEach(el => {
        el.addEventListener('click', async () => {
            FX.tap();
            const concept = await api.getConceptByNameAPI(STATE.profile, el.dataset.concept);
            if (!concept) return showToast('That concept has no page yet.');
            THREADS_CACHE.concepts = await api.getConceptsAPI(STATE.profile);
            closeDetail();
            closeNotes();
            setTab('threads');
            openConcept(concept.id);
        });
    });
}

// ═════════════════════════════════════════════════════════════
//  TAB BAR
// ═════════════════════════════════════════════════════════════

const TABS = {
    capture:  { open: () => {}, close: () => {} },
    notes:    { open: () => openNotes(),     close: () => closeNotes() },
    threads:  { open: () => openThreads(),   close: () => closeThreads() },
    discover: { open: () => openDiscover(),  close: () => closeDiscover() },
    activity: { open: () => openDashboard(), close: () => closeDashboard() },
};

let activeTab = 'capture';

function setTab(name) {
    if (!TABS[name]) return;
    if (name === activeTab) {
        // Tapping the active tab returns you to capture — a reliable way out
        if (name !== 'capture') return setTab('capture');
        return;
    }
    TABS[activeTab]?.close();
    activeTab = name;
    TABS[name].open();
    document.querySelectorAll('.tab-btn').forEach(b => {
        const isActive = b.id === `tab-${name}`;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
}

/** Called by each view's own back/close control so the tab bar stays truthful. */
function syncTabToCapture() {
    activeTab = 'capture';
    document.querySelectorAll('.tab-btn').forEach(b => {
        const isActive = b.id === 'tab-capture';
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
}

function setupTabBar() {
    for (const name of Object.keys(TABS)) {
        const btn = $(`tab-${name}`);
        if (btn) btn.addEventListener('click', () => { FX.tap(); setTab(name); });
    }
}

// ═════════════════════════════════════════════════════════════
//  RESURFACE — one quiet thing from the past on the capture screen
// ═════════════════════════════════════════════════════════════

async function renderResurface() {
    const el = $('resurface');
    if (!el || !STATE.profile) return;
    if (sessionStorage.getItem('nw_resurface_dismissed') === '1') return;

    try {
        const notes = (await api.getNotesAPI(STATE.profile)).filter(n => !api.isDiscoverNote(n));
        if (notes.length < 5) return;

        // Prefer something with a real connection behind it; otherwise reach back in time
        const older = notes.filter(n => Date.now() - new Date(n.created_at) > 7 * 86400000);
        if (!older.length) return;
        const pick = older[Math.floor(Math.random() * Math.min(older.length, 40))];

        const conns = await api.getConnectionsForNoteAPI(pick.id).catch(() => []);
        let line = pick.summary || api.stripDerived(pick.raw_text).slice(0, 140);
        let kicker = timeAgo(pick.created_at);

        if (conns.length) {
            const other = notes.find(n => n.id === conns[0].other);
            if (other) {
                line = conns[0].explanation;
                kicker = `${api.noteTitle(pick)} ⟷ ${api.noteTitle(other)}`;
            }
        }

        el.innerHTML = `
            <button class="resurface-dismiss" aria-label="Dismiss">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div class="resurface-kicker">${esc(kicker)}</div>
            <div class="resurface-body">${esc(line)}</div>`;
        el.classList.remove('hidden');

        el.querySelector('.resurface-dismiss').addEventListener('click', (e) => {
            e.stopPropagation();
            HAPTIC.tap();
            sessionStorage.setItem('nw_resurface_dismissed', '1');
            el.classList.add('hidden');
        });
        el.addEventListener('click', () => { openDetail(pick); });
    } catch (e) {
        console.warn('Resurface failed:', e.message);
    }
}

function timeAgo(iso) {
    const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
    if (days < 1) return 'Earlier today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days} days ago`;
    if (days < 60) return 'Last month';
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} year${days < 730 ? '' : 's'} ago`;
}

// ═════════════════════════════════════════════════════════════
//  THREADS — concepts, synthesis, connections
// ═════════════════════════════════════════════════════════════

const threadsView = $('threads-view');
const conceptDetail = $('concept-detail');
const synthesisDetail = $('synthesis-detail');

const THREADS_CACHE = { concepts: null, syntheses: null, connections: null, notes: null };

function openThreads() {
    FX.tap();
    threadsView.classList.remove('hidden');
    loadThreadsPane(currentThreadsPane);
}
function closeThreads() {
    HAPTIC.tap();
    threadsView.classList.add('hidden');
    conceptDetail.classList.add('hidden');
    synthesisDetail.classList.add('hidden');
}

let currentThreadsPane = 'concepts';

function setupThreads() {
    $('btn-close-threads')?.addEventListener('click', () => { closeThreads(); syncTabToCapture(); });
    $('btn-close-concept')?.addEventListener('click', () => { HAPTIC.tap(); conceptDetail.classList.add('hidden'); });
    $('btn-close-synthesis')?.addEventListener('click', () => { HAPTIC.tap(); synthesisDetail.classList.add('hidden'); });

    document.querySelectorAll('.threads-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            FX.tap();
            const pane = tab.dataset.pane;
            currentThreadsPane = pane;
            document.querySelectorAll('.threads-tab').forEach(t => t.classList.toggle('active', t === tab));
            document.querySelectorAll('.threads-pane').forEach(p => p.classList.toggle('hidden', p.id !== `pane-${pane}`));
            loadThreadsPane(pane);
        });
    });

    document.querySelectorAll('.synth-period').forEach(btn => {
        btn.addEventListener('click', () => runPeriodSynthesis(parseInt(btn.dataset.days, 10), btn));
    });

    $('btn-threads-tidy')?.addEventListener('click', runVocabularyTidy);
    $('btn-concept-rename')?.addEventListener('click', renameActiveConcept);
}

async function loadThreadsPane(pane) {
    if (pane === 'concepts') return renderConcepts();
    if (pane === 'syntheses') return renderSyntheses();
    if (pane === 'connections') return renderConnections();
}

// ─── Concepts ────────────────────────────────────────────────

async function renderConcepts() {
    const list = $('concepts-list');
    list.innerHTML = '<div class="threads-empty">Loading…</div>';
    try {
        const concepts = (await api.getConceptsAPI(STATE.profile)).filter(c => (c.note_ids || []).length > 0);
        THREADS_CACHE.concepts = concepts;

        $('threads-subtitle').textContent = concepts.length
            ? `${concepts.length} concept${concepts.length === 1 ? '' : 's'} across your notes`
            : 'What keeps coming back';

        if (!concepts.length) {
            list.innerHTML = `<div class="threads-empty">
                <p>No concepts yet.</p>
                <p class="threads-empty-sub">Concepts appear as you capture. To build them for notes you already have, open Settings → Notebook maintenance → Build the graph.</p>
            </div>`;
            return;
        }

        const max = Math.max(...concepts.map(c => c.note_ids.length));
        list.innerHTML = concepts.map(c => {
            const n = c.note_ids.length;
            const pct = Math.round((n / max) * 100);
            return `<button class="concept-row" data-concept-id="${esc(c.id)}">
                <div class="concept-row-bar" style="width:${pct}%"></div>
                <div class="concept-row-main">
                    <span class="concept-row-name">${esc(c.name)}</span>
                    <span class="concept-row-count">${n}</span>
                </div>
                ${n >= 2 ? '<span class="concept-row-hint">Synthesise →</span>' : ''}
            </button>`;
        }).join('');

        list.querySelectorAll('.concept-row').forEach(row => {
            row.addEventListener('click', () => openConcept(row.dataset.conceptId));
        });
    } catch (e) {
        list.innerHTML = `<div class="threads-empty">Couldn't load concepts: ${esc(e.message)}</div>`;
    }
}

let activeConcept = null;

async function openConcept(conceptId) {
    FX.tap();
    const concept = (THREADS_CACHE.concepts || []).find(c => c.id === conceptId);
    if (!concept) return;
    activeConcept = concept;

    conceptDetail.classList.remove('hidden');
    $('concept-name').textContent = concept.name;
    const body = $('concept-body');
    body.innerHTML = '<div class="threads-empty">Loading…</div>';

    const notes = (await Promise.all(concept.note_ids.map(id => api.getNoteByIdAPI(id)))).filter(Boolean);
    notes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    $('concept-count').textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;

    const existing = await api.getSynthesisAPI('concept', conceptId).catch(() => null);
    const span = notes.length > 1
        ? `${new Date(notes[notes.length - 1].created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} — ${new Date(notes[0].created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
        : '';

    body.innerHTML = `
        ${span ? `<div class="concept-span">${esc(span)}</div>` : ''}
        <div class="concept-synth-slot">${existing ? synthesisCardHTML(existing) : ''}</div>
        ${notes.length >= 2 ? `<button id="btn-synth-concept" class="btn btn-accent synth-cta">
            ${existing ? 'Synthesise again' : 'Synthesise these ' + notes.length + ' notes'}
        </button>` : '<p class="threads-empty-sub" style="padding:0 1.25rem">One more note under this concept and you can synthesise it.</p>'}
        <div class="concept-notes">
            <div class="concept-notes-label">Notes</div>
            ${notes.map(n => `<button class="concept-note" data-note-id="${esc(n.id)}">
                <span class="concept-note-title">${esc(api.noteTitle(n))}</span>
                <span class="concept-note-date">${new Date(n.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
            </button>`).join('')}
        </div>`;

    body.querySelectorAll('.concept-note').forEach(el => {
        el.addEventListener('click', async () => {
            const note = await api.getNoteByIdAPI(el.dataset.noteId);
            if (note) { conceptDetail.classList.add('hidden'); closeThreads(); openDetail(note); }
        });
    });
    body.querySelector('#btn-synth-concept')?.addEventListener('click', (e) => runConceptSynthesis(conceptId, e.currentTarget));
    bindSynthesisCards(body);
}

async function runConceptSynthesis(conceptId, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Reading across your notes…';
    try {
        const result = await api.synthesizeConceptAPI(conceptId);
        const slot = $('concept-body').querySelector('.concept-synth-slot');
        slot.innerHTML = synthesisCardHTML(result);
        bindSynthesisCards(slot);
        btn.textContent = 'Synthesise again';
        FX.chime();
        THREADS_CACHE.syntheses = null;
    } catch (e) {
        btn.textContent = original;
        showToast(friendlyError(e));
    } finally {
        btn.disabled = false;
    }
}

async function renameActiveConcept() {
    if (!activeConcept) return;
    const next = prompt('Rename concept', activeConcept.name);
    if (!next || next.trim() === activeConcept.name) return;
    try {
        await api.renameConceptAPI(activeConcept.id, next.trim());
        activeConcept.name = next.trim();
        $('concept-name').textContent = next.trim();
        THREADS_CACHE.concepts = null;
        renderConcepts();
        showToast('Renamed');
    } catch (e) { showToast(friendlyError(e)); }
}

// ─── Synthesis ───────────────────────────────────────────────

function synthesisCardHTML(s) {
    const list = (items, cls) => (items || []).length
        ? `<ul class="synth-list ${cls}">${items.map(i => `<li>${esc(typeof i === 'string' ? i : JSON.stringify(i))}</li>`).join('')}</ul>` : '';
    return `<article class="synth-card" data-synth-id="${esc(s.id || '')}">
        <div class="synth-card-head">
            <span class="synth-card-scope">${esc(s.label || '')} · ${s.note_count || 0} notes</span>
            <h3 class="synth-card-title">${esc(s.synthesis_title || 'Synthesis')}</h3>
        </div>
        <p class="synth-narrative">${esc(s.narrative || '')}</p>
        ${s.throughline ? `<p class="synth-throughline">${esc(s.throughline)}</p>` : ''}
        ${s.themes?.length ? `<div class="synth-section"><span class="synth-label">Threads</span>${list(s.themes, 'themes')}</div>` : ''}
        ${s.tensions?.length ? `<div class="synth-section"><span class="synth-label">Tensions</span>${list(s.tensions, 'tensions')}</div>` : ''}
        ${s.questions?.length ? `<div class="synth-section"><span class="synth-label">Open questions</span>${list(s.questions, 'questions')}</div>` : ''}
        <div class="synth-card-foot">
            <span class="synth-date">${s.created_at ? new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
        </div>
    </article>`;
}

function bindSynthesisCards(root) {
    // Reserved for future per-card actions; keeps call sites stable.
}

async function renderSyntheses() {
    const list = $('syntheses-list');
    list.innerHTML = '<div class="threads-empty">Loading…</div>';
    try {
        const items = await api.getSynthesesAPI(STATE.profile);
        THREADS_CACHE.syntheses = items;
        if (!items.length) {
            list.innerHTML = `<div class="threads-empty">
                <p>Nothing synthesised yet.</p>
                <p class="threads-empty-sub">Pick a stretch of time above, or synthesise a concept or collection.</p>
            </div>`;
            return;
        }
        list.innerHTML = items.map(synthesisCardHTML).join('');
        bindSynthesisCards(list);
    } catch (e) {
        list.innerHTML = `<div class="threads-empty">Couldn't load: ${esc(e.message)}</div>`;
    }
}

async function runPeriodSynthesis(days, btn) {
    const original = btn.textContent;
    document.querySelectorAll('.synth-period').forEach(b => b.disabled = true);
    btn.textContent = 'Reading…';
    try {
        const result = await api.synthesizePeriodAPI(STATE.profile, days, btn.textContent);
        const list = $('syntheses-list');
        list.insertAdjacentHTML('afterbegin', synthesisCardHTML(result));
        bindSynthesisCards(list);
        list.querySelector('.synth-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        FX.chime();
    } catch (e) {
        showToast(friendlyError(e));
    } finally {
        document.querySelectorAll('.synth-period').forEach(b => b.disabled = false);
        btn.textContent = original;
    }
}

// ─── Connections ─────────────────────────────────────────────

async function renderConnections() {
    const list = $('connections-list');
    // Opening the pane clears the badge
    api.getAllConnectionsAPI(STATE.profile)
        .then(c => { localStorage.setItem('nw_conns_seen', String(c.length)); updateThreadsBadge(); })
        .catch(() => {});
    list.innerHTML = '<div class="threads-empty">Loading…</div>';
    try {
        const [conns, notes] = await Promise.all([
            api.getAllConnectionsAPI(STATE.profile),
            api.getNotesAPI(STATE.profile),
        ]);
        THREADS_CACHE.connections = conns;
        const byId = new Map(notes.map(n => [n.id, n]));

        if (!conns.length) {
            list.innerHTML = `<div class="threads-empty">
                <p>No connections yet.</p>
                <p class="threads-empty-sub">New notes link themselves as you capture. For notes you already have, open Settings → Notebook maintenance → Build the graph.</p>
            </div>`;
            return;
        }

        const rows = conns
            .map(c => ({ c, a: byId.get(c.note_a), b: byId.get(c.note_b) }))
            .filter(r => r.a && r.b)
            .sort((x, y) => (y.c.strength || 0) - (x.c.strength || 0));

        list.innerHTML = rows.map(({ c, a, b }) => `
            <article class="conn-row">
                <div class="conn-pair">
                    <button class="conn-node" data-note-id="${esc(a.id)}">${esc(api.noteTitle(a))}</button>
                    <span class="conn-link" aria-hidden="true">⟷</span>
                    <button class="conn-node" data-note-id="${esc(b.id)}">${esc(api.noteTitle(b))}</button>
                </div>
                <p class="conn-why">${esc(c.explanation || '')}</p>
            </article>`).join('');

        list.querySelectorAll('.conn-node').forEach(el => {
            el.addEventListener('click', async () => {
                const note = byId.get(el.dataset.noteId);
                if (note) { closeThreads(); syncTabToCapture(); openDetail(note); }
            });
        });
    } catch (e) {
        list.innerHTML = `<div class="threads-empty">Couldn't load: ${esc(e.message)}</div>`;
    }
}

async function runVocabularyTidy() {
    const btn = $('btn-threads-tidy');
    btn.disabled = true;
    showToast('Looking for duplicate concepts…');
    try {
        const proposals = await api.proposeConceptMergesAPI(STATE.profile);
        if (!proposals.length) { showToast('Vocabulary looks clean — nothing to merge.'); return; }

        for (const p of proposals) {
            const names = p.sources.map(s => `"${s.name}"`).join(', ');
            const ok = await showConfirmDialog(
                `Merge into "${p.canonical}"?`,
                `${names} would fold into "${p.canonical}". ${p.totalNotes} notes affected.`,
                'Merge'
            );
            if (!ok) continue;
            for (const src of p.sources) {
                await api.mergeConceptsAPI(STATE.profile, src.id, p.target.id);
            }
            if (p.canonical !== p.target.name) {
                await api.renameConceptAPI(p.target.id, p.canonical);
            }
        }
        THREADS_CACHE.concepts = null;
        renderConcepts();
        showToast('Vocabulary tidied');
    } catch (e) {
        showToast(friendlyError(e));
    } finally {
        btn.disabled = false;
    }
}

// ─── Shared helpers ──────────────────────────────────────────

function friendlyError(e) {
    if (e?.name === 'MissingKeyError') return 'Add your Gemini API key in Settings first.';
    return e?.message || 'Something went wrong.';
}

let toastTimer = null;
function showToast(msg) {
    let el = $('nw-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'nw-toast';
        el.className = 'nw-toast';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 3400);
}

// ─── Init ────────────────────────────────────────────────────
async function init() {
    // Apply styling/theme
    if (STATE.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.setAttribute('data-theme', 'dark');
    updateThemeIcons();
    
    // Initialize typeface UI values
    const settingsFontFamily = $('settings-font-family');
    const settingsFontSize = $('settings-font-size');
    const settingsLetterSpacing = $('settings-letter-spacing');
    const labelFontSize = $('label-font-size');
    const labelLetterSpacing = $('label-letter-spacing');

    if (settingsFontFamily) {
        settingsFontFamily.value = STATE.fontFamily;
        settingsFontFamily.addEventListener('change', () => {
            STATE.fontFamily = settingsFontFamily.value;
            applyTypefaceSettings();
            saveState();
        });
        setupCustomDropdown('settings-font-family');
    }

    if (settingsFontSize) {
        settingsFontSize.value = STATE.fontSize;
        labelFontSize.textContent = `${STATE.fontSize}px`;
        settingsFontSize.addEventListener('input', () => {
            STATE.fontSize = parseInt(settingsFontSize.value);
            labelFontSize.textContent = `${STATE.fontSize}px`;
            applyTypefaceSettings();
            saveState();
        });
    }

    if (settingsLetterSpacing) {
        settingsLetterSpacing.value = STATE.letterSpacing;
        labelLetterSpacing.textContent = `${STATE.letterSpacing >= 0 ? '+' : ''}${STATE.letterSpacing.toFixed(2)}em`;
        settingsLetterSpacing.addEventListener('input', () => {
            STATE.letterSpacing = parseFloat(settingsLetterSpacing.value);
            labelLetterSpacing.textContent = `${STATE.letterSpacing >= 0 ? '+' : ''}${STATE.letterSpacing.toFixed(2)}em`;
            applyTypefaceSettings();
            saveState();
        });
    }

    // Settings Accordion Toggles
    const accordionHeaders = document.querySelectorAll('.settings-accordion-header');
    accordionHeaders.forEach((header) => {
        header.addEventListener('click', () => {
            const section = header.parentElement;
            const isActive = section.classList.contains('active');
            
            // Close all sections
            document.querySelectorAll('.settings-accordion-section').forEach((sec) => {
                sec.classList.remove('active');
                sec.querySelector('.settings-accordion-header').setAttribute('aria-expanded', 'false');
            });
            
            // If the section wasn't active, open it
            if (!isActive) {
                section.classList.add('active');
                header.setAttribute('aria-expanded', 'true');
                FX.tap();
            } else {
                FX.tap();
            }
        });
    });

    // Batch selection action handlers
    if (btnBatchCancel) {
        btnBatchCancel.addEventListener('click', () => {
            HAPTIC.tap();
            clearNoteSelection();
        });
    }

    if (btnBatchApply) {
        btnBatchApply.addEventListener('click', async () => {
            const selectedClusterId = batchClusterSelect.value;
            if (!selectedClusterId) {
                alert('Please select a destination cluster first.');
                return;
            }
            
            HAPTIC.success();
            btnBatchApply.disabled = true;
            btnBatchApply.textContent = 'Applying...';

            try {
                const targetClusterId = selectedClusterId === 'unclustered' ? '' : selectedClusterId;
                const promises = Array.from(STATE.selectedNoteIds).map(noteId => 
                    api.assignNoteToClusterAPI(noteId, targetClusterId)
                );
                await Promise.all(promises);
                
                clearNoteSelection();
                await loadNotes();
            } catch (err) {
                console.error('Batch assignment failed:', err);
                alert('Failed to assign notes to cluster.');
            } finally {
                btnBatchApply.disabled = false;
                btnBatchApply.textContent = 'Apply';
            }
        });
    }

    setupTabBar();
    setupThreads();

    updateGoogleStatus();
    verifySession();

    if (STATE.profile) {
        renderResurface();
        updateMemoryCount();
        updateThreadsBadge();
    }

    // Nudge toward a key rather than failing silently on the first capture
    if (!localStorage.getItem('nw_gemini_key')) {
        setTimeout(() => showToast('Add your Gemini API key in Settings to enable analysis.'), 1200);
    }
}

/** Surfaces how many connections are waiting to be looked at. */
async function updateThreadsBadge() {
    const badge = $('threads-badge');
    if (!badge || !STATE.profile) return;
    try {
        const conns = await api.getAllConnectionsAPI(STATE.profile);
        const seen = parseInt(localStorage.getItem('nw_conns_seen') || '0', 10);
        const fresh = Math.max(0, conns.length - seen);
        badge.textContent = String(fresh);
        badge.classList.toggle('hidden', fresh === 0);
    } catch { badge.classList.add('hidden'); }
}

init();

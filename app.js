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
    fontFamily: localStorage.getItem('nw_font_family') || 'inter',
    fontSize: parseInt(localStorage.getItem('nw_font_size') || '16'),
    letterSpacing: parseFloat(localStorage.getItem('nw_letter_spacing') || '0'),
    selectedNoteIds: new Set(), // Keep track of selected notes in selection mode
    deckSquared: false,    // loose-paper stack: squared away vs spread out
    activityPeriod: 28,    // days covered by the Activity figure
    activityNotes: null,   // unfiltered archive copy, for Activity's figures
    discoverFocus: 0,      // which card in the queue is in hand
    discoverOpen: false,   // is a card pulled out for a decision
    openDrawers: new Set(), // which note-detail drawers you left open
    drawerNoteId: null,     // the note those open drawers belong to
};

// Apply theme class right away to avoid initial layout flicker if light mode active
if (STATE.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
else document.documentElement.setAttribute('data-theme', 'dark');

function applyTypefaceSettings() {
    const root = document.documentElement;
    root.style.setProperty('--user-font-size', `${STATE.fontSize}px`);
    root.style.setProperty('--user-letter-spacing', `${STATE.letterSpacing}em`);
    
    // Only the reading face is user-swappable. The display face stays put so
    // the type scale and its tracking keep working.
    let fontSans = "'Inter', -apple-system, 'Helvetica Neue', sans-serif";
    if (STATE.fontFamily === 'monospace') {
        fontSans = "'JetBrains Mono', ui-monospace, monospace";
    } else if (STATE.fontFamily === 'serif') {
        fontSans = "'Newsreader', 'Source Serif 4', Georgia, serif";
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
    resetMemory();
    updateLettersBadge();
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

// ─── Settings ────────────────────────────────────────────────
// One sheet, one scroll, everything visible. Changes commit as you make
// them; "Done" only closes. Escape, the backdrop and the × do the same.

let settingsReturnFocus = null;

function markSettingsSaved(msg = 'Saved') {
    const el = $('settings-saved-note');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('flash');
    clearTimeout(markSettingsSaved._t);
    markSettingsSaved._t = setTimeout(() => {
        el.classList.remove('flash');
        el.textContent = 'Changes save as you make them';
    }, 1600);
}

function describeStoredKey() {
    const el = $('gemini-key-status');
    if (!el) return;
    const key = localStorage.getItem('nw_gemini_key');
    el.classList.remove('ok', 'bad');
    if (!key) {
        el.textContent = 'No key saved — analysis, Discover and chat are off.';
        return;
    }
    el.textContent = `Key saved on this device · ends in ${key.slice(-4)}`;
    el.classList.add('ok');
}

function saveGeminiKey() {
    const val = (geminiKeyInput?.value || '').trim();
    if (val) localStorage.setItem('nw_gemini_key', val);
    else localStorage.removeItem('nw_gemini_key');
    describeStoredKey();
    markSettingsSaved(val ? 'Key saved' : 'Key cleared');
}

function saveGoogleClientId() {
    if (!googleClientIdInput) return;
    const val = googleClientIdInput.value.trim();
    if (val) localStorage.setItem('nw_google_client_id', val);
    else localStorage.removeItem('nw_google_client_id');
    markSettingsSaved('Client ID saved');
}

function syncSettingsControls() {
    if (geminiKeyInput) {
        geminiKeyInput.value = localStorage.getItem('nw_gemini_key') || '';
        geminiKeyInput.type = 'password';
    }
    const reveal = $('btn-key-reveal');
    if (reveal) { reveal.textContent = 'Show'; reveal.setAttribute('aria-pressed', 'false'); }
    describeStoredKey();

    if (googleClientIdInput) googleClientIdInput.value = localStorage.getItem('nw_google_client_id') || '';
    updateGoogleStatus();

    const audioEnable = $('audio-enable-input');
    const audioVolume = $('audio-volume-input');
    if (audioEnable) audioEnable.checked = !STATE.audioMute;
    if (audioVolume) { audioVolume.value = STATE.audioVolume; audioVolume.disabled = STATE.audioMute; }
    updateVolumeReadout();

    const fam = $('settings-font-family');
    if (fam) fam.value = STATE.fontFamily;
    const size = $('settings-font-size');
    if (size) size.value = STATE.fontSize;
    const ls = $('settings-letter-spacing');
    if (ls) ls.value = STATE.letterSpacing;

    updateSettingsThemeButtons();

    const who = $('st-account-name');
    if (who) {
        const names = { prineeth: 'Prineeth', pramoddini: 'Pramoddini', combined: 'Both notebooks' };
        who.textContent = STATE.profile ? `Signed in as ${names[STATE.profile] || STATE.profile}` : 'Signed in';
    }
    updateMemoryCount();
}

function updateVolumeReadout() {
    const out = $('label-audio-volume');
    const input = $('audio-volume-input');
    if (out && input) out.textContent = `${Math.round(parseFloat(input.value) * 100)}%`;
}

function updateSettingsThemeButtons() {
    const light = $('st-theme-light');
    const dark = $('st-theme-dark');
    if (light) light.setAttribute('aria-pressed', String(STATE.theme === 'light'));
    if (dark) dark.setAttribute('aria-pressed', String(STATE.theme !== 'light'));
}

const SETTINGS_FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function trapSettingsFocus(e) {
    if (e.key !== 'Tab') return;
    const nodes = [...settingsDialog.querySelectorAll(SETTINGS_FOCUSABLE)]
        .filter(n => n.offsetParent !== null || n === document.activeElement);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function settingsOpen() {
    return settingsDialog && !settingsDialog.classList.contains('hidden');
}

function openSettings(sectionId = null) {
    if (!settingsDialog) return;
    settingsReturnFocus = document.activeElement;
    syncSettingsControls();
    settingsDialog.classList.remove('hidden');
    settingsDialog.addEventListener('keydown', trapSettingsFocus);
    document.body.style.overflow = 'hidden';

    const body = $('settings-body');
    if (body) body.scrollTop = 0;
    if (sectionId) {
        requestAnimationFrame(() => {
            $(sectionId)?.scrollIntoView({ block: 'start' });
            markCurrentSettingsSection();
        });
    }
    markCurrentSettingsSection();
    requestAnimationFrame(() => $('btn-settings-x')?.focus());
}

function closeSettings() {
    if (!settingsOpen()) return;
    // Everything else already committed on change; the key is the one field
    // where you might close mid-edit.
    saveGeminiKey();
    saveGoogleClientId();
    saveState();
    settingsDialog.classList.add('hidden');
    settingsDialog.removeEventListener('keydown', trapSettingsFocus);
    document.body.style.overflow = '';
    if (settingsReturnFocus?.isConnected) settingsReturnFocus.focus();
    settingsReturnFocus = null;
}

/** The jump bar highlights whichever section you are actually looking at. */
function markCurrentSettingsSection() {
    const body = $('settings-body');
    const nav = $('settings-nav');
    if (!body || !nav) return;
    const sections = [...body.querySelectorAll('.st-section')];
    const top = body.getBoundingClientRect().top;
    let current = sections[0];
    for (const sec of sections) {
        if (sec.getBoundingClientRect().top - top <= 24) current = sec;
    }
    nav.querySelectorAll('.st-jump').forEach(b => {
        const on = b.dataset.target === current?.id;
        b.classList.toggle('current', on);
        b.setAttribute('aria-current', on ? 'true' : 'false');
    });
}

if (btnSettings) btnSettings.addEventListener('click', () => { HAPTIC.tap(); openSettings(); });
$('btn-settings-x')?.addEventListener('click', () => { HAPTIC.tap(); closeSettings(); });
if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => { HAPTIC.tap(); closeSettings(); });
settingsDialog?.addEventListener('mousedown', (e) => { if (e.target === settingsDialog) closeSettings(); });

// Jump bar
$('settings-nav')?.querySelectorAll('.st-jump').forEach(btn => {
    btn.addEventListener('click', () => {
        FX.tap();
        $(btn.dataset.target)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
});
$('settings-body')?.addEventListener('scroll', () => {
    clearTimeout(markCurrentSettingsSection._t);
    markCurrentSettingsSection._t = setTimeout(markCurrentSettingsSection, 60);
});

// Gemini key: reveal, save on blur, and a real check against the API
$('btn-key-reveal')?.addEventListener('click', () => {
    if (!geminiKeyInput) return;
    const showing = geminiKeyInput.type === 'text';
    geminiKeyInput.type = showing ? 'password' : 'text';
    const btn = $('btn-key-reveal');
    btn.textContent = showing ? 'Show' : 'Hide';
    btn.setAttribute('aria-pressed', String(!showing));
    btn.setAttribute('aria-label', showing ? 'Show API key' : 'Hide API key');
});
geminiKeyInput?.addEventListener('change', saveGeminiKey);
geminiKeyInput?.addEventListener('blur', saveGeminiKey);

$('btn-key-test')?.addEventListener('click', async () => {
    const btn = $('btn-key-test');
    const status = $('gemini-key-status');
    saveGeminiKey();
    if (!localStorage.getItem('nw_gemini_key')) {
        status.textContent = 'Paste a key first.';
        status.classList.add('bad');
        return;
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Checking…';
    status.classList.remove('ok', 'bad');
    status.textContent = 'Asking Google…';
    try {
        await api.callGemini('Reply with the single word: ok', 'ping', { maxTokens: 8 });
        status.textContent = 'Key works.';
        status.classList.add('ok');
        FX.chime();
    } catch (e) {
        status.textContent = `Key rejected — ${friendlyError(e)}`;
        status.classList.add('bad');
    } finally {
        btn.disabled = false;
        btn.textContent = label;
    }
});

googleClientIdInput?.addEventListener('change', saveGoogleClientId);
googleClientIdInput?.addEventListener('blur', saveGoogleClientId);

// Sound
$('audio-enable-input')?.addEventListener('change', (e) => {
    STATE.audioMute = !e.target.checked;
    const vol = $('audio-volume-input');
    if (vol) vol.disabled = STATE.audioMute;
    saveState();
    if (!STATE.audioMute) FX.tap();
    markSettingsSaved(STATE.audioMute ? 'Sound off' : 'Sound on');
});
$('audio-volume-input')?.addEventListener('input', () => {
    STATE.audioVolume = parseFloat($('audio-volume-input').value);
    updateVolumeReadout();
});
$('audio-volume-input')?.addEventListener('change', () => {
    saveState();
    FX.tap();
    markSettingsSaved('Volume set');
});

// Theme, from inside settings as well as the top bar
$('st-theme-light')?.addEventListener('click', () => { HAPTIC.tap(); applyTheme('light'); updateSettingsThemeButtons(); markSettingsSaved('Light'); });
$('st-theme-dark')?.addEventListener('click', () => { HAPTIC.tap(); applyTheme('dark'); updateSettingsThemeButtons(); markSettingsSaved('Dark'); });

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

bindMaintenance('btn-migrate', 'Import old connections', async (log) => {
    const r = await api.migrateConnectionsAPI(STATE.profile || 'prineeth', log);
    THREADS_CACHE.connections = null;
    updateThreadsBadge();
    if (notesPanel.classList.contains('open')) await loadNotes();
    return `Imported ${r.migrated} connections from ${r.scanned} notes. Your notes were not modified, so the main app at /noteworthy/ keeps working.`
        + (r.unresolved ? ` ${r.unresolved} pointed at notes that no longer exist.` : '');
});

bindMaintenance('btn-backfill', 'Build the graph', async (log) => {
    const r = await api.backfillAPI(STATE.profile || 'prineeth', (msg) => log(msg));
    THREADS_CACHE.connections = null;
    THREADS_CACHE.concepts = null;
    if (memoryOpen()) renderMemoryOverview();
    // "Embedded 0" on its own sent us hunting for nine months. Never again.
    if (!r.embedded && r.embedError) {
        return `Found ${r.linked} connections, but embedded nothing — ${r.embedError} `
            + `Semantic search stays off until that endpoint answers.`;
    }
    const embedPart = `Embedded ${r.embedded} notes${r.model ? ` with ${r.model}` : ''}`
        + (r.embedFailed ? ` (${r.embedFailed} could not be embedded)` : '');
    const linkPart = r.linkCandidates === 0
        ? 'every note was already linked, so linking had nothing to look at'
        : `looked at ${r.linkCandidates} unlinked note${r.linkCandidates === 1 ? '' : 's'} and found ${r.linked} connection${r.linked === 1 ? '' : 's'}`;
    return `${embedPart}. Then ${linkPart}.`;
});

bindMaintenance('btn-relink', 'Re-draw connections', async (log) => {
    const profile = STATE.profile || 'prineeth';
    const notes = (await api.getNotesAPI(profile)).filter(n => !api.isDiscoverNote(n));
    const todo = notes.filter(n => n.embedding?.length && !n.relinked_at).length;

    if (!todo) {
        return notes.some(n => n.embedding?.length)
            ? 'Every indexed note has already been re-drawn. Nothing to do.'
            : 'No notes are indexed yet — run "Build the graph" first.';
    }

    // One model call per note is not something to click twice by accident.
    const ok = await showConfirmDialog(
        `Re-draw connections across ${todo} notes?`,
        `That is ${todo} calls to the model and a few minutes. Existing connections are kept — this only adds what the `
        + `first pass could not see. You can stop it by closing the app, and it will resume where it left off.`,
        'Re-draw'
    );
    if (!ok) return 'Left the connections as they are.';

    const r = await api.relinkAPI(profile, (msg) => log(msg));
    THREADS_CACHE.connections = null;
    THREADS_CACHE.concepts = null;
    updateThreadsBadge();
    if (r.stoppedEarly) {
        return `Stopped after ${r.considered} notes with nothing found — that usually means the model call is failing. `
            + `Check the console, then run it again to resume.`;
    }
    return `Re-drew ${r.considered} notes and added ${r.added} new connection${r.added === 1 ? '' : 's'}.`
        + (r.alreadyDone ? ` ${r.alreadyDone} had been done already.` : '')
        + (r.noVector ? ` ${r.noVector} have no vector yet — build the graph to include them.` : '');
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
        closeSettings();
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
            btnSend.disabled = false;
            showToast('Connect Google first — Settings is open at that section.');
            openSettings('st-google');
            requestAnimationFrame(() => googleClientIdInput?.focus());
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
        if (settingsOpen()) { closeSettings(); return; }
        if (!noteDetail.classList.contains('hidden') && memoryOpen()) { closeDetail(); return; }
        if (memoryOpen()) { closeMemory(); syncTabToCapture(); return; }
        if (!dashboardView.classList.contains('hidden')) { closeDashboard(); syncTabToCapture(); return; }
        if (!discoverView.classList.contains('hidden')) { closeDiscover(); syncTabToCapture(); return; }
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
            $('cluster-carousel-wrap')?.classList.add('hidden');
            const emptyMsg = (queryText || activeTags.length) ? 'No matching notes.' : 'No notes yet.<br/>Start capturing!';
            notesList.innerHTML = `<div class="notes-empty"><div class="notes-empty-icon">${(queryText || activeTags.length) ? '🔍' : '📝'}</div><div class="notes-empty-text">${emptyMsg}</div></div>`;
            return;
        }

        // Build the shelf view (skip while searching/filtering or in combined profile)
        const hasFilters = queryText || activeTags.length || profile === 'combined';
        $('cluster-carousel-wrap')?.classList.toggle('hidden', !!hasFilters || !clusters.length);
        if (!hasFilters) {
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

// ─── Cluster shelf ───────────────────────────────────────────
// Filed notes live in bound volumes you walk along; unfiled notes stay a
// loose stack of paper. The two states of a note get two different objects.

function clusterInk(colorId) {
    const map = {};
    api.CLUSTER_COLORS.forEach(c => { map[c.id] = c; });
    return map[colorId] || map['violet'];
}

/** First readable line of a note, for cover typesetting. */
function noteOpeningLine(note, max = 38) {
    const raw = api.stripDerived(note.raw_text || '').replace(/[#*_`>\-]/g, ' ').replace(/\s+/g, ' ').trim();
    return raw.length > max ? raw.slice(0, max).trimEnd() + '…' : raw;
}

function renderClusterCarousel(clusters, grouped, unfiledCount) {
    const wrap = $('cluster-carousel-wrap');
    const track = $('cluster-carousel');
    const controls = $('cluster-controls');
    if (!wrap || !track) return;

    if (!clusters.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');

    const active = STATE.activeClusterFilter;

    track.innerHTML = clusters.map(cluster => {
        const ink = clusterInk(cluster.color);
        const items = grouped[cluster.id] || [];
        // The cover is made of what's inside it — the first lines of its own notes.
        const leaves = items.slice(0, 5).map(n =>
            `<span class="cl-leaf">${esc(noteOpeningLine(n, 34))}</span>`).join('')
            || '<span class="cl-leaf cl-leaf-empty">empty volume</span>';
        // A fat volume holds more paper — the spine carries the count before you read it.
        const spine = Math.round(9 + Math.min(items.length, 40) * 0.35);
        return `
        <button class="cl-cover${cluster.id === active ? ' active' : ''}" data-cluster-id="${esc(cluster.id)}"
                style="--cl: ${esc(ink.hex)}; --cl-glow: ${esc(ink.glow)}; --spine-w: ${spine}px"
                aria-pressed="${cluster.id === active}">
            <span class="cl-spine"></span>
            <span class="cl-leaves">${leaves}</span>
            <span class="cl-band">
                <span class="cl-band-emoji">${esc(cluster.emoji || '📁')}</span>
                <span class="cl-band-name">${esc(cluster.name)}</span>
            </span>
            <span class="cl-count">${items.length}</span>
        </button>`;
    }).join('') + `
        <button class="cl-cover cl-cover-new" data-new-cluster="1" aria-label="New cluster">
            <span class="cl-new-mark">+</span>
            <span class="cl-new-label">New volume</span>
        </button>`;

    // The control pill under the shelf acts on whichever volume is pulled out.
    const activeCluster = clusters.find(c => c.id === active);
    if (activeCluster) {
        controls.classList.remove('hidden');
        controls.innerHTML = `
            <button class="cl-ctl" data-ctl="synthesize" title="Synthesize this volume">✦</button>
            <button class="cl-ctl" data-ctl="rename" title="Rename">✎</button>
            <button class="cl-ctl" data-ctl="recolour" title="Change binding colour">
                <span class="cl-ctl-swatch" style="background:${esc(clusterInk(activeCluster.color).hex)}"></span>
            </button>
            <button class="cl-ctl cl-ctl-danger" data-ctl="delete" title="Delete volume">⌫</button>`;
    } else {
        controls.classList.add('hidden');
        controls.innerHTML = '';
    }

    bindCarouselEvents(clusters);
}

function bindCarouselEvents(clusters) {
    const track = $('cluster-carousel');
    const controls = $('cluster-controls');
    if (!track) return;

    track.querySelectorAll('.cl-cover[data-cluster-id]').forEach(cover => {
        cover.addEventListener('click', () => {
            FX.tap();
            const id = cover.dataset.clusterId;
            STATE.activeClusterFilter = STATE.activeClusterFilter === id ? null : id;
            loadNotes();
        });
    });

    track.querySelector('[data-new-cluster]')?.addEventListener('click', () => {
        HAPTIC.tap();
        $('btn-new-cluster')?.click();
    });

    // Keep the pulled-out volume in view.
    requestAnimationFrame(() => {
        track.querySelector('.cl-cover.active')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    });

    if (!controls) return;
    controls.querySelectorAll('.cl-ctl').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = STATE.activeClusterFilter;
            const cluster = clusters.find(c => c.id === id);
            if (!cluster) return;

            if (btn.dataset.ctl === 'synthesize') {
                await runClusterSynthesis(id, cluster.name, btn);
            } else if (btn.dataset.ctl === 'rename') {
                HAPTIC.tap();
                startCoverRename(cluster);
            } else if (btn.dataset.ctl === 'recolour') {
                HAPTIC.tap();
                const order = api.CLUSTER_COLORS.map(c => c.id);
                const next = order[(order.indexOf(cluster.color) + 1) % order.length];
                await api.updateClusterAPI(id, { color: next });
                FX.pop();
                loadNotes();
            } else if (btn.dataset.ctl === 'delete') {
                const ok = await showConfirmDialog(
                    `Delete "${cluster.name}"?`,
                    'The notes inside go back to the loose stack — nothing is deleted.',
                    'Delete'
                );
                if (!ok) return;
                await api.deleteClusterAPI(id);
                STATE.activeClusterFilter = null;
                FX.swoosh();
                loadNotes();
            }
        });
    });
}

/** Rename in place, on the cover itself. */
function startCoverRename(cluster) {
    const cover = $('cluster-carousel')?.querySelector(`.cl-cover[data-cluster-id="${CSS.escape(cluster.id)}"]`);
    const nameEl = cover?.querySelector('.cl-band-name');
    if (!nameEl) return;

    const input = document.createElement('input');
    input.className = 'cl-band-input';
    input.value = cluster.name;
    input.maxLength = 40;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = async (save) => {
        if (done) return;
        done = true;
        const val = input.value.trim();
        if (save && val && val !== cluster.name) {
            await api.updateClusterAPI(cluster.id, { name: val });
            FX.pop();
        }
        loadNotes();
    };
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(true); }
        if (e.key === 'Escape') { commit(false); }
    });
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('blur', () => commit(true));
}

/** The loose stack — paper that hasn't been bound into anything yet. */
function unfiledDeckHTML(unfiled) {
    const top = unfiled[0];
    const squared = STATE.deckSquared ? ' squared' : '';
    return `
    <div class="unfiled-deck${squared}">
        <button class="deck-stack" id="deck-stack" aria-expanded="${!STATE.deckSquared}" aria-label="${unfiled.length} unfiled notes">
            <span class="deck-sheet deck-sheet-5"></span>
            <span class="deck-sheet deck-sheet-4"></span>
            <span class="deck-sheet deck-sheet-3"></span>
            <span class="deck-sheet deck-sheet-2"></span>
            <span class="deck-sheet deck-sheet-1">
                <span class="deck-rule"></span>
                <span class="deck-excerpt">${top ? esc(noteOpeningLine(top, 64)) : 'Nothing loose.'}</span>
                <span class="deck-figures">
                    <span class="deck-count">${unfiled.length}</span>
                    <span class="deck-unit">loose<br/>leaves</span>
                </span>
            </span>
        </button>
        <div class="deck-caption">
            <span class="deck-caption-label">Unfiled</span>
            <span class="deck-caption-hint">${STATE.deckSquared ? 'Tap the stack to spread it out' : 'Tap the stack to square it up'}</span>
        </div>
    </div>`;
}

function renderClusteredNotes(notes, clusters) {
    const grouped = {};
    const unfiled = [];
    notes.forEach(n => {
        if (n.cluster_id) (grouped[n.cluster_id] ||= []).push(n);
        else unfiled.push(n);
    });

    // A cluster that no longer exists shouldn't hold the view hostage.
    if (STATE.activeClusterFilter && !clusters.some(c => c.id === STATE.activeClusterFilter)) {
        STATE.activeClusterFilter = null;
    }

    renderClusterCarousel(clusters, grouped, unfiled.length);

    const active = clusters.find(c => c.id === STATE.activeClusterFilter);
    let cardIdx = 0;

    if (active) {
        const items = grouped[active.id] || [];
        const ink = clusterInk(active.color);
        notesList.innerHTML = `
            <div class="shelf-open" style="--cl: ${esc(ink.hex)}; --cl-glow: ${esc(ink.glow)}">
                <div class="shelf-open-head">
                    <span class="shelf-open-name">${esc(active.emoji || '📁')} ${esc(active.name)}</span>
                    <span class="shelf-open-count">${items.length} ${items.length === 1 ? 'note' : 'notes'}</span>
                </div>
                ${items.length
                    ? items.map(n => renderCard(n, cardIdx++)).join('')
                    : '<div class="cluster-empty">Nothing bound in here yet — open a note and file it from its Cluster drawer.</div>'}
            </div>
            ${unfiled.length ? `<button class="deck-return" id="deck-return">
                <span class="deck-return-sheets"><i></i><i></i><i></i></span>
                Back to the loose stack <span class="deck-return-count">${unfiled.length}</span>
            </button>` : ''}`;

        bindNoteCardEvents();
        $('deck-return')?.addEventListener('click', () => {
            FX.swoosh();
            STATE.activeClusterFilter = null;
            loadNotes();
        });
        scrollObserver?.disconnect();
        return;
    }

    // No volume pulled out — you're looking at the loose stack.
    if (!unfiled.length && !clusters.length) {
        notesList.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">📝</div><div class="notes-empty-text">No notes yet.<br/>Start capturing!</div></div>';
        return;
    }

    notesList.innerHTML = unfiledDeckHTML(unfiled)
        + `<div class="deck-spread" id="deck-spread">
            ${unfiled.slice(0, PAGE_SIZE).map(n => renderCard(n, cardIdx++)).join('')}
            ${unfiled.length > PAGE_SIZE ? `<div class="notes-sentinel" data-remaining="${unfiled.length - PAGE_SIZE}"></div>` : ''}
           </div>`;

    $('deck-stack')?.addEventListener('click', () => {
        STATE.deckSquared = !STATE.deckSquared;
        STATE.deckSquared ? FX.swoosh() : FX.pop();
        const deck = notesList.querySelector('.unfiled-deck');
        const spread = $('deck-spread');
        deck?.classList.toggle('squared', STATE.deckSquared);
        spread?.classList.toggle('stowed', STATE.deckSquared);
        const hint = deck?.querySelector('.deck-caption-hint');
        if (hint) hint.textContent = STATE.deckSquared ? 'Tap the stack to spread it out' : 'Tap the stack to square it up';
        $('deck-stack')?.setAttribute('aria-expanded', String(!STATE.deckSquared));
    });
    if (STATE.deckSquared) $('deck-spread')?.classList.add('stowed');

    bindNoteCardEvents();
    setupInfiniteScroll(unfiled, PAGE_SIZE);
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

    // Show the person's own words — no AI summary on the card.
    const body = api.stripDerived(note.raw_text);
    const head = `<div class="note-card-raw">${esc(body)}</div>`;

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
                btn.innerHTML = '✓ collected';
                btn.disabled = true;
            }
        });
    });
}

// ─── Note Detail ─────────────────────────────────────────────
function openDetail(note) {
    STATE.activeNote = note;
    // Drawers stay put across a re-render of the same note, but a different note
    // arrives shut — you shouldn't inherit the last note's open drawers.
    if (STATE.drawerNoteId !== note.id) {
        STATE.openDrawers.clear();
        STATE.drawerNoteId = note.id;
    }
    noteDetail.classList.remove('hidden');
    detailBody.scrollTop = 0;
    renderDetail(note);
}
function closeDetail() { HAPTIC.tap(); noteDetail.classList.add('hidden'); STATE.activeNote = null; }
$('btn-detail-back').addEventListener('click', closeDetail);

// ─── The note, and its drawers ───────────────────────────────
// The note itself stays open. Everything derived from it is shut in a drawer
// until you ask, and each drawer shows its own kind of thing its own way —
// a spine rack for clusters, a dot field for tags, a route map for links.

const ND_MARKS = {
    summary:     '<span class="nd-mk nd-mk-quote">&ldquo;</span>',
    persona:     '<span class="nd-mk nd-mk-lens"></span>',
    cluster:     '<span class="nd-mk nd-mk-spines"><i></i><i></i><i></i></span>',
    tags:        '<span class="nd-mk nd-mk-dots"><i></i><i></i><i></i></span>',
    details:     '<span class="nd-mk nd-mk-rows"><i></i><i></i><i></i></span>',
    workbench:   '<span class="nd-mk nd-mk-pin"></span>',
    themes:      '<span class="nd-mk nd-mk-num">01</span>',
    references:  '<span class="nd-mk nd-mk-nodes"><svg viewBox="0 0 20 20" aria-hidden="true"><line x1="10" y1="10" x2="4" y2="4"/><line x1="10" y1="10" x2="16" y2="6"/><line x1="10" y1="10" x2="7" y2="16"/><circle cx="10" cy="10" r="2.4"/><circle cx="4" cy="4" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="7" cy="16" r="1.5"/></svg></span>',
    books:       '<span class="nd-mk nd-mk-shelf"><i></i><i></i><i></i></span>',
    follow_ups:  '<span class="nd-mk nd-mk-q">?</span>',
    connections: '<span class="nd-mk nd-mk-route"><svg viewBox="0 0 20 20" aria-hidden="true"><line x1="10" y1="2" x2="10" y2="18"/><circle cx="10" cy="5" r="2"/><circle cx="10" cy="15" r="2"/></svg></span>',
    chats:       '<span class="nd-mk nd-mk-bubbles"><i></i><i></i></span>',
};

/** One shut drawer. `body` may be empty for the ones that fill in on opening. */
function ndDrawer(key, name, tally, body, opts = {}) {
    const open = STATE.openDrawers.has(key);
    return `
    <section class="nd-drawer${open ? ' open' : ''}${opts.lazy ? ' nd-lazy' : ''}" data-key="${key}">
        <button class="nd-tab" aria-expanded="${open}" aria-controls="nd-body-${key}">
            ${ND_MARKS[key] || ''}
            <span class="nd-tab-name">${esc(name)}</span>
            <span class="nd-tab-tally">${tally || ''}</span>
            <svg class="nd-tab-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="nd-body" id="nd-body-${key}">${body}</div>
    </section>`;
}

function renderDetail(note) {
    const SE = { positive: '☀', negative: '☂', neutral: '◦', mixed: '◐' };
    const ins = note.insights || {};

    // ── The note itself, and what it is filed under ──
    const conceptsHTML = (note.concepts || []).length
        ? `<div class="nd-filed">
             <span class="nd-filed-label">Filed under</span>
             ${note.concepts.map(c => `<button class="detail-concept" data-concept="${esc(c)}">${esc(c)}</button>`).join('')}
           </div>`
        : '';

    const images = note.images || [];
    let imagesHTML = '';
    if (images.length || STATE.profile !== 'combined') {
        imagesHTML = `<div class="nd-images">
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
        </div>`;
    }

    // ── 1 · AI Summary — set as an epigraph ──
    const persona = note.persona && api.PERSONAS[note.persona] ? api.PERSONAS[note.persona] : null;
    const summaryBody = note.summary ? `
        <figure class="nd-epigraph">
            <span class="nd-epigraph-mark">&ldquo;</span>
            <div class="nd-epigraph-text">${renderMarkdown(note.summary)}</div>
            ${persona ? `<figcaption class="nd-epigraph-by">read by ${persona.emoji} ${esc(persona.name)}</figcaption>` : ''}
        </figure>` : '<p class="nd-empty">Not analysed yet.</p>';

    // ── 2 · Persona lenses ──
    const suggestion = api.suggestPersona(note);
    const readings = note.persona_readings || {};
    const readKeys = Object.keys(readings);
    const suggested = api.PERSONAS[suggestion.key];
    const otherKeys = Object.keys(api.PERSONAS).filter(k => k !== suggestion.key);
    const personaBody = `
        <button class="persona-suggested" data-persona="${esc(suggestion.key)}">
            <span class="persona-pill-emoji">${suggested.emoji}</span>
            <span class="persona-suggested-text">
                <strong>${esc(suggested.name)}</strong>
                <span>${esc(suggestion.why)}</span>
            </span>
            <span class="persona-suggested-go">${readings[suggestion.key] ? 'Again' : 'Read'}</span>
        </button>
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
        </div>` : ''}`;

    // ── 3 · Cluster — a rack of spines, one pulled out ──
    const current = STATE.clusters.find(c => c.id === note.cluster_id);
    const clusterBody = STATE.profile === 'combined'
        ? '<p class="nd-empty">Filing works one profile at a time.</p>'
        : `<div class="nd-rack">
            <button class="nd-loose${!note.cluster_id ? ' on' : ''}" data-cluster="">
                <span class="nd-loose-sheet"></span>
                <span class="nd-loose-name">Loose</span>
            </button>
            ${STATE.clusters.map(c => {
                const ink = clusterInk(c.color);
                return `<button class="nd-spine${c.id === note.cluster_id ? ' on' : ''}" data-cluster="${esc(c.id)}"
                            style="--cl:${esc(ink.hex)}" title="${esc(c.name)}">
                    <span class="nd-spine-name">${esc(c.name)}</span>
                </button>`;
            }).join('')}
            ${STATE.clusters.length ? '' : '<p class="nd-empty">No volumes yet — make one from the Notes shelf.</p>'}
        </div>`;

    // ── 4 · Tags — a field of dots weighted by how often you use them ──
    const tagList = note.tags || [];
    const archive = STATE.notes || [];
    const weightOf = t => archive.reduce((n, x) => n + ((x.tags || []).includes(t) ? 1 : 0), 0) || 1;
    const heaviest = Math.max(1, ...tagList.map(weightOf));
    const tagsBody = `
        <div class="nd-tagfield" id="detail-tags-container">
            ${tagList.map(t => {
                const w = weightOf(t);
                const d = 12 + Math.round((w / heaviest) * 20);
                return `<span class="nd-tagdot tag-editable" data-tag="${esc(t)}" style="--d:${d}px">
                    <span class="nd-tagdot-dot"></span>
                    <span class="nd-tagdot-name">${esc(t)}</span>
                    <span class="nd-tagdot-n">${w}</span>
                    <button class="tag-remove" data-tag="${esc(t)}" aria-label="Remove tag">×</button>
                </span>`;
            }).join('')}
            <button class="nd-tagadd" id="btn-add-tag" aria-label="Add tag">+</button>
        </div>
        ${tagList.length ? '<p class="nd-foot">Dot size is how often that tag turns up across your notes.</p>' : '<p class="nd-empty">No tags yet.</p>'}`;

    // ── 5 · Details — a ledger, with the timestamp left off ──
    const ledger = [
        ['Category', note.category ? String(note.category) : null],
        ['Sentiment', note.sentiment ? `${SE[note.sentiment] || ''} ${note.sentiment}` : null],
        ['Profile', note.profile || null],
    ].filter(r => r[1]);
    const detailsBody = ledger.length
        ? `<dl class="nd-ledger">${ledger.map(([k, v]) => `
            <div class="nd-ledger-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
        : '<p class="nd-empty">Nothing recorded yet.</p>';

    // ── 6 · Workbench — a ruled pad you can actually write on ──
    const wb = note.workbench || { items: [], notes: '' };
    const workbenchBody = `
        <div class="nd-pad">
            <div class="nd-pad-label">Collected</div>
            <div id="wb-items-container"></div>
            <div class="wb-add-custom">
                <input type="text" id="wb-custom-input" placeholder="Add a thought of your own…" class="wb-custom-input" />
                <button id="btn-wb-add-custom" class="btn btn-ghost btn-sm">Add</button>
            </div>
            <div class="nd-pad-label">Working it out</div>
            <textarea id="wb-synthesis-textarea" class="nd-pad-sheet" placeholder="Draft, outline, argue with yourself. Saves as you go.">${esc(wb.notes || '')}</textarea>
            <div class="wb-autosave-indicator" id="wb-autosave-indicator">Saved</div>
        </div>`;

    // ── 7–10 · The four readings, each drawn its own way ──
    const themesBody     = ins.themes?.length     ? insightBody('themes', ins.themes, note.id)         : null;
    const referencesBody = ins.references?.length ? insightBody('references', ins.references, note.id) : null;
    const booksBody      = ins.books?.length      ? insightBody('books', ins.books, note.id)           : null;
    const followBody     = ins.follow_ups?.length ? insightBody('follow_ups', ins.follow_ups, note.id) : null;

    // Twelve drawers in one flat run is twelve things shouting at once. They
    // answer three different questions, so they're grouped by question and each
    // group gets its own card — you scan three headings, not twelve rows.
    const groups = [
        {
            name: 'What it means',
            rows: [
                ndDrawer('summary', 'AI Summary', persona ? `${persona.emoji}` : (note.summary ? '' : '—'), summaryBody),
                ndDrawer('persona', 'Read it another way', readKeys.length ? `${readKeys.length}` : '', personaBody),
                themesBody ? ndDrawer('themes', 'Themes', String(ins.themes.length), themesBody) : '',
                followBody ? ndDrawer('follow_ups', 'Questions to Explore', String(ins.follow_ups.length), followBody) : '',
            ],
        },
        {
            name: 'Where it sits',
            rows: [
                ndDrawer('cluster', 'Cluster', current ? `${current.emoji || '📁'} ${esc(current.name)}` : 'Loose', clusterBody),
                ndDrawer('tags', 'Tags', tagList.length ? String(tagList.length) : '—', tagsBody),
                ndDrawer('details', 'Details', ledger.length ? String(ledger.length) : '—', detailsBody),
            ],
        },
        {
            name: 'Where it leads',
            rows: [
                referencesBody ? ndDrawer('references', 'Related Concepts', String(ins.references.length), referencesBody) : '',
                booksBody ? ndDrawer('books', 'Recommended Reading', String(ins.books.length), booksBody) : '',
                ndDrawer('connections', 'Connections', '', '<div id="detail-connections"></div>', { lazy: true }),
                ndDrawer('chats', 'Conversations', '', '<div id="chats-list" class="chats-list"></div>', { lazy: true }),
                ndDrawer('workbench', 'Workbench', (wb.items || []).length ? String((wb.items || []).length) : '', workbenchBody),
            ],
        },
    ];

    const drawers = groups.map(g => {
        const rows = g.rows.filter(Boolean).join('');
        if (!rows) return '';
        return `<section class="nd-group">
            <h2 class="nd-group-name">${esc(g.name)}</h2>
            <div class="nd-group-card">${rows}</div>
        </section>`;
    }).join('');

    detailBody.innerHTML = `
        <div class="nd-note">
            <div class="detail-raw-text" id="detail-raw-text">${renderMarkdown(api.stripDerived(note.raw_text))}</div>
            ${conceptsHTML}
        </div>
        ${imagesHTML}
        <div class="nd-drawers">${drawers}</div>`;

    bindDrawers(note);
    renderWorkbenchUI(note);
    bindNoteConcepts(detailBody);

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
    detailBody.querySelectorAll('.nd-explore[data-section]').forEach(btn => {
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

    // ── The shelf and its notes are two halves of one thing ──
    detailBody.querySelectorAll('.nd-book').forEach(spine => {
        spine.addEventListener('click', () => {
            HAPTIC.tap();
            const k = spine.dataset.book;
            const drawer = spine.closest('.nd-drawer');
            const on = !spine.classList.contains('on');
            drawer.querySelectorAll('.nd-book').forEach(b => b.classList.remove('on'));
            drawer.querySelectorAll('.nd-booknote').forEach(b => b.classList.remove('lit'));
            if (!on) return;
            spine.classList.add('on');
            const note = drawer.querySelector(`.nd-booknote[data-book="${k}"]`);
            if (note) { note.classList.add('lit'); note.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        });
    });

    // ── Filing: pick a spine off the rack ──
    detailBody.querySelectorAll('.nd-spine, .nd-loose').forEach(el => {
        el.addEventListener('click', async () => {
            if (!STATE.activeNote) return;
            const clusterId = el.dataset.cluster || null;
            if ((STATE.activeNote.cluster_id || null) === clusterId) return;
            HAPTIC.tap();
            detailBody.querySelectorAll('.nd-spine, .nd-loose').forEach(o => o.classList.remove('on'));
            el.classList.add('on');
            await api.assignNoteToClusterAPI(STATE.activeNote.id, clusterId);
            STATE.activeNote.cluster_id = clusterId || undefined;
            const drawer = el.closest('.nd-drawer');
            const tally = drawer?.querySelector('.nd-tab-tally');
            const c = STATE.clusters.find(x => x.id === clusterId);
            if (tally) tally.textContent = c ? `${c.emoji || '📁'} ${c.name}` : 'Loose';
            FX.chime();
            if (notesPanel.classList.contains('open')) loadNotes();
        });
    });
}


/** Drawers open on tap; the two that cost a fetch fill in the first time. */
function bindDrawers(note) {
    detailBody.querySelectorAll('.nd-drawer').forEach(drawer => {
        const tab = drawer.querySelector('.nd-tab');
        const key = drawer.dataset.key;
        tab.addEventListener('click', () => {
            const open = drawer.classList.toggle('open');
            tab.setAttribute('aria-expanded', String(open));
            open ? STATE.openDrawers.add(key) : STATE.openDrawers.delete(key);
            HAPTIC.tap();
            if (open && drawer.classList.contains('nd-lazy')) {
                drawer.classList.remove('nd-lazy');
                if (key === 'connections') renderNoteConnections(note);
                if (key === 'chats') loadChatsForNote(note.id);
            }
            // A drawer opened near the foot of the page would otherwise unfold
            // off-screen. Bring its header up so its contents land in view.
            if (open) requestAnimationFrame(() => {
                const top = drawer.offsetTop - 12;
                if (top > detailBody.scrollTop + detailBody.clientHeight - 140 || top < detailBody.scrollTop) {
                    detailBody.scrollTo({ top, behavior: 'smooth' });
                }
            });
        });
        // A drawer restored open still owes its contents.
        if (drawer.classList.contains('open') && drawer.classList.contains('nd-lazy')) {
            drawer.classList.remove('nd-lazy');
            if (key === 'connections') renderNoteConnections(note);
            if (key === 'chats') loadChatsForNote(note.id);
        }
    });
}

function ndTally(key, text) {
    const el = detailBody.querySelector(`.nd-drawer[data-key="${key}"] .nd-tab-tally`);
    if (el) el.textContent = text;
}

/** Concept chips walk you to the concept's own page in Threads. */
function bindNoteConcepts(root) {
    root.querySelectorAll('.detail-concept').forEach(el => {
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

function isCollected(title, type) {
    const items = STATE.activeNote?.workbench?.items;
    return Array.isArray(items) && items.some(i => i.title === title && i.type === type);
}

function collectBtn(type, title, desc) {
    const done = isCollected(title, type);
    return `<button class="nd-collect btn-collect" data-type="${type}" data-title="${esc(title)}" data-desc="${esc(desc || '')}" ${done ? 'disabled' : ''}>
        ${done ? '✓ collected' : '+ collect'}
    </button>`;
}

function exploreMore(sectionKey, noteId, label) {
    return `<div class="nd-more">
        <button class="nd-explore" data-section="${sectionKey}" data-note-id="${noteId}" data-label="${label}">${label}</button>
        <div class="explore-results" id="explore-${sectionKey}"></div>
    </div>`;
}

/**
 * Four kinds of reading, four ways of drawing them: numbered plates, a
 * constellation, a shelf of spines, a set of question cards.
 */
function insightBody(sectionKey, items, noteId) {
    if (sectionKey === 'themes') {
        return `<ol class="nd-plates">
            ${items.map((i, n) => {
                const title = typeof i === 'string' ? i : (i.theme || i.name || '');
                const desc = typeof i === 'string' ? '' : (i.explanation || i.description || '');
                return `<li class="nd-plate">
                    <span class="nd-plate-n">${String(n + 1).padStart(2, '0')}</span>
                    <div class="nd-plate-body">
                        <h4 class="nd-plate-title">${esc(title)}</h4>
                        ${desc ? `<p class="nd-plate-desc">${esc(desc)}</p>` : ''}
                        ${i.connections ? `<p class="nd-plate-link">↳ ${esc(i.connections)}</p>` : ''}
                        ${collectBtn('theme', title, desc)}
                    </div>
                </li>`;
            }).join('')}
        </ol>${exploreMore(sectionKey, noteId, 'Find more themes')}`;
    }

    if (sectionKey === 'references') {
        // The note sits in the middle; what it touches hangs off it. Nodes are
        // offset by half a slot so two of them read as a pair, not a stack.
        const names = items.map(i => typeof i === 'string' ? i : (i.concept || i.name || ''));
        const count = Math.max(names.length, 1);
        const R = 78, cx = 0, cy = 0;
        const nodes = names.map((n, k) => {
            const a = (-Math.PI / 2) + ((k + 0.5) / count) * Math.PI * 2;
            return { n, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * 0.7 };
        });
        // Labels sit further out along the same spoke, so they never collide.
        nodes.forEach(p => {
            p.lx = p.x * 1.16;
            p.ly = p.y * 1.16 + (Math.abs(p.x) > 15 ? 3.5 : (p.y < 0 ? -9 : 15));
            p.anchor = p.x > 15 ? 'start' : p.x < -15 ? 'end' : 'middle';
        });
        // Fit the box to the drawing so a two-node map isn't mostly empty space.
        const halfW = Math.max(...nodes.map(p => Math.abs(p.lx)), 40) + 84;
        const halfH = Math.max(...nodes.map(p => Math.abs(p.ly)), 24) + 18;
        const view = `${(-halfW).toFixed(0)} ${(-halfH).toFixed(0)} ${(halfW * 2).toFixed(0)} ${(halfH * 2).toFixed(0)}`;
        return `
        <div class="nd-constellation">
            <svg viewBox="${view}" role="img" aria-label="Concepts around this note">
                ${nodes.map(p => `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"/>`).join('')}
                ${nodes.map(p => `<circle class="nd-node" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"/>`).join('')}
                <circle class="nd-hub" cx="${cx}" cy="${cy}" r="8"/>
                ${nodes.map(p => `<text x="${p.lx.toFixed(1)}" y="${p.ly.toFixed(1)}" text-anchor="${p.anchor}">${esc(p.n.length > 20 ? p.n.slice(0, 19) + '…' : p.n)}</text>`).join('')}
            </svg>
        </div>
        <ul class="nd-conceptlist">
            ${items.map(i => {
                const title = typeof i === 'string' ? i : (i.concept || i.name || '');
                const desc = typeof i === 'string' ? '' : (i.description || '');
                return `<li>
                    <span class="nd-conceptlist-name">${esc(title)}</span>
                    ${desc ? `<span class="nd-conceptlist-desc">${esc(desc)}</span>` : ''}
                    ${i.relevance ? `<span class="nd-conceptlist-rel">↳ ${esc(i.relevance)}</span>` : ''}
                    ${collectBtn('reference', title, desc)}
                </li>`;
            }).join('')}
        </ul>${exploreMore(sectionKey, noteId, 'Find more concepts')}`;
    }

    if (sectionKey === 'books') {
        return `
        <div class="nd-shelf">
            ${items.map((b, k) => {
                const title = typeof b === 'string' ? b : (b.title || '');
                return `<button class="nd-book" data-book="${k}" style="--h:${118 + (k % 3) * 14}px; --cl:var(--cloth-${['ochre','brick','forest','navy','aubergine','olive'][k % 6]})">
                    <span class="nd-book-title">${esc(title)}</span>
                </button>`;
            }).join('')}
            <span class="nd-shelf-board"></span>
        </div>
        <ul class="nd-booknotes">
            ${items.map((b, k) => {
                const title = typeof b === 'string' ? b : (b.title || '');
                const author = typeof b === 'string' ? '' : (b.author || 'Unknown');
                const reason = typeof b === 'string' ? '' : (b.reason || '');
                return `<li class="nd-booknote" data-book="${k}">
                    <span class="nd-booknote-title">${esc(title)}</span>
                    ${author ? `<span class="nd-booknote-by">${esc(author)}</span>` : ''}
                    ${reason ? `<span class="nd-booknote-why">${esc(reason)}</span>` : ''}
                    ${collectBtn('book', title, `by ${author} — ${reason}`)}
                </li>`;
            }).join('')}
        </ul>${exploreMore(sectionKey, noteId, 'Find more reading')}`;
    }

    // follow_ups — each question gets its own mark and its own card
    return `<ul class="nd-questions">
        ${items.map(q => {
            const text = typeof q === 'string' ? q : (q.question || '');
            const ctx = typeof q === 'string' ? '' : (q.context || '');
            return `<li class="nd-question">
                <span class="nd-question-mark">?</span>
                <div class="nd-question-body">
                    <p class="nd-question-text">${esc(text)}</p>
                    ${ctx ? `<p class="nd-question-ctx">${esc(ctx)}</p>` : ''}
                    ${collectBtn('question', text, '')}
                </div>
            </li>`;
        }).join('')}
    </ul>${exploreMore('follow_ups', noteId, 'Ask for more questions')}`;
}

async function exploreSection(section, noteId, btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="explore-spinner"></span> Looking…';

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
        btn.textContent = btn.dataset.label || 'Find more';
    } catch (e) {
        console.error("Explore section failed:", e);
        btn.disabled = false;
        btn.textContent = 'Try again';
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
        const chats = await api.getChatsAPI(profile, noteId);
        ndTally('chats', chats.length ? String(chats.length) : '—');
        const drawer = detailBody.querySelector('.nd-drawer[data-key="chats"]');
        drawer?.classList.remove('nd-lazy');

        if (!chats.length) {
            container.innerHTML = `<p class="nd-empty">No conversations yet — tap Chat in the header to start one.</p>`;
            return;
        }

        // Each thread is drawn as the shape of itself: one bubble per exchange.
        container.innerHTML = chats.map(c => {
            const time = new Date(c.updated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const msgs = Array.isArray(c.messages) ? c.messages.length : 0;
            const drawn = Math.max(1, Math.min(msgs || 1, 9));
            const bubbles = Array.from({ length: drawn }, (_, k) =>
                `<i class="nd-bub${(Array.isArray(c.messages) && c.messages[k]?.role === 'assistant') || (!msgs && k % 2) ? ' nd-bub-them' : ''}"></i>`).join('');
            return `<button class="nd-chat" data-chat-id="${esc(c.id)}">
                <span class="nd-chat-shape">${bubbles}</span>
                <span class="nd-chat-body">
                    <span class="nd-chat-title">${esc(c.title || 'Untitled')}</span>
                    <span class="nd-chat-meta">${msgs ? `${msgs} message${msgs === 1 ? '' : 's'} · ` : ''}${time}</span>
                </span>
            </button>`;
        }).join('');

        container.querySelectorAll('.nd-chat').forEach(card => {
            card.addEventListener('click', () => resumeChat(card.dataset.chatId));
        });
    } catch { container.innerHTML = '<p class="nd-empty">Could not load conversations.</p>'; }
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
            if (upd && (upd.status === 'processed' || upd.status === 'error')) { clearInterval(poll); STATE.activeNote = upd; STATE.notes = notes; renderDetail(upd); btn.disabled = false; btn.innerHTML = originalContent; }
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
            // Poll for re-processing
            const poll = setInterval(async () => {
                if (!STATE.activeNote) { clearInterval(poll); return; }
                const notes = await api.getNotesAPI(STATE.profile);
                if (!STATE.activeNote) { clearInterval(poll); return; }
                const upd = notes.find(n => n.id === STATE.activeNote.id);
                if (upd && upd.status === 'processed') {
                    clearInterval(poll); STATE.activeNote = upd; STATE.notes = notes;
                    renderDetail(upd);
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
async function openDashboard() {
    FX.tap();
    dashboardView.classList.remove('hidden');
    renderDashboard();
    // The notes panel leaves STATE.notes filtered by whatever you last searched.
    // Activity always counts the whole archive, so it fetches its own copy.
    try {
        STATE.activityNotes = await api.getNotesAPI(STATE.profile || 'prineeth');
        if (!dashboardView.classList.contains('hidden')) renderDashboard();
    } catch (e) {
        console.warn('Activity load failed:', e.message);
    }
}

function closeDashboard() {
    HAPTIC.tap();
    dashboardView.classList.add('hidden');
}

// ─── Activity ────────────────────────────────────────────────
// One figure you can read across the room, then the mix of what that figure
// was made of, printed as ink bars. The dot rhythm keeps its place at the end.

const CAPTURE_KINDS = [
    { key: 'brainstorm', label: 'Brainstorm', ink: 'var(--ink-brainstorm)' },
    { key: 'idea',       label: 'Idea',       ink: 'var(--ink-idea)' },
    { key: 'reference',  label: 'Reference',  ink: 'var(--ink-reference)' },
    { key: 'journal',    label: 'Journal',    ink: 'var(--ink-journal)' },
    { key: 'task',       label: 'Task',       ink: 'var(--ink-task)' },
    { key: 'other',      label: 'Unsorted',   ink: 'var(--ink-other)' },
];

function notesInWindow(notes, days, endsAt = new Date()) {
    if (!days) return notes.slice();
    const from = new Date(endsAt.getTime() - days * 86400000);
    return notes.filter(n => n.created_at && new Date(n.created_at) > from && new Date(n.created_at) <= endsAt);
}

function renderDashboard() {
    const notes = STATE.activityNotes || STATE.notes || [];
    const days = STATE.activityPeriod ?? 28;

    const period = notesInWindow(notes, days);
    const windowLabel = days ? `in the last ${days} days` : 'since you started';

    // ── The figure ──
    const headline = $('act-headline');
    if (headline) {
        let deltaHTML = '';
        if (days) {
            const prevEnd = new Date(Date.now() - days * 86400000);
            const prev = notesInWindow(notes, days, prevEnd).length;
            const diff = period.length - prev;
            const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
            const mark = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
            const word = diff === 0
                ? `the same as the ${days} days before`
                : `${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than the ${days} days before`;
            deltaHTML = `<div class="act-delta act-delta-${dir}"><span class="act-delta-mark">${mark}</span>${word}</div>`;
        } else {
            const first = notes.reduce((a, n) => (!a || new Date(n.created_at) < a) ? new Date(n.created_at) : a, null);
            if (first) deltaHTML = `<div class="act-delta act-delta-flat"><span class="act-delta-mark">—</span>first note ${first.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</div>`;
        }

        headline.innerHTML = `
            <div class="act-figure">
                <div class="act-figure-num">${period.length}</div>
                <div class="act-figure-cap">
                    <span class="act-figure-unit">${period.length === 1 ? 'note' : 'notes'}<br/>captured</span>
                    <span class="act-figure-window">${windowLabel}</span>
                </div>
            </div>
            ${deltaHTML}`;
    }

    // ── The mix ──
    const mix = $('act-mix');
    if (mix) {
        const counts = {};
        period.forEach(n => {
            // Older notes can carry a non-string category (an empty array, say).
            const raw = String(n.category ?? '').trim().toLowerCase();
            const key = CAPTURE_KINDS.some(k => k.key === raw) ? raw : 'other';
            counts[key] = (counts[key] || 0) + 1;
        });
        const rows = CAPTURE_KINDS
            .map(k => ({ ...k, n: counts[k.key] || 0 }))
            .filter(k => k.n > 0)
            .sort((a, b) => b.n - a.n);
        const total = rows.reduce((s, r) => s + r.n, 0);

        if (!total) {
            mix.innerHTML = `<div class="act-label">What you captured</div>
                <p class="act-empty">Nothing captured in this window yet.</p>`;
        } else {
            const pct = n => Math.round((n / total) * 100);
            mix.innerHTML = `
                <div class="act-label">What you captured</div>
                <div class="act-band" role="img" aria-label="Capture mix">
                    ${rows.map(r => `<span class="act-band-seg" style="--ink:${r.ink};--w:${(r.n / total) * 100}%" title="${r.label}: ${r.n}"></span>`).join('')}
                </div>
                <ul class="act-rows">
                    ${rows.map((r, i) => `
                    <li class="act-row" style="--ink:${r.ink};--w:${(r.n / total) * 100}%;--i:${i}">
                        <span class="act-row-name">${r.label}</span>
                        <span class="act-row-track"><span class="act-row-fill"></span></span>
                        <span class="act-row-fig"><b>${r.n}</b><i>${pct(r.n)}%</i></span>
                    </li>`).join('')}
                </ul>`;
            // Let the bars draw themselves in after paint.
            requestAnimationFrame(() => mix.querySelectorAll('.act-row').forEach(r => r.classList.add('drawn')));
        }
    }

    // ── The rhythm (always the last 28 days, whatever the window above says) ──
    const rhythm = $('act-rhythm');
    if (rhythm) {
        const byDate = {};
        notes.forEach(n => {
            if (!n.created_at) return;
            const d = new Date(n.created_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            byDate[key] = (byDate[key] || 0) + 1;
        });

        const today = new Date();
        const start = new Date();
        start.setDate(today.getDate() - today.getDay() - 21);

        let streak = 0, best = 0, active = 0;
        const cells = [];
        for (let i = 0; i < 28; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const count = byDate[key] || 0;
            if (count) { streak++; active++; best = Math.max(best, streak); } else { streak = 0; }
            const step = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3;
            cells.push(`<div class="act-cell" title="${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}: ${count || 'no'} ${count === 1 ? 'capture' : 'captures'}">
                <span class="act-dot act-dot-${step}"></span>
            </div>`);
        }

        rhythm.innerHTML = `
            <div class="act-label">Rhythm <span class="act-label-note">last 28 days</span></div>
            <div class="act-cal">
                <div class="act-cal-head"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
                <div class="act-cal-grid">${cells.join('')}</div>
            </div>
            <div class="act-rhythm-figs">
                <span><b>${active}</b> days with a note</span>
                <span><b>${best}</b> day best run</span>
            </div>`;
    }
}

function setupActivityPeriod() {
    const bar = $('act-period');
    if (!bar) return;
    bar.querySelectorAll('.act-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            HAPTIC.tap();
            STATE.activityPeriod = parseInt(btn.dataset.days, 10);
            bar.querySelectorAll('.act-period-btn').forEach(b => {
                const on = b === btn;
                b.classList.toggle('active', on);
                b.setAttribute('aria-selected', String(on));
            });
            renderDashboard();
        });
    });
}

// Bind button clicks
// Activity opens from the tab bar (see setupTabBar)
$('btn-close-dashboard').addEventListener('click', () => { closeDashboard(); syncTabToCapture(); });
setupActivityPeriod();

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

function openDiscover() {
    FX.tap();
    discoverView.classList.remove('hidden');
    STATE.discoverOpen = false;
    $('discover-card-view')?.classList.add('hidden');
    loadDiscoverCards();
}
function closeDiscover() { HAPTIC.tap(); discoverView.classList.add('hidden'); }

// Discover opens from the tab bar (see setupTabBar)
$('btn-close-discover').addEventListener('click', () => { closeDiscover(); syncTabToCapture(); });
$('btn-gen-cards').addEventListener('click', generateCards);

$('btn-gen-cards-empty').addEventListener('click', generateCards);
$('btn-close-card').addEventListener('click', () => { HAPTIC.tap(); closeDiscoverCard(); });

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

const DRAW_ICON = `
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
    </svg>`;

let drawing = false;

async function generateCards() {
    if (drawing) return;
    const profile = STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
    if (!profile) return;
    const filter = STATE.discoverFilter;
    const specificType = (filter !== 'all' && filter !== 'stored') ? filter : null;

    const btnHeader = $('btn-gen-cards');
    const btnEmpty = $('btn-gen-cards-empty');
    const btnDial = $('btn-dial-draw');

    drawing = true;
    const spinner = `<span class="explore-spinner" style="width: 14px; height: 14px; border-color: var(--text-muted); border-top-color: currentColor; vertical-align: middle;"></span>`;
    if (btnHeader) { btnHeader.disabled = true; btnHeader.innerHTML = spinner; }
    if (btnEmpty) { btnEmpty.disabled = true; btnEmpty.textContent = 'Drawing a round…'; }
    if (btnDial) { btnDial.disabled = true; btnDial.classList.add('drawing'); }
    showToast(specificType ? `Drawing ${CARD_KINDS[specificType]?.label.toLowerCase() || specificType} cards…` : 'Drawing a fresh round…');

    try {
        // The cards land in Firestore as they are written, so there is nothing to
        // wait out afterwards — read the well again the moment the draw returns.
        const n = await api.generateDiscoverAPI(profile, specificType);
        await loadDiscoverCards();
        updateDiscoverBadge();
        if (n > 0) {
            FX.chime();
            showToast(`${n} new card${n === 1 ? '' : 's'} waiting.`);
        } else {
            showToast('Nothing new this time — try again, or capture a few more notes.');
        }
    } catch (e) {
        console.error('Card generation failed:', e);
        showToast(friendlyError(e));
    } finally {
        drawing = false;
        if (btnHeader) { btnHeader.disabled = false; btnHeader.innerHTML = DRAW_ICON; }
        if (btnEmpty) { btnEmpty.disabled = false; btnEmpty.textContent = 'Generate now'; }
        const dial = $('btn-dial-draw');
        if (dial) { dial.disabled = false; dial.classList.remove('drawing'); }
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

// ─── Discover ────────────────────────────────────────────────
// Three parts that answer three questions. The dots say what the feed is
// drawing from. The queue says what's waiting. The dial says how far in you
// are and hands you the next one. Deciding still happens on a single card.

const CARD_KINDS = {
    quote:          { label: 'Quote',   initial: 'Q', ink: 'var(--cloth-ochre)',     dir: 'across' },
    question:       { label: 'Ask',     initial: 'A', ink: 'var(--cloth-brick)',     dir: 'inward' },
    recommendation: { label: 'Read',    initial: 'R', ink: 'var(--cloth-forest)',    dir: 'outward' },
    observation:    { label: 'Notice',  initial: 'N', ink: 'var(--cloth-aubergine)', dir: 'inward' },
    excerpt:        { label: 'Excerpt', initial: 'E', ink: 'var(--cloth-navy)',      dir: 'across' },
};
const DIR_MARK = { outward: '↗', inward: '↘', across: '→' };
const DIR_WHY = {
    outward: 'points you outside your notes',
    inward:  'points back into your notes',
    across:  'carries something over as it is',
};

function discoverSeeds() {
    const pool = STATE.discoverCards || [];
    const counts = {};
    pool.forEach(c => { counts[c.card_type] = (counts[c.card_type] || 0) + 1; });

    // 'All' and 'Kept' aren't kinds, so they print as paper rather than ink.
    const seeds = [{ key: 'all', label: 'All', initial: '✳', ink: 'var(--text-primary)', n: pool.length, plain: true }];
    Object.entries(CARD_KINDS).forEach(([key, k]) => {
        seeds.push({ key, label: k.label, initial: k.initial, ink: k.ink, n: counts[key] || 0 });
    });
    seeds.push({
        key: 'stored', label: 'Kept', initial: '❏', ink: 'var(--text-secondary)',
        n: (STATE.storedDiscoverCards || []).length, plain: true,
    });
    return seeds;
}

function renderDiscoverSeeds() {
    const host = $('dsc-seeds');
    if (!host) return;
    host.innerHTML = discoverSeeds().map(s => `
        <button class="dsc-seed${STATE.discoverFilter === s.key ? ' active' : ''}${s.plain ? ' dsc-seed-plain' : ''}"
                data-filter="${esc(s.key)}" style="--ink:${s.ink}" aria-pressed="${STATE.discoverFilter === s.key}">
            <span class="dsc-seed-dot">${s.initial}</span>
            <span class="dsc-seed-label">${esc(s.label)}</span>
            ${s.n ? `<span class="dsc-seed-n">${s.n}</span>` : ''}
        </button>`).join('');

    host.querySelectorAll('.dsc-seed').forEach(btn => {
        btn.addEventListener('click', async () => {
            HAPTIC.tap();
            STATE.discoverFilter = btn.dataset.filter;
            STATE.discoverFocus = 0;
            if (STATE.discoverFilter === 'stored') await loadDiscoverCards();
            else renderDiscoverStack();
        });
    });
}

/** One row of the queue: badge, direction, the card's own opening, its place. */
function queueRowHTML(card, i, stored) {
    const kind = CARD_KINDS[card.card_type] || { label: card.card_type || 'Card', initial: '·', ink: 'var(--text-muted)', dir: 'across' };
    const text = (card.content || '').replace(/\s+/g, ' ').trim();
    const lead = text.length > 96 ? text.slice(0, 96).trimEnd() + '…' : text;
    return `
    <button class="dsc-row${!stored && i === STATE.discoverFocus ? ' focus' : ''}" data-idx="${i}" data-id="${esc(card.id)}"
            style="--ink:${kind.ink}">
        <span class="dsc-row-badge">${kind.initial}</span>
        <span class="dsc-row-body">
            <span class="dsc-row-kind">${esc(kind.label)}</span>
            <span class="dsc-row-lead">${esc(lead)}</span>
            ${card.why ? `<span class="dsc-row-why">${esc(card.why)}</span>` : ''}
            ${card.source ? `<span class="dsc-row-src">${esc(card.source)}</span>` : ''}
        </span>
        <span class="dsc-row-tail">
            <span class="dsc-row-dir" title="${DIR_WHY[kind.dir]}">${DIR_MARK[kind.dir]}</span>
            <span class="dsc-row-n">${String(i + 1).padStart(2, '0')}</span>
        </span>
        ${stored ? `<span class="dsc-row-drop" data-drop="${esc(card.id)}" role="button" aria-label="Remove from kept">×</span>` : ''}
    </button>`;
}

function renderDiscoverQueue() {
    const host = $('dsc-queue');
    const cards = getFilteredDiscoverCards();
    const stored = STATE.discoverFilter === 'stored';
    if (!host) return;

    if (!cards.length) {
        host.innerHTML = '';
        host.classList.add('hidden');
        discoverEmpty.classList.remove('hidden');
        const emptyText = discoverEmpty.querySelector('.discover-empty-text');
        if (stored) emptyText.innerHTML = 'Nothing kept yet.<br/>Keep a card and it lands here.';
        else if (STATE.discoverFilter !== 'all' && (STATE.discoverCards || []).length)
            emptyText.innerHTML = `Nothing of that kind waiting.<br/>Try another dot, or draw more.`;
        else emptyText.innerHTML = 'The well is empty.<br/>Keep capturing — or draw a fresh round.';
        return;
    }

    host.classList.remove('hidden');
    discoverEmpty.classList.add('hidden');
    if (STATE.discoverFocus >= cards.length) STATE.discoverFocus = 0;

    host.innerHTML = `
        <div class="dsc-queue-head">
            <span>${stored ? 'Kept' : 'Waiting'}</span>
            <span class="dsc-queue-legend">↗ out · ↘ in · → across</span>
        </div>
        ${cards.map((c, i) => queueRowHTML(c, i, stored)).join('')}`;

    host.querySelectorAll('.dsc-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('[data-drop]')) return;
            const i = parseInt(row.dataset.idx, 10);
            if (stored) { HAPTIC.tap(); row.classList.toggle('open'); return; }
            FX.tap();
            STATE.discoverFocus = i;
            openDiscoverCard();
        });
    });

    host.querySelectorAll('[data-drop]').forEach(x => {
        x.addEventListener('click', async (e) => {
            e.stopPropagation();
            HAPTIC.tap();
            const id = x.dataset.drop;
            const card = (STATE.storedDiscoverCards || []).find(c => c.id === id);
            const ok = await showConfirmDialog('Drop this card?', 'It leaves your kept pile and its note goes with it.', 'Drop');
            if (!ok) return;
            await api.updateDiscoverCardAPI(id, 'dismissed');
            try {
                const noteId = await api.findNoteByDiscoverCardIdAPI(id, card?.content);
                if (noteId) await api.deleteNoteAPI(noteId);
            } catch (err) { console.error('Failed to delete corresponding note:', err); }
            STATE.storedDiscoverCards = STATE.storedDiscoverCards.filter(c => c.id !== id);
            FX.swoosh();
            renderDiscoverStack();
            updateDiscoverBadge();
        });
    });

    const focused = host.querySelector('.dsc-row.focus');
    if (focused) focused.scrollIntoView({ block: 'nearest' });
}

/** The dial: ticks for what's left, a needle for where you are, and the transport. */
function renderDiscoverDial() {
    const dial = $('dsc-dial');
    if (!dial) return;
    const cards = getFilteredDiscoverCards();
    const stored = STATE.discoverFilter === 'stored';

    if (stored || !cards.length) { dial.classList.add('hidden'); dial.innerHTML = ''; return; }
    dial.classList.remove('hidden');

    const n = cards.length;
    const i = Math.min(STATE.discoverFocus, n - 1);
    // Ticks are the cards themselves; the needle sits over the one in hand.
    const shown = Math.min(n, 33);
    const ticks = Array.from({ length: shown }, (_, t) => {
        const idx = Math.round((t / Math.max(shown - 1, 1)) * (n - 1));
        return `<span class="dsc-tick${idx === i ? ' on' : ''}"></span>`;
    }).join('');
    const pos = n > 1 ? (i / (n - 1)) * 100 : 50;

    dial.innerHTML = `
        <div class="dsc-gauge">
            <div class="dsc-ticks">${ticks}</div>
            <span class="dsc-needle" style="left:${pos}%"></span>
        </div>
        <div class="dsc-readout"><b>${String(i + 1).padStart(2, '0')}</b><i>of ${String(n).padStart(2, '0')} waiting</i></div>
        <div class="dsc-transport">
            <button class="dsc-step" data-step="-1" aria-label="Previous card">‹</button>
            <button class="dsc-draw" id="btn-dial-draw" aria-label="Draw more cards">+</button>
            <button class="dsc-step" data-step="1" aria-label="Next card">›</button>
        </div>`;

    dial.querySelectorAll('.dsc-step').forEach(btn => {
        btn.addEventListener('click', () => {
            HAPTIC.tap();
            const step = parseInt(btn.dataset.step, 10);
            STATE.discoverFocus = (STATE.discoverFocus + step + n) % n;
            renderDiscoverQueue();
            renderDiscoverDial();
        });
    });
    $('btn-dial-draw')?.addEventListener('click', generateCards);
}

/** Pull the focused card out of the queue to decide on it. */
function openDiscoverCard() {
    const view = $('discover-card-view');
    if (!view) return;
    view.classList.remove('hidden');
    STATE.discoverOpen = true;
    paintCardStack();
    updateCardPlace();
}

/** Where the card in hand sits in the queue you came from. */
function updateCardPlace() {
    const el = $('dsc-card-place');
    if (!el) return;
    const n = getFilteredDiscoverCards().length;
    const i = Math.min(STATE.discoverFocus, Math.max(n - 1, 0));
    el.textContent = n ? `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}` : '';
}

function closeDiscoverCard() {
    $('discover-card-view')?.classList.add('hidden');
    STATE.discoverOpen = false;
    renderDiscoverQueue();
    renderDiscoverDial();
}

/** The three-deep card stack, starting at whatever the queue has in focus. */
function paintCardStack() {
    const cards = getFilteredDiscoverCards();
    if (!cards.length) { closeDiscoverCard(); return; }
    const start = Math.min(STATE.discoverFocus, cards.length - 1);
    discoverStack.innerHTML = '';
    cards.slice(start, start + 3).forEach(card => {
        const kind = CARD_KINDS[card.card_type] || {};
        const el = document.createElement('div');
        el.className = 'swipe-card';
        el.dataset.id = card.id;
        el.dataset.type = card.card_type;
        el.style.setProperty('--ink', kind.ink || 'var(--text-muted)');
        el.innerHTML = `
            <div class="swipe-stamp stamp-keep">KEEP</div>
            <div class="swipe-stamp stamp-pass">PASS</div>
            <div class="card-type-label"><span class="dsc-row-badge">${kind.initial || '·'}</span> ${esc(kind.label || card.card_type || '')}</div>
            <div class="card-content">${esc(card.content)}</div>
            ${card.source ? `<div class="card-source">${esc(card.source)}</div>` : ''}
            ${card.why ? `<div class="card-why">${esc(card.why)}</div>` : ''}`;
        discoverStack.appendChild(el);
    });
    setupSwipeCardDragging();
}

function renderDiscoverStack() {
    renderDiscoverSeeds();
    renderDiscoverQueue();
    renderDiscoverDial();
    if (STATE.discoverOpen) paintCardStack();
}

function removeTopCard() {
    const gone = discoverStack.firstElementChild?.dataset.id;
    STATE.discoverCards = (STATE.discoverCards || []).filter(c => c.id !== gone);
    const left = getFilteredDiscoverCards();
    if (STATE.discoverFocus >= left.length) STATE.discoverFocus = Math.max(left.length - 1, 0);
    if (!left.length) closeDiscoverCard();
    renderDiscoverStack();
    updateCardPlace();
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
                if (card.why) {
                    noteText += `\n\nWhy this came up: ${card.why}`;
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
    if (upd) { STATE.activeNote = upd; STATE.notes = notes; renderDetail(upd); }
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
    // classList.add rejects a string with spaces, so carry each class over
    for (const cls of select.className.split(/\s+/).filter(Boolean)) {
        container.classList.add(cls);
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
/** Links are drawn as a line with stations — the note you're on, then its stops. */
async function renderNoteConnections(note) {
    const slot = $('detail-connections');
    if (!slot) return;
    slot.innerHTML = '<p class="nd-empty">Looking…</p>';

    let conns = [];
    try {
        conns = await api.getConnectionsForNoteAPI(note.id);
    } catch (e) {
        console.warn('Connections failed:', e.message);
        slot.innerHTML = '<p class="nd-empty">Could not load connections.</p>';
        return;
    }

    if (!conns.length) {
        ndTally('connections', '—');
        slot.innerHTML = `<div class="nd-line nd-line-empty">
                <span class="nd-stop nd-stop-here"><b></b><span>This note</span></span>
                <span class="nd-stop nd-stop-none"><b></b><span>no stops yet</span></span>
            </div>
            <button id="btn-find-links" class="nd-explore">Look for connections</button>`;
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
    ndTally('connections', String(rows.length));

    slot.innerHTML = `
        <div class="nd-line">
            <span class="nd-stop nd-stop-here"><b></b><span>This note</span></span>
            ${rows.map(({ c, other }) => `
                <button class="nd-stop nd-stop-go" data-note-id="${esc(other.id)}">
                    <b></b>
                    <span class="nd-stop-title">${esc(api.noteTitle(other))}</span>
                    ${c.explanation ? `<span class="nd-stop-why">${esc(c.explanation)}</span>` : ''}
                    <span class="nd-stop-date">${new Date(other.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </button>`).join('')}
        </div>`;

    slot.querySelectorAll('.nd-stop-go').forEach(el => {
        el.addEventListener('click', async () => {
            FX.tap();
            const target = await api.getNoteByIdAPI(el.dataset.noteId);
            if (target) openDetail(target);
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
    memory:   { open: () => openMemory(),    close: () => closeMemory() },
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
    if (await renderLetterArrival(el)) return;
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
        el.classList.remove('hidden', 'resurface-letter');

        el.querySelector('.resurface-dismiss').addEventListener('click', (e) => {
            e.stopPropagation();
            HAPTIC.tap();
            sessionStorage.setItem('nw_resurface_dismissed', '1');
            el.classList.add('hidden');
        });
        el.onclick = () => { openDetail(pick); };
    } catch (e) {
        console.warn('Resurface failed:', e.message);
    }
}

/**
 * The one place the app knocks. A letter waiting to be read, or one ready to
 * be written, takes the capture screen's quiet slot ahead of a resurfaced note
 * — it is the more important thing to have arrived.
 */
async function renderLetterArrival(el) {
    if (sessionStorage.getItem('nw_letter_dismissed') === '1') return false;
    let st;
    try { st = await api.letterStatusAPI(memProfile()); } catch { return false; }
    LETTERS.status = st;
    if (!st.unread && !st.due) return false;

    const unread = st.unread > 0;
    el.innerHTML = `
        <button class="resurface-dismiss" aria-label="Dismiss">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="resurface-kicker">${unread ? 'A letter is waiting' : 'A letter is ready to be written'}</div>
        <div class="resurface-body">${esc(unread
            ? (st.last?.envelope || 'The notebook wrote back.')
            : `${st.freshCount} notes since the last one, ${st.daysSince} days ago.`)}</div>`;
    el.classList.remove('hidden');
    el.classList.add('resurface-letter');

    el.querySelector('.resurface-dismiss').addEventListener('click', (e) => {
        e.stopPropagation();
        HAPTIC.tap();
        sessionStorage.setItem('nw_letter_dismissed', '1');
        el.classList.add('hidden');
        el.classList.remove('resurface-letter');
    });
    el.onclick = () => {
        if (activeTab !== 'memory') setTab('memory');
        else openMemory('letters');
        setMemoryPane('letters');
        if (!unread) requestAnimationFrame(writeLetterNow);
    };
    return true;
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
//  MEMORY — one conversation that has read the whole notebook
//  Retrieval runs per message, so the context follows the talk.
//  Every answer shows the notes it actually leaned on.
// ═════════════════════════════════════════════════════════════

const memoryView = $('memory-view');
const memoryMessages = $('memory-messages');
const memoryInput = $('memory-input');

const MEM = {
    chatId: null,
    history: [],
    sending: false,
    overviewFor: null,   // which profile the header stats describe
    pane: 'letters',     // letters speak first, so they open first
};

function memProfile() {
    return STATE.profile === 'combined' ? 'prineeth' : STATE.profile;
}

function openMemory(pane = null) {
    FX.tap();
    memoryView.classList.remove('hidden');
    // A waiting letter is the reason you came, whatever you tapped
    const wants = pane || ((LETTERS.status?.unread || LETTERS.status?.due) ? 'letters' : MEM.pane);
    setMemoryPane(wants);
    if (wants === 'ask') requestAnimationFrame(() => memoryInput?.focus());
}

function closeMemory() {
    HAPTIC.tap();
    memoryView.classList.add('hidden');
    $('memory-history')?.classList.add('hidden');
    $('btn-memory-history')?.setAttribute('aria-expanded', 'false');
}

function memoryOpen() { return memoryView && !memoryView.classList.contains('hidden'); }

/** The header line: what this thing has actually read. */
async function renderMemoryOverview() {
    const host = $('memory-overview');
    const profile = memProfile();
    if (!host || !profile) return;
    if (MEM.overviewFor !== profile) host.innerHTML = `<span class="mem-stat">Reading the notebook…</span>`;

    try {
        const o = await api.getNotebookOverviewAPI(profile);
        MEM.overviewFor = profile;
        const since = o.firstNote
            ? o.firstNote.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
            : null;
        const stats = [
            `<span class="mem-stat"><b>${o.noteCount}</b> notes read</span>`,
            since ? `<span class="mem-stat">since <b>${esc(since)}</b></span>` : '',
            o.recentCount ? `<span class="mem-stat"><b>${o.recentCount}</b> in the last 30 days</span>` : '',
            o.keptCount ? `<span class="mem-stat"><b>${o.keptCount}</b> cards kept</span>` : '',
            o.conceptCount ? `<span class="mem-stat"><b>${o.conceptCount}</b> concepts</span>` : '',
            o.signalCount ? `<span class="mem-stat"><b>${o.signalCount}</b> signals about you</span>` : '',
        ].filter(Boolean);
        // Without embeddings recall is keyword-only. Say it, and offer the fix.
        if (o.noteCount > 12 && o.embeddedCount < o.noteCount * 0.5) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mem-stat mem-stat-warn';
            btn.innerHTML = `<b>${o.noteCount - o.embeddedCount}</b> notes not indexed — build the graph`;
            btn.addEventListener('click', () => { HAPTIC.tap(); openSettings('st-maintenance'); });
            host.innerHTML = stats.join('');
            host.appendChild(btn);
        } else {
            host.innerHTML = stats.join('');
        }
        const sub = $('memory-subtitle');
        if (sub && o.topConcepts.length) {
            sub.textContent = `Circling ${o.topConcepts.slice(0, 3).map(c => c.name).join(', ')}`;
        }
    } catch (e) {
        host.innerHTML = `<span class="mem-stat">${esc(friendlyError(e))}</span>`;
    }
}

/** The empty state does the work of explaining what this is good for. */
async function renderMemoryOpening() {
    if (!memoryMessages) return;
    memoryMessages.innerHTML = `
        <div class="mem-open">
            <div class="mem-open-lead">Ask the notebook, not the internet.</div>
            <div class="mem-open-sub">This one has read every note you have written — the concepts you keep returning to, the connections already drawn, and what the app has learned about how you think.</div>
            <div id="mem-seeds" style="width:100%;display:flex;flex-direction:column;gap:0.5rem"></div>
        </div>`;

    try {
        const prompts = await api.suggestMemoryPromptsAPI(memProfile());
        const seeds = $('mem-seeds');
        if (!seeds) return;
        seeds.innerHTML = prompts.map(p => `<button class="mem-seed" type="button">${esc(p)}</button>`).join('');
        seeds.querySelectorAll('.mem-seed').forEach(btn => {
            btn.addEventListener('click', () => {
                memoryInput.value = btn.textContent;
                askMemory();
            });
        });
    } catch { /* the composer still works without openers */ }
}

function memBubble(role, html) {
    const el = document.createElement('div');
    el.className = `chat-bubble ${role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}`;
    el.innerHTML = html;
    memoryMessages.appendChild(el);
    return el;
}

/** The notes an answer leaned on, folded away but one tap from the note itself. */
function memSources(sources) {
    if (!sources?.length) return;
    // Count only what actually matched. Background notes are pulled in by date,
    // and claiming the answer "drew on" them is how a beautiful-thing note ends
    // up looking like evidence about doctoral study.
    const matched = sources.filter(s => s.why === 'match');
    const context = sources.filter(s => s.why !== 'match');
    const n = matched.length;
    const label = (open) => n
        ? `Drew on ${n} note${n === 1 ? '' : 's'} ${open ? '▴' : '▾'}`
        : `Nothing matched directly ${open ? '▴' : '▾'}`;

    const chip = (s) => `<button class="mem-source${s.why !== 'match' ? ' is-context' : ''}" type="button" data-note="${esc(s.id)}">`
        + `${s.kind === 'kept' ? '<i>kept</i> ' : ''}${esc(s.title)}`
        + `<em>${esc(new Date(s.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</em></button>`;

    const wrap = document.createElement('div');
    wrap.className = 'mem-sources';
    wrap.innerHTML = `
        <button class="mem-sources-toggle" type="button" aria-expanded="false">${label(false)}</button>
        <div class="mem-source-list hidden">
            ${matched.slice(0, 20).map(chip).join('')}
            ${context.length ? `<div class="mem-source-aside">Also in view as background, not as an answer to this${context.length > 1 ? ' — pulled in by date' : ''}:</div>${context.slice(0, 12).map(chip).join('')}` : ''}
        </div>`;
    memoryMessages.appendChild(wrap);

    const toggle = wrap.querySelector('.mem-sources-toggle');
    const list = wrap.querySelector('.mem-source-list');
    toggle.addEventListener('click', () => {
        const open = !list.classList.contains('hidden');
        list.classList.toggle('hidden', open);
        toggle.setAttribute('aria-expanded', String(!open));
        toggle.textContent = label(!open);
    });

    wrap.querySelectorAll('.mem-source').forEach(chip => {
        chip.addEventListener('click', async () => {
            HAPTIC.tap();
            try {
                const note = await api.getNoteByIdAPI(chip.dataset.note);
                if (note) openDetail(note);
                else showToast('That note is no longer in the notebook.');
            } catch (e) { showToast(friendlyError(e)); }
        });
    });
}

function scrollMemoryDown() {
    memoryMessages.scrollTop = memoryMessages.scrollHeight;
}

async function askMemory() {
    if (MEM.sending) return;
    const text = (memoryInput.value || '').trim();
    if (!text) return;
    const profile = memProfile();
    if (!profile) { showToast('Pick a profile first.'); return; }

    // First question clears the opening screen
    if (!MEM.history.length) memoryMessages.innerHTML = '';

    HAPTIC.pop();
    MEM.sending = true;
    memoryInput.value = '';
    memoryInput.style.height = '38px';
    memBubble('user', esc(text));
    MEM.history.push({ role: 'user', content: text });

    const thinking = document.createElement('div');
    thinking.className = 'chat-bubble chat-bubble-thinking';
    thinking.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div>`;
    memoryMessages.appendChild(thinking);
    scrollMemoryDown();

    try {
        const res = await api.sendMemoryChatAPI(profile, MEM.chatId, text);
        thinking.remove();
        MEM.chatId = res.id;
        MEM.history.push({ role: 'assistant', content: res.response, sources: res.sources });
        memBubble('ai', fmtReply(res.response));
        memSources(res.sources);
        scrollMemoryDown();
        FX.chime();
    } catch (e) {
        thinking.remove();
        console.error('Memory chat failed:', e);
        memBubble('ai', `<span style="color:var(--error)">${esc(friendlyError(e))}</span>`);
        scrollMemoryDown();
    } finally {
        MEM.sending = false;
    }
}

/** Switching profiles drops the conversation — it belonged to the other notebook. */
function resetMemory() {
    MEM.chatId = null;
    MEM.history = [];
    MEM.overviewFor = null;
    LETTERS.list = [];
    LETTERS.status = null;
    LETTERS.openId = null;
    if (memoryMessages) memoryMessages.innerHTML = '';
    if (memoryOpen()) { renderMemoryOverview(); renderMemoryOpening(); }
}

function newMemoryChat() {
    HAPTIC.tap();
    MEM.chatId = null;
    MEM.history = [];
    $('memory-history')?.classList.add('hidden');
    $('btn-memory-history')?.setAttribute('aria-expanded', 'false');
    renderMemoryOpening();
    requestAnimationFrame(() => memoryInput?.focus());
}

async function resumeMemoryChat(chatId) {
    try {
        const chat = await api.getChatByIdAPI(chatId);
        if (!chat) return;
        MEM.chatId = chat.id;
        MEM.history = chat.messages || [];
        memoryMessages.innerHTML = '';
        for (const m of MEM.history) {
            const body = m.content || m.text || '';
            memBubble(m.role === 'user' ? 'user' : 'ai', m.role === 'user' ? esc(body) : fmtReply(body));
            if (m.role !== 'user' && m.sources?.length) memSources(m.sources);
        }
        $('memory-history').classList.add('hidden');
        $('btn-memory-history').setAttribute('aria-expanded', 'false');
        scrollMemoryDown();
    } catch (e) { showToast(friendlyError(e)); }
}

async function toggleMemoryHistory() {
    const panel = $('memory-history');
    const btn = $('btn-memory-history');
    if (!panel) return;
    HAPTIC.tap();
    const showing = !panel.classList.contains('hidden');
    if (showing) {
        panel.classList.add('hidden');
        btn?.setAttribute('aria-expanded', 'false');
        return;
    }
    panel.classList.remove('hidden');
    btn?.setAttribute('aria-expanded', 'true');
    panel.innerHTML = `<div class="mem-history-empty">Looking…</div>`;

    try {
        const chats = await api.getMemoryChatsAPI(memProfile());
        if (!chats.length) {
            panel.innerHTML = `<div class="mem-history-empty">No past conversations yet.</div>`;
            return;
        }
        panel.innerHTML = `<div class="mem-history-head">Past conversations</div>`
            + chats.slice(0, 25).map(c => `
                <button class="mem-history-row${c.id === MEM.chatId ? ' current' : ''}" type="button" data-chat="${esc(c.id)}">
                    <span>${esc(c.title || 'Untitled')}</span>
                    <time>${esc(timeAgo(c.updated_at || c.created_at))}</time>
                </button>`).join('');
        panel.querySelectorAll('.mem-history-row').forEach(row => {
            row.addEventListener('click', () => { FX.tap(); resumeMemoryChat(row.dataset.chat); });
        });
    } catch (e) {
        panel.innerHTML = `<div class="mem-history-empty">${esc(friendlyError(e))}</div>`;
    }
}

// ── Letters ──────────────────────────────────────────────────
// The one part of the app that speaks first. It arrives as a sheet, it is
// read once, and it does not ask to be filed anywhere.

const LETTERS = { list: [], status: null, openId: null, writing: false };

function letterDates(l) {
    const f = (iso, opts) => new Date(iso).toLocaleDateString('en-IN', opts);
    const end = new Date(l.period_end);
    return {
        heading: f(l.period_end, { day: 'numeric', month: 'long', year: 'numeric' }),
        span: `${f(l.period_start, { day: 'numeric', month: 'short' })} – ${f(l.period_end, { day: 'numeric', month: 'short' })}`,
        end,
    };
}

/** The letter itself: a sheet, set for reading, not for scanning. */
function letterSheetHTML(l) {
    const d = letterDates(l);
    const paras = (l.body || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
        .map(p => `<p>${esc(p)}</p>`).join('');
    const foot = [
        l.question_revisited ? `<div class="letter-foot-row"><span>Took up</span><b>${esc(l.question_revisited)}</b></div>` : '',
        l.reading ? `<div class="letter-foot-row"><span>Offered</span><b>${esc(l.reading)}</b></div>` : '',
    ].filter(Boolean).join('');

    return `
    <article class="letter-sheet" data-letter="${esc(l.id)}">
        <header class="letter-head">
            <div class="letter-date">${esc(d.heading)}</div>
            <div class="letter-meta">${esc(d.span)} · ${l.note_count} note${l.note_count === 1 ? '' : 's'}</div>
            ${l.envelope ? `<div class="letter-envelope">${esc(l.envelope)}</div>` : ''}
        </header>
        <div class="letter-body">${paras}</div>
        ${foot ? `<footer class="letter-foot">${foot}</footer>` : ''}
    </article>`;
}

/** What to show when there is no letter yet, or one is due. */
function letterInvitationHTML() {
    const st = LETTERS.status;
    if (!st) return '';
    if (st.due) {
        return `
        <div class="letter-invite is-due">
            <div class="letter-invite-lead">A letter is ready to be written.</div>
            <div class="letter-invite-sub">${st.freshCount} notes since the last one, ${st.daysSince} days ago.</div>
            <button class="btn btn-accent btn-sm" id="btn-write-letter">Write it</button>
        </div>`;
    }
    const waiting = st.blockedBy === 'notes'
        ? `${st.freshCount} new note${st.freshCount === 1 ? '' : 's'} since the last letter — a few more and there is something to write about.`
        : `The next letter is due in ${Math.max(0, 7 - st.daysSince)} day${7 - st.daysSince === 1 ? '' : 's'}.`;
    return `
    <div class="letter-invite">
        <div class="letter-invite-sub">${esc(waiting)}</div>
        <button class="btn btn-ghost btn-sm" id="btn-write-letter">Write one anyway</button>
    </div>`;
}

async function renderLetters() {
    const host = $('letters-body');
    if (!host) return;
    const profile = memProfile();
    if (!profile) return;

    if (!LETTERS.list.length) host.innerHTML = `<div class="letter-invite"><div class="letter-invite-sub">Looking…</div></div>`;

    try {
        [LETTERS.list, LETTERS.status] = await Promise.all([
            api.getLettersAPI(profile),
            api.letterStatusAPI(profile),
        ]);
    } catch (e) {
        host.innerHTML = `<div class="letter-invite"><div class="letter-invite-sub">${esc(friendlyError(e))}</div></div>`;
        return;
    }

    const [latest, ...rest] = LETTERS.list;
    const shown = LETTERS.openId
        ? (LETTERS.list.find(l => l.id === LETTERS.openId) || latest)
        : latest;

    const archive = LETTERS.list.filter(l => l.id !== shown?.id);
    const archiveHTML = archive.length ? `
        <div class="letter-archive">
            <div class="letter-archive-head">Earlier letters</div>
            ${archive.map(l => {
                const d = letterDates(l);
                return `<button class="letter-archive-row" type="button" data-open="${esc(l.id)}">
                    <span>${esc(l.envelope || d.span)}</span>
                    <time>${esc(d.span)}</time>
                </button>`;
            }).join('')}
        </div>` : '';

    host.innerHTML = (shown ? letterSheetHTML(shown) : '')
        + letterInvitationHTML()
        + archiveHTML;

    // Reading a letter is the whole interaction — mark it the moment it shows
    if (shown && !shown.read_at) {
        shown.read_at = new Date().toISOString();
        api.markLetterReadAPI(shown.id).catch(() => {});
        updateLettersBadge();
    }

    $('btn-write-letter')?.addEventListener('click', writeLetterNow);
    host.querySelectorAll('[data-open]').forEach(b => {
        b.addEventListener('click', () => {
            FX.tap();
            LETTERS.openId = b.dataset.open;
            renderLetters();
            $('letters-body').scrollTop = 0;
        });
    });
}

async function writeLetterNow() {
    if (LETTERS.writing) return;
    const btn = $('btn-write-letter');
    const profile = memProfile();
    if (!profile) return;

    LETTERS.writing = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Writing…'; }
    showToast('Reading the week back…');

    try {
        const r = await api.writeLetterAPI(profile, { force: true });
        if (r.skipped) {
            showToast(r.reason === 'empty' ? 'Nothing in the notebook yet.' : 'Nothing new to write about yet.');
        } else {
            LETTERS.openId = r.letter.id;
            FX.chime();
        }
        await renderLetters();
        updateLettersBadge();
    } catch (e) {
        console.error('Letter failed:', e);
        showToast(friendlyError(e));
        if (btn) { btn.disabled = false; btn.textContent = 'Write it'; }
    } finally {
        LETTERS.writing = false;
    }
}

/** A dot on the Letters tab when one is unread or overdue. */
async function updateLettersBadge() {
    const dot = $('letters-badge');
    if (!dot || !STATE.profile) return;
    try {
        const st = await api.letterStatusAPI(memProfile());
        LETTERS.status = st;
        dot.classList.toggle('hidden', !(st.unread || st.due));
    } catch { dot.classList.add('hidden'); }
}

function setMemoryPane(name) {
    const isLetters = name === 'letters';
    $('mem-pane-letters')?.classList.toggle('hidden', !isLetters);
    $('mem-pane-ask')?.classList.toggle('hidden', isLetters);
    document.querySelectorAll('.mem-pane-tab').forEach(t => {
        const on = t.dataset.pane === name;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
    });
    // The history and new-conversation controls belong to Ask alone
    $('btn-memory-history')?.classList.toggle('hidden', isLetters);
    $('btn-memory-new')?.classList.toggle('hidden', isLetters);
    const sub = $('memory-subtitle');
    if (sub && isLetters) sub.textContent = 'What the notebook wanted to say';
    MEM.pane = name;

    if (isLetters) renderLetters();
    else { renderMemoryOverview(); if (!MEM.history.length && !MEM.chatId) renderMemoryOpening(); }
}

function setupMemory() {
    document.querySelectorAll('.mem-pane-tab').forEach(tab => {
        tab.addEventListener('click', () => { FX.tap(); setMemoryPane(tab.dataset.pane); });
    });
    $('btn-close-memory')?.addEventListener('click', () => { closeMemory(); syncTabToCapture(); });
    $('btn-memory-new')?.addEventListener('click', newMemoryChat);
    $('btn-memory-history')?.addEventListener('click', toggleMemoryHistory);

    $('memory-form')?.addEventListener('submit', (e) => { e.preventDefault(); askMemory(); });

    if (memoryInput) {
        memoryInput.addEventListener('input', () => {
            memoryInput.style.height = 'auto';
            memoryInput.style.height = Math.min(memoryInput.scrollHeight, 160) + 'px';
        });
        memoryInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                askMemory();
            }
        });
    }
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

        // Strength alone is nearly flat — 286 of 333 land between 0.65 and 0.85 —
        // so below the top few it orders almost nothing. Bucket it into coarse
        // tiers it can actually support, then let recency order within a tier,
        // so the head of the list is what the notebook noticed most recently.
        const tier = (v) => (v >= 0.9 ? 3 : v >= 0.8 ? 2 : v >= 0.7 ? 1 : 0);
        const when = (c) => new Date(c.updated_at || c.created_at || 0).getTime();
        const rows = conns
            .map(c => ({ c, a: byId.get(c.note_a), b: byId.get(c.note_b) }))
            .filter(r => r.a && r.b)
            .sort((x, y) => {
                // Errands linked before the graph learned to skip them go last
                const lx = api.isLogisticsNote(x.a) || api.isLogisticsNote(x.b);
                const ly = api.isLogisticsNote(y.a) || api.isLogisticsNote(y.b);
                if (lx !== ly) return lx ? 1 : -1;
                const t = tier(y.c.strength || 0) - tier(x.c.strength || 0);
                return t !== 0 ? t : when(y.c) - when(x.c);
            });

        // ── The atlas ──────────────────────────────────────────────────────
        // Time along the bottom, one arc per connection, height set by how many
        // days it crosses. Position comes from the date rather than a layout
        // solver, so there is no blob to untangle and the picture is the same
        // every time it opens. What it shows that a list cannot: most links are
        // same-week echoes, and a handful reach across months. Those are the
        // ones worth having, and in a flat list they are invisible.
        const DAY = 86400000;
        const stamps = notes.map(n => new Date(n.created_at).getTime()).filter(t => !isNaN(t));
        const t0 = Math.min(...stamps);
        const totalDays = Math.max(1, Math.round((Math.max(...stamps) - t0) / DAY));
        const dayOf = (n) => Math.round((new Date(n.created_at).getTime() - t0) / DAY);

        const BASE = 150, LEFT = 22, RIGHT = 658;
        const xOf = (d) => LEFT + (d / totalDays) * (RIGHT - LEFT);
        const tierOf = (span) => (span >= 42 ? 'far' : span >= 14 ? 'mid' : 'near');

        const arcs = rows
            .filter(r => !api.isLogisticsNote(r.a) && !api.isLogisticsNote(r.b))
            .map(r => {
                const da = dayOf(r.a), db = dayOf(r.b);
                const lo = Math.min(da, db), hi = Math.max(da, db), span = hi - lo;
                const h = 12 + (span / Math.max(totalDays, 1)) * 118;
                return { r, lo, hi, span, tier: tierOf(span),
                    d: `M${xOf(lo).toFixed(1)} ${BASE}Q${xOf((lo + hi) / 2).toFixed(1)} ${(BASE - 2 * h).toFixed(1)} ${xOf(hi).toFixed(1)} ${BASE}` };
            });

        const counts = { near: 0, mid: 0, far: 0 };
        arcs.forEach(a => counts[a.tier]++);

        // Capture rhythm: a tick per day that holds notes, taller where more landed
        const perDay = {};
        notes.filter(n => !api.isDiscoverNote(n)).forEach(n => {
            const d = dayOf(n);
            if (!isNaN(d)) perDay[d] = (perDay[d] || 0) + 1;
        });
        const tickPath = Object.entries(perDay)
            .map(([d, c]) => `M${xOf(+d).toFixed(1)} ${BASE}v${(Math.min(c, 8) * 1.5 + 2).toFixed(1)}`).join('');

        const monthMarks = [];
        for (let d = 0; d <= totalDays; d++) {
            const date = new Date(t0 + d * DAY);
            if (date.getDate() === 1 || d === 0) {
                monthMarks.push({ x: xOf(d), label: date.toLocaleDateString('en-IN', { month: 'short' }).toLowerCase().slice(0, 3) });
            }
        }

        let spanTier = 'all';
        let pickedDay = null;

        const matches = ({ lo, hi, tier: t }) =>
            (spanTier === 'all' || t === spanTier) &&
            (pickedDay === null || (lo <= pickedDay && hi >= pickedDay));

        const chip = (key, label, n) =>
            `<button class="atlas-chip${spanTier === key ? ' active' : ''}" data-tier="${key}">${label}<span>${n}</span></button>`;

        const atlasHTML = () => `
            <div class="conn-atlas">
                <svg class="atlas-svg" viewBox="0 0 680 186" role="img"
                     aria-label="Connections drawn across time. ${counts.far} reach more than six weeks.">
                    <g class="atlas-arcs">
                        ${['near', 'mid', 'far'].map(t => {
                            const d = arcs.filter(a => a.tier === t && matches(a)).map(a => a.d).join('');
                            return d ? `<path class="arc arc-${t}" d="${d}"/>` : '';
                        }).join('')}
                    </g>
                    <path class="atlas-base" d="M${LEFT} ${BASE}H${RIGHT}"/>
                    <path class="atlas-ticks" d="${tickPath}"/>
                    ${monthMarks.map(m => `<text class="atlas-month" x="${m.x.toFixed(1)}" y="178">${esc(m.label)}</text>`).join('')}
                </svg>
                <div class="atlas-legend">
                    ${chip('all', 'All', arcs.length)}
                    ${chip('near', 'Within a week', counts.near)}
                    ${chip('mid', 'Across weeks', counts.mid)}
                    ${chip('far', 'Across months', counts.far)}
                    ${pickedDay !== null ? `<button class="atlas-clear" id="btn-atlas-clear">Clear ${esc(new Date(t0 + pickedDay * DAY).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</button>` : ''}
                </div>
            </div>`;

        // The sentence is the connection; the two notes are where it came from.
        // Leading with truncated titles buried the one line worth reading.
        const day = (n) => new Date(n.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const cite = (n) => `<button class="conn-node" data-note-id="${esc(n.id)}">`
            + `${esc(api.noteTitle(n))}<time>${esc(day(n))}</time></button>`;

        const rowHTML = ({ c, a, b }) => {
            const errand = api.isLogisticsNote(a) || api.isLogisticsNote(b);
            // Only the genuinely strong get a mark. Grading all 333 would be
            // decorating a scale that cannot carry it.
            const cls = ['conn-row', (c.strength || 0) >= 0.9 ? 'is-strong' : '', errand ? 'is-errand' : ''].filter(Boolean).join(' ');
            return `<article class="${cls}">
                ${errand ? '<div class="conn-errand-tag">scheduling</div>' : ''}
                <p class="conn-claim">${esc(c.explanation || '')}</p>
                <div class="conn-cite">${cite(a)}${cite(b)}</div>
            </article>`;
        };

        // Rows are taller now, and there are 333 of them. Open on a readable
        // stretch rather than forty thousand pixels of scroll.
        const PAGE = 60;
        let shown = PAGE;

        const paint = () => {
            const visible = arcs.filter(matches).map(a => a.r);
            const errands = spanTier === 'all' && pickedDay === null
                ? rows.filter(r => api.isLogisticsNote(r.a) || api.isLogisticsNote(r.b))
                : [];
            const all = [...visible, ...errands];
            const slice = all.slice(0, shown);

            list.innerHTML = atlasHTML()
                + (all.length
                    ? slice.map(rowHTML).join('')
                        + (shown < all.length
                            ? `<button class="conn-more" id="btn-conn-more">Show ${Math.min(PAGE, all.length - shown)} more · ${all.length - shown} left</button>`
                            : '')
                    : `<div class="conn-none">Nothing in that stretch. Try another span, or clear the filter.</div>`);

            list.querySelectorAll('.conn-node').forEach(el => {
                el.addEventListener('click', () => {
                    const note = byId.get(el.dataset.noteId);
                    if (note) { closeThreads(); syncTabToCapture(); openDetail(note); }
                });
            });
            $('btn-conn-more')?.addEventListener('click', () => {
                HAPTIC.tap();
                shown += PAGE;
                paint();
            });
            list.querySelectorAll('.atlas-chip').forEach(b => {
                b.addEventListener('click', () => {
                    FX.tap();
                    spanTier = b.dataset.tier;
                    shown = PAGE;
                    paint();
                });
            });
            $('btn-atlas-clear')?.addEventListener('click', () => {
                HAPTIC.tap();
                pickedDay = null;
                shown = PAGE;
                paint();
            });

            // A day on the baseline is a bigger target than a hairline arc, and
            // "what did the fourth of July reach?" is the question anyway.
            const svg = list.querySelector('.atlas-svg');
            svg?.addEventListener('click', (e) => {
                const box = svg.getBoundingClientRect();
                const vx = ((e.clientX - box.left) / box.width) * 680;
                if (vx < LEFT - 8 || vx > RIGHT + 8) return;
                const d = Math.round(((vx - LEFT) / (RIGHT - LEFT)) * totalDays);
                const hit = Object.keys(perDay).map(Number)
                    .reduce((best, x) => Math.abs(x - d) < Math.abs(best - d) ? x : best, 1e9);
                if (Math.abs(hit - d) > Math.max(1, Math.round(totalDays / 40))) return;
                FX.tap();
                pickedDay = pickedDay === hit ? null : hit;
                shown = PAGE;
                paint();
            });
        };
        paint();
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
    setupMemory();

    updateGoogleStatus();
    verifySession();

    if (STATE.profile) {
        renderResurface();
        updateMemoryCount();
        updateThreadsBadge();
        updateLettersBadge();
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

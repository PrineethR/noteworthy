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
    tap: () => { if (!STATE.audioMute) playTone(220, 'sine', 0.2, 0.4 * STATE.audioVolume); HAPTIC.tap(); },
    // Gentle double tap
    pop: () => { if (!STATE.audioMute) { playTone(180, 'sine', 0.25, 0.4 * STATE.audioVolume); setTimeout(() => playTone(240, 'sine', 0.3, 0.3 * STATE.audioVolume), 80); } HAPTIC.pop(); },
    // Deep swoosh
    swoosh: () => { if (!STATE.audioMute) playTone(140, 'triangle', 0.5, 0.3 * STATE.audioVolume, 60); HAPTIC.swoosh(); },
    // Uniform, simple reverberated calming piano + synth chord
    chime: () => { if (!STATE.audioMute) playCalmingChord(1.8); HAPTIC.success(); }
};

function playCalmingChord(duration = 2.0) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const freqs = [220, 277.18, 329.63, 415.30]; // AMaj7 chord (A3, C#4, E4, G#4)
    const baseVol = STATE.audioVolume * 0.18;

    freqs.forEach((freq) => {
        // 1. Piano-like Sine element (very mellow)
        const oscSine = audioCtx.createOscillator();
        const gainSine = audioCtx.createGain();
        oscSine.type = 'sine';
        oscSine.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        gainSine.gain.setValueAtTime(0, audioCtx.currentTime);
        gainSine.gain.linearRampToValueAtTime(baseVol * 0.7, audioCtx.currentTime + 0.15);
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
        
        gainTri.gain.setValueAtTime(0, audioCtx.currentTime);
        gainTri.gain.linearRampToValueAtTime(baseVol * 0.3, audioCtx.currentTime + 0.20);
        gainTri.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration + 0.2);
        
        oscTri.connect(gainTri);
        gainTri.connect(dry);
        gainTri.connect(wet);
        oscTri.start();
        oscTri.stop(audioCtx.currentTime + duration + 0.2);

        // 3. Lower Octave Square wave (sub-bass warmth)
        const oscSquare = audioCtx.createOscillator();
        const gainSquare = audioCtx.createGain();
        oscSquare.type = 'square';
        oscSquare.frequency.setValueAtTime(freq / 2, audioCtx.currentTime); // 1 octave lower
        
        gainSquare.gain.setValueAtTime(0, audioCtx.currentTime);
        gainSquare.gain.linearRampToValueAtTime(baseVol * 0.12, audioCtx.currentTime + 0.25);
        gainSquare.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration + 0.3);
        
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
            }
        } catch (e) {
            console.error("Failed to load task lists:", e);
            if (mainSelect) mainSelect.innerHTML = '<option value="@default">Default</option>';
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

const btnRunLinker = $('btn-run-linker');
if (btnRunLinker) {
    btnRunLinker.addEventListener('click', async () => {
        FX.tap();
        btnRunLinker.disabled = true;
        const label = $('linker-status-label');
        const originalText = btnRunLinker.textContent;
        btnRunLinker.textContent = "Linking...";
        
        if (label) {
            label.textContent = "Discovering semantic connections...";
            label.style.color = "var(--text-secondary)";
        }

        try {
            const profile = STATE.profile || 'prineeth';
            // Dynamically import the linker module
            const { runSemanticLinker } = await import("./js/linker-client.js");
            
            await runSemanticLinker(profile, (msg, type) => {
                if (label) {
                    label.textContent = msg;
                    if (type === 'error') label.style.color = 'var(--danger)';
                    else if (type === 'success') label.style.color = 'var(--success)';
                    else label.style.color = 'var(--text-secondary)';
                }
                console.log(`[Linker] [${type}] ${msg}`);
            });

            if (label) {
                label.textContent = "Done! Sync to download connections.";
                label.style.color = "var(--success)";
            }
            FX.chime();
            
            // Reload notes in case they were modified
            if (notesPanel.classList.contains('open')) {
                await loadNotes();
            }
        } catch (e) {
            console.error("Semantic linker failed:", e);
            if (label) {
                label.textContent = `Failed: ${e.message}`;
                label.style.color = "var(--danger)";
            }
            alert(`Semantic Linker failed: ${e.message}`);
        } finally {
            btnRunLinker.disabled = false;
            btnRunLinker.textContent = originalText;
        }
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

const COMMANDS = [
    { key: '\\remind', label: '\\remind <text>', desc: 'Add task or calendar reminder' },
    { key: '\\task', label: '\\task <text>', desc: 'Add a Google Task' },
    { key: '\\calendar', label: '\\calendar <text>', desc: 'Schedule a Google Calendar event' },
    { key: '\\doc', label: '\\doc <title>', desc: 'Create a Google Doc' },
    { key: '@remind', label: '@remind <text>', desc: 'Add task or calendar reminder' },
    { key: '@task', label: '@task <text>', desc: 'Add a Google Task' },
    { key: '@calendar', label: '@calendar <text>', desc: 'Schedule a Google Calendar event' },
    { key: '@doc', label: '@doc <title>', desc: 'Create a Google Doc' }
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
        const trigger = match[1];
        const query = match[2].toLowerCase();
        
        const filtered = COMMANDS.filter(cmd => 
            cmd.key.startsWith(trigger) && 
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
    const isTaskActive = text.match(/^([\\]|[@])(task|remind)\b/i);
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

    // Check if it starts with a command trigger
    const commandMatch = text.match(/^([\\]|[@])(remind|task|calendar|doc)\b/i);

    if (commandMatch) {
        const cmdName = commandMatch[2].toLowerCase();
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

    // Normal note save path
    try {
        await api.addNoteAPI(text, STATE.profile);
        FX.chime(); // Sound when successful
        const rect = btnSend.getBoundingClientRect();
        triggerRisographRipple(rect.left + rect.width / 2, rect.top + rect.height / 2);
        noteInput.classList.add('note-clearing');
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
    } catch (e) {
        console.error("Failed to add note:", e);
        btnSend.disabled = false;
    }
}

btnSend.addEventListener('click', sendNote);

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
function closeNotes() { HAPTIC.tap(); notesPanel.classList.remove('open'); notesBackdrop.classList.remove('visible'); STATE.searchTags = []; const si = $('notes-search-input'); if (si) si.value = ''; renderSearchTags(); }

$('btn-notes').addEventListener('click', openNotes);
$('btn-close-notes').addEventListener('click', closeNotes);
notesBackdrop.addEventListener('click', closeNotes);

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
        
        // Auto-recover stuck notes (pending/processing for > 30s)
        const now = new Date();
        if (!STATE.reprocessingNotes) {
            STATE.reprocessingNotes = new Set();
        }
        notes.forEach(note => {
            if ((note.status === 'pending' || note.status === 'processing') && note.created_at) {
                const createdTime = new Date(note.created_at);
                const ageInSeconds = (now - createdTime) / 1000;
                if (ageInSeconds > 30 && !STATE.reprocessingNotes.has(note.id)) {
                    STATE.reprocessingNotes.add(note.id);
                    console.warn(`Auto-reprocessing stuck note ${note.id} (${note.status}, age: ${Math.round(ageInSeconds)}s)`);
                    api.reprocessNoteAPI(note.id).catch(err => {
                        console.error(`Reprocessing failed for note ${note.id}`, err);
                        STATE.reprocessingNotes.delete(note.id);
                    });
                    note.status = 'processing';
                }
            }
        });
        
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
        <div class="detail-section"><div class="detail-section-label">Your note</div><div class="detail-raw-text" id="detail-raw-text">${renderMarkdown(note.raw_text)}</div></div>
        ${imagesHTML}
        ${note.summary ? `<div class="detail-section"><div class="detail-section-label">AI Summary</div><div class="detail-summary">${renderMarkdown(note.summary)}</div></div>` : ''}
        <div class="detail-section"><div class="detail-section-label">Tags</div><div class="detail-tags" id="detail-tags-container">${tags}<button class="tag tag-add" id="btn-add-tag" aria-label="Add tag">+ Add</button></div></div>
        <div class="detail-section"><div class="detail-section-label">Details</div><div class="detail-meta">
            ${note.category ? `<span class="detail-meta-item"><span class="category-badge">${note.category}</span></span>` : ''}
            ${note.sentiment ? `<span class="detail-meta-item">${SE[note.sentiment] || ''} ${note.sentiment}</span>` : ''}
            <span class="detail-meta-item">📅 ${time}</span><span class="detail-meta-item">👤 ${note.profile}</span>
        </div></div>
        ${iHTML ? `<div class="detail-divider"></div>${iHTML}` : ''}
        ${renderSemanticMap(note)}
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

// ─── Discover ────────────────────────────────────────────────
const CARD_EMOJI = { quote: '📖', question: '💭', recommendation: '📚', observation: '🔮', excerpt: '✍️' };

function openDiscover() { FX.tap(); discoverView.classList.remove('hidden'); loadDiscoverCards(); }
function closeDiscover() { HAPTIC.tap(); discoverView.classList.add('hidden'); }

$('btn-discover').addEventListener('click', openDiscover);
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

function renderSemanticMap(note) {
    const rawText = note.raw_text || '';
    const header = '## Semantic Connections';
    const idx = rawText.indexOf(header);
    if (idx === -1) return '';

    const connectionsPart = rawText.substring(idx + header.length);
    const lines = connectionsPart.split('\n');
    const connections = [];

    // Build Title to Note map
    const titleToNoteMap = new Map();
    if (STATE.notes) {
        STATE.notes.forEach(n => {
            titleToNoteMap.set(getNoteTitle(n.raw_text, n.summary).toLowerCase(), n);
        });
    }

    for (const line of lines) {
        const match = line.match(/-\s*\[\[(.*?)\]\]\s*:\s*(.*)/);
        if (match) {
            const targetTitle = match[1].trim();
            const explanation = match[2].trim();
            const targetNote = titleToNoteMap.get(targetTitle.toLowerCase());
            if (targetNote && targetNote.id !== note.id) {
                connections.push({
                    title: targetTitle,
                    explanation: explanation,
                    note: targetNote
                });
            }
        }
    }

    if (connections.length === 0) return '';

    // Render snaking path
    const nodeHeight = 84;
    const padding = 35;
    const svgHeight = padding * 2 + (connections.length * nodeHeight);
    
    // Generate S-curves connecting alternating nodes
    // Current note starts at (x=25, y=35)
    let pathD = "M 25 35";
    const points = [{ x: 25, y: 35 }];
    
    for (let i = 0; i < connections.length; i++) {
        const nextY = 35 + (i + 1) * nodeHeight;
        const nextX = (i % 2 === 0) ? 55 : 25; // alternate x coordinates for a fluid snake path
        const prev = points[points.length - 1];
        
        // Control points for smooth horizontal S-curve
        const cy1 = prev.y + (nodeHeight / 2);
        const cy2 = nextY - (nodeHeight / 2);
        
        pathD += ` C ${prev.x} ${cy1}, ${nextX} ${cy2}, ${nextX} ${nextY}`;
        points.push({ x: nextX, y: nextY });
    }

    // Render Squircles nodes over the path
    const nodesSVG = points.map((pt, idx) => {
        const isCurrent = idx === 0;
        const color = isCurrent ? 'var(--combined)' : 'var(--pramoddini)';
        const innerColor = isCurrent ? 'var(--prineeth)' : 'var(--teal)';
        return `
            <g class="transit-node-g" style="cursor: pointer;" data-index="${idx}">
                <rect class="transit-node-rect" x="${pt.x - 12}" y="${pt.y - 12}" width="24" height="24" rx="7" ry="7" fill="${color}" stroke="var(--bg-elevated)" stroke-width="2.5"></rect>
                <rect x="${pt.x - 5}" y="${pt.y - 5}" width="10" height="10" rx="3.5" ry="3.5" fill="${innerColor}"></rect>
            </g>
        `;
    }).join('');

    // Generate detail cards next to each path segment
    const cardsHTML = connections.map((conn, i) => {
        const pt = points[i + 1];
        return `
            <div class="transit-card" style="position: absolute; left: 85px; top: ${pt.y - 32}px; display: flex; flex-direction: column; gap: 4px; background: var(--bg-card); border: 1.5px solid var(--border-subtle); border-radius: var(--radius-md); padding: 8px 12px; width: calc(100% - 105px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); cursor: pointer;" data-note-id="${conn.note.id}">
                <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${esc(conn.title)}</div>
                <div style="font-size: 0.72rem; color: var(--text-secondary); line-height: 1.3;">${esc(conn.explanation)}</div>
            </div>
        `;
    }).join('');

    // Current note label on top
    const currentNoteTitle = getNoteTitle(note.raw_text, note.summary);

    return `
        <div class="detail-section" style="margin-top: 1.25rem;">
            <div class="detail-section-label">Semantic Map</div>
            <div class="semantic-map-wrap" style="position: relative; width: 100%; height: ${svgHeight}px; border: 1.5px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--bg-surface); overflow: hidden; padding: 10px;">
                <!-- Grid background matching user screen -->
                <div class="transit-grid-bg" style="position: absolute; inset: 0; opacity: 0.08; background-size: 16px 16px; background-image: radial-gradient(circle, var(--accent) 1px, transparent 1px);"></div>
                
                <svg style="position: absolute; left: 16px; top: 0; width: 80px; height: ${svgHeight}px; overflow: visible; pointer-events: none;">
                    <!-- Fluid connection path -->
                    <path d="${pathD}" stroke="var(--accent)" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.85;"></path>
                    ${nodesSVG}
                </svg>
                
                <!-- Current Note bubble at top -->
                <div class="transit-card current-active" style="position: absolute; left: 85px; top: 12px; display: flex; flex-direction: column; background: var(--bg-elevated); border: 2px solid var(--accent); border-radius: var(--radius-md); padding: 8px 12px; width: calc(100% - 105px); box-shadow: 0 4px 16px var(--accent-glow);">
                    <div style="font-size: 0.62rem; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px;">Viewing Note</div>
                    <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${esc(currentNoteTitle)}</div>
                </div>
                
                ${cardsHTML}
            </div>
        </div>
    `;
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

    updateGoogleStatus();
    verifySession();
}

init();

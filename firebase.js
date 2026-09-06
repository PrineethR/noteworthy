import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    setPersistence,
    browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// Default configuration
const defaultFirebaseConfig = {
    apiKey: "AIzaSyBsONyGccFD4Eto_E1FIJQOFPbdI5Oj6bE",
    authDomain: "noteworthy-4994f.firebaseapp.com",
    projectId: "noteworthy-4994f",
    storageBucket: "noteworthy-4994f.firebasestorage.app",
    messagingSenderId: "323883129607",
    appId: "1:323883129607:web:437d36c8a044b4686283a2"
};

// Check if we have a saved config in localStorage
let firebaseConfig = defaultFirebaseConfig;
const savedConfig = localStorage.getItem('nw_firebase_config');
if (savedConfig) {
    try {
        firebaseConfig = JSON.parse(savedConfig);
    } catch (e) {
        console.error("Failed to parse saved Firebase config", e);
    }
}

const isConfigPlaceholder = !firebaseConfig || firebaseConfig.apiKey === "YOUR_API_KEY" || !firebaseConfig.apiKey;

// Initialize Firebase (only if not using placeholder to avoid SDK warnings/errors)
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Enable Offline Persistence for Firestore
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Multiple tabs open, offline persistence can only be enabled in one tab at a time.');
    } else if (err.code == 'unimplemented') {
        console.warn('The current browser does not support offline persistence.');
    }
});

// ─── Auth ────────────────────────────────────────────────────
// The apiKey above is an identifier, not a secret — it ships in every page and
// is meant to. What actually guards the notebook is firestore.rules, which
// checks the signed-in uid against a two-name allowlist. So the sign-in below
// is the lock; the profile PIN is a convenience latch on top of it.

// Web already defaults to local persistence, but say it out loud: this is
// meant to be a once-per-device sign-in, and a silent change of that default
// would turn into a password prompt on every cold open.
setPersistence(auth, browserLocalPersistence).catch(err =>
    console.warn('Could not set auth persistence:', err?.message || err));

/**
 * Resolves with the signed-in user, or null, once Firebase has finished
 * restoring any stored session.
 *
 * Reading auth.currentUser at boot is a race: it is null until the persisted
 * session is read back off the device, so a check that runs too early sends a
 * signed-in person to the sign-in screen. onAuthStateChanged is the only
 * honest signal that the restore has happened.
 */
function authReady() {
    return new Promise(resolve => {
        const stop = onAuthStateChanged(auth, user => { stop(); resolve(user); });
    });
}

export {
    app,
    db,
    auth,
    isConfigPlaceholder,
    authReady,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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

// Enable Offline Persistence for Firestore
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Multiple tabs open, offline persistence can only be enabled in one tab at a time.');
    } else if (err.code == 'unimplemented') {
        console.warn('The current browser does not support offline persistence.');
    }
});

export { app, db, isConfigPlaceholder };

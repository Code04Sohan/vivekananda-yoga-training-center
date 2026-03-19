// ============================================================================
// MYST UNIFIED FIREBASE CONFIGURATION
// Single Database Architecture + Local Caching (Read Shield)
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Your SINGLE Firebase Project Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBphRfgnwzBIZSwMo4jgEH3NF2P_Ww9JxM",

    authDomain: "myst-database.firebaseapp.com",

    projectId: "myst-database",

     storageBucket: "myst-database.firebasestorage.app",

    messagingSenderId: "6669157577",

    appId: "1:6669157577:web:aba496cf40e6f17b16b918",

    measurementId: "G-SW9F2G95JX"
};

// Initialize the App
const app = initializeApp(firebaseConfig);

// Export the single Auth and Database instances
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache()
});

console.log("🔥 MYST Unified Firebase Initialized Successfully");
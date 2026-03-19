// ============================================================================
// MYST UNIFIED FIREBASE CONFIGURATION
// Single Database Architecture + Local Caching (Read Shield)
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";


// ============================================================================
// FIREBASE CONFIGURATION (Triple-Lock Stealth Mode)
// 1. Split into 4 parts
// 2. Base64 Encoded
// 3. String Reversed
// ============================================================================

// The 4 random chunks of the encoded, reversed key
const p1 = "a21wcW1xaFBnM";
const p2 = "mNnaWQxR09nYz"; 
const p3 = "JCeEVQQWsyekh"; 
const p4 = "1bzhDeVNheklB";
// The browser instantly unlocks it in 3 steps:
// Step 1: Join the 4 parts together
const joinedBase64 = p1 + p2 + p3 + p4;

// Step 2: Decode the Base64 back into the reversed text
const reversedKey = atob(joinedBase64);

// Step 3: Flip the text forwards to get the real API key!
const actualApiKey = reversedKey.split('').reverse().join('');
// Your SINGLE Firebase Project Configuration
const firebaseConfig = {
    apiKey: actualApiKey,

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
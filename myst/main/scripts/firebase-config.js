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
const p1 = "c1hkV1Y1enI2V"; 
const p2 = "TJBbi1xeWtmdE"; 
const p3 = "kxUlJncTF2R1R"; 
const p4 = "tc09BeVNheklB";
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

    authDomain: "myst-backup.firebaseapp.com",

    projectId: "myst-backup",

    storageBucket: "myst-backup.firebasestorage.app",

    messagingSenderId: "915511456528",

    appId: "1:915511456528:web:6a5f41baf70c0c660c2b95",

    measurementId: "G-JMQVF9TQDH"

};

// Initialize the App
const app = initializeApp(firebaseConfig);

// Export the single Auth and Database instances
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache()
});

console.log("🔥 MYST Unified Firebase Initialized Successfully");
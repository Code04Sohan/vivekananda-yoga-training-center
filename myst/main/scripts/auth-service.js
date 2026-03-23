// ============================================================================
// MODULE 1: AUTHENTICATION & ROLE VERIFICATION (THE SWITCHBOARD)
// Single Database Architecture
// ============================================================================

import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

let isSystemBooted = false;

// --- IMPORT ALL MODULES HERE ---
import { initSystemToggles, initStaffManager } from './staff-manager.js';
import { initCSVImporter } from './csv-injector.js';
import { initMatController } from './mat-controller.js';
import { initLiveDashboard } from './dashboard-engine.js';
import { initResultsEngine } from './results-engine.js';
import { initDistrictResults } from './district-results.js';
import { initCandidateManager } from './candidate-manager.js';
import { initStageManager } from './stage-manager.js';
import { initResultsExplorer } from './results-explorer.js';
// --- JUDGE AUTH ---
import { initJudgePanel } from './judge-panel.js';

export function initAuth() {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('admin-email') || document.getElementById('judge-email');
    const passInput = document.getElementById('admin-password') || document.getElementById('judge-password');
    const errorMsg = document.getElementById('login-error');
    const btnLogin = document.getElementById('btn-admin-login') || document.getElementById('btn-judge-login');
    const btnLogout = document.getElementById('btn-logout');
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await verifyUserRole(user.uid, errorMsg);
        } else {
            showLoginScreen();
        }
    });
    
    // Handle Login
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorMsg.classList.add('hidden');
            btnLogin.innerText = "⏳ Unlocking Vault...";
            btnLogin.disabled = true;

            try {
                const userCredential = await signInWithEmailAndPassword(auth, emailInput.value, passInput.value);
                await verifyUserRole(userCredential.user.uid, errorMsg);
            } catch (error) {
                console.error("Login Failed:", error);
                errorMsg.innerText = "Access Denied: Invalid Credentials.";
                errorMsg.classList.remove('hidden');
                btnLogin.innerText = "🔓 Unlock MYST Vault";
                btnLogin.disabled = false;
            }
        });
    }

    // Handle Logout
    if (btnLogout) {
    // 1. Clone and replace the button to instantly destroy any duplicate event listeners
        const cleanLogoutBtn = btnLogout.cloneNode(true);
        btnLogout.parentNode.replaceChild(cleanLogoutBtn, btnLogout);

        // 2. Attach a single, clean listener
        cleanLogoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();

            // FIX 1: Instantly disable the "Stay or Leave" popup so the redirect is smooth
            window.onbeforeunload = null; 

            // FIX 2: Change button text so user doesn't double-click
            cleanLogoutBtn.innerText = "Logging out...";
            cleanLogoutBtn.disabled = true;

            try {
                // Note: The permission-denied errors might still flash in the console 
                // for a millisecond here. That is 100% normal and harmless in Firebase!
                await signOut(auth);
                console.log("User signed out successfully.");
                
                // Redirect smoothly to the login screen
                window.location.replace('D:/GitPulls/vivekananda-yoga-training-center/index.html'); 
            } catch (error) {
                console.error("Logout Error:", error);
                cleanLogoutBtn.innerText = "Logout";
                cleanLogoutBtn.disabled = false;
            }
        });
    }
}

// 3. Verify Role in Firestore & ACTIVATE SWITCHBOARD
async function verifyUserRole(uid, errorElement) {
    try {
        const userDocRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userDocRef);

        if (!userSnap.exists()) throw new Error("User profile not found in database.");

        const role = userSnap.data().role;

        // Hide all sidebar buttons by default for safety
        const allNavButtons = document.querySelectorAll('.sidebar-btn');
        allNavButtons.forEach(btn => btn.style.display = 'none');

        // NEW: Hide the Global Portal Status controls by default
        const masterControls = document.getElementById('master-controls');
        if (masterControls) masterControls.style.display = 'none';

        // ==========================================
        // SWITCHBOARD LOGIC
        // ==========================================
        
        if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
            console.log("✅ Admin verified.");
            
            // Show all UI tabs AND the Portal Status controls
            allNavButtons.forEach(btn => btn.style.display = 'block');
            if (masterControls) masterControls.style.display = 'flex';

            // 🛡️ THE GLOBAL ARMOR: Only boot if it hasn't booted yet
            if (!isSystemBooted) {
                console.log("🚀 Booting full Admin system...");
                initCandidateManager();
                initSystemToggles();
                initStaffManager();
                initCSVImporter();
                initStageManager(uid, role); 
                initMatController();
                initLiveDashboard();
                initResultsEngine();
                initResultsExplorer();
                initDistrictResults(); // (If you have this)
                
                isSystemBooted = true; // Lock the door behind us
            }

            unlockDashboard();

        } else if (role === 'STAGE_MGR') {
            console.log("✅ Stage Coordinator verified.");

            // FIX: Show ONLY the Queue Pusher (Stage Manager tab)
            const navStageManager = document.getElementById('nav-stage-manager');
            
            if (navStageManager) navStageManager.style.display = 'block';

            // 🛡️ THE GLOBAL ARMOR for Stage Coordinators
            if (!isSystemBooted) {
                console.log("🚀 Booting Stage Coordinator controls...");
                // FIX: Pass uid and role to trigger the Smart Lock logic!
                initStageManager(uid, role); 
                
                isSystemBooted = true; // Lock the door behind us
            }

            unlockDashboard();
            
            // FIX: Auto-click the Stage Manager tab
            if (navStageManager) navStageManager.click();

        } else if (role === 'JUDGE') {
            console.log("✅ Judge verified.");

            // 🛑 SECURITY REDIRECT: If they logged in on the Admin page, kick them to the Judge page
            if (!window.location.pathname.includes('judge.html')) {
                console.log("Redirecting Judge to correct portal...");
                window.location.href = 'judge.html';
                return; // Stop running code on this page
            }

            // 🛡️ THE GLOBAL ARMOR for Judges
            if (!isSystemBooted) {
                console.log("🚀 Booting Judge Tablet UI...");
                
                // We pass the UID so the tablet knows EXACTLY who is sitting there
                initJudgePanel(uid); 
                
                isSystemBooted = true; 
            }

            unlockDashboard();

        } else {
            throw new Error("Insufficient Permissions");
        }
        
    } catch (error) {
        console.error("Role Verification Failed:", error);
        if (errorElement) {
            errorElement.innerText = "Access Denied: Unauthorized Role.";
            errorElement.classList.remove('hidden');
        }
        await signOut(auth); 
        showLoginScreen();
    }
}

// 4. UI Toggles
function unlockDashboard() {
    const overlay = document.getElementById('auth-overlay');
    const topBar = document.getElementById('global-top-bar'); // Only exists in Admin
    const appWrapper = document.getElementById('app-wrapper');

    if (overlay) overlay.style.display = 'none';
    if (topBar) topBar.style.display = 'flex';
    if (appWrapper) appWrapper.style.display = 'flex'; // Changed from flex-col to flex for compatibility
}

function showLoginScreen() {
    const overlay = document.getElementById('auth-overlay');
    const topBar = document.getElementById('global-top-bar');
    const appWrapper = document.getElementById('app-wrapper');
    
    if (overlay) overlay.style.display = 'flex';
    if (topBar) topBar.style.display = 'none';
    if (appWrapper) appWrapper.style.display = 'none';
    
    // Check for Admin button OR Judge button
    const btnAdminLogin = document.getElementById('btn-admin-login');
    const btnJudgeLogin = document.getElementById('btn-judge-login');
    
    if (btnAdminLogin) {
        btnAdminLogin.innerText = "🔓 Unlock MYST Vault";
        btnAdminLogin.disabled = false;
    }
    if (btnJudgeLogin) {
        btnJudgeLogin.innerText = "🔓 Authenticate Tablet";
        btnJudgeLogin.disabled = false;
    }
}
// ============================================================================
// MODULE 1: AUTHENTICATION & ROLE VERIFICATION (THE SWITCHBOARD)
// Single Database Architecture
// ============================================================================

import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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
import { initJudgePanel } from './judge-panel.js';
// --- NEW: IMPORT DISPLAY ENGINE ---
import { initDisplay } from './display-app.js';

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
            if (btnLogin) { btnLogin.innerText = "⏳ Authenticating..."; btnLogin.disabled = true; }

            try {
                const userCredential = await signInWithEmailAndPassword(auth, emailInput.value, passInput.value);
                await verifyUserRole(userCredential.user.uid, errorMsg);
            } catch (error) {
                errorMsg.innerText = "Access Denied: Invalid Credentials.";
                errorMsg.classList.remove('hidden');
                if (btnLogin) { btnLogin.innerText = "Connect / Login"; btnLogin.disabled = false; }
            }
        });
    }

    // Handle Logout
    if (btnLogout) {
        const cleanLogoutBtn = btnLogout.cloneNode(true);
        btnLogout.parentNode.replaceChild(cleanLogoutBtn, btnLogout);

        cleanLogoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            window.onbeforeunload = null; 
            cleanLogoutBtn.innerText = "Logging out...";
            cleanLogoutBtn.disabled = true;

            try {
                await signOut(auth);
                window.location.replace('index.html'); 
            } catch (error) {
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

        if (!userSnap.exists()) throw new Error("User profile not found.");

        const role = userSnap.data().role;
        
        // --- SMART PAGE DETECTION ---
        const isDisplayPage = window.location.pathname.includes('display.html');
        const isJudgePage = window.location.pathname.includes('judge.html');

        // Hide all sidebar buttons by default
        const allNavButtons = document.querySelectorAll('.sidebar-btn');
        allNavButtons.forEach(btn => btn.style.display = 'none');
        const masterControls = document.getElementById('master-controls');
        if (masterControls) masterControls.style.display = 'none';

        // ==========================================
        // SWITCHBOARD ROUTING LOGIC
        // ==========================================
        
        if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
            
            // If Admin opens the TV display, boot ONLY the display engine
            if (isDisplayPage) {
                if (!isSystemBooted) { initDisplay(); isSystemBooted = true; }
                unlockDashboard();
                return;
            }
            
            // Redirect from wrong pages
            if (isJudgePage) { window.location.href = 'index.html'; return; }
            
            // Standard Admin Boot
            allNavButtons.forEach(btn => btn.style.display = 'block');
            if (masterControls) masterControls.style.display = 'flex';

            if (!isSystemBooted) {
                initCandidateManager(); initSystemToggles(); initStaffManager();
                initCSVImporter(); initStageManager(uid, role); initMatController();
                initLiveDashboard(); initResultsEngine(); initResultsExplorer();
                initDistrictResults(); 
                isSystemBooted = true; 
            }
            unlockDashboard();

        } else if (role === 'STAGE_MGR') {
            
            // Stage Managers can also run the TV display safely
            if (isDisplayPage) {
                if (!isSystemBooted) { initDisplay(); isSystemBooted = true; }
                unlockDashboard();
                return;
            }
            
            if (isJudgePage) { window.location.href = 'index.html'; return; }

            const navStageManager = document.getElementById('nav-stage-manager');
            if (navStageManager) navStageManager.style.display = 'block';

            if (!isSystemBooted) {
                initStageManager(uid, role); 
                isSystemBooted = true; 
            }
            unlockDashboard();
            if (navStageManager) navStageManager.click();

        } else if (role === 'JUDGE') {
            
            if (!isJudgePage) { window.location.href = 'judge.html'; return; }

            if (!isSystemBooted) {
                initJudgePanel(uid); 
                isSystemBooted = true; 
            }
            unlockDashboard();

        // 🟢 NEW ROLE: DEDICATED TV DISPLAY NODE 🟢
        } else if (role === 'DISPLAY') {
            
            // Force them to the display screen
            if (!isDisplayPage) { window.location.href = 'display.html'; return; }

            if (!isSystemBooted) {
                initDisplay(); 
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
    if (appWrapper) appWrapper.style.display = 'flex'; 
}

function showLoginScreen() {
    const overlay = document.getElementById('auth-overlay');
    const topBar = document.getElementById('global-top-bar');
    const appWrapper = document.getElementById('app-wrapper');
    
    if (overlay) overlay.style.display = 'flex';
    if (topBar) topBar.style.display = 'none';
    if (appWrapper) appWrapper.style.display = 'none';
    
    const btnAdminLogin = document.getElementById('btn-admin-login');
    const btnJudgeLogin = document.getElementById('btn-judge-login');
    
    if (btnAdminLogin) {
        btnAdminLogin.innerText = "Connect / Login";
        btnAdminLogin.disabled = false;
    }
    if (btnJudgeLogin) {
        btnJudgeLogin.innerText = "Authenticate Tablet";
        btnJudgeLogin.disabled = false;
    }
}
// ============================================================================
// MODULE 8: THE JUDGE SMART TERMINAL ENGINE
// Decoupled Auto-Pull Architecture
// ============================================================================

import { initAuth } from './auth-service.js';
import { db } from './firebase-config.js';
import { collection, doc, onSnapshot, query, where, writeBatch, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// --- GLOBAL STATE ---
let currentUid = null;
let currentMatId = null;
let judgeSeat = null; // 'j1', 'j2', 'j3', 'j4', 'j5'
let currentQueue = []; // Holds the active candidates being scored
let localScores = {}; // Stores the math before submission

// Unsubscribers
let unsubSystem = null;
let unsubProfile = null;
let unsubMats = null;
let unsubQueue = null;

// Scoring Engine State
let currentStageIndex = 0;
const SCORING_STAGES = [
    { id: 'a1', title: 'ASAN 1', sub: 'Mandatory Posture', max: 10 },
    { id: 'a2', title: 'ASAN 2', sub: 'Mandatory Posture', max: 10 },
    { id: 'a3', title: 'ASAN 3', sub: 'Mandatory Posture', max: 10 }, // <-- Added A3
    { id: 'opt', title: 'OPTIONAL', sub: 'Bonus Posture', max: 20 }
];

// 1. Boot the Authentication System
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initJudgeQRScanner();
});

// --- AUDIO TONE FEEDBACK ---
function playScannerBeep(freq = 880, duration = 0.12) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        // Audio might be constrained until user interaction
    }
}

// --- PARSE JUDGE CREDENTIALS ---
function parseJudgeCredentials(rawText) {
    const text = (rawText || '').trim();
    if (!text) return null;

    let email = '';
    let password = '';

    try {
        const data = JSON.parse(text);
        if (typeof data === 'object' && data !== null) {
            email = String(data.email ?? data.user ?? data.id ?? data.judge_email ?? data.judgeEmail ?? '').trim();
            password = String(data.password ?? data.pass ?? data.pin ?? data.key ?? '').trim();
        }
    } catch (e) {
        // Try delimited strings (email:password, email|password, or email,password)
        if (text.includes(':')) {
            const idx = text.indexOf(':');
            email = text.substring(0, idx).trim();
            password = text.substring(idx + 1).trim();
        } else if (text.includes('|')) {
            const idx = text.indexOf('|');
            email = text.substring(0, idx).trim();
            password = text.substring(idx + 1).trim();
        } else if (text.includes(',')) {
            const idx = text.indexOf(',');
            email = text.substring(0, idx).trim();
            password = text.substring(idx + 1).trim();
        }
    }

    if (email && password) {
        return { email, password };
    }
    return null;
}

// --- JUDGE QR SCANNER ENGINE ---
let judgeQrScannerInstance = null;
let isJudgeScanning = false;

function initJudgeQRScanner() {
    const btnOpen = document.getElementById('btn-open-judge-qr');
    const modal = document.getElementById('modal-judge-qr');
    const btnClose = document.getElementById('btn-close-judge-qr');
    const btnCancel = document.getElementById('btn-cancel-judge-qr');
    const statusEl = document.getElementById('judge-qr-status');
    const emailInput = document.getElementById('judge-email');
    const passInput = document.getElementById('judge-password');
    const loginForm = document.getElementById('login-form');

    if (!btnOpen || !modal) return;

    async function stopJudgeScanner() {
        if (judgeQrScannerInstance && isJudgeScanning) {
            try {
                await judgeQrScannerInstance.stop();
                judgeQrScannerInstance.clear();
            } catch (err) {
                console.warn("Judge QR scanner stop:", err);
            }
            isJudgeScanning = false;
        }
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    async function startJudgeScanner() {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        if (statusEl) {
            statusEl.textContent = "Requesting camera access...";
            statusEl.className = "mt-3 text-xs text-slate-300 font-mono bg-slate-950 border border-slate-800 px-3 py-2 rounded-lg";
        }

        if (typeof Html5Qrcode === 'undefined') {
            if (statusEl) {
                statusEl.textContent = "QR library failed to load. Please check internet connection.";
                statusEl.className = "mt-3 text-xs text-red-400 font-mono bg-red-950/40 border border-red-800 px-3 py-2 rounded-lg";
            }
            return;
        }

        if (!judgeQrScannerInstance) {
            judgeQrScannerInstance = new Html5Qrcode("judge-qr-reader");
        }

        const config = {
            fps: 10,
            qrbox: { width: 220, height: 220 },
            aspectRatio: 1.0
        };

        const onScanSuccess = async (decodedText) => {
            if (!isJudgeScanning) return;
            const creds = parseJudgeCredentials(decodedText);

            if (creds) {
                isJudgeScanning = false;
                playScannerBeep(880, 0.15);

                if (statusEl) {
                    statusEl.textContent = `✓ Judge Pass Verified: ${creds.email}. Logging in...`;
                    statusEl.className = "mt-3 text-xs text-emerald-400 font-mono bg-emerald-950/40 border border-emerald-800 px-3 py-2 rounded-lg";
                }

                if (emailInput) emailInput.value = creds.email;
                if (passInput) passInput.value = creds.password;

                setTimeout(async () => {
                    await stopJudgeScanner();
                    if (loginForm) {
                        if (typeof loginForm.requestSubmit === 'function') {
                            loginForm.requestSubmit();
                        } else {
                            loginForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                        }
                    }
                }, 400);
            } else {
                if (statusEl) {
                    statusEl.textContent = "⚠️ Unrecognized QR format. Please scan a valid Judge Pass.";
                    statusEl.className = "mt-3 text-xs text-amber-400 font-mono bg-amber-950/40 border border-amber-800 px-3 py-2 rounded-lg";
                }
            }
        };

        try {
            isJudgeScanning = true;
            await judgeQrScannerInstance.start(
                { facingMode: "environment" },
                config,
                onScanSuccess,
                () => {}
            );
            if (statusEl) {
                statusEl.textContent = "Point camera at Judge QR Pass";
            }
        } catch (err) {
            // Environment camera not available, try fallback (e.g. laptop webcam)
            try {
                await judgeQrScannerInstance.start(
                    { facingMode: "user" },
                    config,
                    onScanSuccess,
                    () => {}
                );
                if (statusEl) {
                    statusEl.textContent = "Point camera at Judge QR Pass";
                }
            } catch (fallbackErr) {
                isJudgeScanning = false;
                console.error("Camera access error:", fallbackErr);
                if (statusEl) {
                    statusEl.textContent = "Camera error: " + (fallbackErr?.message || "Could not open camera");
                    statusEl.className = "mt-3 text-xs text-red-400 font-mono bg-red-950/40 border border-red-800 px-3 py-2 rounded-lg";
                }
            }
        }
    }

    btnOpen.addEventListener('click', startJudgeScanner);
    if (btnClose) btnClose.addEventListener('click', stopJudgeScanner);
    if (btnCancel) btnCancel.addEventListener('click', stopJudgeScanner);
}

// 2. Main Initialization (Called by auth-service.js)
export async function initJudgePanel(uid) {
    console.log("🟢 Judge Terminal Authenticated:", uid);
    currentUid = uid;

    // Set initial view to Lobby
    switchView('lobby');

    // Fetch and display Judge Name
    try {
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (userSnap.exists()) {
            document.getElementById('header-judge-name').innerText = userSnap.data().name || userSnap.data().email;
        }
    } catch (e) { console.error("Could not fetch profile:", e); }

    // Boot all Real-Time Security Listeners
    listenToSystemState();
    listenToPortalAndStaffStatus();
    listenToJudgeProfile(uid);
    listenToMatAssignment(uid);
    
    // Bind UI Buttons
    document.getElementById('btn-go-scoring').addEventListener('click', startScoringBatch);
    document.getElementById('btn-cancel-scoring').addEventListener('click', abortScoringBatch);
    document.getElementById('btn-next-stage').addEventListener('click', () => navigateStage(1));
    document.getElementById('btn-prev-stage').addEventListener('click', () => navigateStage(-1));
    document.getElementById('btn-submit-scores').addEventListener('click', submitFinalScores);
    document.getElementById('btn-blocked-logout').addEventListener('click', () => document.getElementById('btn-logout').click());
}

// ==========================================
// THE 3 SECURITY LISTENERS (The Armor)
// ==========================================

// A. Global Portal Status
// A. Global Portal Status
// A. Global Portal Status
function listenToSystemState() {
    if (unsubSystem) unsubSystem();
    unsubSystem = onSnapshot(doc(db, 'system_state', 'portal'), (docSnap) => {
        const overlay = document.getElementById('overlay-portal-closed');
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // EXACT MATCH FOR YOUR DATABASE: Check 'isScoringOpen'
            if (data.isScoringOpen === false) {
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
            } else {
                overlay.classList.remove('flex');
                overlay.classList.add('hidden');
            }
        }
    });
}

// B. Personal Account Block
// B. Personal Account Block
function listenToJudgeProfile(uid) {
    if (unsubProfile) unsubProfile();
    unsubProfile = onSnapshot(doc(db, 'users', uid), (docSnap) => {
        const overlay = document.getElementById('overlay-judge-blocked');
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // EXACT MATCH FOR YOUR DATABASE: Check 'active'
            // If active is false, OR if their role is not JUDGE, lock them out.
            if (data.active === false || data.role !== 'JUDGE') {
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
            } else {
                overlay.classList.remove('flex');
                overlay.classList.add('hidden');
            }
        } else {
            // Document was deleted
            overlay.classList.remove('hidden');
            overlay.classList.add('flex');
        }
    });
}

// C. Smart Mat Assignment
function listenToMatAssignment(uid) {
    if (unsubMats) unsubMats();
    unsubMats = onSnapshot(collection(db, 'active_mats'), async (snapshot) => {
        let assignedMat = null;
        let detectedSeat = null;
        let coordinatorId = null;

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.headJudge === uid) { assignedMat = { id: docSnap.id, ...data }; detectedSeat = 'j1'; coordinatorId = data.coordinator; }
            else if (data.panelJudges && data.panelJudges[0] === uid) { assignedMat = { id: docSnap.id, ...data }; detectedSeat = 'j2'; coordinatorId = data.coordinator; }
            else if (data.panelJudges && data.panelJudges[1] === uid) { assignedMat = { id: docSnap.id, ...data }; detectedSeat = 'j3'; coordinatorId = data.coordinator; }
            else if (data.panelJudges && data.panelJudges[2] === uid) { assignedMat = { id: docSnap.id, ...data }; detectedSeat = 'j4'; coordinatorId = data.coordinator; }
            else if (data.panelJudges && data.panelJudges[3] === uid) { assignedMat = { id: docSnap.id, ...data }; detectedSeat = 'j5'; coordinatorId = data.coordinator; }
        });

        if (assignedMat) {
            // STATUS: ASSIGNED
            currentMatId = assignedMat.id;
            judgeSeat = detectedSeat;
            
            document.getElementById('header-seat-assignment').innerText = `Mat ${assignedMat.matNumber} - ${detectedSeat.toUpperCase()}`;
            document.getElementById('queue-mat-number').innerText = assignedMat.matNumber;
            
            // Fetch Coordinator Name
            if (coordinatorId) {
                const coordSnap = await getDoc(doc(db, 'users', coordinatorId));
                document.getElementById('queue-coordinator-name').innerText = coordSnap.exists() ? (coordSnap.data().name || "Coordinator") : "Unknown";
            }
            
            // If we were in the lobby, move to receiver
            if (document.getElementById('view-lobby').classList.contains('flex')) {
                switchView('receiver');
            }
            
            // Boot the Auto-Pull Queue Listener
            listenToLiveQueue();

        } else {
            // STATUS: UNASSIGNED
            currentMatId = null;
            judgeSeat = null;
            document.getElementById('header-seat-assignment').innerText = "Unassigned";
            if (unsubQueue) { unsubQueue(); unsubQueue = null; }
            switchView('lobby');
        }
    });
}

// ADD THIS NEW FUNCTION HERE
function listenToPortalAndStaffStatus() {
    // Listen to Portal Status text
    onSnapshot(doc(db, 'system_state', 'portal'), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            // Translate isScoringOpen boolean to readable UI text
            let displayText = data.isScoringOpen === true ? "ACTIVE" : "PAUSED";
            document.getElementById('portal-status-display').innerText = displayText;
        }
    });

    // Listen to Staff Provisioning text (Assuming this is still in a 'staff' doc)
    onSnapshot(doc(db, 'system_state', 'staff'), (docSnap) => {
        if (docSnap.exists() && docSnap.data().provisioningText) {
            document.getElementById('staff-provisioning-display').innerText = docSnap.data().provisioningText;
        } else {
            document.getElementById('staff-provisioning-display').innerText = "Ready";
        }
    });
}
// ==========================================
// THE AUTO-PULL ENGINE (View B)
// ==========================================
function listenToLiveQueue() {
    if (unsubQueue) unsubQueue();
    
    // THE MAGIC QUERY: Only fetch tickets for MY mat, where MY lock is false!
    const q = query(collection(db, 'scoring_queue'), 
        where('stageId', '==', currentMatId),
        where(`${judgeSeat}_status`, '==', false)
    );

    unsubQueue = onSnapshot(q, async (snapshot) => {
        const slots = document.querySelectorAll('.queue-display-slot');
        const btnGo = document.getElementById('btn-go-scoring');
        const statusIcon = document.getElementById('queue-status-icon');
        const statusText = document.getElementById('queue-status-text');
        const banner = document.getElementById('queue-status-banner');

        // Reset UI
        slots.forEach(slot => { slot.value = ''; slot.classList.remove('bg-white', 'border-brand-500', 'text-brand-600'); slot.classList.add('bg-slate-50', 'text-slate-800'); });
        
        if (snapshot.empty) {
            // No work to do.
            currentQueue = [];
            btnGo.disabled = true;
            btnGo.innerText = "Awaiting Batch...";
            btnGo.className = "w-full bg-slate-300 text-slate-500 font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider cursor-not-allowed";
            statusIcon.innerText = "⏳";
            statusText.innerText = "Waiting for Stage Coordinator";
            banner.className = "bg-slate-100 border border-slate-300 rounded-xl p-3 sm:p-4 text-center mb-4 sm:mb-5 flex flex-col items-center justify-center transition-colors";
            return;
        }

        // We have work! Sort it so it stays organized.
        let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        docs.sort((a, b) => {
            if (a.batchNo === b.batchNo) return a.timestamp - b.timestamp;
            return a.batchNo - b.batchNo;
        });

        // Group by batchNo, take only the oldest active batch to prevent UI overload
        const activeBatchNo = docs[0].batchNo;
        currentQueue = docs.filter(d => d.batchNo === activeBatchNo);

        // Fetch Candidate Details for the UI Preview
        for (let i = 0; i < currentQueue.length; i++) {
            if (i >= 5) break; // Safety limit
            
            // Use denormalized data from scoring_queue directly!
            currentQueue[i].name = currentQueue[i].name || "Unknown Athlete";
            currentQueue[i].division = currentQueue[i].division || "Unassigned";
            currentQueue[i].group = currentQueue[i].group || "Unassigned"; 
            currentQueue[i].state = currentQueue[i].district || "Unknown"; // Map district to state for scorecard
            currentQueue[i].gender = currentQueue[i].gender || ""; 
            currentQueue[i].coachName = currentQueue[i].coachName || ""; 
            
            // Populate Slot
            slots[i].value = `${currentQueue[i].trackNo} - ${currentQueue[i].name}`;
            slots[i].classList.remove('bg-slate-50', 'text-slate-800');
            slots[i].classList.add('bg-white', 'border-brand-500', 'text-brand-600');
        }

        // Activate the GO Button
        statusIcon.innerText = "🔥";
        statusText.innerText = "Batch Ready for Scoring";
        banner.className = "bg-brand-50 border border-brand-200 rounded-xl p-3 sm:p-4 text-center mb-4 sm:mb-5 flex flex-col items-center justify-center transition-colors";
        
        btnGo.disabled = false;
        btnGo.innerText = "GO -> Start Scoring";
        btnGo.className = "w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider cursor-pointer shadow-md transition-colors";
    });
}

// ==========================================
// THE SCORING ENGINE (View C)
// ==========================================

function startScoringBatch() {
    // 1. Initialize local score state for this batch
    localScores = {};
    currentQueue.forEach(c => {
        localScores[c.trackNo] = { a1: '', a2: '', a3: '', opt: '' };
    });

    currentStageIndex = 0;
    switchView('scoring');
    renderScoringStage();
}

function abortScoringBatch() {
    if (confirm("Are you sure you want to abort? All typed scores will be lost.")) {
        localScores = {};
        switchView('receiver');
    }
}

function renderScoringStage() {
    const stage = SCORING_STAGES[currentStageIndex];
    
    // Update Header
    document.getElementById('current-stage-title').innerText = stage.title;
    document.getElementById('current-stage-subtitle').innerText = `${stage.sub} (Max ${stage.max})`;
    document.getElementById('scoring-batch-count').innerText = `${currentQueue.length} Athletes`;
    

    // Render Cards
    const container = document.getElementById('scoring-cards-container');
    const template = document.getElementById('athlete-card-template');
    container.innerHTML = '';

    currentQueue.forEach(c => {
        const clone = template.content.cloneNode(true);
        const nameEl = clone.querySelector('.athlete-name');
        const trackEl = clone.querySelector('.athlete-track');
        const divEl = clone.querySelector('.athlete-division');
        const groupEl = clone.querySelector('.athlete-group');

        nameEl.innerText = c.name;
        nameEl.title = c.name;
        trackEl.innerText = c.trackNo;
        divEl.innerText = c.division;
        divEl.title = c.division;
        groupEl.innerText = c.group;
        groupEl.title = c.group;
        
        const input = clone.querySelector('.score-input');
        input.max = stage.max;
        input.min = 0;
        input.value = localScores[c.trackNo][stage.id]; // Restore typed value if navigating back

        // Auto-select on focus for ergonomic touch scoring
        input.addEventListener('focus', () => {
            input.select();
        });

        // Input Validation Listener
        input.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            
            // Check for error: Not empty AND (NaN OR greater than max OR less than 0)
            if (e.target.value !== "" && (isNaN(val) || val > stage.max || val < 0)) {
                e.target.classList.add('input-error'); // Turns the box red
            } else {
                e.target.classList.remove('input-error'); // Removes red if fixed
            }
            
            localScores[c.trackNo][stage.id] = e.target.value; 
            validateAllScores();
        });

        container.appendChild(clone);
    });

    // Update Dots & Navigation
    for (let i = 0; i <= 3; i++) { // <-- Changed 2 to 3 (because 0,1,2,3 = 4 dots)
        const dot = document.getElementById(`dot-${i}`);
        if(dot) { 
            if (i === currentStageIndex) {
                dot.classList.remove('bg-slate-300'); dot.classList.add('bg-brand-600', 'scale-125');
            } else {
                dot.classList.add('bg-slate-300'); dot.classList.remove('bg-brand-600', 'scale-125');
            }
        }
    }

    const btnPrev = document.getElementById('btn-prev-stage');
    const btnNext = document.getElementById('btn-next-stage');
    const btnSubmit = document.getElementById('btn-submit-scores');

    btnPrev.disabled = currentStageIndex === 0;

    if (currentStageIndex === 3) { // <-- Changed 2 to 3 (Last stage is now index 3)
        btnNext.classList.add('hidden');
        btnSubmit.classList.remove('hidden');
    } else {
        btnNext.classList.remove('hidden');
        btnSubmit.classList.add('hidden');
    }

    validateAllScores();
}

function navigateStage(direction) {
    currentStageIndex += direction;
    renderScoringStage();
    // Scroll to top of cards
    document.getElementById('scoring-cards-container').scrollTop = 0;
}

function validateAllScores() {
    let isValid = true;
    let totalFields = currentQueue.length * 4; // Expected 4 fields per athlete (a1, a2, a3, opt)
    let filledFields = 0;

    currentQueue.forEach(c => {
        ['a1', 'a2', 'a3', 'opt'].forEach(key => { // <-- Added 'a3' to the array
            const valText = localScores[c.trackNo][key];
            const val = parseFloat(valText);
            const maxAllowed = key === 'opt' ? 20 : 10; 
            
            if (valText !== '' && !isNaN(val)) {
                if (val > maxAllowed || val < 0) {
                    isValid = false; 
                } else {
                    filledFields++; 
                }
            } else {
                isValid = false; 
            }
        });
    }); 

    const btnSubmit = document.getElementById('btn-submit-scores');
    
    if (isValid) {
        btnSubmit.disabled = false;
        btnSubmit.innerText = "✅ SUBMIT FINAL SCORES";
        btnSubmit.className = "w-full bg-green-600 hover:bg-green-500 text-white font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider cursor-pointer shadow-md transition-colors";
    } else {
        btnSubmit.disabled = true;
        btnSubmit.innerText = `Awaiting Valid Scores (${filledFields}/${totalFields})`;
        btnSubmit.className = "w-full bg-slate-200 text-slate-400 font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider cursor-not-allowed border border-slate-300 transition-colors";
    }
}

// ==========================================
// THE SUBMIT PROTOCOL (The 15 Writes)
// ==========================================
async function submitFinalScores() {
    const btnSubmit = document.getElementById('btn-submit-scores');
    btnSubmit.disabled = true;
    btnSubmit.innerText = "⏳ ENCRYPTING TO VAULT...";

    try {
        const batch = writeBatch(db);

        currentQueue.forEach(c => {
            const trackNo = c.trackNo;
            const s = localScores[trackNo];

            // 1. Write the Math to the `scores` collection
            const scoreRef = doc(db, 'scores', trackNo);
            const scoreUpdate = {};
            scoreUpdate[`${judgeSeat}_a1`] = parseFloat(s.a1);
            scoreUpdate[`${judgeSeat}_a2`] = parseFloat(s.a2);
            scoreUpdate[`${judgeSeat}_a3`] = parseFloat(s.a3);
            scoreUpdate[`${judgeSeat}_opt`] = parseFloat(s.opt);
            scoreUpdate['timestamp'] = new Date().toISOString();
            scoreUpdate['status'] = 'active'; 
            
            // --- METADATA ---
            scoreUpdate['candidateName'] = c.name;
            scoreUpdate['division'] = c.division;
            scoreUpdate['group'] = c.group;
            scoreUpdate['state'] = c.state; // We will use this as District to avoid breaking dashboard/results
            scoreUpdate['district'] = c.state; // Save as district too for consistency
            scoreUpdate['gender'] = c.gender;
            scoreUpdate['coachName'] = c.coachName;
            scoreUpdate['stageId'] = currentMatId; // Track which mat they scored on
            scoreUpdate['panelSize'] = c.panelSize || 5; // Track 3-judge vs 5-judge mode
            // ----------------------------------
            
            // Note: We use merge:true so J1 doesn't overwrite J2's scores!
            batch.set(scoreRef, scoreUpdate, { merge: true });

            // 2. Lock the Temporary Queue Ticket
            const queueRef = doc(db, 'scoring_queue', trackNo);
            const queueUpdate = {};
            queueUpdate[`${judgeSeat}_status`] = true;
            batch.update(queueRef, queueUpdate);

            // 3. The Permanent Double-Lock in Candidates Vault
            const candRef = doc(db, 'candidates', trackNo);
            const candUpdate = {};
            candUpdate[`${judgeSeat}_status`] = true;
            candUpdate['updatedAt'] = new Date().toISOString();
            batch.update(candRef, candUpdate);
        });

        await batch.commit();

        // Success! Clear local memory and return to Receiver
        localScores = {};
        switchView('receiver');
        
        // Note: You do NOT need to refresh the UI manually here. 
        // Because the lock is now `true`, the auto-pull listener (`where j_status == false`) 
        // will instantly trigger, see that it no longer qualifies, and clear the screen automatically!

    } catch (error) {
        console.error("Submission Error:", error);
        alert("CRITICAL ERROR: Failed to save scores. Do not refresh. Call Administrator.");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "⚠️ RETRY SUBMISSION";
        btnSubmit.classList.replace('bg-green-600', 'bg-red-600');
    }
}

// --- HELPER: VIEW ROUTER ---
function switchView(viewName) {
    const views = {
        'lobby': document.getElementById('view-lobby'),
        'receiver': document.getElementById('view-queue-receiver'),
        'scoring': document.getElementById('view-scoring-engine')
    };

    Object.values(views).forEach(v => { if(v) { v.classList.remove('flex', 'block'); v.classList.add('hidden'); } });

    if (viewName === 'lobby') { views.lobby.classList.remove('hidden'); views.lobby.classList.add('flex'); }
    if (viewName === 'receiver') { views.receiver.classList.remove('hidden'); views.receiver.classList.add('block'); } // Using block for scrolling
    if (viewName === 'scoring') { views.scoring.classList.remove('hidden'); views.scoring.classList.add('flex'); }
}
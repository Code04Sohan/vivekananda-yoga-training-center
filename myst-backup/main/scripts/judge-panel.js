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
    { id: 'opt', title: 'OPTIONAL', sub: 'Bonus Posture', max: 20 }
];

// 1. Boot the Authentication System
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
});

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
        slots.forEach(slot => { slot.value = ''; slot.classList.remove('bg-white', 'border-brand-500', 'text-brand-600', 'shadow-md'); slot.classList.add('bg-slate-50', 'text-slate-800'); });
        
        if (snapshot.empty) {
            // No work to do.
            currentQueue = [];
            btnGo.disabled = true;
            btnGo.innerText = "Awaiting Batch...";
            btnGo.className = "w-full bg-slate-300 text-slate-500 font-black py-5 rounded-xl text-xl uppercase tracking-widest transition-all duration-300 shadow-none cursor-not-allowed";
            statusIcon.innerText = "⏳";
            statusText.innerText = "Waiting for Stage Coordinator";
            banner.className = "bg-slate-100 border border-slate-300 rounded-lg p-4 text-center mb-8 flex flex-col items-center justify-center transition-colors";
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
        // Fetch Candidate Details for the UI Preview
        for (let i = 0; i < currentQueue.length; i++) {
            if (i >= 5) break; // Safety limit
            try {
                const cSnap = await getDoc(doc(db, 'candidates', currentQueue[i].trackNo));
                if (cSnap.exists()) {
                    const data = cSnap.data(); // Store data object for cleaner reading
                    
                    currentQueue[i].name = data.name;
                    currentQueue[i].division = data.division || "Unassigned";
                    
                    // --- FIX IS HERE ---
                    // Importer saves as 'groupName', we map it to 'group' for the scorecard
                    currentQueue[i].group = data.groupName || data.group || "Unassigned"; 
                    
                    // Importer saves as 'district', we map it to 'state' for the scorecard
                    currentQueue[i].state = data.district || data.state || "Unknown";
                    // -------------------
                    
                } else {
                    currentQueue[i].name = "Unknown Athlete";
                    currentQueue[i].division = "Unassigned";
                    currentQueue[i].group = "Unassigned"; 
                    currentQueue[i].state = "Unknown";
                }
            } catch(e) {
                console.error("Failed to fetch candidate profile", e);
            }
            
            // Populate Slot
            slots[i].value = `${currentQueue[i].trackNo} - ${currentQueue[i].name}`;
            slots[i].classList.remove('bg-slate-50', 'text-slate-800');
            slots[i].classList.add('bg-white', 'border-brand-500', 'text-brand-600', 'shadow-md');
        }

        // Activate the GO Button
        statusIcon.innerText = "🔥";
        statusText.innerText = "Batch Ready for Scoring";
        banner.className = "bg-brand-50 border border-brand-200 rounded-lg p-4 text-center mb-8 flex flex-col items-center justify-center transition-colors";
        
        btnGo.disabled = false;
        btnGo.innerText = "GO -> Start Scoring";
        btnGo.className = "w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-5 rounded-xl text-xl uppercase tracking-widest transition-transform active:scale-95 shadow-[0_10px_20px_rgba(79,70,229,0.3)] cursor-pointer";
    });
}

// ==========================================
// THE SCORING ENGINE (View C)
// ==========================================

function startScoringBatch() {
    // 1. Initialize local score state for this batch
    localScores = {};
    currentQueue.forEach(c => {
        localScores[c.trackNo] = { a1: '', a2: '', opt: '' };
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
        clone.querySelector('.athlete-name').innerText = c.name;
        clone.querySelector('.athlete-track').innerText = c.trackNo;
        clone.querySelector('.athlete-division').innerText = c.division;
        clone.querySelector('.athlete-group').innerText = c.group;
        
        const input = clone.querySelector('.score-input');
        input.max = stage.max;
        input.min = 0;
        input.value = localScores[c.trackNo][stage.id]; // Restore typed value if navigating back

        // Input Validation Listener
        input.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            
            // Check for error: Not empty AND (greater than max OR less than 0)
            if (e.target.value !== "" && (val > stage.max || val < 0)) {
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
    for (let i = 0; i <= 2; i++) { // Changed 3 to 2
        const dot = document.getElementById(`dot-${i}`);
        if(dot) { // Added a safety check
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

    if (currentStageIndex === 2) { // Changed 3 to 2
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
    let totalFields = currentQueue.length * 4;
    let filledFields = 0;

    currentQueue.forEach(c => {
        ['a1', 'a2', 'opt'].forEach(key => {
            const valText = localScores[c.trackNo][key];
            const val = parseFloat(valText);
            const maxAllowed = key === 'opt' ? 20 : 10; // Determines max based on stage
            
            if (valText !== '' && !isNaN(val)) {
                if (val > maxAllowed || val < 0) {
                    isValid = false; // Invalid score detected, lock the button!
                } else {
                    filledFields++; // Valid score
                }
            } else {
                isValid = false; // Empty field detected
            }
        });
    });

    const btnSubmit = document.getElementById('btn-submit-scores');
    
    if (isValid) {
        btnSubmit.disabled = false;
        btnSubmit.innerText = "✅ SUBMIT FINAL SCORES";
        btnSubmit.className = "w-full bg-green-600 hover:bg-green-500 text-white font-black py-4 rounded-xl text-lg uppercase tracking-widest transition-transform active:scale-95 shadow-[0_10px_20px_rgba(22,163,74,0.3)] cursor-pointer";
    } else {
        btnSubmit.disabled = true;
        btnSubmit.innerText = `Awaiting Valid Scores (${filledFields}/${totalFields})`;
        btnSubmit.className = "w-full bg-slate-200 text-slate-500 font-black py-4 rounded-xl text-lg uppercase tracking-widest transition-all duration-300 shadow-none cursor-not-allowed border border-slate-300";
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
            scoreUpdate[`${judgeSeat}_opt`] = parseFloat(s.opt);
            scoreUpdate['timestamp'] = new Date().toISOString();
            scoreUpdate['status'] = 'active'; 
            
            // --- ADD THESE 4 METADATA LINES ---
            scoreUpdate['candidateName'] = c.name;
            scoreUpdate['division'] = c.division;
            scoreUpdate['group'] = c.group;
            scoreUpdate['state'] = c.state;
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
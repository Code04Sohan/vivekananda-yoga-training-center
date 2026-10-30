// ============================================================================
// MYST 2.0: CULTURAL JUDGE SMART TERMINAL ENGINE
// Dedicated 2-Judge Scoring for Drawing, Song, Dance, Recital
// ============================================================================

import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    collection, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    onSnapshot, 
    query, 
    where 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

// --- SESSION STATE ---
let currentJudgeUid = null;
let currentJudgeProfile = null;
let assignedStage = null; // { comp, seat: 'j1' | 'j2', isLocked: false, ... }
let activeTargetCandidate = null; // Candidate profile object
let isCurrentCandidateLocked = false;
let unsubscribeStageListener = null;

// QR Scanner state
let cultQrScannerInstance = null;
let currentQrScanTarget = 'candidate'; // 'candidate' or 'judge_login'
let lastScanTimestamp = 0;

// ============================================================================
// 1. BOOTSTRAP ON LOAD
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initAuthFlow();
    initCandidateSearch();
    initScoringControls();
    initModalControls();
});

// ============================================================================
// 2. AUDIO & HAPTIC FEEDBACK
// ============================================================================
function playBeep(freq = 880, duration = 0.12) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') ctx.resume();
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
        // Audio constrained until user interaction
    }
}

function playSuccessChime() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        
        const now = ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.08);
            gain.gain.setValueAtTime(0.15, now + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + idx * 0.08);
            osc.stop(now + idx * 0.08 + 0.25);
        });
    } catch (e) {}
}

// ============================================================================
// 3. AUTHENTICATION FLOW (QR Pass & Manual Login)
// ============================================================================
function initAuthFlow() {
    const loginForm = document.getElementById('cult-login-form');
    const emailInput = document.getElementById('cult-judge-email');
    const passInput = document.getElementById('cult-judge-password');
    const errorMsg = document.getElementById('cult-login-error');
    const btnSubmit = document.getElementById('btn-cult-login-submit');
    const btnLogout = document.getElementById('btn-cult-logout');
    const btnOpenQrLogin = document.getElementById('btn-open-judge-qr-login');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = emailInput.value.trim();
            const password = passInput.value.trim();
            await executeLogin(email, password, errorMsg, btnSubmit);
        });
    }

    if (btnOpenQrLogin) {
        btnOpenQrLogin.addEventListener('click', () => {
            openQrScannerModal('judge_login');
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (confirm("Are you sure you want to log out of the Judge Terminal?")) {
                await signOut(auth);
                window.location.reload();
            }
        });
    }

    // Auth State Observer
    onAuthStateChanged(auth, async (user) => {
        const overlay = document.getElementById('cult-auth-overlay');
        if (user) {
            currentJudgeUid = user.uid;
            await loadJudgeProfileAndStage(user.uid);
            if (overlay) overlay.classList.add('hidden');
        } else {
            currentJudgeUid = null;
            assignedStage = null;
            if (overlay) overlay.classList.remove('hidden');
        }
    });
}

async function executeLogin(email, password, errorEl, btnEl) {
    if (!email || !password) return;

    if (errorEl) errorEl.classList.add('hidden');
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerText = "Verifying Credentials...";
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
        // Auth state observer handles post-login initialization
    } catch (err) {
        console.error("Login failed:", err);
        if (errorEl) {
            errorEl.textContent = `Login Error: ${err.message}`;
            errorEl.classList.remove('hidden');
        }
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerText = "Sign In to Terminal";
        }
    }
}

// ============================================================================
// 4. LOAD PROFILE & AUTO-DISCOVER STAGE ASSIGNMENT
// ============================================================================
async function loadJudgeProfileAndStage(uid) {
    try {
        const userDoc = await getDoc(doc(db, 'users', uid));
        if (userDoc.exists()) {
            currentJudgeProfile = { id: userDoc.id, ...userDoc.data() };
        } else {
            currentJudgeProfile = { id: uid, name: 'Judge', email: auth.currentUser?.email || '' };
        }

        // Listen to all 4 stages to detect assignment
        if (unsubscribeStageListener) unsubscribeStageListener();

        unsubscribeStageListener = onSnapshot(collection(db, 'cult_stages'), (snapshot) => {
            let foundStage = null;
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const pSize = data.panelSize !== undefined ? parseInt(data.panelSize) : (docSnap.id === 'song' ? 1 : 2);
                if (data.j1_uid === uid) {
                    foundStage = { comp: docSnap.id, seat: 'j1', panelSize: pSize, ...data };
                } else if (pSize === 2 && data.j2_uid === uid) {
                    foundStage = { comp: docSnap.id, seat: 'j2', panelSize: pSize, ...data };
                }
            });

            assignedStage = foundStage;
            updateTerminalStageUI();
        });

    } catch (err) {
        console.error("Error loading judge profile:", err);
    }
}

function updateTerminalStageUI() {
    const compTitle = document.getElementById('header-comp-title');
    const compIcon = document.getElementById('header-comp-icon');
    const judgeInfo = document.getElementById('header-judge-info');
    const seatBadge = document.getElementById('badge-judge-seat');
    const bannerLocked = document.getElementById('banner-stage-locked');
    const bannerNotAssigned = document.getElementById('banner-not-assigned');
    const terminalContent = document.getElementById('scoring-terminal-content');
    const btnSubmit = document.getElementById('btn-submit-cult-score');

    if (!assignedStage) {
        if (bannerNotAssigned) bannerNotAssigned.classList.remove('hidden');
        if (terminalContent) terminalContent.classList.add('hidden');
        if (compTitle) compTitle.textContent = "No Stage Assigned";
        if (compIcon) compIcon.textContent = "⚠️";
        if (judgeInfo) judgeInfo.textContent = currentJudgeProfile?.name || 'Judge';
        if (seatBadge) seatBadge.textContent = "UNASSIGNED";
        return;
    }

    if (bannerNotAssigned) bannerNotAssigned.classList.add('hidden');
    if (terminalContent) terminalContent.classList.remove('hidden');

    const compName = assignedStage.comp.toUpperCase();
    const panelSize = assignedStage.panelSize !== undefined ? parseInt(assignedStage.panelSize) : (assignedStage.comp === 'song' ? 1 : 2);
    const isHead = assignedStage.seat === 'j1';

    let seatLabel = "";
    if (panelSize === 1) {
        seatLabel = "Solo Judge (Max 50)";
    } else {
        seatLabel = isHead ? "Judge 1 (Head Judge)" : "Judge 2 (Panel Judge)";
    }

    const compIcons = { drawing: '🎨', song: '🎵', dance: '💃', recital: '📜' };
    if (compTitle) compTitle.textContent = `${compName} COMPETITION`;
    if (compIcon) compIcon.textContent = compIcons[assignedStage.comp] || '🎭';
    if (judgeInfo) judgeInfo.textContent = `${currentJudgeProfile?.name || 'Judge'} · ${seatLabel}`;
    if (seatBadge) {
        if (panelSize === 1) {
            seatBadge.textContent = "SOLO JUDGE";
            seatBadge.className = "text-[10px] sm:text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/40 truncate";
        } else {
            seatBadge.textContent = isHead ? "JUDGE 1" : "JUDGE 2";
            seatBadge.className = isHead 
                ? "text-[10px] sm:text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/40 truncate"
                : "text-[10px] sm:text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 truncate";
        }
    }

    // Panel Lock Control
    if (assignedStage.isLocked) {
        if (bannerLocked) bannerLocked.classList.remove('hidden');
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerText = "🔒 Stage Locked by Admin";
            btnSubmit.className = "w-full bg-slate-200 text-slate-400 font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-colors shadow-none cursor-not-allowed border border-slate-300";
        }
    } else {
        if (bannerLocked) bannerLocked.classList.add('hidden');
        validateCurrentMarks();
    }
}

// ============================================================================
// 5. CANDIDATE LOOKUP (QR & Manual Track No)
// ============================================================================
function initCandidateSearch() {
    const btnOpenQr = document.getElementById('btn-open-candidate-qr');
    const inputTrack = document.getElementById('input-track-lookup');
    const btnLookup = document.getElementById('btn-lookup-candidate');
    const btnClearTarget = document.getElementById('btn-clear-target-candidate');

    if (btnOpenQr) {
        btnOpenQr.addEventListener('click', () => {
            if (!assignedStage) {
                alert("You are not currently assigned to any active stage.");
                return;
            }
            openQrScannerModal('candidate');
        });
    }

    if (btnLookup) {
        btnLookup.addEventListener('click', () => {
            const rawTrack = inputTrack.value.trim();
            if (!rawTrack) return;
            const cleanTrack = rawTrack.replace(/^0+/, '') || '0';
            lookupCandidateByTrack(cleanTrack);
        });
    }

    if (inputTrack) {
        inputTrack.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                btnLookup?.click();
            }
        });
    }

    if (btnClearTarget) {
        btnClearTarget.addEventListener('click', () => {
            clearTargetCandidate();
        });
    }
}

async function lookupCandidateByTrack(trackNo) {
    if (!assignedStage) return;

    const comp = assignedStage.comp;
    const docId = `${comp}_${trackNo}`;

    try {
        const candDoc = await getDoc(doc(db, 'cult_candidates', docId));
        if (!candDoc.exists()) {
            alert(`Candidate #${trackNo} not found in [${comp.toUpperCase()}] roster. Please verify track number.`);
            return;
        }

        const candidateData = candDoc.data();
        setTargetCandidate(candidateData);

    } catch (err) {
        console.error("Lookup error:", err);
        alert("Failed to find candidate: " + err.message);
    }
}

async function setTargetCandidate(candidate) {
    activeTargetCandidate = candidate;

    const card = document.getElementById('target-candidate-card');
    const trackEl = document.getElementById('cand-display-track');
    const nameEl = document.getElementById('cand-display-name');
    const metaEl = document.getElementById('cand-display-meta');
    const prevScoreBadge = document.getElementById('cand-display-previous-score');
    const marksInput = document.getElementById('input-marks-value');

    if (card) card.classList.remove('hidden');
    if (trackEl) trackEl.textContent = `#${candidate.trackNo}`;
    if (nameEl) nameEl.textContent = candidate.name;
    if (metaEl) metaEl.textContent = `${candidate.groupName || 'Unassigned'} · ${candidate.gender || '-'} · ${candidate.district || '-'}`;

    isCurrentCandidateLocked = false;
    // Check if this judge already scored this candidate
    if (prevScoreBadge) prevScoreBadge.classList.add('hidden');
    try {
        const scoreDoc = await getDoc(doc(db, 'cult_scores', `${assignedStage.comp}_${candidate.trackNo}`));
        if (scoreDoc.exists()) {
            const scoreData = scoreDoc.data();
            const myScoreField = `${assignedStage.seat}_score`;
            if (scoreData[myScoreField] !== undefined) {
                const prev = parseFloat(scoreData[myScoreField]);
                isCurrentCandidateLocked = true;
                if (prevScoreBadge) {
                    prevScoreBadge.textContent = `🔒 Saved & Locked: ${prev.toFixed(1)} / 50`;
                    prevScoreBadge.className = "text-[10px] sm:text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-800";
                    prevScoreBadge.classList.remove('hidden');
                }
                if (marksInput) {
                    marksInput.value = prev.toFixed(1);
                }
            }
        }
    } catch (e) {}

    playBeep(987.77, 0.08); // B5 confirmation beep
    updateScoringInputState();
    validateCurrentMarks();
    if (!isCurrentCandidateLocked) {
        setTimeout(() => {
            marksInput?.focus();
            marksInput?.select();
        }, 50);
    }
}

function clearTargetCandidate() {
    activeTargetCandidate = null;
    isCurrentCandidateLocked = false;
    const card = document.getElementById('target-candidate-card');
    const inputTrack = document.getElementById('input-track-lookup');
    const marksInput = document.getElementById('input-marks-value');

    if (card) card.classList.add('hidden');
    if (inputTrack) inputTrack.value = '';
    if (marksInput) {
        marksInput.value = '';
        marksInput.classList.remove('input-error');
    }

    updateScoringInputState();
    validateCurrentMarks();
}

function updateScoringInputState() {
    const marksInput = document.getElementById('input-marks-value');
    const adjustBtns = document.querySelectorAll('.btn-score-adjust');
    const hasCandidate = !!activeTargetCandidate;

    if (marksInput) {
        marksInput.disabled = !hasCandidate || isCurrentCandidateLocked;
        if (!hasCandidate) {
            marksInput.classList.remove('input-error');
        }
    }

    adjustBtns.forEach(btn => {
        btn.disabled = !hasCandidate || isCurrentCandidateLocked;
    });
}

// ============================================================================
// 6. SCORING DIAL & VALIDATION CONTROLS
// ============================================================================
function initScoringControls() {
    const marksInput = document.getElementById('input-marks-value');
    const adjustBtns = document.querySelectorAll('.btn-score-adjust');
    const btnSubmit = document.getElementById('btn-submit-cult-score');

    if (marksInput) {
        // Enforce numeric only on keydown: block e, E, +, -, etc.
        marksInput.addEventListener('keydown', (e) => {
            // If Enter is pressed and submit is ready, trigger submit
            if (e.key === 'Enter') {
                e.preventDefault();
                if (btnSubmit && !btnSubmit.disabled) {
                    btnSubmit.click();
                }
                return;
            }

            // Allow navigation/editing keys
            if (['Backspace', 'Delete', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
                return;
            }

            // Allow Ctrl / Cmd combinations (Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+Z)
            if (e.ctrlKey || e.metaKey) {
                return;
            }

            // Allow single decimal point
            if (e.key === '.' && !marksInput.value.includes('.')) {
                return;
            }

            // Allow digits 0-9
            if (/^[0-9]$/.test(e.key)) {
                return;
            }

            // Block everything else (letters, exponential 'e', signs, symbols)
            e.preventDefault();
        });

        marksInput.addEventListener('input', () => {
            // Strip any unexpected non-numeric characters (from paste or mobile keypad quirks)
            let val = marksInput.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
            const parts = val.split('.');
            if (parts.length > 2) {
                val = parts[0] + '.' + parts.slice(1).join('');
            }
            if (marksInput.value !== val) {
                marksInput.value = val;
            }

            validateCurrentMarks();
        });

        marksInput.addEventListener('focus', () => {
            marksInput.select();
        });
    }

    adjustBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!activeTargetCandidate) return;
            const delta = parseFloat(e.currentTarget.dataset.adjust);
            let current = parseFloat(marksInput.value) || 0;
            let updated = Math.max(0, Math.min(50, current + delta));
            marksInput.value = updated.toFixed(1);
            playBeep(659.25, 0.05);
            validateCurrentMarks();
        });
    });

    if (btnSubmit) {
        btnSubmit.addEventListener('click', async () => {
            await submitCandidateScore();
        });
    }

    // Initialize locked state on boot
    updateScoringInputState();
    validateCurrentMarks();
}

function validateCurrentMarks() {
    const marksInput = document.getElementById('input-marks-value');
    const validationMsg = document.getElementById('marks-validation-msg');
    const btnSubmit = document.getElementById('btn-submit-cult-score');

    if (!marksInput || !btnSubmit) return;

    updateScoringInputState();

    if (!activeTargetCandidate) {
        marksInput.classList.remove('input-error');
        if (validationMsg) {
            validationMsg.textContent = "Select or scan a candidate above to unlock scoring";
            validationMsg.className = "text-xs text-slate-400 mt-2 font-medium";
        }
        btnSubmit.disabled = true;
        btnSubmit.innerText = "Select Candidate Above";
        btnSubmit.className = "w-full bg-slate-200 text-slate-400 font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-colors shadow-none cursor-not-allowed border border-slate-300";
        return;
    }

    if (isCurrentCandidateLocked) {
        marksInput.classList.remove('input-error');
        marksInput.disabled = true;
        if (validationMsg) {
            validationMsg.textContent = "🔒 Score is locked in the vault. Only an Administrator can edit or reset.";
            validationMsg.className = "text-xs text-amber-600 mt-2 font-bold font-mono";
        }
        btnSubmit.disabled = true;
        btnSubmit.innerText = "🔒 Score Locked (Already Submitted)";
        btnSubmit.className = "w-full bg-slate-200 text-slate-500 font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-colors shadow-none cursor-not-allowed border border-slate-300";
        return;
    }

    if (assignedStage?.isLocked) {
        marksInput.classList.remove('input-error');
        if (validationMsg) {
            validationMsg.textContent = "Scoring is locked by the Administrator";
            validationMsg.className = "text-xs text-red-500 mt-2 font-medium";
        }
        btnSubmit.disabled = true;
        btnSubmit.innerText = "🔒 Stage Locked by Admin";
        btnSubmit.className = "w-full bg-slate-200 text-slate-400 font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-colors shadow-none cursor-not-allowed border border-slate-300";
        return;
    }

    const valStr = marksInput.value.trim();
    if (valStr === "") {
        marksInput.classList.remove('input-error');
        if (validationMsg) {
            validationMsg.textContent = "Enter score between 0.0 and 50.0";
            validationMsg.className = "text-xs text-slate-500 mt-2 font-medium";
        }
        btnSubmit.disabled = true;
        btnSubmit.innerText = "Enter Score (0 - 50)";
        btnSubmit.className = "w-full bg-slate-200 text-slate-400 font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-colors shadow-none cursor-not-allowed border border-slate-300";
        return;
    }

    const val = parseFloat(valStr);

    if (isNaN(val)) {
        marksInput.classList.add('input-error');
        if (validationMsg) {
            validationMsg.textContent = "Invalid score format. Numbers only.";
            validationMsg.className = "text-xs text-red-600 mt-2 font-bold font-mono";
        }
        btnSubmit.disabled = true;
        btnSubmit.innerText = "Invalid Number Format";
        btnSubmit.className = "w-full bg-slate-200 text-slate-400 font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-colors shadow-none cursor-not-allowed border border-slate-300";
        return;
    }

    if (val > 50) {
        marksInput.classList.add('input-error');
        if (validationMsg) {
            validationMsg.textContent = `❌ ${val} exceeds max limit! Score must be 50.0 or less.`;
            validationMsg.className = "text-xs text-red-600 mt-2 font-bold font-mono";
        }
        btnSubmit.disabled = true;
        btnSubmit.innerText = "Score Exceeds 50 (Not Allowed)";
        btnSubmit.className = "w-full bg-slate-200 text-slate-400 font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-colors shadow-none cursor-not-allowed border border-slate-300";
        return;
    }

    if (val < 0) {
        marksInput.classList.add('input-error');
        if (validationMsg) {
            validationMsg.textContent = "❌ Score cannot be negative!";
            validationMsg.className = "text-xs text-red-600 mt-2 font-bold font-mono";
        }
        btnSubmit.disabled = true;
        btnSubmit.innerText = "Score Cannot Be Negative";
        btnSubmit.className = "w-full bg-slate-200 text-slate-400 font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-colors shadow-none cursor-not-allowed border border-slate-300";
        return;
    }

    // Valid score: 0 <= val <= 50
    marksInput.classList.remove('input-error');
    if (validationMsg) {
        validationMsg.textContent = `Awarding ${val.toFixed(1)} / 50 to #${activeTargetCandidate.trackNo} (${activeTargetCandidate.name})`;
        validationMsg.className = "text-xs text-emerald-600 mt-2 font-bold font-mono";
    }

    btnSubmit.disabled = false;
    btnSubmit.innerText = `✅ Submit ${val.toFixed(1)} Marks`;
    btnSubmit.className = "w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-all shadow-md hover:shadow-indigo-500/25 cursor-pointer active:scale-[0.98]";
}

// ============================================================================
// 7. SUBMIT SCORE TO FIRESTORE VAULT
// ============================================================================
async function submitCandidateScore() {
    if (!activeTargetCandidate || !assignedStage) return;
    if (isCurrentCandidateLocked) {
        alert("🔒 Security Restriction: This candidate has already been scored and locked. Only an Administrator can modify or reset submitted scores.");
        return;
    }

    const btnSubmit = document.getElementById('btn-submit-cult-score');
    const marksInput = document.getElementById('input-marks-value');
    const marks = parseFloat(marksInput.value);

    if (isNaN(marks) || marks < 0 || marks > 50) {
        marksInput.classList.add('input-error');
        validateCurrentMarks();
        return;
    }

    btnSubmit.disabled = true;
    btnSubmit.innerText = "⏳ Encrypting to Vault...";
    btnSubmit.className = "w-full bg-brand-500 text-white font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-all shadow-md cursor-wait";

    try {
        const comp = assignedStage.comp;
        const trackNo = activeTargetCandidate.trackNo;
        const seat = assignedStage.seat; // 'j1' or 'j2'
        const panelSize = assignedStage.panelSize !== undefined ? parseInt(assignedStage.panelSize) : (comp === 'song' ? 1 : 2);
        const docId = `${comp}_${trackNo}`;

        const scoreRef = doc(db, 'cult_scores', docId);

        // Fetch existing score to combine totals
        const existingScoreDoc = await getDoc(scoreRef);
        let existingData = existingScoreDoc.exists() ? existingScoreDoc.data() : {};

        if (existingData[`${seat}_score`] !== undefined) {
            alert("🔒 Security Restriction: A score for this candidate was already recorded in the vault. Re-submission is blocked.");
            isCurrentCandidateLocked = true;
            validateCurrentMarks();
            return;
        }

        const updatePayload = {
            competition: comp,
            trackNo: trackNo,
            panelSize: panelSize,
            candidateName: activeTargetCandidate.name,
            groupName: activeTargetCandidate.groupName || '',
            gender: activeTargetCandidate.gender || '',
            district: activeTargetCandidate.district || '',
            institution: activeTargetCandidate.institution || '',
            lastUpdated: new Date().toISOString()
        };

        if (seat === 'j1') {
            updatePayload.j1_score = marks;
            updatePayload.j1_uid = currentJudgeUid;
            updatePayload.j1_name = currentJudgeProfile?.name || 'Judge 1';
            updatePayload.j1_submittedAt = new Date().toISOString();
        } else {
            updatePayload.j2_score = marks;
            updatePayload.j2_uid = currentJudgeUid;
            updatePayload.j2_name = currentJudgeProfile?.name || 'Judge 2';
            updatePayload.j2_submittedAt = new Date().toISOString();
        }

        // Calculate combined total or solo total based on panelSize
        if (panelSize === 1) {
            updatePayload.total_score = marks;
            updatePayload.max_score = 50;
            updatePayload.status = 'completed';
        } else {
            updatePayload.max_score = 100;
            const otherScore = seat === 'j1' ? existingData.j2_score : existingData.j1_score;
            if (otherScore !== undefined) {
                updatePayload.total_score = marks + parseFloat(otherScore);
                updatePayload.status = 'completed';
            } else {
                updatePayload.status = `${seat}_done`;
            }
        }

        // 1. Write Scorecard
        await setDoc(scoreRef, updatePayload, { merge: true });

        // 2. Update Candidate Status flag
        const candRef = doc(db, 'cult_candidates', docId);
        const candUpdate = {};
        candUpdate[`${seat}_status`] = true;
        if (panelSize === 1 || updatePayload.status === 'completed') {
            candUpdate['status'] = 'completed';
        }
        await updateDoc(candRef, candUpdate);
        isCurrentCandidateLocked = true;

        // Success Haptic & Chime
        playSuccessChime();
        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);

        // Show Success Pop-up Modal
        const successModal = document.getElementById('modal-score-success');
        const successDetail = document.getElementById('success-modal-detail');
        if (successDetail) {
            successDetail.textContent = `Candidate #${trackNo} (${activeTargetCandidate.name}): ${marks.toFixed(1)} / 50`;
        }
        if (successModal) {
            successModal.classList.remove('hidden');
            successModal.classList.add('flex');
        }

    } catch (err) {
        console.error("Submission Error:", err);
        alert("CRITICAL ERROR: Failed to save score to database. Do not reload. Call Administrator.");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "⚠️ Retry Submission";
        btnSubmit.className = "w-full bg-red-600 hover:bg-red-500 text-white font-black py-3 sm:py-3.5 rounded-xl text-sm sm:text-base uppercase tracking-wider transition-all shadow-md cursor-pointer";
    }
}

function initModalControls() {
    const btnDismissSuccess = document.getElementById('btn-dismiss-success');
    const successModal = document.getElementById('modal-score-success');

    if (btnDismissSuccess) {
        btnDismissSuccess.addEventListener('click', () => {
            if (successModal) {
                successModal.classList.add('hidden');
                successModal.classList.remove('flex');
            }
            clearTargetCandidate();
        });
    }

    const btnCloseQr = document.getElementById('btn-close-cult-qr');
    const btnCancelQr = document.getElementById('btn-cancel-cult-qr');
    if (btnCloseQr) {
        btnCloseQr.addEventListener('click', () => {
            closeQrScannerModal();
        });
    }
    if (btnCancelQr) {
        btnCancelQr.addEventListener('click', () => {
            closeQrScannerModal();
        });
    }
}

// ============================================================================
// 8. FULLSCREEN QR SCANNER ENGINE (CANDIDATE BADGE & JUDGE LOGIN)
// ============================================================================
function openQrScannerModal(targetMode) {
    currentQrScanTarget = targetMode; // 'candidate' or 'judge_login'
    const modal = document.getElementById('modal-cult-qr');
    const title = document.getElementById('cult-qr-modal-title');
    const status = document.getElementById('cult-qr-scan-status');

    if (title) {
        title.textContent = targetMode === 'candidate' 
            ? "Scan Candidate Badge QR" 
            : "Scan Judge QR Pass";
    }

    if (status) {
        status.textContent = targetMode === 'candidate'
            ? "Point camera at Candidate Badge..."
            : "Point camera at Judge Login Pass...";
    }

    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    startCameraScanner();
}

async function startCameraScanner() {
    const statusEl = document.getElementById('cult-qr-scan-status');
    const viewportId = 'qr-camera-viewport';

    try {
        if (!cultQrScannerInstance) {
            cultQrScannerInstance = new Html5Qrcode(viewportId);
        }

        const onScanSuccess = async (decodedText) => {
            const now = Date.now();
            if (now - lastScanTimestamp < 1200) return; // Debounce
            lastScanTimestamp = now;

            if (currentQrScanTarget === 'candidate') {
                handleScannedCandidateQR(decodedText);
            } else if (currentQrScanTarget === 'judge_login') {
                handleScannedJudgeQR(decodedText);
            }
        };

        const config = { fps: 15, qrbox: { width: 240, height: 240 } };

        try {
            await cultQrScannerInstance.start({ facingMode: "environment" }, config, onScanSuccess, () => {});
        } catch (backErr) {
            // Fallback to front camera on laptops/desktops
            await cultQrScannerInstance.start({ facingMode: "user" }, config, onScanSuccess, () => {});
        }

    } catch (err) {
        console.error("Camera start error:", err);
        if (statusEl) statusEl.textContent = `Camera Error: ${err.message}`;
    }
}

function handleScannedCandidateQR(rawText) {
    let trackNo = '';

    try {
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed === 'object') {
            trackNo = String(parsed.track_no || parsed.trackNo || parsed.id || '').trim();
        }
    } catch (e) {
        trackNo = rawText.trim();
    }

    if (!trackNo) return;

    // Normalize leading zeros: '014' -> '14'
    const cleanTrack = trackNo.replace(/^0+/, '') || '0';

    playBeep(880, 0.1);
    if (navigator.vibrate) navigator.vibrate(60);

    closeQrScannerModal();

    const inputTrack = document.getElementById('input-track-lookup');
    if (inputTrack) inputTrack.value = cleanTrack;

    lookupCandidateByTrack(cleanTrack);
}

function handleScannedJudgeQR(rawText) {
    let email = '';
    let password = '';

    try {
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed === 'object') {
            email = String(parsed.email || parsed.user || parsed.id || '').trim();
            password = String(parsed.password || parsed.pass || parsed.pin || '').trim();
        }
    } catch (e) {
        if (rawText.includes(':')) {
            const idx = rawText.indexOf(':');
            email = rawText.substring(0, idx).trim();
            password = rawText.substring(idx + 1).trim();
        } else if (rawText.includes('|')) {
            const idx = rawText.indexOf('|');
            email = rawText.substring(0, idx).trim();
            password = rawText.substring(idx + 1).trim();
        }
    }

    if (!email || !password) {
        alert("Invalid Judge QR Pass format. Could not extract credentials.");
        return;
    }

    playBeep(880, 0.1);
    closeQrScannerModal();

    const emailInput = document.getElementById('cult-judge-email');
    const passInput = document.getElementById('cult-judge-password');
    const errorMsg = document.getElementById('cult-login-error');
    const btnSubmit = document.getElementById('btn-cult-login-submit');

    if (emailInput) emailInput.value = email;
    if (passInput) passInput.value = password;

    executeLogin(email, password, errorMsg, btnSubmit);
}

async function closeQrScannerModal() {
    const modal = document.getElementById('modal-cult-qr');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    if (cultQrScannerInstance) {
        try {
            await cultQrScannerInstance.stop();
        } catch (e) {}
    }
}


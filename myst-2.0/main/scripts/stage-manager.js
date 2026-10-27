// ============================================================================
// MODULE 3: STAGE MANAGER (THE QUEUE PUSHER)
// Decoupled Flat Queue Architecture
// ============================================================================

import { collection, doc, setDoc, deleteDoc, onSnapshot, getDocs, query, where, writeBatch, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

let unsubscribeQueue = null;
let unsubscribeMats = null;
let currentMatId = null;

// Replace your existing initStageManager function with this:

export function initStageManager(uid, role) {
    const matSelect = document.getElementById('queue-mat-select');
    const btnPush = document.getElementById('btn-push-queue');
    const btnClear = document.getElementById('btn-clear-completed-queue');
    const inputs = document.querySelectorAll('.queue-input'); // We need these to disable them if locked out

    if (!matSelect || !btnPush || !btnClear) return;

    // Boot Candidate QR Scanning & Slot Navigation Engine
    initCandidateSlotScanner();

    // 1. Listen for Active Mats & Apply Role-Based Smart Locks
    if (unsubscribeMats) unsubscribeMats();
    
    unsubscribeMats = onSnapshot(collection(db, 'active_mats'), (snapshot) => {
        
        // ==========================================
        // STAGE COORDINATOR LOGIC (Locked Terminal)
        // ==========================================
        if (role === 'STAGE_MGR') {
            let assignedMat = null;
            
            // Search all active mats to see if this user's UID is listed as the coordinator
            snapshot.forEach(doc => {
                if (doc.data().coordinator === uid) {
                    assignedMat = { id: doc.id, ...doc.data() };
                }
            });

            if (assignedMat) {
                // STATUS: ASSIGNED!
                currentMatId = assignedMat.id;
                matSelect.innerHTML = `<option value="${assignedMat.id}" selected>🔒 Locked to Mat ${assignedMat.matNumber}</option>`;
                matSelect.disabled = true; // Lock the dropdown
                matSelect.classList.add('bg-green-900/20', 'text-green-400', 'border-green-700');
                
                // Unlock the tools
                btnPush.disabled = false;
                btnClear.disabled = false;
                inputs.forEach(input => input.disabled = false);
                
                // Auto-start listening to their specific queue
                listenToLiveQueue(currentMatId);
                
            } else {
                // STATUS: UNASSIGNED! (Waiting in the lobby)
                currentMatId = null;
                matSelect.innerHTML = `<option value="">⛔ Waiting for Admin Assignment...</option>`;
                matSelect.disabled = true; // Lock the dropdown
                matSelect.classList.remove('bg-green-900/20', 'text-green-400', 'border-green-700');
                
                // Lock the tools
                btnPush.disabled = true;
                btnClear.disabled = true;
                inputs.forEach(input => {
                    input.disabled = true;
                    input.value = ''; // Clear any typed data
                });
                
                // Show a clear error in the queue table
                document.getElementById('live-queue-tbody').innerHTML = `<tr><td colspan="8" class="p-10 text-center"><div class="inline-flex items-center justify-center p-4 bg-red-950/30 border border-red-900 rounded-2xl text-red-400 font-bold uppercase tracking-widest"><span class="mr-3 text-2xl">❌</span> You are not assigned to an active mat. Please wait for the Admin.</div></td></tr>`;
                
                // Kill the queue listener so they don't see old data
                if (unsubscribeQueue) {
                    unsubscribeQueue();
                    unsubscribeQueue = null;
                }
            }
        } 
        // ==========================================
        // SUPER ADMIN LOGIC (Free Roam)
        // ==========================================
        else {
            let options = '<option value="">-- Select Mat --</option>';
            snapshot.forEach(doc => {
                options += `<option value="${doc.id}">Mat ${doc.data().matNumber}</option>`;
            });
            
            const previousSelection = matSelect.value;
            matSelect.innerHTML = options;
            matSelect.disabled = false; // Admin can use the dropdown
            
            if (previousSelection && snapshot.docs.some(d => d.id === previousSelection)) {
                matSelect.value = previousSelection;
            } else if (!previousSelection) {
                // Reset tools if mat was deleted while admin was looking at it
                 btnPush.disabled = false;
                 btnClear.disabled = false;
                 inputs.forEach(input => input.disabled = false);
            }
        }
    });

    // 2. Admin Manual Selection Listener (Only triggers for Admins since Coordinator dropdown is disabled)
    matSelect.addEventListener('change', (e) => {
        currentMatId = e.target.value;
        if (unsubscribeQueue) {
            unsubscribeQueue();
            unsubscribeQueue = null;
        }

        if (currentMatId) {
            listenToLiveQueue(currentMatId);
        } else {
            document.getElementById('live-queue-tbody').innerHTML = `<tr><td colspan="8" class="p-10 text-center text-slate-500 italic font-medium">Select a Mat to view its live queue.</td></tr>`;
        }
    });

    // 3. Push to Mat Queue (ARMORED VERSION)
    // 3. Push to Mat Queue (STRICT BATCH REJECTION)
    btnPush.addEventListener('click', async () => {
        if (!currentMatId) return alert("Please select a target Mat first!");

        const inputs = document.querySelectorAll('.queue-input');
        const trackNos = [];
        
        inputs.forEach(input => {
            const rawVal = input.value.trim();
            const val = rawVal.replace(/^0+/, '') || (rawVal === '0' ? '0' : '');
            if (val) trackNos.push(val);
        });

        if (trackNos.length === 0) return alert("Please enter at least one Track Number!");

        btnPush.disabled = true;
        btnPush.innerText = "⏳ Verifying Candidates...";

        try {
            const validTrackNos = [];
            const candidateDataMap = {}; // Store fetched data
            let errorMessage = "";

            // --- THE PRE-FLIGHT CHECK ---
            for (const trackNo of trackNos) {
                // 1. Check Master Vault
                const candidateSnap = await getDoc(doc(db, 'candidates', trackNo));
                if (!candidateSnap.exists()) {
                    errorMessage += `❌ Track ${trackNo}: Does not exist in database.\n`;
                    continue;
                }
                
                const cData = candidateSnap.data();
                if (cData.status === 'DNS') {
                    errorMessage += `❌ Track ${trackNo}: Is marked as DNS (Absent).\n`;
                    continue;
                }
                
                const isFullyScored = cData.j1_status && cData.j2_status && cData.j3_status && cData.j4_status && cData.j5_status;
                if (isFullyScored) {
                    errorMessage += `❌ Track ${trackNo}: Is already completely scored. Admin must Hard Reset them first.\n`;
                    continue;
                }

                // 2. Check Active Queue
                const queueSnap = await getDoc(doc(db, 'scoring_queue', trackNo));
                if (queueSnap.exists()) {
                    const activeMat = queueSnap.data().stageId;
                    errorMessage += `❌ Track ${trackNo}: Is already waiting in Mat ${activeMat}'s live queue.\n`;
                    continue;
                }

                // If it passes all checks, it's valid!
                validTrackNos.push(trackNo);
                candidateDataMap[trackNo] = cData; // Save for batch push
            }

            // --- THE STRICT REJECTION FIX ---
            // If even ONE track number had an error, abort the entire batch!
            if (errorMessage) {
                alert("⚠️ BATCH PUSH REJECTED!\nNone of the candidates were pushed. Please fix the following errors and try again:\n\n" + errorMessage);
                btnPush.disabled = false;
                btnPush.innerText = "🚀 Push to Mat Queue";
                return; 
            }

            // If the code reaches here, ALL entered track numbers are 100% valid.
            btnPush.innerText = "⏳ Pushing Full Batch...";

            // --- THE PUSH ENGINE ---
            const activeMatSnap = await getDoc(doc(db, 'active_mats', currentMatId));
            const panelSize = activeMatSnap.exists() ? (activeMatSnap.data().panelSize || 5) : 5;

            const queueQuery = query(collection(db, 'scoring_queue'), where('stageId', '==', currentMatId));
            const queueSnap = await getDocs(queueQuery);
            
            let highestBatch = 0;
            queueSnap.forEach(doc => {
                const batchNo = doc.data().batchNo || 0;
                if (batchNo > highestBatch) highestBatch = batchNo;
            });
            
            const nextBatchNo = highestBatch + 1;
            const batch = writeBatch(db);

            validTrackNos.forEach(trackNo => {
                const cData = candidateDataMap[trackNo];
                
                // 1. Write to Scoring Queue
                const queueRef = doc(db, 'scoring_queue', trackNo);
                batch.set(queueRef, {
                    trackNo: trackNo,
                    stageId: currentMatId,
                    batchNo: nextBatchNo,
                    timestamp: Date.now(),
                    name: cData.name || '',
                    group: cData.groupName || cData.group || '',
                    division: cData.division || '',
                    district: cData.district || '',
                    gender: cData.gender || '',
                    coachName: cData.coachName || '',
                    panelSize: panelSize, // Inject panelSize
                    j1_status: false,
                    j2_status: false,
                    j3_status: false,
                    j4_status: panelSize === 3, // True if Ghost Judge
                    j5_status: panelSize === 3  // True if Ghost Judge
                });

                // 2. Pre-lock Candidates Vault for Ghost Judges (Ensures candidate-manager turns green correctly)
                if (panelSize === 3) {
                    const candRef = doc(db, 'candidates', trackNo);
                    batch.update(candRef, {
                        j4_status: true,
                        j5_status: true,
                        panelSize: 3 // Good for reference
                    });
                }
            });

            await batch.commit();

            // Clear ALL inputs & candidate name previews upon successful batch push
            inputs.forEach(input => input.value = '');
            document.querySelectorAll('.slot-name-preview').forEach(el => el.textContent = '');
            resetSlotScannerActiveIndex();
            
        } catch (error) {
            console.error("Error pushing to queue:", error);
            alert("Failed to push to queue. Check console.");
        } finally {
            btnPush.disabled = false;
            btnPush.innerText = "🚀 Push to Mat Queue";
        }
    });
    

    // 4. Clear Completed Athletes
    btnClear.addEventListener('click', async () => {
        if (!currentMatId) return alert("Select a Mat first.");

        try {
            const queueQuery = query(collection(db, 'scoring_queue'), where('stageId', '==', currentMatId));
            const queueSnap = await getDocs(queueQuery);
            
            const batch = writeBatch(db);
            let deletedCount = 0;

            queueSnap.forEach(docSnap => {
                const data = docSnap.data();
                // Check if all 5 judges are done
                if (data.j1_status && data.j2_status && data.j3_status && data.j4_status && data.j5_status) {
                    batch.delete(docSnap.ref);
                    deletedCount++;
                }
            });

            if (deletedCount > 0) {
                await batch.commit();
            } else {
                alert("No fully completed candidates to clear yet.");
            }
        } catch (error) {
            console.error("Error clearing queue:", error);
        }
    });
}

// Render the Live Table
// Render the Live Table & Handle Accidental Deletes
function listenToLiveQueue(matId) {
    const q = query(collection(db, 'scoring_queue'), where('stageId', '==', matId));
    const tbody = document.getElementById('live-queue-tbody');
    
    // Attach the event listener for the Cancel buttons ONLY ONCE
    if (tbody.dataset.listenerAttached !== 'true') {
        tbody.addEventListener('click', async (e) => {
            if (e.target.classList.contains('btn-cancel-queue')) {
                const trackNo = e.target.dataset.track;
                if (confirm(`Remove Candidate ${trackNo} from the live queue?`)) {
                    await deleteDoc(doc(db, 'scoring_queue', trackNo));
                }
            }
        });
        tbody.dataset.listenerAttached = 'true';
    }

    unsubscribeQueue = onSnapshot(q, (snapshot) => {
        tbody.innerHTML = '';

        if (snapshot.empty) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-10 text-center text-slate-500 italic font-medium">Queue is currently empty.</td></tr>`;
            return;
        }

        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        docs.sort((a, b) => {
            if (a.batchNo === b.batchNo) return a.timestamp - b.timestamp;
            return a.batchNo - b.batchNo;
        });

        docs.forEach(data => {
            const tr = document.createElement('tr');
            tr.className = "border-b border-slate-800 hover:bg-slate-800/50 transition-colors group";
            
            const renderStatus = (status) => status 
                ? `<div class="flex justify-center"><span class="w-6 h-6 bg-emerald-900/50 text-emerald-400 border border-emerald-700 rounded-full flex items-center justify-center font-black">✓</span></div>` 
                : `<div class="flex justify-center"><span class="w-6 h-6 bg-slate-900 text-slate-600 border border-slate-700 rounded-full flex items-center justify-center font-bold">−</span></div>`;

            // NEW: The Cancel Button
            const cancelBtn = `<button class="btn-cancel-queue text-[10px] uppercase font-bold tracking-wider bg-red-950/40 hover:bg-red-900 border border-red-900/80 text-red-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors flex items-center justify-center mx-auto" data-track="${data.trackNo}"><span class="mr-1">✖</span> Cancel</button>`;

            tr.innerHTML = `
                <td class="p-4 font-mono text-slate-500 text-xs font-bold tracking-widest bg-slate-950/20 text-center">B-${data.batchNo}</td>
                <td class="p-4 font-mono text-brand-400 font-black text-xl tracking-widest bg-slate-900/20 text-center">${data.trackNo}</td>
                <td class="p-4 bg-slate-950/20">${renderStatus(data.j1_status)}</td>
                <td class="p-4 bg-slate-900/20">${renderStatus(data.j2_status)}</td>
                <td class="p-4 bg-slate-950/20">${renderStatus(data.j3_status)}</td>
                <td class="p-4 bg-slate-900/20">${renderStatus(data.j4_status)}</td>
                <td class="p-4 bg-slate-950/20">${renderStatus(data.j5_status)}</td>
                <td class="p-4 bg-slate-900/20 align-middle">${cancelBtn}</td>
            `;
            tbody.appendChild(tr);
        });
    });
}

// ==========================================
// CANDIDATE QR SCANNER ENGINE FOR STAGE MGR
// ==========================================

let slotScannerInstance = null;
let isSlotScanning = false;
let activeSlotIndex = 0;
let currentEntryMode = 'scan'; // 'scan' | 'manual'
let currentlyHeldTrack = null;
let isScannerInCooldown = false;
let cooldownTimer = null;
let lastQrSeenTimestamp = 0;

// --- AUDIO FEEDBACK GENERATION ---
function playSuccessChime() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        
        // Note 1: 880Hz (A5)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        gain1.gain.setValueAtTime(0.12, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.12);

        // Note 2: 1175Hz (D6)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1175, now + 0.1);
        gain2.gain.setValueAtTime(0.15, now + 0.1);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.1);
        osc2.stop(now + 0.28);
    } catch (e) {}
}

function playWarningBuzz() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.setValueAtTime(180, now + 0.12);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
    } catch (e) {}
}

function parseCandidateQR(rawText) {
    const text = (rawText || '').trim();
    if (!text) return null;

    let trackNo = '';
    let name = '';
    let dob = '';

    try {
        const data = JSON.parse(text);
        if (typeof data === 'object' && data !== null) {
            trackNo = String(data.track_no ?? data.trackNo ?? data.track ?? data.id ?? '').trim();
            name = String(data.name ?? data.athlete ?? '').trim();
            dob = String(data.dob ?? data.birthDate ?? '').trim();
        }
    } catch (e) {
        if (text.includes(':') || text.includes('|') || text.includes(',')) {
            const parts = text.split(/[:|,]/);
            trackNo = parts[0]?.trim() || '';
            name = parts[1]?.trim() || '';
        } else {
            trackNo = text;
        }
    }

    if (!trackNo) return null;

    // Normalize track number: strip leading zeros (e.g. '014' -> '14', '001' -> '1', '0100' -> '100')
    trackNo = trackNo.replace(/^0+/, '') || '0';

    return { trackNo, name, dob };
}

function resetSlotScannerActiveIndex() {
    currentlyHeldTrack = null;
    setActiveSlot(0);
}

function updateModalSlotsPreview() {
    const chipsContainer = document.getElementById('modal-slots-preview-chips');
    const filledCountEl = document.getElementById('modal-slots-filled-count');
    const inputs = document.querySelectorAll('.queue-input');

    if (!chipsContainer || inputs.length === 0) return;

    let filledCount = 0;
    chipsContainer.innerHTML = '';

    inputs.forEach((inp, idx) => {
        const val = inp.value.trim();
        const hasVal = Boolean(val);
        if (hasVal) filledCount++;
        const isTarget = (idx === activeSlotIndex);

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `p-2 rounded-xl text-center border transition-all cursor-pointer flex flex-col items-center justify-center select-none ${
            isTarget 
                ? 'border-brand-500 bg-brand-950/70 ring-2 ring-brand-500/50 text-brand-300 font-black' 
                : hasVal 
                    ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300 font-bold' 
                    : 'border-slate-800 bg-slate-950 text-slate-400 font-medium hover:border-slate-700'
        }`;
        
        chip.innerHTML = `
            <span class="text-[9px] uppercase tracking-wider block opacity-70">Slot ${idx + 1}</span>
            <span class="text-xs font-mono font-black truncate max-w-full">${hasVal ? val : '−'}</span>
        `;

        chip.addEventListener('click', () => {
            setActiveSlot(idx);
        });

        chipsContainer.appendChild(chip);
    });

    if (filledCountEl) {
        filledCountEl.textContent = `${filledCount} / 5 Filled`;
    }
}

function setActiveSlot(index) {
    const totalSlots = 5;
    activeSlotIndex = Math.max(0, Math.min(index, totalSlots - 1));

    // Update target badge in modal
    const badge = document.getElementById('slot-qr-target-badge');
    if (badge) {
        badge.textContent = `SLOT ${activeSlotIndex + 1}`;
    }

    // Update target dropdown in modal
    const targetSelect = document.getElementById('modal-slot-target-select');
    if (targetSelect && String(targetSelect.value) !== String(activeSlotIndex)) {
        targetSelect.value = String(activeSlotIndex);
    }

    // Highlight active slot row in main panel
    const slotRows = document.querySelectorAll('.slot-row');
    slotRows.forEach((row, i) => {
        const input = row.querySelector('.queue-input');
        if (i === activeSlotIndex) {
            row.classList.add('active-target-slot');
            if (input) {
                input.classList.remove('border-slate-700', 'bg-slate-950');
                input.classList.add('border-brand-500', 'bg-slate-900/90', 'ring-1', 'ring-brand-500/50');
            }
        } else {
            row.classList.remove('active-target-slot');
            if (input) {
                input.classList.remove('border-brand-500', 'bg-slate-900/90', 'ring-1', 'ring-brand-500/50');
                input.classList.add('border-slate-700', 'bg-slate-950');
            }
        }
    });

    // Refresh chips preview in modal
    updateModalSlotsPreview();
}

function initCandidateSlotScanner() {
    const toggleEntryMode = document.getElementById('toggle-entry-mode');
    const toggleEntryWrapper = document.getElementById('toggle-entry-wrapper');
    const toggleModeIcon = document.getElementById('toggle-mode-icon');
    const toggleLabelText = document.getElementById('toggle-label-text');
    const toggleSwitchTrack = document.getElementById('toggle-switch-track');
    const toggleSwitchKnob = document.getElementById('toggle-switch-knob');
    const btnOpenScanner = document.getElementById('btn-open-scanner');
    const modalQr = document.getElementById('modal-slot-qr');
    const btnCloseModal = document.getElementById('btn-close-modal-qr');
    const statusEl = document.getElementById('slot-qr-status');
    const targetSelect = document.getElementById('modal-slot-target-select');
    const slotRows = document.querySelectorAll('.slot-row');
    const inputs = document.querySelectorAll('.queue-input');
    const previews = document.querySelectorAll('.slot-name-preview');

    if (!modalQr) return;

    // --- MODE SWITCHER & LOCKING LOGIC ---
    function applyEntryMode(isScanMode) {
        currentEntryMode = isScanMode ? 'scan' : 'manual';

        if (toggleEntryMode && toggleEntryMode.checked !== isScanMode) {
            toggleEntryMode.checked = isScanMode;
        }

        if (isScanMode) {
            if (toggleEntryWrapper) {
                toggleEntryWrapper.className = "w-full flex items-center justify-between p-3 mb-4 rounded-xl border border-emerald-500/60 bg-gradient-to-r from-emerald-950/80 via-slate-900 to-teal-950/80 shadow-md shadow-emerald-950/50 cursor-pointer select-none transition-all duration-200";
            }
            if (toggleModeIcon) toggleModeIcon.textContent = "📷";
            if (toggleLabelText) {
                toggleLabelText.textContent = "Scan Mode (Locked)";
                toggleLabelText.className = "text-xs sm:text-sm font-black uppercase tracking-wider text-emerald-300";
            }
            if (toggleSwitchTrack) {
                toggleSwitchTrack.className = "w-14 h-7 rounded-full p-0.5 transition-all duration-200 bg-gradient-to-r from-emerald-500 to-teal-400 shadow-inner flex items-center";
            }
            if (toggleSwitchKnob) {
                toggleSwitchKnob.className = "w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-200 transform translate-x-7 flex items-center justify-center text-[10px] font-black text-emerald-700";
                toggleSwitchKnob.textContent = "✓";
            }
            if (btnOpenScanner) {
                btnOpenScanner.classList.remove('hidden');
                btnOpenScanner.disabled = false;
            }
            inputs.forEach(input => {
                input.readOnly = true;
                input.classList.add('cursor-pointer', 'select-none');
            });
        } else {
            // Manual Mode
            if (toggleEntryWrapper) {
                toggleEntryWrapper.className = "w-full flex items-center justify-between p-3 mb-4 rounded-xl border border-amber-500/60 bg-gradient-to-r from-amber-950/80 via-slate-900 to-orange-950/80 shadow-md shadow-amber-950/50 cursor-pointer select-none transition-all duration-200";
            }
            if (toggleModeIcon) toggleModeIcon.textContent = "✍️";
            if (toggleLabelText) {
                toggleLabelText.textContent = "Manual Mode (Unlocked)";
                toggleLabelText.className = "text-xs sm:text-sm font-black uppercase tracking-wider text-amber-300";
            }
            if (toggleSwitchTrack) {
                toggleSwitchTrack.className = "w-14 h-7 rounded-full p-0.5 transition-all duration-200 bg-gradient-to-r from-amber-500 to-orange-500 shadow-inner flex items-center";
            }
            if (toggleSwitchKnob) {
                toggleSwitchKnob.className = "w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-200 transform translate-x-0 flex items-center justify-center text-[10px] font-black text-amber-700";
                toggleSwitchKnob.textContent = "✎";
            }
            if (btnOpenScanner) {
                btnOpenScanner.classList.add('hidden');
                btnOpenScanner.disabled = true;
            }
            inputs.forEach(input => {
                input.readOnly = false;
                input.classList.remove('cursor-pointer', 'select-none');
            });
            stopSlotScanner();
        }
    }

    if (toggleEntryMode) {
        toggleEntryMode.addEventListener('change', (e) => {
            applyEntryMode(e.target.checked);
        });
    }

    // Modal target dropdown listener
    if (targetSelect) {
        targetSelect.addEventListener('change', (e) => {
            setActiveSlot(parseInt(e.target.value));
        });
    }

    // Set initial active slot (Slot 1) & initial mode (Scan Mode)
    setActiveSlot(0);
    applyEntryMode(toggleEntryMode ? toggleEntryMode.checked : true);

    // Slot click selection & individual clear buttons in main panel
    slotRows.forEach((row, index) => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.btn-clear-slot')) {
                // Clear button clicked
                if (inputs[index]) inputs[index].value = '';
                if (previews[index]) previews[index].textContent = '';
                currentlyHeldTrack = null;
                setActiveSlot(index);
                if (currentEntryMode === 'manual' && inputs[index]) {
                    inputs[index].focus();
                }
                return;
            }
            
            setActiveSlot(index);
            if (currentEntryMode === 'scan') {
                // If in scan mode, tapping slot opens the full-screen scanner targeting this slot
                startSlotScanner();
            } else if (currentEntryMode === 'manual' && inputs[index]) {
                inputs[index].focus();
            }
        });
    });

    // Listen to manual input edits to update preview & active slot
    inputs.forEach((input, index) => {
        input.addEventListener('focus', () => {
            setActiveSlot(index);
        });
        input.addEventListener('input', () => {
            setActiveSlot(index);
            if (!input.value.trim() && previews[index]) {
                previews[index].textContent = '';
            }
        });
        input.addEventListener('blur', () => {
            if (input.value.trim()) {
                input.value = input.value.trim().replace(/^0+/, '') || '0';
            }
            updateModalSlotsPreview();
        });
    });

    async function stopSlotScanner() {
        if (slotScannerInstance && isSlotScanning) {
            try {
                await slotScannerInstance.stop();
                slotScannerInstance.clear();
            } catch (e) {
                console.warn("Slot QR stop:", e);
            }
            isSlotScanning = false;
        }
        if (modalQr) {
            modalQr.classList.add('hidden');
            modalQr.classList.remove('flex');
        }
    }

    async function startSlotScanner() {
        if (!modalQr) return;
        modalQr.classList.remove('hidden');
        modalQr.classList.add('flex');

        updateModalSlotsPreview();
        setActiveSlot(activeSlotIndex);

        if (statusEl) {
            statusEl.textContent = "Requesting camera access...";
            statusEl.className = "mt-3 text-xs font-mono text-slate-400 text-center bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl w-full truncate";
        }

        if (typeof Html5Qrcode === 'undefined') {
            if (statusEl) {
                statusEl.textContent = "QR library failed to load. Check internet connection.";
                statusEl.className = "mt-3 text-xs font-mono text-red-400 text-center bg-red-950/40 border border-red-800 px-3 py-2 rounded-xl w-full truncate";
            }
            return;
        }

        if (!slotScannerInstance) {
            slotScannerInstance = new Html5Qrcode("slot-qr-reader");
        }

        const config = {
            fps: 10,
            qrbox: { width: 240, height: 240 },
            aspectRatio: 1.0
        };

        const onScanSuccess = (decodedText) => {
            if (!isSlotScanning || isScannerInCooldown) return;
            lastQrSeenTimestamp = Date.now();

            const parsed = parseCandidateQR(decodedText);
            if (!parsed || !parsed.trackNo) {
                if (statusEl) {
                    statusEl.textContent = "⚠️ Unrecognized QR. Point at Candidate QR.";
                    statusEl.className = "mt-3 text-xs font-mono text-amber-400 text-center bg-amber-950/40 border border-amber-800 px-3 py-2 rounded-xl w-full truncate";
                }
                return;
            }

            const scannedTrack = parsed.trackNo;

            // 1. CONTINUOUS HOLD CHECK: Ignore frame if same card is held
            if (currentlyHeldTrack === scannedTrack) {
                return;
            }

            // 2. BATCH-WIDE DUPLICATE CHECK: Is track number already in another slot?
            let existingIndex = -1;
            inputs.forEach((inp, idx) => {
                const existingVal = inp.value.trim().replace(/^0+/, '') || (inp.value.trim() === '0' ? '0' : '');
                if (existingVal && existingVal === scannedTrack) {
                    existingIndex = idx;
                }
            });

            if (existingIndex !== -1) {
                currentlyHeldTrack = scannedTrack;
                playWarningBuzz();
                if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

                if (statusEl) {
                    statusEl.textContent = `⚠️ Track #${scannedTrack} already in Slot ${existingIndex + 1}! Scan next candidate.`;
                    statusEl.className = "mt-3 text-xs font-mono text-amber-400 text-center bg-amber-950/40 border border-amber-800 px-3 py-2 rounded-xl w-full truncate";
                }
                return;
            }

            // 3. SUCCESSFUL SCAN:
            currentlyHeldTrack = scannedTrack;

            // Populate active slot input in main panel
            if (inputs[activeSlotIndex]) {
                inputs[activeSlotIndex].value = scannedTrack;
            }

            // Populate visual preview in main panel
            const displayName = parsed.name ? (parsed.dob ? `👤 ${parsed.name} (${parsed.dob})` : `👤 ${parsed.name}`) : `Candidate #${scannedTrack}`;
            if (previews[activeSlotIndex]) {
                previews[activeSlotIndex].textContent = displayName;
            }

            // Audio & Haptic feedback
            playSuccessChime();
            if (navigator.vibrate) navigator.vibrate([60, 40, 60]);

            // Update mini chips immediately
            updateModalSlotsPreview();

            // Calculate next empty slot index
            let nextSlot = -1;
            for (let i = activeSlotIndex + 1; i < 5; i++) {
                if (!inputs[i] || !inputs[i].value.trim()) {
                    nextSlot = i;
                    break;
                }
            }
            if (nextSlot === -1) {
                for (let i = 0; i < activeSlotIndex; i++) {
                    if (!inputs[i] || !inputs[i].value.trim()) {
                        nextSlot = i;
                        break;
                    }
                }
            }
            if (nextSlot === -1) {
                nextSlot = (activeSlotIndex + 1) % 5;
            }

            // 4. TRIGGER COOLDOWN & CONFIRMATION OVERLAY IN MODAL
            isScannerInCooldown = true;
            const capturedSlot = activeSlotIndex;

            const overlay = document.getElementById('slot-qr-feedback-overlay');
            const overlayTitle = document.getElementById('slot-qr-feedback-title');
            const overlayDetail = document.getElementById('slot-qr-feedback-detail');
            const overlayCooldown = document.getElementById('slot-qr-feedback-cooldown');

            if (overlay) {
                if (overlayTitle) overlayTitle.textContent = `SLOT ${capturedSlot + 1} CAPTURED!`;
                if (overlayDetail) overlayDetail.textContent = `Track #${scannedTrack} · ${parsed.name || 'Candidate'}`;
                if (overlayCooldown) overlayCooldown.textContent = `Targeting Slot ${nextSlot + 1} · Ready in 1.5s`;
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
            }

            if (statusEl) {
                statusEl.textContent = `✓ Slot ${capturedSlot + 1} filled: #${scannedTrack} (${parsed.name || 'Candidate'})`;
                statusEl.className = "mt-3 text-xs font-mono text-emerald-400 text-center bg-emerald-950/40 border border-emerald-800 px-3 py-2 rounded-xl w-full truncate";
            }

            if (cooldownTimer) clearTimeout(cooldownTimer);
            cooldownTimer = setTimeout(() => {
                if (overlay) {
                    overlay.classList.add('hidden');
                    overlay.classList.remove('flex');
                }
                isScannerInCooldown = false;
                setActiveSlot(nextSlot);
                if (statusEl) {
                    statusEl.textContent = `Ready: Point camera at Candidate ${nextSlot + 1} QR...`;
                    statusEl.className = "mt-3 text-xs font-mono text-slate-300 text-center bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl w-full truncate";
                }
            }, 1500);
        };

        const onScanFailure = () => {
            const now = Date.now();
            if (now - lastQrSeenTimestamp > 600) {
                currentlyHeldTrack = null;
            }
        };

        try {
            isSlotScanning = true;
            await slotScannerInstance.start(
                { facingMode: "environment" },
                config,
                onScanSuccess,
                onScanFailure
            );
            if (statusEl) {
                statusEl.textContent = `Ready: Point camera at Candidate ${activeSlotIndex + 1} QR...`;
            }
        } catch (err) {
            try {
                await slotScannerInstance.start(
                    { facingMode: "user" },
                    config,
                    onScanSuccess,
                    onScanFailure
                );
                if (statusEl) {
                    statusEl.textContent = `Ready: Point camera at Candidate ${activeSlotIndex + 1} QR...`;
                }
            } catch (fallbackErr) {
                isSlotScanning = false;
                console.error("Camera access failed:", fallbackErr);
                if (statusEl) {
                    statusEl.textContent = "Camera error: " + (fallbackErr?.message || "Could not open camera");
                    statusEl.className = "mt-3 text-xs font-mono text-red-400 text-center bg-red-950/40 border border-red-800 px-3 py-2 rounded-xl w-full truncate";
                }
            }
        }
    }

    if (btnOpenScanner) {
        btnOpenScanner.addEventListener('click', startSlotScanner);
    }

    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', stopSlotScanner);
    }
}
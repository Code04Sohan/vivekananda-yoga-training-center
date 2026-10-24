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
            const val = input.value.trim();
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
let lastScannedTrack = null;
let lastScannedTime = 0;

function playCandidateTone() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(987, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
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
    return { trackNo, name, dob };
}

function resetSlotScannerActiveIndex() {
    setActiveSlot(0);
}

function setActiveSlot(index) {
    const totalSlots = 5;
    activeSlotIndex = Math.max(0, Math.min(index, totalSlots - 1));

    const slotBoxes = document.querySelectorAll('.slot-box');
    const badge = document.getElementById('slot-qr-target-badge');

    if (badge) {
        badge.textContent = `SLOT ${activeSlotIndex + 1}`;
    }

    slotBoxes.forEach((box, i) => {
        const label = box.querySelector('.slot-label');
        if (i === activeSlotIndex) {
            box.classList.remove('border-slate-800', 'bg-slate-950');
            box.classList.add('border-brand-500', 'bg-slate-900/90', 'ring-1', 'ring-brand-500/50');
            if (label) {
                label.textContent = `Candidate ${i + 1} (Active)`;
                label.classList.remove('text-slate-400');
                label.classList.add('text-brand-400');
            }
        } else {
            box.classList.remove('border-brand-500', 'bg-slate-900/90', 'ring-1', 'ring-brand-500/50');
            box.classList.add('border-slate-800', 'bg-slate-950');
            if (label) {
                label.textContent = `Candidate ${i + 1}`;
                label.classList.remove('text-brand-400');
                label.classList.add('text-slate-400');
            }
        }
    });
}

function initCandidateSlotScanner() {
    const btnToggle = document.getElementById('btn-toggle-slot-qr');
    const drawer = document.getElementById('slot-qr-drawer');
    const btnClose = document.getElementById('btn-close-slot-qr');
    const statusEl = document.getElementById('slot-qr-status');
    const btnIcon = document.getElementById('slot-qr-btn-icon');
    const btnText = document.getElementById('slot-qr-btn-text');
    const slotBoxes = document.querySelectorAll('.slot-box');
    const inputs = document.querySelectorAll('.queue-input');
    const previews = document.querySelectorAll('.slot-name-preview');

    if (!btnToggle || !drawer) return;

    // Set initial active slot (Slot 1)
    setActiveSlot(0);

    // Slot click selection & individual clear buttons
    slotBoxes.forEach((box, index) => {
        box.addEventListener('click', (e) => {
            if (e.target.closest('.btn-clear-slot')) {
                // Clear button clicked
                if (inputs[index]) inputs[index].value = '';
                if (previews[index]) previews[index].textContent = '';
                setActiveSlot(index);
                if (inputs[index]) inputs[index].focus();
                return;
            }
            setActiveSlot(index);
            if (inputs[index] && e.target !== inputs[index]) {
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
        drawer.classList.add('hidden');
        if (btnText) btnText.textContent = "Open Scanner";
        if (btnIcon) btnIcon.textContent = "📷";
        btnToggle.classList.remove('bg-red-950/60', 'text-red-300', 'border-red-700');
        btnToggle.classList.add('bg-brand-600/20', 'text-brand-300', 'border-brand-500/40');
    }

    async function startSlotScanner() {
        drawer.classList.remove('hidden');
        if (btnText) btnText.textContent = "Close Scanner";
        if (btnIcon) btnIcon.textContent = "✕";
        btnToggle.classList.remove('bg-brand-600/20', 'text-brand-300', 'border-brand-500/40');
        btnToggle.classList.add('bg-red-950/60', 'text-red-300', 'border-red-700');

        if (statusEl) {
            statusEl.textContent = "Requesting camera access...";
            statusEl.className = "mt-2 text-[11px] text-slate-400 text-center font-mono truncate px-1";
        }

        if (typeof Html5Qrcode === 'undefined') {
            if (statusEl) {
                statusEl.textContent = "QR library failed to load. Check internet connection.";
                statusEl.className = "mt-2 text-[11px] text-red-400 text-center font-mono truncate px-1";
            }
            return;
        }

        if (!slotScannerInstance) {
            slotScannerInstance = new Html5Qrcode("slot-qr-reader");
        }

        const config = {
            fps: 10,
            qrbox: { width: 220, height: 220 },
            aspectRatio: 1.0
        };

        const onScanSuccess = (decodedText) => {
            if (!isSlotScanning) return;
            const parsed = parseCandidateQR(decodedText);
            if (!parsed) {
                if (statusEl) {
                    statusEl.textContent = "⚠️ Unrecognized QR. Point at Candidate QR.";
                    statusEl.className = "mt-2 text-[11px] text-amber-400 text-center font-mono truncate px-1";
                }
                return;
            }

            // De-bounce rapid consecutive frames of same QR
            const now = Date.now();
            if (parsed.trackNo === lastScannedTrack && (now - lastScannedTime) < 1500) {
                return;
            }
            lastScannedTrack = parsed.trackNo;
            lastScannedTime = now;

            // 1. Populate track_no in active slot input
            if (inputs[activeSlotIndex]) {
                inputs[activeSlotIndex].value = parsed.trackNo;
            }

            // 2. Display candidate name (+ optional dob) preview for stage manager verification
            if (previews[activeSlotIndex]) {
                const displayName = parsed.name ? (parsed.dob ? `👤 ${parsed.name} (${parsed.dob})` : `👤 ${parsed.name}`) : `Candidate #${parsed.trackNo}`;
                previews[activeSlotIndex].textContent = displayName;
            }

            // 3. Audio & visual feedback
            playCandidateTone();
            const currentBox = slotBoxes[activeSlotIndex];
            if (currentBox) {
                currentBox.classList.add('border-emerald-500', 'bg-emerald-950/30');
                setTimeout(() => {
                    currentBox.classList.remove('border-emerald-500', 'bg-emerald-950/30');
                }, 400);
            }

            if (statusEl) {
                statusEl.textContent = `✓ Slot ${activeSlotIndex + 1} filled: #${parsed.trackNo} (${parsed.name || 'Candidate'})`;
                statusEl.className = "mt-2 text-[11px] text-emerald-400 text-center font-mono truncate px-1";
            }

            // 4. Auto-advance to next empty slot (or loop to next slot)
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

            setActiveSlot(nextSlot);
        };

        try {
            isSlotScanning = true;
            await slotScannerInstance.start(
                { facingMode: "environment" },
                config,
                onScanSuccess,
                () => {}
            );
            if (statusEl) {
                statusEl.textContent = "Ready: Point camera at Candidate QR...";
            }
        } catch (err) {
            // Environment camera unavailable (e.g. PC webcam), fallback to user facingMode
            try {
                await slotScannerInstance.start(
                    { facingMode: "user" },
                    config,
                    onScanSuccess,
                    () => {}
                );
                if (statusEl) {
                    statusEl.textContent = "Ready: Point camera at Candidate QR...";
                }
            } catch (fallbackErr) {
                isSlotScanning = false;
                console.error("Camera access failed:", fallbackErr);
                if (statusEl) {
                    statusEl.textContent = "Camera error: " + (fallbackErr?.message || "Could not open camera");
                    statusEl.className = "mt-2 text-[11px] text-red-400 text-center font-mono truncate px-1";
                }
            }
        }
    }

    btnToggle.addEventListener('click', () => {
        if (isSlotScanning) {
            stopSlotScanner();
        } else {
            startSlotScanner();
        }
    });

    if (btnClose) {
        btnClose.addEventListener('click', stopSlotScanner);
    }
}
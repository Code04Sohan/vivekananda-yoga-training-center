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
                document.getElementById('live-queue-tbody').innerHTML = `<tr><td colspan="7" class="p-8 text-red-500 font-bold uppercase tracking-widest bg-red-950/20 rounded">❌ You are not assigned to an active mat. Please wait for the Admin.</td></tr>`;
                
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
            document.getElementById('live-queue-tbody').innerHTML = `<tr><td colspan="7" class="p-8 text-gray-500 italic">Select a Mat to view its live queue.</td></tr>`;
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
            }

            // --- THE STRICT REJECTION FIX ---
            // If even ONE track number had an error, abort the entire batch!
            if (errorMessage) {
                alert("⚠️ BATCH PUSH REJECTED!\nNone of the candidates were pushed. Please fix the following errors and try again:\n\n" + errorMessage);
                btnPush.disabled = false;
                btnPush.innerText = "🚀 Push to Mat Queue";
                return; // This completely stops the function right here!
            }

            // If the code reaches here, ALL entered track numbers are 100% valid.
            btnPush.innerText = "⏳ Pushing Full Batch...";

            // --- THE PUSH ENGINE ---
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
                const queueRef = doc(db, 'scoring_queue', trackNo);
                batch.set(queueRef, {
                    trackNo: trackNo,
                    stageId: currentMatId,
                    batchNo: nextBatchNo,
                    timestamp: Date.now(),
                    j1_status: false,
                    j2_status: false,
                    j3_status: false,
                    j4_status: false,
                    j5_status: false
                });
            });

            await batch.commit();

            // Clear ALL inputs because we know the whole batch was successful
            inputs.forEach(input => input.value = '');
            
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
            tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-gray-500 italic">Queue is currently empty.</td></tr>`;
            return;
        }

        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        docs.sort((a, b) => {
            if (a.batchNo === b.batchNo) return a.timestamp - b.timestamp;
            return a.batchNo - b.batchNo;
        });

        docs.forEach(data => {
            const tr = document.createElement('tr');
            tr.className = "border-b border-gray-800 hover:bg-gray-800/50 transition-colors";
            
            const renderStatus = (status) => status 
                ? `<span class="text-green-500 font-black">✔</span>` 
                : `<span class="text-gray-600 font-bold">−</span>`;

            // NEW: The Cancel Button
            const cancelBtn = `<button class="btn-cancel-queue text-xs bg-red-900/30 hover:bg-red-800 text-red-400 hover:text-white px-2 py-1 rounded border border-red-800 transition-colors" data-track="${data.trackNo}">✖ Cancel</button>`;

            tr.innerHTML = `
                <td class="p-3 font-mono text-gray-500 text-xs">B-${data.batchNo}</td>
                <td class="p-3 font-mono text-blue-400 font-bold text-lg">${data.trackNo}</td>
                <td class="p-3">${renderStatus(data.j1_status)}</td>
                <td class="p-3">${renderStatus(data.j2_status)}</td>
                <td class="p-3">${renderStatus(data.j3_status)}</td>
                <td class="p-3">${renderStatus(data.j4_status)}</td>
                <td class="p-3">${renderStatus(data.j5_status)}</td>
                <td class="p-3 text-center">${cancelBtn}</td>
            `;
            tbody.appendChild(tr);
        });
    });
}
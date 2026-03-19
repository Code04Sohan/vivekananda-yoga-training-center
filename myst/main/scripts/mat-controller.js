// ============================================================================
// MODULE 4: MAT & STAFF ASSIGNMENT (THE REWRITE)
// Flat Queue Architecture
// ============================================================================

import { collection, doc, setDoc, deleteDoc, onSnapshot, getDocs, query, where, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

let unsubscribeMats = null;

export function initMatController() {
    const btnAddMat = document.getElementById('btn-add-mat');
    const matsContainer = document.getElementById('active-mats-container');

    if (!btnAddMat || !matsContainer) return;

    // 🛡️ THE ARMOR: Prevent the "6x Prompt" Bug
    if (btnAddMat.dataset.listenerAttached !== 'true') {
        btnAddMat.addEventListener('click', async () => {
            const matId = prompt("Enter Mat Number (e.g., 1, 2, 3):");
            if (!matId) return;

            const matRef = doc(db, 'active_mats', `mat_${matId}`);
            try {
                // NEW: We only create the structure for the staff. No more playlists or batches!
                await setDoc(matRef, {
                    matNumber: matId,
                    status: 'setting_up',
                    coordinator: "", 
                    headJudge: "",
                    panelJudges: ["", "", "", ""],
                    createdAt: new Date().toISOString()
                });
            } catch (error) {
                console.error("Error creating mat:", error);
            }
        });
        
        btnAddMat.dataset.listenerAttached = 'true';
    }

    if (unsubscribeMats) unsubscribeMats();

    unsubscribeMats = onSnapshot(collection(db, 'active_mats'), (snapshot) => {
        const matsContainer = document.getElementById('active-mats-container');
        if (!matsContainer) return;

        // Track ALL busy staff (Coordinators AND Judges)
        let busyStaff = new Set();
        snapshot.forEach(matDoc => {
            const data = matDoc.data();
            if (data.coordinator) busyStaff.add(data.coordinator);
            if (data.headJudge) busyStaff.add(data.headJudge);
            if (data.panelJudges) {
                data.panelJudges.forEach(jId => { if (jId) busyStaff.add(jId); });
            }
        });

        matsContainer.innerHTML = ''; 
        
        snapshot.forEach(matDoc => {
            renderMatCard(matDoc.id, matDoc.data(), busyStaff); 
        });
    });
}

async function renderMatCard(docId, data, busyStaff) {
    const container = document.getElementById('active-mats-container');
    const template = document.getElementById('mat-template');
    if (!template) return;

    const clone = template.cloneNode(true);
    clone.style.display = 'block';
    clone.id = `ui-${docId}`;
    clone.querySelector('.mat-number').textContent = data.matNumber;

    // --- POPULATE STAGE COORDINATOR DROPDOWN ---
    const coordSelect = clone.querySelector('.select-coordinator');
    try {
        const coordQuery = query(collection(db, 'users'), where('role', '==', 'STAGE_MGR'));
        const coordSnap = await getDocs(coordQuery);
        let coordOptions = '<option value="">-- Select Coordinator --</option>';
        
        coordSnap.forEach(cDoc => {
            const cId = cDoc.id;
            const cName = cDoc.data().name || cDoc.data().email;
            const isAssignedHere = (data.coordinator === cId);
            
            if (!busyStaff.has(cId) || isAssignedHere) {
                coordOptions += `<option value="${cId}">${cName}</option>`;
            }
        });
        coordSelect.innerHTML = coordOptions;
        if (data.coordinator) coordSelect.value = data.coordinator;
    } catch (err) { console.error("Error loading coordinators:", err); }

    // --- POPULATE JUDGE DROPDOWNS ---
    const headSelect = clone.querySelector('.select-judge-head');
    const panelSelects = clone.querySelectorAll('.select-judge-panel');
    try {
        const judgesQuery = query(collection(db, 'users'), where('role', '==', 'JUDGE'));
        const judgesSnap = await getDocs(judgesQuery);
        let judgeOptions = '<option value="">-- Select Judge --</option>';
        
        judgesSnap.forEach(jDoc => {
            const jId = jDoc.id;
            const jName = jDoc.data().name || jDoc.data().email;
            const isAssignedHere = (data.headJudge === jId) || (data.panelJudges && data.panelJudges.includes(jId));
            
            if (!busyStaff.has(jId) || isAssignedHere) {
                judgeOptions += `<option value="${jId}">${jName}</option>`;
            }
        });
        
        headSelect.innerHTML = judgeOptions;
        panelSelects.forEach(s => s.innerHTML = judgeOptions);
        
        if (data.headJudge) headSelect.value = data.headJudge;
        if (data.panelJudges && data.panelJudges.length === 4) {
            panelSelects.forEach((s, i) => s.value = data.panelJudges[i] || "");
        }
    } catch (err) { console.error("Error loading judges:", err); }

    // --- BUTTON BINDINGS ---
    clone.querySelector('.btn-lock-judges').onclick = () => lockStaffToMat(docId, clone);
    clone.querySelector('.btn-close-mat').onclick = () => closeMat(docId);
    
    // ==========================================
    // NEW: VISUAL LOCKDOWN (Atomic Workflow)
    // ==========================================
    if (data.status === 'ready') {
        // 1. Add glowing 'LOCKED' badge to the Mat Header
        const header = clone.querySelector('.bg-gray-950');
        header.innerHTML += `<div class="bg-green-900/40 text-green-400 border border-green-500/50 px-3 py-1 rounded text-xs font-black tracking-widest flex items-center shadow-[0_0_15px_rgba(34,197,94,0.3)]"><span class="mr-2 text-sm">🔒</span> LIVE & LOCKED</div>`;

        // 2. Disable & Blur all Dropdowns
        const allSelects = clone.querySelectorAll('select');
        allSelects.forEach(select => {
            select.disabled = true;
            select.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-950');
        });

        // 3. Disable the Lock Button so it can't be clicked again
        const lockBtn = clone.querySelector('.btn-lock-judges');
        lockBtn.disabled = true;
        lockBtn.innerText = "PANEL SECURED";
        lockBtn.classList.replace('bg-green-700', 'bg-gray-800');
        lockBtn.classList.replace('hover:bg-green-600', 'hover:bg-gray-800');
        lockBtn.classList.replace('text-white', 'text-gray-500');
        lockBtn.classList.replace('shadow', 'shadow-none');
        lockBtn.classList.add('cursor-not-allowed', 'border', 'border-gray-700');
    }

    container.appendChild(clone);
}

// Lock all 6 Staff Members (1 Coordinator + 5 Judges)
async function lockStaffToMat(docId, cardElement) {
    const coordinator = cardElement.querySelector('.select-coordinator').value;
    const headJudge = cardElement.querySelector('.select-judge-head').value;
    const panelJudges = Array.from(cardElement.querySelectorAll('.select-judge-panel')).map(s => s.value);

    if (!coordinator || !headJudge || panelJudges.includes("")) {
        alert("Please assign 1 Coordinator and all 5 Judges before locking.");
        return;
    }

    try {
        await updateDoc(doc(db, 'active_mats', docId), {
            coordinator: coordinator,
            headJudge: headJudge,
            panelJudges: panelJudges,
            status: 'ready'
        });
        alert("✅ Staff Panel securely locked to Mat.");
    } catch (error) {
        console.error("Error locking staff:", error);
    }
}

// Teardown Mat (Simplified: Just delete the document!)
async function closeMat(docId) {
    if (confirm("Are you sure you want to close this mat? This will release all assigned staff.")) {
        try {
            await deleteDoc(doc(db, 'active_mats', docId));
        } catch (error) {
            console.error("Error closing mat:", error);
            alert("Failed to safely close the mat.");
        }
    }
}
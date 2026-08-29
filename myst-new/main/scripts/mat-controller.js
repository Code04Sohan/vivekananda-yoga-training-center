// ============================================================================
// MODULE 4: MAT & STAFF ASSIGNMENT (THE REWRITE)
// Flat Queue Architecture
// ============================================================================

import { collection, doc, setDoc, deleteDoc, onSnapshot, getDocs, query, where, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

let unsubscribeMats = null;
let unsubscribeStaff = null;
let staffCache = [];

export function initMatController() {
    const btnAddMat = document.getElementById('btn-add-mat');
    const matsContainer = document.getElementById('active-mats-container');

    if (!btnAddMat || !matsContainer) return;

    if (!unsubscribeStaff) {
        unsubscribeStaff = onSnapshot(collection(db, 'users'), (snapshot) => {
            staffCache = [];
            snapshot.forEach(doc => {
                if (doc.data().role === 'STAGE_MGR' || doc.data().role === 'JUDGE') {
                    staffCache.push({ id: doc.id, ...doc.data() });
                }
            });
            // Staff updated, but we let the mat snapshot handle rendering
        });
    }

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

        // --- DOM DIFFING ---
        const existingCards = {};
        Array.from(matsContainer.children).forEach(card => {
            if (card.id && card.id.startsWith('ui-')) {
                existingCards[card.id.replace('ui-', '')] = card;
            }
        });

        snapshot.docs.forEach((matDoc, index) => {
            let card = existingCards[matDoc.id];
            
            // If it doesn't exist, create it from template
            if (!card) {
                const template = document.getElementById('mat-template');
                card = template.cloneNode(true);
                card.style.display = 'block';
                card.id = `ui-${matDoc.id}`;
                matsContainer.appendChild(card);
            }

            // Sync the content of the card synchronously
            syncMatCard(card, matDoc.id, matDoc.data(), busyStaff);

            // Reorder if needed
            if (matsContainer.children[index] !== card) {
                matsContainer.insertBefore(card, matsContainer.children[index]);
            }

            delete existingCards[matDoc.id];
        });

        // Remove deleted mats
        Object.values(existingCards).forEach(card => card.remove());
    });
}

function syncMatCard(clone, docId, data, busyStaff) {
    clone.querySelector('.mat-number').textContent = data.matNumber;

    // --- PANEL SIZE LOGIC ---
    const panelSizeSelect = clone.querySelector('.select-panel-size');
    if (panelSizeSelect) {
        if (data.panelSize && panelSizeSelect.value !== data.panelSize.toString()) {
            panelSizeSelect.value = data.panelSize.toString();
        }
        
        if (!panelSizeSelect.dataset.listenerAttached) {
            panelSizeSelect.addEventListener('change', (e) => {
                const size = e.target.value;
                const panelSelects = clone.querySelectorAll('.select-judge-panel');
                const j4 = panelSelects[2].parentElement;
                const j5 = panelSelects[3].parentElement;
                if (size === '3') {
                    j4.style.display = 'none';
                    j5.style.display = 'none';
                    panelSelects[2].value = "";
                    panelSelects[3].value = "";
                } else {
                    j4.style.display = 'flex';
                    j5.style.display = 'flex';
                }
            });
            panelSizeSelect.dataset.listenerAttached = 'true';
            setTimeout(() => panelSizeSelect.dispatchEvent(new Event('change')), 0);
        }
    }

    // --- POPULATE STAGE COORDINATOR DROPDOWN ---
    const coordSelect = clone.querySelector('.select-coordinator');
    let coordOptions = '<option value="">-- Select Coordinator --</option>';
    
    staffCache.filter(u => u.role === 'STAGE_MGR').forEach(cDoc => {
        const cId = cDoc.id;
        const cName = cDoc.name || cDoc.email;
        const isAssignedHere = (data.coordinator === cId);
        
        if (!busyStaff.has(cId) || isAssignedHere) {
            coordOptions += `<option value="${cId}">${cName}</option>`;
        }
    });
    
    // Only update innerHTML if changed to preserve focus/selection state during typing
    if (coordSelect.innerHTML !== coordOptions) coordSelect.innerHTML = coordOptions;
    if (data.coordinator && coordSelect.value !== data.coordinator) coordSelect.value = data.coordinator;

    // --- POPULATE JUDGE DROPDOWNS ---
    const headSelect = clone.querySelector('.select-judge-head');
    const panelSelects = clone.querySelectorAll('.select-judge-panel');
    let judgeOptions = '<option value="">-- Select Judge --</option>';
    
    staffCache.filter(u => u.role === 'JUDGE').forEach(jDoc => {
        const jId = jDoc.id;
        const jName = jDoc.name || jDoc.email;
        const isAssignedHere = (data.headJudge === jId) || (data.panelJudges && data.panelJudges.includes(jId));
        
        if (!busyStaff.has(jId) || isAssignedHere) {
            judgeOptions += `<option value="${jId}">${jName}</option>`;
        }
    });
    
    if (headSelect.innerHTML !== judgeOptions) headSelect.innerHTML = judgeOptions;
    if (data.headJudge && headSelect.value !== data.headJudge) headSelect.value = data.headJudge;
    
    panelSelects.forEach((s, i) => {
        if (s.innerHTML !== judgeOptions) s.innerHTML = judgeOptions;
        if (data.panelJudges && data.panelJudges.length === 4 && s.value !== data.panelJudges[i]) {
            s.value = data.panelJudges[i] || "";
        }
    });

    // --- BUTTON BINDINGS ---
    clone.querySelector('.btn-lock-judges').onclick = () => lockStaffToMat(docId, clone);
    clone.querySelector('.btn-close-mat').onclick = () => closeMat(docId);
    
    // ==========================================
    // NEW: VISUAL LOCKDOWN (Atomic Workflow)
    // ==========================================
    const header = clone.querySelector('.bg-gray-950');
    const lockBtn = clone.querySelector('.btn-lock-judges');
    const allSelects = clone.querySelectorAll('select');

    if (data.status === 'ready') {
        // 1. Add glowing 'LOCKED' badge to the Mat Header
        if (!header.querySelector('.locked-badge')) {
            header.innerHTML += `<div class="locked-badge bg-green-900/40 text-green-400 border border-green-500/50 px-3 py-1 rounded text-xs font-black tracking-widest flex items-center shadow-[0_0_15px_rgba(34,197,94,0.3)]"><span class="mr-2 text-sm">🔒</span> LIVE & LOCKED</div>`;
        }

        // 2. Disable & Blur all Dropdowns
        allSelects.forEach(select => {
            select.disabled = true;
            select.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-950');
        });

        // 3. Disable the Lock Button so it can't be clicked again
        lockBtn.disabled = true;
        lockBtn.innerText = "PANEL SECURED";
        lockBtn.classList.replace('bg-green-700', 'bg-gray-800');
        lockBtn.classList.replace('hover:bg-green-600', 'hover:bg-gray-800');
        lockBtn.classList.replace('text-white', 'text-gray-500');
        lockBtn.classList.replace('shadow', 'shadow-none');
        lockBtn.classList.add('cursor-not-allowed', 'border', 'border-gray-700');
    } else {
        const badge = header.querySelector('.locked-badge');
        if (badge) badge.remove();

        allSelects.forEach(select => {
            select.disabled = false;
            select.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-gray-950');
        });

        lockBtn.disabled = false;
        lockBtn.innerText = "Lock Panel";
        lockBtn.classList.replace('bg-gray-800', 'bg-green-700');
        lockBtn.classList.replace('hover:bg-gray-800', 'hover:bg-green-600');
        lockBtn.classList.replace('text-gray-500', 'text-white');
        lockBtn.classList.replace('shadow-none', 'shadow');
        lockBtn.classList.remove('cursor-not-allowed', 'border', 'border-gray-700');
    }
}

// Lock all Staff Members
async function lockStaffToMat(docId, cardElement) {
    const coordinator = cardElement.querySelector('.select-coordinator').value;
    const headJudge = cardElement.querySelector('.select-judge-head').value;
    const panelJudges = Array.from(cardElement.querySelectorAll('.select-judge-panel')).map(s => s.value);
    const panelSize = parseInt(cardElement.querySelector('.select-panel-size')?.value || "5");

    const requiredPanelCount = panelSize === 3 ? 2 : 4;
    const activePanelJudges = panelJudges.slice(0, requiredPanelCount);

    if (!coordinator || !headJudge || activePanelJudges.includes("")) {
        alert(`Please assign 1 Coordinator and all ${panelSize} Judges before locking.`);
        return;
    }

    // ==========================================
    // NEW: DUPLICATE JUDGE FAIL-SAFE
    // ==========================================
    const allJudges = [headJudge, ...activePanelJudges]; 
    const uniqueJudges = new Set(allJudges);       
    
    if (uniqueJudges.size !== panelSize) {
        alert("⚠️ DUPLICATE JUDGE DETECTED!\nYou cannot assign the same judge to multiple seats on the same mat. Please correct the panel.");
        return;
    }
    // ==========================================

    try {
        await updateDoc(doc(db, 'active_mats', docId), {
            coordinator: coordinator,
            headJudge: headJudge,
            panelJudges: panelJudges, // Keep all 4 in array, but j4/j5 will just be "" if panelSize is 3
            panelSize: panelSize,
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
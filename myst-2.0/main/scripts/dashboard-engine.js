// ============================================================================
// MODULE 5: LIVE GLOBAL LEADERBOARD & AUDIT
// Merged Scorecard Architecture with Soft Deletion & Matrix Editing
// ============================================================================

import { collection, onSnapshot, doc, updateDoc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

let allLiveScores = [];
let currentEditingScoreId = null;
let unsubscribeFilters = null;
let unsubscribeScores = null;

export function initLiveDashboard() {
    const tbody = document.getElementById('live-dashboard-tbody');
    if (!tbody) return;

    if (unsubscribeFilters) unsubscribeFilters();
    if (unsubscribeScores) unsubscribeScores();

    // 1. Fetch system metadata for filters instead of ALL candidates!
    unsubscribeFilters = onSnapshot(doc(db, 'system_metadata', 'filters'), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            updateFilters(data.groups || [], data.genders || [], data.districts || []);
            renderDashboard();
        }
    });

    // 2. Real-Time Listener on Scores
    unsubscribeScores = onSnapshot(collection(db, 'scores'), (snapshot) => {
        allLiveScores = [];
        snapshot.forEach(doc => { allLiveScores.push({ id: doc.id, ...doc.data() }); });
        renderDashboard();
    });

    // 3. Filter Listeners
    document.getElementById('dash-group-select')?.addEventListener('change', renderDashboard);
    document.getElementById('dash-gender-select')?.addEventListener('change', renderDashboard);
    document.getElementById('dash-district-select')?.addEventListener('change', renderDashboard);
    // Search Event Listener
    document.getElementById('dash-search-track')?.addEventListener('input', renderDashboard);
    // Backup and Restore Buttons Listner
    document.getElementById('btn-backup-scores')?.addEventListener('click', downloadScoresBackup);
    document.getElementById('file-restore-scores')?.addEventListener('change', restoreScoresBackup);

    // 4. Delegation & Modal Binding
    tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-admin-edit');
        if (btn) openOverrideModal(btn.dataset.id, btn.dataset.track);
    });

    document.getElementById('btn-close-modal')?.addEventListener('click', closeOverrideModal);
    document.getElementById('btn-save-admin-override')?.addEventListener('click', saveAdminOverride);
    document.getElementById('btn-void-score')?.addEventListener('click', voidScore);
    
    document.getElementById('btn-backup-scores')?.addEventListener('click', downloadScoresBackup);
    document.getElementById('file-restore-scores')?.addEventListener('change', restoreScoresBackup);
    
    // ADD THIS NEW INITIALIZER:
    setupWipeScoresModal();
}

// --- FILTERING ---

let activeFilters = { groups: [], genders: [], dists: [] }; // Cache for re-renders

function updateFilters(groups = [], genders = [], dists = []) {
    activeFilters = { groups, genders, dists };
    
    const selGroup = document.getElementById('dash-group-select');
    const selGender = document.getElementById('dash-gender-select');
    const selDist = document.getElementById('dash-district-select');
    if(!selGroup || !selGender || !selDist) return;

    const currGroup = selGroup.value;
    const currGender = selGender.value;
    const currDist = selDist.value;

    const fill = (el, arr, current, defaultText) => {
        el.innerHTML = `<option value="">-- ${defaultText} --</option>`;
        [...arr].sort().forEach(i => el.innerHTML += `<option value="${i}">${i}</option>`);
        el.value = arr.includes(current) ? current : "";
    };

    fill(selGroup, groups, currGroup, 'All Groups');
    fill(selGender, genders, currGender, 'All Genders');
    fill(selDist, dists, currDist, 'All Districts');
}

// --- RENDERING ---

function renderDashboard() {
    const tbody = document.getElementById('live-dashboard-tbody');
    const filterGroup = document.getElementById('dash-group-select')?.value || "";
    const filterGender = document.getElementById('dash-gender-select')?.value || "";
    const filterDist = document.getElementById('dash-district-select')?.value || "";

    const filterTrack = document.getElementById('dash-search-track')?.value.toLowerCase().trim() || "";

    tbody.innerHTML = '';

    // Map Scores and Apply Filters
    const processedScores = allLiveScores.map(score => {
        // Use denormalized data directly from the score document
        const sGroup = score.group || "";
        const sGender = score.gender || "";
        const sDist = score.district || score.state || "";

        // HELPER: Sum judge's total (Now includes a3)
        const getSum = (j) => {
            if (score[`${j}_a1`] === undefined) return null; // Distinguish between 0 and unassigned
            return (parseFloat(score[`${j}_a1`])||0) + (parseFloat(score[`${j}_a2`])||0) + (parseFloat(score[`${j}_a3`])||0) + (parseFloat(score[`${j}_opt`])||0);
        };
        
        const marks = {
            J1: getSum('j1'), J2: getSum('j2'), J3: getSum('j3'), J4: getSum('j4'), J5: getSum('j5')
        };

        // --- FIX OLYMPIC MATH BUG & ADD 3-JUDGE MODE ---
        const panelSize = score.panelSize || 5;
        let validScoresCount = 0;
        Object.values(marks).forEach(val => { if (val !== null) validScoresCount++; });
        
        const isFullyScored = validScoresCount >= panelSize;
        
        let olympicSum = 0;
        if (isFullyScored) {
            const panel = Object.values(marks).filter(v => v !== null);
            if (panelSize === 3) {
                olympicSum = panel.reduce((a,b)=>a+b, 0); // No discards
            } else {
                olympicSum = panel.reduce((a,b)=>a+b, 0) - Math.max(...panel) - Math.min(...panel);
            }
        }

        return { ...score, candidateName: score.candidateName, sGroup, sGender, sDist, marks, olympicSum, isFullyScored };
    }).filter(s => {
        // SOFT DELETION CHECK: Hide voided scores
        if (s.status === 'void' || s.status === 'deleted') return false; 

        const matchGrp = filterGroup === "" || s.sGroup === filterGroup;
        const matchGen = filterGender === "" || s.sGender === filterGender;
        const matchDist = filterDist === "" || s.sDist === filterDist;

        const matchTrack = filterTrack === "" || String(s.id).toLowerCase().includes(filterTrack);
        return matchGrp && matchGen && matchDist && matchTrack;
    });

    // Sort by Olympic Sum Descending
    processedScores.sort((a, b) => b.olympicSum - a.olympicSum);

    processedScores.forEach(score => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/50 transition-colors group";
        
        // Audit String (Shows individual judge totals)
        const auditText = Object.entries(score.marks)
            .filter(([judge, mark]) => mark !== null) // Hide ghost judges
            .map(([judge, mark]) => `<span class="font-bold text-slate-500 text-xs uppercase mr-1 tracking-wider">${judge}:</span> <span class="${mark === 0 ? 'text-red-400 font-bold' : 'text-brand-300 font-medium'} mr-3 inline-block bg-slate-950/50 px-2 py-0.5 rounded border border-slate-800">${mark.toFixed(1)}</span>`)
            .join('');

        // PUBLISHED LOCK
        const isPublished = score.status === 'published' || score.status === 'OFFICIAL';
        const actionHtml = isPublished 
            ? `<span class="text-[10px] text-emerald-400 font-bold border border-emerald-800/50 bg-emerald-950/40 px-3 py-1.5 rounded-md uppercase tracking-widest flex items-center justify-center shadow-inner"><span class="mr-1.5">🔒</span> LOCKED</span>`
            : `<button class="btn-admin-edit bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-4 py-2 rounded-lg text-xs border border-slate-600 transition-colors uppercase font-bold tracking-wider shadow-lg flex items-center justify-center active:scale-95" data-id="${score.id}" data-track="${score.id}"><span class="mr-2">✏️</span> Edit</button>`;

        // If not fully scored, show "..."" instead of "0.00"
        const finalScoreText = score.isFullyScored ? score.olympicSum.toFixed(2) : '<span class="text-slate-600">...</span>';

        tr.innerHTML = `
            <td class="p-5 font-mono text-brand-400 font-bold text-lg tracking-widest">${score.id}</td>
            <td class="p-5 font-bold text-white text-base">
                ${score.candidateName || 'Unknown'} 
                <span class="block text-[10px] text-amber-500 font-bold tracking-widest uppercase mt-1 bg-amber-950/30 border border-amber-900/50 px-2 py-0.5 rounded w-fit">${score.division || 'Unassigned'}</span>
            </td>
            <td class="p-5">
                <div class="flex flex-wrap gap-y-2 justify-center">${auditText}</div>
            </td>
            <td class="p-5 text-right font-black text-emerald-400 text-xl tracking-tighter drop-shadow-md">${finalScoreText}</td>
            <td class="p-5">${actionHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

// --- ADMIN OVERRIDE MODAL LOGIC (5x4 Grid) ---

function openOverrideModal(scoreId, trackNo) {
    currentEditingScoreId = scoreId;
    const scoreData = allLiveScores.find(s => s.id === scoreId) || {};
    
    document.getElementById('edit-score-track').innerText = trackNo;
    const tableBody = document.getElementById('typo-matrix-table');
    
    let rowsHtml = '';
    ['j1', 'j2', 'j3', 'j4', 'j5'].forEach(j => {
        const isGhost = scoreData[`${j}_status`] === true && (scoreData[`${j}_a1`] === undefined); // Identify if ghost judge based on scoring status but no scores
        const disabledAttr = isGhost ? 'disabled' : '';
        const opc = isGhost ? 'opacity-30 grayscale cursor-not-allowed' : '';
        
        rowsHtml += `
        <tr class="hover:bg-slate-800/50 transition-colors border-b border-slate-800 ${opc}">
            <td class="p-3 font-bold text-slate-300 uppercase tracking-widest text-xs">${j}</td>
            <td class="p-3 text-center"><input type="number" step="0.1" id="edit-${j}_a1" value="${scoreData[`${j}_a1`] || ''}" class="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-center font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors" ${disabledAttr}></td>
            <td class="p-3 text-center"><input type="number" step="0.1" id="edit-${j}_a2" value="${scoreData[`${j}_a2`] || ''}" class="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-center font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors" ${disabledAttr}></td>
            <td class="p-3 text-center"><input type="number" step="0.1" id="edit-${j}_a3" value="${scoreData[`${j}_a3`] || ''}" class="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-center font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors" ${disabledAttr}></td>
            <td class="p-3 text-center"><input type="number" step="0.1" id="edit-${j}_opt" value="${scoreData[`${j}_opt`] || ''}" class="w-16 bg-brand-900/30 border border-brand-700/50 rounded-lg px-2 py-1.5 text-brand-300 font-bold text-center font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors" ${disabledAttr}></td>
        </tr>`;
    });
    tableBody.innerHTML = rowsHtml;
    document.getElementById('modal-edit-score').style.display = 'flex';
}

function closeOverrideModal() {
    document.getElementById('modal-edit-score').style.display = 'none';
    currentEditingScoreId = null;
}

async function saveAdminOverride() {
    if (!currentEditingScoreId) return;
    const btnSave = document.getElementById('btn-save-admin-override');
    btnSave.innerText = "⏳ Saving..."; btnSave.disabled = true;

    try {
        const updatePayload = {
            adminOverridden: true,
            updatedAt: new Date().toISOString()
        };

        // Extract all inputs 
        ['j1', 'j2', 'j3', 'j4', 'j5'].forEach(j => {
            ['a1', 'a2', 'a3', 'opt'].forEach(asan => { 
                const val = parseFloat(document.getElementById(`edit-${j}_${asan}`).value);
                if (!isNaN(val)) updatePayload[`${j}_${asan}`] = val;
            });
        });

        await updateDoc(doc(db, 'scores', currentEditingScoreId), updatePayload);
        closeOverrideModal();
    } catch (error) {
        console.error("Override failed:", error);
        alert("Failed to update score grid.");
    } finally {
        btnSave.innerText = "Save Override"; btnSave.disabled = false;
    }
}

// THE AUDIT TRAIL: Soft Deletion
async function voidScore() {
    if (!currentEditingScoreId) return;
    
    if(!confirm("Are you sure you want to void this scorecard? It will be removed from standings but kept in the database for auditing.")) return;

    try {
        await updateDoc(doc(db, 'scores', currentEditingScoreId), {
            status: 'void',
            voidedAt: new Date().toISOString()
        });
        closeOverrideModal();
    } catch(e) {
        console.error("Void failed:", e);
        alert("Failed to void score.");
    }
}

// GLOBAL WIPE: Delete all scorecards
// ==========================================
// WIPE MODAL LOGIC (Secure UI)
// ==========================================
function setupWipeScoresModal() {
    const btnTrigger = document.getElementById('btn-wipe-scores');
    const modal = document.getElementById('modal-wipe-scores');
    const inputConfirm = document.getElementById('input-confirm-wipe-scores');
    const btnCancel = document.getElementById('btn-cancel-wipe-scores');
    const btnExecute = document.getElementById('btn-execute-wipe-scores');
    const btnModalBackup = document.getElementById('btn-modal-backup-scores');

    if (!btnTrigger) return;

    // 1. Open Modal
    btnTrigger.addEventListener('click', () => {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        inputConfirm.value = '';
        btnExecute.disabled = true;
        btnExecute.classList.remove('animate-pulse');
    });

    // 2. Close Modal
    btnCancel.addEventListener('click', () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    });

    // 3. Bind the Big Backup Button inside the Modal (Reuses the existing backup logic)
    btnModalBackup.addEventListener('click', downloadScoresBackup);

    // 4. Validation Listener ("confirm" to unlock)
    inputConfirm.addEventListener('input', (e) => {
        if (e.target.value === 'confirm') {
            btnExecute.disabled = false;
            btnExecute.classList.add('animate-pulse');
        } else {
            btnExecute.disabled = true;
            btnExecute.classList.remove('animate-pulse');
        }
    });

    // 5. Execute the Wipe
    btnExecute.addEventListener('click', async () => {
        btnExecute.innerText = "⏳ Deleting...";
        btnExecute.disabled = true;

        try {
            const snap = await getDocs(collection(db, 'scores'));
            const batch = writeBatch(db);
            
            let count = 0;
            snap.forEach(d => {
                batch.delete(d.ref);
                count++;
            });

            await batch.commit();
            alert(`✅ Successfully deleted ${count} scorecards.`);
            
            // Auto-close modal on success
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        } catch (error) {
            console.error("Wipe failed:", error);
            alert("Failed to wipe scorecards.");
        } finally {
            btnExecute.innerText = "Wipe Scorecards";
            btnExecute.disabled = false;
            btnExecute.classList.remove('animate-pulse');
        }
    });
}

// ==========================================
// DISASTER RECOVERY: BACKUP & RESTORE
// ==========================================

async function downloadScoresBackup() {
    const btn = document.getElementById('btn-backup-scores');
    btn.innerText = "⏳ Generating...";
    btn.disabled = true;

    try {
        const snap = await getDocs(collection(db, 'scores'));
        if (snap.empty) {
            alert("No scores to backup!");
            return;
        }

        // 1. Package the database into a clean JSON array
        const backupData = [];
        snap.forEach(doc => {
            backupData.push({ id: doc.id, ...doc.data() });
        });

        const jsonString = JSON.stringify(backupData, null, 2);
        
        // 2. Generate a precise timestamp for the filename
        const now = new Date();
        const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
        const filename = `MYST_Raw_Scores_Backup_${timeStr}.json`;

        // 3. Trigger Browser Download
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        alert(`✅ Backup saved successfully: ${filename}`);
    } catch (error) {
        console.error("Backup failed:", error);
        alert("Failed to generate backup.");
    } finally {
        btn.innerText = "💾 Backup Scores (JSON)";
        btn.disabled = false;
    }
}

async function restoreScoresBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!confirm("⚠️ WARNING: Restoring this backup will inject all these scorecards back into the live database. Proceed?")) {
        event.target.value = ''; // Reset file input
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const backupData = JSON.parse(e.target.result);
            if (!Array.isArray(backupData)) throw new Error("Invalid backup file format.");

            // Use chunking to safely restore large backups (Firestore batch limit is 500)
            const CHUNK_SIZE = 400;
            let restoredCount = 0;

            for (let i = 0; i < backupData.length; i += CHUNK_SIZE) {
                const chunk = backupData.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);

                chunk.forEach(scoreObj => {
                    const docId = scoreObj.id;
                    const data = { ...scoreObj };
                    delete data.id; // Remove the injected ID before saving
                    
                    const docRef = doc(db, 'scores', docId);
                    batch.set(docRef, data); // Set will safely overwrite or create
                    restoredCount++;
                });

                await batch.commit();
            }

            alert(`✅ DISASTER RECOVERY COMPLETE. ${restoredCount} scorecards have been successfully injected back into the live database.`);
            event.target.value = ''; // Reset file input

        } catch (error) {
            console.error("Restore failed:", error);
            alert("❌ Failed to restore backup. Make sure you selected a valid JSON backup file.");
            event.target.value = '';
        }
    };
    
    reader.readAsText(file);
}
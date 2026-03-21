// ============================================================================
// MODULE 7: MASTER CANDIDATE MANAGER
// Single Database Architecture with Lifecycle Integration
// ============================================================================

import { collection, onSnapshot, doc, updateDoc, writeBatch, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

let allCandidates = [];

let unsubscribeCandidates = null;

export function initCandidateManager() {
    const tbody = document.getElementById('candidate-manager-tbody');
    const searchInput = document.getElementById('search-candidate');
    const filterCat = document.getElementById('filter-candidate-category');
    const filterGen = document.getElementById('filter-candidate-gender');
    const filterDist = document.getElementById('filter-candidate-district');
    
    if (!tbody) return;

    // If a listener is already running, kill it before making a new one!
    if (unsubscribeCandidates) {
        unsubscribeCandidates(); 
    }

    // 1. Real-time listener for ALL candidates
    unsubscribeCandidates = onSnapshot(collection(db, 'candidates'), (snapshot) => {
        allCandidates = [];
        snapshot.forEach(docSnap => {
            allCandidates.push({ id: docSnap.id, ...docSnap.data() });
        });
        
        // Auto-populate dropdowns based on actual data
        populateFilters(allCandidates, filterCat, filterGen, filterDist);
        
        // Render with current filters applied
        applyFilters();
    });

    // 2. Attach Listeners to Inputs & Dropdowns
    const triggerFilter = () => applyFilters();
    if (searchInput) searchInput.addEventListener('input', triggerFilter);
    if (filterCat) filterCat.addEventListener('change', triggerFilter);
    if (filterGen) filterGen.addEventListener('change', triggerFilter);
    if (filterDist) filterDist.addEventListener('change', triggerFilter);

    // 3. Event delegation for Action Buttons (Restore / Force DNS)
    tbody.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        if (!id) return;

        // Targeted Restore: Sends them back to Stage Manager but KEEPS their division
        if (e.target.classList.contains('btn-restore')) {
            if (confirm("Restore this candidate to 'Pending'? They will keep their assigned division and re-enter the Stage Manager pool for a rematch.")) {
                await updateCandidateStatus(id, 'pending');
            }
        } 
        // Force DNS: Admin manual override if a kid goes home sick before competing
        else if (e.target.classList.contains('btn-dns')) {
            if (confirm("Manually mark this candidate as DNS (Did Not Start)?")) {
                await updateCandidateStatus(id, 'DNS');
            }
        }
    });

    // 4. Factory Reset Modal Logic
    setupFactoryReset();
}

// --- FILTERING LOGIC ---

function populateFilters(candidates, catSelect, genSelect, distSelect) {
    const currCat = catSelect.value;
    const currGen = genSelect.value;
    const currDist = distSelect.value;

    const categories = new Set();
    const genders = new Set();
    const districts = new Set();

    candidates.forEach(c => {
        if (c.groupName) categories.add(c.groupName);
        if (c.gender) genders.add(c.gender);
        if (c.district) districts.add(c.district);
    });

    catSelect.innerHTML = '<option value="All">All Categories</option>';
    [...categories].sort().forEach(c => catSelect.innerHTML += `<option value="${c}">${c}</option>`);
    catSelect.value = categories.has(currCat) ? currCat : "All";

    genSelect.innerHTML = '<option value="All">All Genders</option>';
    [...genders].sort().forEach(g => genSelect.innerHTML += `<option value="${g}">${g}</option>`);
    genSelect.value = genders.has(currGen) ? currGen : "All";

    distSelect.innerHTML = '<option value="All">All Districts</option>';
    [...districts].sort().forEach(d => distSelect.innerHTML += `<option value="${d}">${d}</option>`);
    distSelect.value = districts.has(currDist) ? currDist : "All";
}

function applyFilters() {
    const term = document.getElementById('search-candidate').value.toLowerCase();
    const cat = document.getElementById('filter-candidate-category').value;
    const gen = document.getElementById('filter-candidate-gender').value;
    const dist = document.getElementById('filter-candidate-district').value;

    const filtered = allCandidates.filter(c => {
        const matchesSearch = c.trackNo.toLowerCase().includes(term) || c.name.toLowerCase().includes(term);
        const matchesCat = cat === "All" || c.groupName === cat;
        const matchesGen = gen === "All" || c.gender === gen;
        const matchesDist = dist === "All" || c.district === dist;
        
        return matchesSearch && matchesCat && matchesGen && matchesDist;
    });

    renderCandidateTable(filtered);
}

// --- RENDERING & DB UPDATES ---
function renderCandidateTable(candidates) {
    const tbody = document.getElementById('candidate-manager-tbody');
    tbody.innerHTML = '';

    // --- SMART TWO-STEP SORTING ---
    candidates.sort((a, b) => {
        const divA = a.division || 'Unassigned';
        const divB = b.division || 'Unassigned';

        // 1. Sort by Division (Smart Alphanumeric Sort)
        // This perfectly handles "Group 1", "Group 2", "A", "B", etc.
        const divCompare = divA.localeCompare(divB, undefined, { numeric: true, sensitivity: 'base' });
        
        // If divisions are different, group them by division
        if (divCompare !== 0) {
            return divCompare;
        }
        
        // 2. If they are in the same division, sort by Track Number
        return parseInt(a.trackNo) - parseInt(b.trackNo);
    });

    candidates.forEach(c => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-800 transition-colors border-b border-gray-800"; 
        
        // NEW DYNAMIC STATUS LOGIC: Are all 5 locks true?
        const isFullyScored = c.j1_status && c.j2_status && c.j3_status && c.j4_status && c.j5_status;
        
        let displayStatus = 'pending';
        if (c.status === 'DNS') displayStatus = 'DNS';
        else if (isFullyScored) displayStatus = 'scored';

        // Render the Badge based on the dynamic status
        let statusBadge = `<span class="bg-gray-700 text-gray-300 px-2 py-1 rounded text-[10px] uppercase tracking-wider font-bold">Unknown</span>`;
        if (displayStatus === 'pending') statusBadge = `<span class="bg-yellow-900/80 text-yellow-300 px-2 py-1 rounded text-[10px] uppercase tracking-wider font-bold">🟡 Pending</span>`;
        if (displayStatus === 'scored') statusBadge = `<span class="bg-green-900/80 text-green-300 px-2 py-1 rounded text-[10px] uppercase tracking-wider font-bold shadow-[0_0_8px_rgba(22,163,74,0.4)]">🟢 Scored</span>`;
        if (displayStatus === 'DNS') statusBadge = `<span class="bg-red-900/80 text-red-300 px-2 py-1 rounded text-[10px] uppercase tracking-wider font-bold">🔴 DNS</span>`;

        // The Contextual Action Buttons
        let actionButtons = '';
        if (displayStatus === 'scored' || displayStatus === 'DNS') {
            actionButtons = `<button class="btn-restore bg-gray-700 hover:bg-gray-600 border border-gray-500 text-white px-3 py-1 rounded text-xs transition-transform active:scale-95 flex items-center shadow-lg" data-id="${c.id}">♻️ Hard Reset</button>`;
        } else if (displayStatus === 'pending') {
            actionButtons = `<button class="btn-dns bg-red-900/30 hover:bg-red-900 border border-red-800 text-red-400 hover:text-white px-3 py-1 rounded text-xs transition-colors" data-id="${c.id}">Force DNS</button>`;
        }

        const divisionDisplay = c.division && c.division !== 'Unassigned' 
            ? `<span class="text-yellow-500 font-bold text-xs block">${c.division}</span>` 
            : `<span class="text-gray-600 text-xs italic block">Unassigned</span>`;

        const coachDisplay = `<span class="text-purple-400 text-[10px] uppercase tracking-wider font-bold block mt-1">Coach: ${c.coachName || 'Independent'}</span>`; //UPDATE_TODAY

        tr.innerHTML = `
            <td class="p-4 font-mono text-blue-400 font-bold">${c.trackNo}</td>
            <td class="p-4 font-bold text-white">
                ${c.name} 
                ${divisionDisplay}
                ${coachDisplay} </td>
            <td class="p-4 text-gray-400 font-semibold">${c.gender || 'N/A'}</td>
            <td class="p-4 text-gray-400">${c.district || 'N/A'}</td>
            <td class="p-4 text-gray-400 text-sm">${c.groupName}</td>
            <td class="p-4">${statusBadge}</td>
            <td class="p-4 text-right flex justify-end">${actionButtons}</td>
        `;
        tbody.appendChild(tr);
    });
}
// 3. The Surgical Update
// 3. The Surgical Update & Hard Reset
async function updateCandidateStatus(docId, newStatus) {
    try {
        const candidateRef = doc(db, 'candidates', docId);
        
        if (newStatus === 'pending') {
            // HARD RESET: Wipe the status AND all 5 double-locks!
            await updateDoc(candidateRef, {
                status: 'pending',
                j1_status: false,
                j2_status: false,
                j3_status: false,
                j4_status: false,
                j5_status: false,
                updatedAt: new Date().toISOString()
            });
            // Delete their scorecard completely so judges start fresh!
            await deleteDoc(doc(db, 'scores', docId));
            alert("Candidate has been completely reset. You may now push them to the queue again.");
            
        } else {
            // FORCE DNS
            await updateDoc(candidateRef, {
                status: newStatus,
                updatedAt: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error("Error updating candidate:", error);
        alert("Failed to update candidate status.");
    }
}
// --- FACTORY RESET LOGIC ---

function setupFactoryReset() {
    const btnTrigger = document.getElementById('btn-trigger-factory-reset');
    const modal = document.getElementById('modal-factory-reset');
    const inputConfirm = document.getElementById('input-confirm-reset');
    const btnCancel = document.getElementById('btn-cancel-reset');
    const btnExecute = document.getElementById('btn-execute-reset');
    const btnGotoBackup = document.getElementById('btn-goto-backup');

    if (!btnTrigger) return;

    // Open Modal
    btnTrigger.addEventListener('click', () => {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        inputConfirm.value = '';
        btnExecute.disabled = true;
    });

    // Close Modal
    btnCancel.addEventListener('click', () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    });

    if (btnGotoBackup) {
        btnGotoBackup.addEventListener('click', () => {
            // Close the modal
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            
            // Virtually click the sidebar navigation button
            const navDashboard = document.getElementById('nav-live-dashboard');
            if (navDashboard) {
                navDashboard.click();
            }
        });
    }

    // Validation Listener
    inputConfirm.addEventListener('input', (e) => {
        if (e.target.value === 'confirm') {
            btnExecute.disabled = false;
            btnExecute.classList.add('animate-pulse');
        } else {
            btnExecute.disabled = true;
            btnExecute.classList.remove('animate-pulse');
        }
    });

    // Execute the Wipe (UPGRADED FOR WORKFLOW SAFETY)
    btnExecute.addEventListener('click', async () => {
        btnExecute.innerText = "⏳ Wiping Database...";
        btnExecute.disabled = true;
        
        try {
            // We must wipe all 3 collections to prevent "Ghost Scores" on the next upload
            const collectionsToWipe = ['candidates', 'scores', 'scoring_queue'];
            
            for (const colName of collectionsToWipe) {
                const snap = await getDocs(collection(db, colName));
                const docList = [];
                snap.forEach(doc => docList.push(doc.ref));

                const CHUNK_SIZE = 100;
                for (let i = 0; i < docList.length; i += CHUNK_SIZE) {
                    const chunk = docList.slice(i, i + CHUNK_SIZE);
                    const batch = writeBatch(db);
                    chunk.forEach(ref => batch.delete(ref));
                    await batch.commit();
                }
            }

            // Reset the Track Number Counter
            const counterRef = doc(db, 'system_metadata', 'counters');
            await writeBatch(db).set(counterRef, { lastTrackNo: 100 }).commit();

            alert("☢️ STAGE CLEARED. Candidates, Scores, and Queues have been completely purged.");
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            
        } catch (error) {
            console.error("Factory Reset Error:", error);
            alert("Error during reset. Check console.");
        } finally {
            btnExecute.innerText = "Wipe Database";
        }
    });
}
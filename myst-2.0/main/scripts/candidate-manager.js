// ============================================================================
// MODULE 7: MASTER CANDIDATE MANAGER
// Single Database Architecture with Lifecycle Integration
// ============================================================================

import { collection, doc, updateDoc, writeBatch, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

let allCandidates = [];

export function initCandidateManager() {
    const tbody = document.getElementById('candidate-manager-tbody');
    const searchInput = document.getElementById('search-candidate');
    const filterCat = document.getElementById('filter-candidate-category');
    const filterGen = document.getElementById('filter-candidate-gender');
    const filterDist = document.getElementById('filter-candidate-district');
    const btnRefresh = document.getElementById('btn-refresh-candidates');
    
    if (!tbody) return;

    // Load candidates once when the view initializes
    loadCandidates();

    if (btnRefresh) {
        btnRefresh.addEventListener('click', loadCandidates);
    }

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

async function loadCandidates() {
    const tbody = document.getElementById('candidate-manager-tbody');
    const btnRefresh = document.getElementById('btn-refresh-candidates');
    const filterCat = document.getElementById('filter-candidate-category');
    const filterGen = document.getElementById('filter-candidate-gender');
    const filterDist = document.getElementById('filter-candidate-district');

    if (btnRefresh) {
        btnRefresh.innerHTML = `<span class="mr-2 w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin"></span> REFRESHING...`;
        btnRefresh.disabled = true;
    }

    try {
        const snapshot = await getDocs(collection(db, 'candidates'));
        allCandidates = [];
        snapshot.forEach(docSnap => {
            allCandidates.push({ id: docSnap.id, ...docSnap.data() });
        });
        
        // Auto-populate dropdowns based on actual data
        populateFilters(allCandidates, filterCat, filterGen, filterDist);
        
        // Render with current filters applied
        applyFilters();
    } catch (error) {
        console.error("Failed to load candidates:", error);
        alert("Error loading candidates from database.");
    } finally {
        if (btnRefresh) {
            btnRefresh.innerHTML = `<span class="mr-2">🔄</span> REFRESH LIST`;
            btnRefresh.disabled = false;
        }
    }
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
        const groupValue = c.groupName || c.group;
        if (groupValue) categories.add(groupValue);
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
        const groupValue = c.groupName || c.group;
        const matchesSearch = c.trackNo.toLowerCase().includes(term) || c.name.toLowerCase().includes(term);
        const matchesCat = cat === "All" || groupValue === cat;
        const matchesGen = gen === "All" || c.gender === gen;
        const matchesDist = dist === "All" || c.district === dist;
        
        return matchesSearch && matchesCat && matchesGen && matchesDist;
    });

    renderCandidateTable(filtered);
}

// --- RENDERING & DB UPDATES ---
function renderCandidateTable(candidates) {
    const tbody = document.getElementById('candidate-manager-tbody');
    
    // --- SMART TWO-STEP SORTING ---
    candidates.sort((a, b) => {
        const divA = a.division || 'Unassigned';
        const divB = b.division || 'Unassigned';

        // 1. Sort by Division (Smart Alphanumeric Sort)
        const divCompare = divA.localeCompare(divB, undefined, { numeric: true, sensitivity: 'base' });
        
        // If divisions are different, group them by division
        if (divCompare !== 0) {
            return divCompare;
        }
        
        // 2. If they are in the same division, sort by Track Number
        return parseInt(a.trackNo) - parseInt(b.trackNo);
    });

    // --- DOM DIFFING TO PREVENT FLICKER ---
    const existingRows = {};
    Array.from(tbody.children).forEach(tr => {
        const id = tr.dataset.track; 
        if (id) existingRows[id] = tr;
    });

    candidates.forEach((c, index) => {
        const isFullyScored = c.j1_status && c.j2_status && c.j3_status && c.j4_status && c.j5_status;
        const groupValue = c.groupName || c.group || 'Unassigned';
        
        let displayStatus = 'pending';
        if (c.status === 'DNS') displayStatus = 'DNS';
        else if (isFullyScored) displayStatus = 'scored';

        let statusBadge = `<span class="bg-slate-800 text-slate-400 border border-slate-700 px-3 py-1.5 rounded-md text-[10px] uppercase tracking-widest font-bold">Unknown</span>`;
        if (displayStatus === 'pending') statusBadge = `<span class="bg-amber-900/40 text-amber-400 border border-amber-700/50 px-3 py-1.5 rounded-md text-[10px] uppercase tracking-widest font-bold flex items-center w-fit"><span class="w-1.5 h-1.5 bg-amber-500 rounded-full mr-2"></span> Pending</span>`;
        if (displayStatus === 'scored') statusBadge = `<span class="bg-emerald-900/40 text-emerald-400 border border-emerald-700/50 px-3 py-1.5 rounded-md text-[10px] uppercase tracking-widest font-bold shadow-[0_0_10px_rgba(16,185,129,0.2)] flex items-center w-fit"><span class="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-2"></span> Scored</span>`;
        if (displayStatus === 'DNS') statusBadge = `<span class="bg-red-900/40 text-red-400 border border-red-700/50 px-3 py-1.5 rounded-md text-[10px] uppercase tracking-widest font-bold flex items-center w-fit"><span class="w-1.5 h-1.5 bg-red-500 rounded-full mr-2"></span> DNS</span>`;

        let actionButtons = '';
        if (displayStatus === 'scored' || displayStatus === 'DNS') {
            actionButtons = `<button class="btn-restore bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white px-4 py-2 rounded-lg text-xs transition-colors shadow-lg flex items-center active:scale-95 uppercase tracking-wider font-bold" data-id="${c.id}"><span class="mr-2">♻️</span> Hard Reset</button>`;
        } else if (displayStatus === 'pending') {
            actionButtons = `<button class="btn-dns bg-red-950/50 hover:bg-red-900 border border-red-900/80 text-red-400 hover:text-white px-4 py-2 rounded-lg text-xs transition-colors uppercase tracking-wider font-bold shadow" data-id="${c.id}">Force DNS</button>`;
        }

        const divisionDisplay = c.division && c.division !== 'Unassigned' 
            ? `<span class="text-amber-500 font-bold text-xs block mt-1 tracking-wider uppercase">${c.division}</span>` 
            : `<span class="text-slate-500 text-xs italic block mt-1">Unassigned</span>`;

        const coachDisplay = `<span class="text-purple-400 text-[10px] uppercase tracking-widest font-bold block mt-1 border border-purple-900/50 bg-purple-950/30 px-2 py-0.5 rounded w-fit">Coach: ${c.coachName || 'Independent'}</span>`;

        const html = `
            <td class="p-5 font-mono text-brand-400 font-bold tracking-widest bg-slate-950/20">${c.trackNo}</td>
            <td class="p-5 font-bold text-white bg-slate-900/20">
                <div class="text-base mb-1 drop-shadow-sm">${c.name}</div>
                <div class="flex items-center space-x-2">
                    ${divisionDisplay}
                    ${coachDisplay}
                </div>
            </td>
            <td class="p-5 text-slate-400 font-semibold bg-slate-950/20">${c.gender || 'N/A'}</td>
            <td class="p-5 text-slate-400 font-medium bg-slate-900/20">${c.district || 'N/A'}</td>
            <td class="p-5 text-slate-300 text-sm font-bold tracking-tight bg-slate-950/20">${groupValue}</td>
            <td class="p-5 bg-slate-900/20">${statusBadge}</td>
            <td class="p-5 text-right flex justify-end bg-slate-950/20">${actionButtons}</td>
        `;

        let tr = existingRows[c.trackNo];
        if (!tr) {
            tr = document.createElement('tr');
            tr.dataset.track = c.trackNo;
            tr.className = "hover:bg-slate-800/80 transition-colors border-b border-slate-800 group"; 
            tbody.appendChild(tr);
        }
        
        if (tr.innerHTML !== html) {
            tr.innerHTML = html;
        }
        
        if (tbody.children[index] !== tr) {
            tbody.insertBefore(tr, tbody.children[index]);
        }
        
        delete existingRows[c.trackNo];
    });

    // Remove deleted rows
    Object.values(existingRows).forEach(tr => tr.remove());
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
        
        // Fix for Tailwind CSS transition classes
        setTimeout(() => {
            modal.children[0].dataset.show = 'true';
        }, 10);
        
        inputConfirm.value = '';
        btnExecute.disabled = true;
    });

    // Close Modal
    const closeModal = () => {
        modal.children[0].dataset.show = 'false';
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 200); // Wait for transition
    };

    btnCancel.addEventListener('click', closeModal);

    if (btnGotoBackup) {
        btnGotoBackup.addEventListener('click', () => {
            closeModal();
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
            closeModal();
            
        } catch (error) {
            console.error("Factory Reset Error:", error);
            alert("Error during reset. Check console.");
        } finally {
            btnExecute.innerText = "Wipe Database";
        }
    });
}
// ============================================================================
// MYST LIVE DISPLAY ENGINE (SMART NODE)
// Handles Live Scoring Matrices & Podium Broadcasts
// ============================================================================

import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, onSnapshot, query, where, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

// --- GLOBAL STATE & CACHES ---
let currentMode = 'live'; // 'live' or 'podium'
let currentMatId = null;
let currentCategoryId = null;

let candidatesMap = {};
let scoresMap = {};
let publishedResultsMap = {};

let unsubQueue = null;

// ==========================================
// 1. SWITCHBOARD INITIALIZATION
// ==========================================
export function initDisplay() {
    // Auto-open settings if nothing is configured yet
    if (!currentMatId && !currentCategoryId) {
        document.getElementById('settings-modal').classList.remove('hidden');
        document.getElementById('settings-modal').classList.add('flex');
    }
    
    // Boot the UI listeners and data engines
    bindSettingsUI();
    bootDisplayEngine();
}

// ==========================================
// 2. SETTINGS & CONFIGURATION UI
// ==========================================
function bindSettingsUI() {
    const modal = document.getElementById('settings-modal');
    
    document.getElementById('btn-open-settings').addEventListener('click', () => {
        modal.classList.remove('hidden'); modal.classList.add('flex');
    });
    
    document.getElementById('btn-close-settings').addEventListener('click', () => {
        modal.classList.add('hidden'); modal.classList.remove('flex');
    });

    // Mode Toggles
    const btnLive = document.getElementById('btn-mode-live');
    const btnPodium = document.getElementById('btn-mode-podium');
    const viewLive = document.getElementById('settings-live');
    const viewPodium = document.getElementById('settings-podium');

    btnLive.addEventListener('click', () => {
        currentMode = 'live';
        btnLive.className = "flex-1 py-2 rounded text-sm font-bold bg-blue-600 text-white transition-colors";
        btnPodium.className = "flex-1 py-2 rounded text-sm font-bold text-gray-500 hover:text-white transition-colors";
        viewLive.classList.remove('hidden');
        viewPodium.classList.add('hidden');
    });

    btnPodium.addEventListener('click', () => {
        currentMode = 'podium';
        btnPodium.className = "flex-1 py-2 rounded text-sm font-bold bg-purple-600 text-white transition-colors";
        btnLive.className = "flex-1 py-2 rounded text-sm font-bold text-gray-500 hover:text-white transition-colors";
        viewPodium.classList.remove('hidden');
        viewLive.classList.add('hidden');
    });

    // Apply Button
    document.getElementById('btn-apply-settings').addEventListener('click', () => {
        currentMatId = document.getElementById('select-mat').value;
        currentCategoryId = document.getElementById('select-result-category').value;
        
        modal.classList.add('hidden'); modal.classList.remove('flex');
        
        if (currentMode === 'live' && currentMatId) {
            document.getElementById('view-podium').classList.add('hidden');
            document.getElementById('view-live-scoring').classList.remove('hidden');
            document.getElementById('view-live-scoring').classList.add('flex');
            
            const matName = document.getElementById('select-mat').options[document.getElementById('select-mat').selectedIndex].text;
            document.getElementById('display-header-title').innerText = matName;
            document.getElementById('display-header-subtitle').innerText = "Live Scoreboard";
            
            listenToQueue(); // Restart queue listener for new mat
        } 
        else if (currentMode === 'podium' && currentCategoryId) {
            document.getElementById('view-live-scoring').classList.add('hidden');
            document.getElementById('view-podium').classList.remove('hidden');
            document.getElementById('view-podium').classList.add('flex');
            
            document.getElementById('display-header-title').innerText = "OFFICIAL PODIUM";
            document.getElementById('display-header-subtitle').innerText = currentCategoryId;
            
            if (unsubQueue) { unsubQueue(); unsubQueue = null; } // Kill live listener to save reads
            renderPodiumView();
        }
    });
}

// ==========================================
// 3. THE DATA ENGINES (Caches)
// ==========================================
function bootDisplayEngine() {
    // A. Listen for Active Mats (For Settings Dropdown)
    onSnapshot(collection(db, 'active_mats'), snap => {
        const select = document.getElementById('select-mat');
        const prevVal = select.value;
        select.innerHTML = '<option value="">-- Select Mat --</option>';
        snap.forEach(doc => { select.innerHTML += `<option value="${doc.id}">Mat ${doc.data().matNumber}</option>`; });
        if (prevVal) select.value = prevVal;
    });

    // B. Listen for Published Results (For Settings Dropdown & Podium Rendering)
    onSnapshot(collection(db, 'published_results'), snap => {
        const select = document.getElementById('select-result-category');
        const prevVal = select.value;
        select.innerHTML = '<option value="">-- Select Result Category --</option>';
        
        publishedResultsMap = {};
        snap.forEach(doc => { 
            const d = doc.data();
            publishedResultsMap[doc.id] = d;
            const displayName = `${d.group} - ${d.gender} (${d.district})`;
            select.innerHTML += `<option value="${doc.id}">${displayName}</option>`; 
        });
        if (prevVal) select.value = prevVal;
        
        if (currentMode === 'podium') renderPodiumView(); // Auto-update if looking at podium
    });

    // C. Cache Candidates (For Live Names/Divisions)
    onSnapshot(collection(db, 'candidates'), snap => {
        candidatesMap = {};
        snap.forEach(doc => candidatesMap[doc.id] = doc.data());
        if (currentMode === 'live') renderLiveView();
    });

    // D. Cache Live Scores (For the Matrix math)
    onSnapshot(collection(db, 'scores'), snap => {
        scoresMap = {};
        snap.forEach(doc => scoresMap[doc.id] = doc.data());
        if (currentMode === 'live') renderLiveView();
    });
}

// Queue Listener (Only runs when in Live Mode)
let currentBatches = {};
function listenToQueue() {
    if (unsubQueue) unsubQueue();
    const q = query(collection(db, 'scoring_queue'), where('stageId', '==', currentMatId));
    
    unsubQueue = onSnapshot(q, snap => {
        currentBatches = {};
        // Group queue items by their Batch Number
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const bNum = data.batchNo || 0;
            if (!currentBatches[bNum]) currentBatches[bNum] = [];
            currentBatches[bNum].push(data);
        });
        renderLiveView();
    });
}

// ==========================================
// 4. LIVE SCORING RENDERER (Split View)
// ==========================================
function renderLiveView() {
    if (!currentMatId) return;

    const tbodyStage = document.getElementById('live-stage-tbody');
    const tbodyUpcoming = document.getElementById('live-upcoming-tbody');
    const lblStageBatch = document.getElementById('current-batch-id');
    const lblUpcomingBatch = document.getElementById('upcoming-batch-id');

    // Find the ordered batch numbers
    const batchNumbers = Object.keys(currentBatches).map(Number).sort((a, b) => a - b);

    if (batchNumbers.length === 0) {
        lblStageBatch.innerText = "--";
        lblUpcomingBatch.innerText = "--";
        tbodyStage.innerHTML = `<tr><td colspan="9" class="p-12 text-center text-gray-500 italic">No athletes currently assigned to this mat.</td></tr>`;
        tbodyUpcoming.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-gray-600 italic">Queue is empty.</td></tr>`;
        return;
    }

    // Identify Active (First) and Upcoming (Second)
    const activeBatchNo = batchNumbers[0];
    const upcomingBatchNo = batchNumbers.length > 1 ? batchNumbers[1] : null;

    const activeQueue = currentBatches[activeBatchNo] || [];
    const upcomingQueue = upcomingBatchNo ? currentBatches[upcomingBatchNo] : [];

    lblStageBatch.innerText = activeBatchNo;
    lblUpcomingBatch.innerText = upcomingBatchNo ? `Batch ${upcomingBatchNo}` : 'None';

    // RENDER ON-STAGE BATCH
    tbodyStage.innerHTML = activeQueue.map(q => generateLiveRow(q, true)).join('');

    // RENDER UPCOMING BATCH (Miniature rows)
    if (upcomingQueue.length > 0) {
        tbodyUpcoming.innerHTML = upcomingQueue.map(q => {
            const c = candidatesMap[q.trackNo] || {};
            return `
                <tr class="hover:bg-gray-800 transition-colors">
                    <td class="p-2 pl-4 font-mono text-blue-500 w-20">${q.trackNo}</td>
                    <td class="p-2 font-bold text-gray-300">${c.name || 'Unknown'}</td>
                    <td class="p-2 pr-4 text-right text-yellow-500/70 font-bold text-xs uppercase">${c.division || ''}</td>
                </tr>
            `;
        }).join('');
    } else {
        tbodyUpcoming.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-gray-600 italic">No upcoming batches.</td></tr>`;
    }
}

// Math Engine for Table Rows
function generateLiveRow(qItem, isLarge) {
    const trackNo = qItem.trackNo;
    const c = candidatesMap[trackNo] || {};
    const s = scoresMap[trackNo] || {};

    const getJ = (prefix) => {
        let total = 0, isTyping = false;
        ['a1', 'a2', 'opt'].forEach(key => {
            const val = parseFloat(s[`${prefix}_${key}`]);
            if (!isNaN(val)) { total += val; isTyping = true; }
        });
        return { total, isTyping };
    };

    const j1 = getJ('j1'), j2 = getJ('j2'), j3 = getJ('j3'), j4 = getJ('j4'), j5 = getJ('j5');

    const formatCell = (jObj, isLocked) => {
        if (isLocked) return `<span class="text-white">${jObj.total.toFixed(1)}</span>`;
        if (jObj.isTyping) return `<span class="text-yellow-400 animate-pulse">${jObj.total.toFixed(1)}</span>`;
        return `<span class="text-gray-700">-</span>`; 
    };

    let finalScoreHtml = `<span class="text-gray-600 text-sm tracking-widest uppercase">Scoring</span>`;
    const isFullyScored = qItem.j1_status && qItem.j2_status && qItem.j3_status && qItem.j4_status && qItem.j5_status;

    if (isFullyScored) {
        const panel = [j1.total, j2.total, j3.total, j4.total, j5.total];
        const olympicTotal = panel.reduce((a,b)=>a+b, 0) - Math.max(...panel) - Math.min(...panel);
        finalScoreHtml = `<span class="text-green-400 font-black text-3xl drop-shadow-[0_0_12px_rgba(74,222,128,0.5)]">${olympicTotal.toFixed(2)}</span>`;
    }

    return `
        <tr class="hover:bg-gray-800/50 transition-colors border-b border-gray-800/50">
            <td class="p-4 font-mono text-blue-400 font-bold">${trackNo}</td>
            <td class="p-4 font-black tracking-wide">${c.name || 'Unknown'}</td>
            <td class="p-4 text-center text-yellow-500 text-sm font-bold uppercase tracking-widest">${c.division || ''}</td>
            <td class="p-4 text-center">${formatCell(j1, qItem.j1_status)}</td>
            <td class="p-4 text-center">${formatCell(j2, qItem.j2_status)}</td>
            <td class="p-4 text-center">${formatCell(j3, qItem.j3_status)}</td>
            <td class="p-4 text-center">${formatCell(j4, qItem.j4_status)}</td>
            <td class="p-4 text-center">${formatCell(j5, qItem.j5_status)}</td>
            <td class="p-4 text-right">${finalScoreHtml}</td>
        </tr>
    `;
}

// ==========================================
// 5. PODIUM RESULTS RENDERER
// ==========================================
function renderPodiumView() {
    if (!currentCategoryId || !publishedResultsMap[currentCategoryId]) return;

    const data = publishedResultsMap[currentCategoryId];
    const standings = data.standings || [];

    // Safe Fill Helper
    const fillPodium = (num, athlete) => {
        const nameEl = document.getElementById(`podium-${num}-name`);
        const scoreEl = document.getElementById(`podium-${num}-score`);
        if (athlete) {
            nameEl.innerText = athlete.name;
            scoreEl.innerText = `${athlete.finalScore} PTS`;
        } else {
            nameEl.innerText = "--";
            scoreEl.innerText = "--";
        }
    };

    // Fill Top 3
    fillPodium(1, standings.find(s => s.rank === 1));
    fillPodium(2, standings.find(s => s.rank === 2));
    fillPodium(3, standings.find(s => s.rank === 3));

    // Fill Remaining Leaderboard
    const listBody = document.getElementById('podium-list-tbody');
    listBody.innerHTML = '';
    
    // Get athletes 4th place and below
    const remaining = standings.filter(s => s.rank > 3);
    
    if (remaining.length === 0) {
        listBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-600 italic">No remaining standings.</td></tr>`;
        return;
    }

    remaining.forEach(s => {
        listBody.innerHTML += `
            <tr class="hover:bg-gray-800 transition-colors">
                <td class="p-4 pl-8 font-black text-gray-500 w-24">#${s.rank}</td>
                <td class="p-4 font-bold text-gray-300">${s.name}</td>
                <td class="p-4 text-center text-blue-400/80 text-sm font-bold uppercase">${s.division || ''}</td>
                <td class="p-4 text-center text-gray-400 text-sm">${s.district}</td>
                <td class="p-4 text-right pr-8 text-gray-300 font-mono">${s.finalScore}</td>
            </tr>
        `;
    });
}
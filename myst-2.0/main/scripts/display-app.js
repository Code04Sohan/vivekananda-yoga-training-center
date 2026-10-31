// ============================================================================
// MYST LIVE DISPLAY ENGINE (SMART BROADCAST NODE)
// Fluid Viewport Architecture · 3-Judge vs 5-Judge Adaptation · TV Shortcuts
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
let activeMatsMap = {};

let unsubQueue = null;
let yogaWakeLock = null;

// Escaping helper for safe HTML attribute rendering
function esc(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==========================================
// 1. SWITCHBOARD INITIALIZATION
// ==========================================
export function initDisplay() {
    if (!currentMatId && !currentCategoryId) {
        document.getElementById('settings-modal').classList.remove('hidden');
        document.getElementById('settings-modal').classList.add('flex');
    }
    bindSettingsUI();
    initKeyboardShortcuts();
    startYogaClock();
    requestYogaScreenWakeLock();
    bootDisplayEngine();
}

// ==========================================
// 2. SETTINGS & CONFIGURATION UI
// ==========================================
function bindSettingsUI() {
    const modal = document.getElementById('settings-modal');

    const syncSettingsFields = () => {
        const slotsSelect = document.getElementById('select-podium-slots');
        if (slotsSelect) slotsSelect.value = getPodiumSlotsPerPage().toString();
    };

    document.getElementById('btn-open-settings').addEventListener('click', () => {
        syncSettingsFields();
        modal.classList.remove('hidden'); modal.classList.add('flex');
    });

    document.getElementById('btn-close-settings').addEventListener('click', () => {
        modal.classList.add('hidden'); modal.classList.remove('flex');
    });

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

    document.getElementById('btn-apply-settings').addEventListener('click', () => {
        currentMatId = document.getElementById('select-mat').value;
        currentCategoryId = document.getElementById('select-result-category').value;

        const slotsSelect = document.getElementById('select-podium-slots');
        if (slotsSelect) {
            const chosenSlots = parseInt(slotsSelect.value, 10);
            if ([5, 6, 7, 8, 10].includes(chosenSlots)) {
                localStorage.setItem('myst_yoga_podium_slots', chosenSlots);
            }
        }

        modal.classList.add('hidden'); modal.classList.remove('flex');

        if (currentMode === 'live' && currentMatId) {
            document.getElementById('view-podium').classList.add('hidden');
            document.getElementById('view-podium').classList.remove('flex');
            document.getElementById('view-live-scoring').classList.remove('hidden');
            document.getElementById('view-live-scoring').classList.add('flex');

            const matSelect = document.getElementById('select-mat');
            const matName = matSelect.selectedIndex >= 0 ? matSelect.options[matSelect.selectedIndex].text : `Mat ${currentMatId}`;
            const titleEl = document.getElementById('display-header-title');
            const subEl = document.getElementById('display-header-subtitle');
            titleEl.innerText = matName;
            titleEl.setAttribute('data-tooltip', matName);
            titleEl.setAttribute('title', matName);
            subEl.innerText = "Live Scoreboard";
            subEl.removeAttribute('data-tooltip');
            subEl.removeAttribute('title');

            stopPagination();
            listenToQueue();
        }
        else if (currentMode === 'podium' && currentCategoryId) {
            document.getElementById('view-live-scoring').classList.add('hidden');
            document.getElementById('view-live-scoring').classList.remove('flex');
            document.getElementById('view-podium').classList.remove('hidden');
            document.getElementById('view-podium').classList.add('flex');

            const titleEl = document.getElementById('display-header-title');
            const subEl = document.getElementById('display-header-subtitle');
            titleEl.innerText = "OFFICIAL PODIUM";
            titleEl.removeAttribute('data-tooltip');
            titleEl.removeAttribute('title');
            subEl.innerText = currentCategoryId;
            subEl.setAttribute('data-tooltip', currentCategoryId);
            subEl.setAttribute('title', currentCategoryId);

            if (unsubQueue) { unsubQueue(); unsubQueue = null; }
            renderPodiumView();
        }
    });

    // Podium Manual Navigation Buttons
    document.getElementById('btn-podium-prev')?.addEventListener('click', () => {
        if (!currentRemainingList || currentRemainingList.length === 0) return;
        stopPagination();
        const slotsPerPage = getPodiumSlotsPerPage();
        const totalPages = Math.ceil(currentRemainingList.length / slotsPerPage);
        currentPodiumPage = (currentPodiumPage - 1 + totalPages) % totalPages;
        isPodiumPaused = true;
        renderPodiumPage(currentRemainingList);
    });

    document.getElementById('btn-podium-next')?.addEventListener('click', () => {
        if (!currentRemainingList || currentRemainingList.length === 0) return;
        stopPagination();
        const slotsPerPage = getPodiumSlotsPerPage();
        const totalPages = Math.ceil(currentRemainingList.length / slotsPerPage);
        currentPodiumPage = (currentPodiumPage + 1) % totalPages;
        isPodiumPaused = true;
        renderPodiumPage(currentRemainingList);
    });

    // Initialize initial fields on boot
    syncSettingsFields();
}

// ==========================================
// 3. THE DATA ENGINES (Caches)
// ==========================================
function bootDisplayEngine() {
    onSnapshot(collection(db, 'active_mats'), snap => {
        const select = document.getElementById('select-mat');
        const prevVal = select.value;
        select.innerHTML = '<option value="">-- Select Mat --</option>';
        activeMatsMap = {};
        snap.forEach(doc => {
            activeMatsMap[doc.id] = doc.data();
            select.innerHTML += `<option value="${doc.id}">Mat ${doc.data().matNumber}</option>`;
        });
        if (prevVal) select.value = prevVal;

        if (currentMode === 'live' && currentMatId) {
            renderLiveView();
        }
    });

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

        if (currentMode === 'podium') renderPodiumView();
    });
}

let currentBatches = {};
let unsubScores = null;

function listenToQueue() {
    if (unsubQueue) unsubQueue();
    if (unsubScores) unsubScores();

    const q = query(collection(db, 'scoring_queue'), where('stageId', '==', currentMatId));
    unsubQueue = onSnapshot(q, snap => {
        currentBatches = {};
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const bNum = data.batchNo || 0;
            if (!currentBatches[bNum]) currentBatches[bNum] = [];
            currentBatches[bNum].push(data);
        });
        renderLiveView();
    });

    const qScores = query(collection(db, 'scores'), where('stageId', '==', currentMatId));
    unsubScores = onSnapshot(qScores, snap => {
        scoresMap = {};
        snap.forEach(doc => scoresMap[doc.id] = doc.data());
        if (currentMode === 'live') renderLiveView();
    });
}

// HELPER: Pad array to exactly N elements (default 5)
function padToN(arr, n = 5) {
    const result = [...(arr || [])];
    while (result.length < n) {
        result.push(null);
    }
    return result.slice(0, n);
}

function padToFive(arr) {
    return padToN(arr, 5);
}

function getPodiumSlotsPerPage() {
    const saved = parseInt(localStorage.getItem('myst_yoga_podium_slots'), 10);
    return [5, 6, 7, 8, 10].includes(saved) ? saved : 5;
}

// ==========================================
// 4. LIVE SCORING RENDERER (Split View)
// ==========================================
function renderLiveView() {
    if (!currentMatId) return;

    const tbodyStage = document.getElementById('live-stage-tbody');
    const tbodyUpcoming = document.getElementById('live-upcoming-tbody');
    const tbodyRecent = document.getElementById('live-recent-tbody');

    const lblStageBatch = document.getElementById('current-batch-id');
    const lblUpcomingBatch = document.getElementById('upcoming-batch-id');
    const lblRecentBatch = document.getElementById('recent-batch-id');

    // Dynamic Panel Size Detection (3-Judge vs 5-Judge)
    const matData = activeMatsMap[currentMatId] || {};
    const activePanelSize = matData.panelSize || 5;

    // Adapt Table Header Columns
    const thJ4 = document.getElementById('live-th-j4');
    const thJ5 = document.getElementById('live-th-j5');
    const thName = document.getElementById('live-th-name');
    const thTotal = document.getElementById('live-th-total');

    if (activePanelSize === 3) {
        if (thJ4) thJ4.classList.add('hidden');
        if (thJ5) thJ5.classList.add('hidden');
        if (thName) thName.className = "px-2 md:px-4 w-[42%]";
        if (thTotal) thTotal.className = "px-2 md:px-4 w-[19%] text-right text-green-400";
    } else {
        if (thJ4) thJ4.classList.remove('hidden');
        if (thJ5) thJ5.classList.remove('hidden');
        if (thName) thName.className = "px-2 md:px-4 w-[28%]";
        if (thTotal) thTotal.className = "px-2 md:px-4 w-[15%] text-right text-green-400";
    }

    const batchNumbers = Object.keys(currentBatches).map(Number).sort((a, b) => a - b);

    if (batchNumbers.length === 0) {
        lblStageBatch.innerText = "--"; lblUpcomingBatch.innerText = "--"; lblRecentBatch.innerText = "--";
        tbodyStage.innerHTML = padToFive([]).map(() => generateLiveRow(null, activePanelSize)).join('');
        tbodyUpcoming.innerHTML = padToFive([]).map(() => `<tr class="border-b border-gray-800/10"><td class="py-1 px-2 md:px-4 w-[15%] text-gray-900">-</td><td class="py-1 px-2 w-[55%] text-gray-900">-</td><td class="py-1 px-2 w-[30%] text-gray-900">-</td></tr>`).join('');
        tbodyRecent.innerHTML = padToFive([]).map(() => `<tr class="border-b border-gray-800/10"><td class="py-1 px-2 md:px-4 w-[15%] text-gray-900">-</td><td class="py-1 px-2 w-[40%] text-gray-900">-</td><td class="py-1 px-2 w-[25%] text-gray-900">-</td><td class="py-1 px-2 w-[20%] text-gray-900">-</td></tr>`).join('');
        return;
    }

    let activeBatchNo = null;
    for (let bNum of batchNumbers) {
        const batchItems = currentBatches[bNum];
        const isFullyScored = batchItems.every(q => {
            if (activePanelSize === 3) {
                return q.j1_status && q.j2_status && q.j3_status;
            }
            return q.j1_status && q.j2_status && q.j3_status && q.j4_status && q.j5_status;
        });
        if (!isFullyScored) {
            activeBatchNo = bNum;
            break;
        }
    }

    if (activeBatchNo === null) activeBatchNo = batchNumbers[batchNumbers.length - 1];

    let upcomingBatchNo = null;
    let recentBatchNo = null;
    const activeIndex = batchNumbers.indexOf(activeBatchNo);

    if (activeIndex > 0) recentBatchNo = batchNumbers[activeIndex - 1];
    if (activeIndex < batchNumbers.length - 1) upcomingBatchNo = batchNumbers[activeIndex + 1];

    lblStageBatch.innerText = activeBatchNo;
    lblUpcomingBatch.innerText = upcomingBatchNo ? `Batch ${upcomingBatchNo}` : 'None';
    lblRecentBatch.innerText = recentBatchNo ? `Batch ${recentBatchNo}` : 'None';

    // RENDER ON-STAGE BATCH (Locked to 5 Rows with panelSize support)
    const activeQueue = padToFive(currentBatches[activeBatchNo]);
    tbodyStage.innerHTML = activeQueue.map(q => generateLiveRow(q, activePanelSize)).join('');

    const upcomingQueue = padToFive(upcomingBatchNo ? currentBatches[upcomingBatchNo] : []);
    tbodyUpcoming.innerHTML = upcomingQueue.map(q => {
        if (!q) return `<tr class="border-b border-gray-800/10 h-[20%]"><td class="py-1 px-2 md:px-3 w-[18%] text-gray-900">-</td><td class="py-1 px-2 md:px-3 w-[52%] text-gray-900">-</td><td class="py-1 px-2 md:px-3 w-[30%] text-gray-900">-</td></tr>`;
        const nameText = q.name || 'Unknown';
        const groupText = q.group || q.division || '';
        return `
            <tr class="hover:bg-gray-800/60 transition-colors border-b border-gray-800/30 h-[20%]">
                <td class="py-1 px-2 md:px-3 font-mono font-bold text-yellow-500 w-[18%] text-xs md:text-sm">${esc(q.trackNo)}</td>
                <td class="py-1 px-2 md:px-3 font-bold text-gray-200 text-xs md:text-sm w-[52%]">
                    <span class="block truncate cursor-default" data-tooltip="${esc(nameText)}" title="${esc(nameText)}">${esc(nameText)}</span>
                </td>
                <td class="py-1 px-2 md:px-3 text-right text-gray-400 font-bold text-[9px] md:text-xs uppercase w-[30%]">
                    <span class="block truncate cursor-default" data-tooltip="${esc(groupText)}" title="${esc(groupText)}">${esc(groupText)}</span>
                </td>
            </tr>
        `;
    }).join('');

    const recentQueue = padToFive(recentBatchNo ? currentBatches[recentBatchNo] : []);
    tbodyRecent.innerHTML = recentQueue.map(q => {
        if (!q) return `<tr class="border-b border-gray-800/10 h-[20%]"><td class="py-1 px-2 md:px-3 w-[18%] text-gray-900">-</td><td class="py-1 px-2 md:px-3 w-[40%] text-gray-900">-</td><td class="py-1 px-2 md:px-3 w-[22%] text-gray-900">-</td><td class="py-1 px-2 md:px-3 w-[20%] text-gray-900">-</td></tr>`;
        const finalScore = calculateFinalScore(q.trackNo, q);
        const nameText = q.name || 'Unknown';
        const groupText = q.group || q.division || '';
        return `
            <tr class="hover:bg-gray-800/60 transition-colors border-b border-gray-800/30 h-[20%]">
                <td class="py-1 px-2 md:px-3 font-mono font-bold text-green-400 w-[18%] text-xs md:text-sm">${esc(q.trackNo)}</td>
                <td class="py-1 px-2 md:px-3 font-bold text-gray-200 text-xs md:text-sm w-[40%]">
                    <span class="block truncate cursor-default" data-tooltip="${esc(nameText)}" title="${esc(nameText)}">${esc(nameText)}</span>
                </td>
                <td class="py-1 px-2 md:px-3 text-gray-400 font-bold text-[9px] md:text-xs uppercase w-[22%] text-center">
                    <span class="block truncate cursor-default" data-tooltip="${esc(groupText)}" title="${esc(groupText)}">${esc(groupText)}</span>
                </td>
                <td class="py-1 px-2 md:px-3 text-right font-black text-green-400 text-xs md:text-base w-[20%]">${finalScore}</td>
            </tr>
        `;
    }).join('');
}

// Math Engine Helper
function calculateFinalScore(trackNo, qItem) {
    if (!qItem) return "...";
    const s = scoresMap[trackNo] || {};
    const panelSize = s.panelSize || qItem.panelSize || (activeMatsMap[currentMatId]?.panelSize) || 5;

    const isComplete = panelSize === 3 
        ? (qItem.j1_status && qItem.j2_status && qItem.j3_status)
        : (qItem.j1_status && qItem.j2_status && qItem.j3_status && qItem.j4_status && qItem.j5_status);

    if (!isComplete) return "...";
    
    const getJ = (prefix) => {
        if (s[`${prefix}_a1`] === undefined) return null;
        let total = 0;
        ['a1', 'a2', 'a3', 'opt'].forEach(key => {
            const val = parseFloat(s[`${prefix}_${key}`]);
            if (!isNaN(val)) total += val;
        });
        return total;
    };
    
    const panel = [getJ('j1'), getJ('j2'), getJ('j3'), getJ('j4'), getJ('j5')].filter(v => v !== null);
    
    let olympicTotal = 0;
    if (panelSize === 3) {
        olympicTotal = panel.reduce((a, b) => a + b, 0);
    } else {
        olympicTotal = panel.reduce((a, b) => a + b, 0) - (panel.length > 0 ? Math.max(...panel) : 0) - (panel.length > 0 ? Math.min(...panel) : 0);
    }
    return olympicTotal.toFixed(2);
}

// On-Stage Row Generator (Supports 3-Judge and 5-Judge Layouts)
function generateLiveRow(qItem, panelSize = 5) {
    if (!qItem) {
        if (panelSize === 3) {
            return `
                <tr class="border-b border-gray-800/10 h-[20%]">
                    <td class="py-0.5 md:py-1 px-2 md:px-4 text-gray-900 font-mono w-[12%]">-</td>
                    <td class="py-0.5 md:py-1 px-2 md:px-4 text-gray-900 font-bold w-[42%]">-</td>
                    <td class="py-0.5 md:py-1 px-1 md:px-2 text-center text-gray-900 w-[9%]">-</td>
                    <td class="py-0.5 md:py-1 px-1 md:px-2 text-center text-gray-900 w-[9%]">-</td>
                    <td class="py-0.5 md:py-1 px-1 md:px-2 text-center text-gray-900 w-[9%]">-</td>
                    <td class="py-0.5 md:py-1 px-2 md:px-4 text-right text-gray-900 w-[19%]">-</td>
                </tr>
            `;
        }
        return `
            <tr class="border-b border-gray-800/10 h-[20%]">
                <td class="py-0.5 md:py-1 px-2 md:px-4 text-gray-900 font-mono w-[12%]">-</td>
                <td class="py-0.5 md:py-1 px-2 md:px-4 text-gray-900 font-bold w-[28%]">-</td>
                <td class="py-0.5 md:py-1 px-1 md:px-2 text-center text-gray-900 w-[9%]">-</td>
                <td class="py-0.5 md:py-1 px-1 md:px-2 text-center text-gray-900 w-[9%]">-</td>
                <td class="py-0.5 md:py-1 px-1 md:px-2 text-center text-gray-900 w-[9%]">-</td>
                <td class="py-0.5 md:py-1 px-1 md:px-2 text-center text-gray-900 w-[9%]">-</td>
                <td class="py-0.5 md:py-1 px-1 md:px-2 text-center text-gray-900 w-[9%]">-</td>
                <td class="py-0.5 md:py-1 px-2 md:px-4 text-right text-gray-900 w-[15%]">-</td>
            </tr>
        `;
    }

    const trackNo = qItem.trackNo;
    const s = scoresMap[trackNo] || {};
    const effectivePanelSize = panelSize || s.panelSize || qItem.panelSize || 5;
    const nameText = qItem.name || 'Unknown';
    const groupText = qItem.group || qItem.division || '';

    const getJ = (prefix) => {
        if (s[`${prefix}_a1`] === undefined) return { total: null };
        let total = 0;
        ['a1', 'a2', 'a3', 'opt'].forEach(key => {
            const val = parseFloat(s[`${prefix}_${key}`]);
            if (!isNaN(val)) { total += val; }
        });
        return { total };
    };

    const j1 = getJ('j1'), j2 = getJ('j2'), j3 = getJ('j3'), j4 = getJ('j4'), j5 = getJ('j5');

    const formatCell = (jObj, isLocked) => {
        if (isLocked && jObj.total !== null) return `<span class="text-white font-bold text-sm md:text-lg">${jObj.total.toFixed(1)}</span>`;
        return `<span class="text-gray-700 font-bold">-</span>`;
    };

    let finalScoreHtml = `<span class="text-gray-600 text-[10px] md:text-xs tracking-widest uppercase">Scoring</span>`;
    const isFullyScored = effectivePanelSize === 3
        ? (qItem.j1_status && qItem.j2_status && qItem.j3_status)
        : (qItem.j1_status && qItem.j2_status && qItem.j3_status && qItem.j4_status && qItem.j5_status);

    if (isFullyScored) {
        finalScoreHtml = `<span class="text-green-400 font-black text-xl md:text-3xl">${calculateFinalScore(trackNo, qItem)}</span>`;
    }

    if (effectivePanelSize === 3) {
        return `
            <tr class="hover:bg-gray-800/50 transition-colors border-b border-gray-800/50 h-[20%]">
                <td class="py-1 md:py-2 px-2 md:px-4 font-mono text-blue-400 font-bold text-xs md:text-sm w-[12%]">${esc(trackNo)}</td>
                <td class="py-1 md:py-2 px-2 md:px-4 font-black tracking-wide leading-tight min-w-0 w-[42%]">
                    <div class="truncate cursor-default text-sm md:text-lg text-white" data-tooltip="${esc(nameText)}" title="${esc(nameText)}">
                        ${esc(nameText)}
                    </div>
                    <div class="text-[9px] md:text-xs text-blue-400 font-bold uppercase tracking-widest mt-0.5 opacity-80 truncate cursor-default" data-tooltip="${esc(groupText)}" title="${esc(groupText)}">
                        ${esc(groupText)}
                    </div>
                </td>
                <td class="py-1 md:py-2 px-1 md:px-2 text-center w-[9%]">${formatCell(j1, qItem.j1_status)}</td>
                <td class="py-1 md:py-2 px-1 md:px-2 text-center w-[9%]">${formatCell(j2, qItem.j2_status)}</td>
                <td class="py-1 md:py-2 px-1 md:px-2 text-center w-[9%]">${formatCell(j3, qItem.j3_status)}</td>
                <td class="py-1 md:py-2 px-2 md:px-4 text-right w-[19%]">${finalScoreHtml}</td>
            </tr>
        `;
    }

    return `
        <tr class="hover:bg-gray-800/50 transition-colors border-b border-gray-800/50 h-[20%]">
            <td class="py-1 md:py-2 px-2 md:px-4 font-mono text-blue-400 font-bold text-xs md:text-sm w-[12%]">${esc(trackNo)}</td>
            <td class="py-1 md:py-2 px-2 md:px-4 font-black tracking-wide leading-tight min-w-0 w-[28%]">
                <div class="truncate cursor-default text-sm md:text-lg text-white" data-tooltip="${esc(nameText)}" title="${esc(nameText)}">
                    ${esc(nameText)}
                </div>
                <div class="text-[9px] md:text-xs text-blue-400 font-bold uppercase tracking-widest mt-0.5 opacity-80 truncate cursor-default" data-tooltip="${esc(groupText)}" title="${esc(groupText)}">
                    ${esc(groupText)}
                </div>
            </td>
            <td class="py-1 md:py-2 px-1 md:px-2 text-center w-[9%]">${formatCell(j1, qItem.j1_status)}</td>
            <td class="py-1 md:py-2 px-1 md:px-2 text-center w-[9%]">${formatCell(j2, qItem.j2_status)}</td>
            <td class="py-1 md:py-2 px-1 md:px-2 text-center w-[9%]">${formatCell(j3, qItem.j3_status)}</td>
            <td class="py-1 md:py-2 px-1 md:px-2 text-center w-[9%]">${formatCell(j4, qItem.j4_status)}</td>
            <td class="py-1 md:py-2 px-1 md:px-2 text-center w-[9%]">${formatCell(j5, qItem.j5_status)}</td>
            <td class="py-1 md:py-2 px-2 md:px-4 text-right w-[15%]">${finalScoreHtml}</td>
        </tr>
    `;
}

// ==========================================
// 5. PODIUM RESULTS RENDERER (With Pagination & Pause)
// ==========================================
let podiumPaginationTimer = null;
let currentPodiumPage = 0;
let isPodiumPaused = false;
let currentRemainingList = [];
const ITEMS_PER_PAGE = 5;
const PAGE_DURATION_MS = 10000; // 10 seconds per page

function stopPagination() {
    if (podiumPaginationTimer) {
        clearTimeout(podiumPaginationTimer);
        podiumPaginationTimer = null;
    }
    const bar = document.getElementById('podium-progress-bar');
    if (bar) {
        bar.classList.add('hidden');
        bar.style.transition = 'none';
        bar.style.width = '0%';
    }
}

function renderPodiumView() {
    stopPagination();
    if (!currentCategoryId || !publishedResultsMap[currentCategoryId]) return;

    const data = publishedResultsMap[currentCategoryId];
    const standings = data.standings || [];

    const fillPodium = (num, athlete) => {
        const nameEl = document.getElementById(`podium-${num}-name`);
        const scoreEl = document.getElementById(`podium-${num}-score`);
        const trackEl = document.getElementById(`podium-${num}-track`);
        const metaEl = document.getElementById(`podium-${num}-meta`);

        if (athlete) {
            const athleteName = athlete.name || 'Unknown';
            if (nameEl) {
                nameEl.innerText = athleteName;
                nameEl.setAttribute('data-tooltip', athleteName);
                nameEl.setAttribute('title', athleteName);
            }
            if (scoreEl) {
                scoreEl.innerText = athlete.finalScore !== undefined ? `${athlete.finalScore}` : '--';
            }
            if (trackEl) {
                const trk = athlete.trackNo || athlete.chestNo || athlete.id;
                trackEl.innerText = trk ? `Track #${trk}` : 'Track #--';
            }
            if (metaEl) {
                const metaParts = [athlete.division, athlete.district].filter(Boolean);
                const metaStr = metaParts.length > 0 ? metaParts.join(' · ') : '-';
                metaEl.innerText = metaStr;
                metaEl.setAttribute('data-tooltip', metaStr);
                metaEl.setAttribute('title', metaStr);
            }
        } else {
            if (nameEl) {
                nameEl.innerText = "-- Awaiting --";
                nameEl.removeAttribute('data-tooltip');
                nameEl.removeAttribute('title');
            }
            if (scoreEl) scoreEl.innerText = "--";
            if (trackEl) trackEl.innerText = "Track #--";
            if (metaEl) {
                metaEl.innerText = "--";
                metaEl.removeAttribute('data-tooltip');
                metaEl.removeAttribute('title');
            }
        }
    };

    fillPodium(1, standings.find(s => s.rank === 1));
    fillPodium(2, standings.find(s => s.rank === 2));
    fillPodium(3, standings.find(s => s.rank === 3));

    const totalRankedEl = document.getElementById('podium-total-ranked');
    if (totalRankedEl) {
        totalRankedEl.textContent = `${standings.length} Ranked`;
    }

    currentRemainingList = standings;
    currentPodiumPage = 0;
    isPodiumPaused = false;
    
    renderPodiumPage(currentRemainingList);
}

function renderPodiumPage(remainingList) {
    const listBody = document.getElementById('podium-list-tbody');
    const pageInfo = document.getElementById('podium-page-info');
    const pauseBadge = document.getElementById('podium-pause-badge');
    
    if (!listBody) return;
    listBody.innerHTML = '';

    if (!remainingList || remainingList.length === 0) {
        listBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-500 font-mono text-sm italic">No standings available for this category.</td></tr>`;
        if (pageInfo) pageInfo.textContent = "Page 1 of 1";
        return;
    }

    const slotsPerPage = getPodiumSlotsPerPage();
    const totalPages = Math.max(1, Math.ceil(remainingList.length / slotsPerPage));
    if (currentPodiumPage >= totalPages) currentPodiumPage = 0;
    if (currentPodiumPage < 0) currentPodiumPage = totalPages - 1;

    if (pageInfo) {
        pageInfo.textContent = `Page ${currentPodiumPage + 1} of ${totalPages}`;
    }

    if (pauseBadge) {
        if (isPodiumPaused) pauseBadge.classList.remove('hidden');
        else pauseBadge.classList.add('hidden');
    }

    const startIndex = currentPodiumPage * slotsPerPage;
    const rawPageItems = remainingList.slice(startIndex, startIndex + slotsPerPage);
    const pageItems = padToN(rawPageItems, slotsPerPage);

    const rowHeightPercent = (100 / slotsPerPage).toFixed(2);
    const isDense = slotsPerPage >= 7;
    const pyClass = isDense ? "py-0.5 md:py-1" : "py-1 md:py-1.5";
    const nameFontClass = isDense ? "text-xs md:text-sm" : "text-xs md:text-base";
    const rankFontClass = isDense ? "text-[11px] md:text-xs" : "text-xs md:text-sm";
    const scoreFontClass = isDense ? "text-xs md:text-sm" : "text-xs md:text-base";

    pageItems.forEach(s => {
        if (!s) {
            listBody.innerHTML += `
                <tr class="border-b border-gray-800/20 text-gray-800 select-none" style="height: ${rowHeightPercent}%;">
                    <td class="${pyClass} px-2 md:px-3 text-center w-[10%]">-</td>
                    <td class="${pyClass} px-2 md:px-3 text-center w-[12%]">-</td>
                    <td class="${pyClass} px-2 md:px-3 w-[36%]">-</td>
                    <td class="${pyClass} px-2 md:px-3 text-center w-[15%]">-</td>
                    <td class="${pyClass} px-2 md:px-3 text-center w-[14%]">-</td>
                    <td class="${pyClass} px-2 md:px-3 md:pr-4 text-right w-[13%]">-</td>
                </tr>
            `;
            return;
        }

        const isPodium = s.rank <= 3;
        const medalBadge = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : `#${s.rank}`;
        const rowBg = s.rank === 1 
            ? 'bg-yellow-950/20 text-white border-yellow-500/30' 
            : s.rank === 2 
            ? 'bg-gray-800/50 text-white border-gray-700/50' 
            : s.rank === 3 
            ? 'bg-amber-950/20 text-white border-amber-800/30' 
            : 'text-gray-300 border-gray-800/40';

        const nameText = s.name || 'Unknown';
        const trkVal = s.trackNo || s.chestNo || s.id;
        const trkText = trkVal ? `#${trkVal}` : '-';
        const divText = s.division || '';
        const distText = s.district || '';
        const scoreText = s.finalScore !== undefined ? s.finalScore : '-';

        listBody.innerHTML += `
            <tr class="${rowBg} hover:bg-gray-800/80 transition-colors border-b" style="height: ${rowHeightPercent}%;">
                <td class="${pyClass} px-2 md:px-3 text-center font-black ${rankFontClass} w-[10%]">
                    ${medalBadge}
                </td>
                <td class="${pyClass} px-2 md:px-3 font-mono font-bold text-purple-400 text-xs sm:text-sm text-center w-[12%]">
                    ${esc(trkText)}
                </td>
                <td class="${pyClass} px-2 md:px-3 font-bold text-gray-100 ${nameFontClass} w-[36%]">
                    <span class="block truncate cursor-default" data-tooltip="${esc(nameText)}" title="${esc(nameText)}">${esc(nameText)}</span>
                </td>
                <td class="${pyClass} px-2 md:px-3 text-center text-blue-400 text-[10px] md:text-xs font-bold uppercase w-[15%]">
                    <span class="block truncate cursor-default" data-tooltip="${esc(divText)}" title="${esc(divText)}">${esc(divText || '-')}</span>
                </td>
                <td class="${pyClass} px-2 md:px-3 text-center text-gray-400 text-[10px] md:text-xs w-[14%]">
                    <span class="block truncate cursor-default" data-tooltip="${esc(distText)}" title="${esc(distText)}">${esc(distText || '-')}</span>
                </td>
                <td class="${pyClass} px-2 md:px-3 md:pr-4 text-right font-mono font-black ${scoreFontClass} text-emerald-400 w-[13%]">
                    ${scoreText}
                </td>
            </tr>
        `;
    });

    if (totalPages > 1 && !isPodiumPaused) {
        // Start Progress Bar Animation
        const bar = document.getElementById('podium-progress-bar');
        if (bar) {
            bar.classList.remove('hidden');
            bar.style.transition = 'none';
            bar.style.width = '0%';
            
            // Force reflow
            void bar.offsetWidth; 
            
            bar.style.transition = `width ${PAGE_DURATION_MS}ms linear`;
            bar.style.width = '100%';
        }

        podiumPaginationTimer = setTimeout(() => {
            if (!isPodiumPaused) {
                currentPodiumPage++;
                renderPodiumPage(remainingList);
            }
        }, PAGE_DURATION_MS);
    } else {
        const bar = document.getElementById('podium-progress-bar');
        if (bar) bar.classList.add('hidden');
    }
}

function togglePodiumPause() {
    isPodiumPaused = !isPodiumPaused;
    const badge = document.getElementById('podium-pause-badge');
    const bar = document.getElementById('podium-progress-bar');

    if (isPodiumPaused) {
        if (podiumPaginationTimer) {
            clearTimeout(podiumPaginationTimer);
            podiumPaginationTimer = null;
        }
        if (badge) badge.classList.remove('hidden');
        if (bar) bar.style.width = '0%';
    } else {
        if (badge) badge.classList.add('hidden');
        if (currentRemainingList && currentRemainingList.length > 0) {
            renderPodiumPage(currentRemainingList);
        }
    }
}

// ==========================================
// 6. KEYBOARD NAVIGATION & REMOTE CONTROL
// ==========================================
function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

        switch (e.key) {
            case 'f':
            case 'F':
                e.preventDefault();
                toggleFullscreen();
                break;
            case 's':
            case 'S':
                e.preventDefault();
                toggleSettingsModal();
                break;
            case ' ':
                e.preventDefault();
                if (currentMode === 'podium') {
                    togglePodiumPause();
                }
                break;
            case '1':
            case '2':
            case '3':
            case '4':
                const matSelect = document.getElementById('select-mat');
                const targetVal = `mat_${e.key}`;
                if (matSelect) {
                    for (let opt of matSelect.options) {
                        if (opt.value === targetVal) {
                            matSelect.value = targetVal;
                            document.getElementById('btn-mode-live')?.click();
                            document.getElementById('btn-apply-settings')?.click();
                            break;
                        }
                    }
                }
                break;
            case 'p':
            case 'P':
                document.getElementById('btn-mode-podium')?.click();
                document.getElementById('btn-apply-settings')?.click();
                break;
            case 'l':
            case 'L':
                document.getElementById('btn-mode-live')?.click();
                document.getElementById('btn-apply-settings')?.click();
                break;
            case 'ArrowLeft':
                if (currentMode === 'podium' && currentRemainingList && currentRemainingList.length > 0) {
                    e.preventDefault();
                    stopPagination();
                    const slotsPerPage = getPodiumSlotsPerPage();
                    const totalPages = Math.ceil(currentRemainingList.length / slotsPerPage);
                    currentPodiumPage = (currentPodiumPage - 1 + totalPages) % totalPages;
                    isPodiumPaused = true;
                    renderPodiumPage(currentRemainingList);
                }
                break;
            case 'ArrowRight':
                if (currentMode === 'podium' && currentRemainingList && currentRemainingList.length > 0) {
                    e.preventDefault();
                    stopPagination();
                    const slotsPerPage = getPodiumSlotsPerPage();
                    const totalPages = Math.ceil(currentRemainingList.length / slotsPerPage);
                    currentPodiumPage = (currentPodiumPage + 1) % totalPages;
                    isPodiumPaused = true;
                    renderPodiumPage(currentRemainingList);
                }
                break;
            case 'Escape':
                closeSettingsModal();
                break;
        }
    });

    // Fullscreen button
    document.getElementById('btn-toggle-fullscreen')?.addEventListener('click', toggleFullscreen);
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.warn("Fullscreen request error:", err);
        });
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
}

function toggleSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        const slotsSelect = document.getElementById('select-podium-slots');
        if (slotsSelect) slotsSelect.value = getPodiumSlotsPerPage().toString();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } else {
        closeSettingsModal();
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function startYogaClock() {
    const clockEl = document.getElementById('yoga-clock');
    if (!clockEl) return;
    const tick = () => {
        clockEl.textContent = new Date().toLocaleTimeString();
    };
    tick();
    setInterval(tick, 1000);
}

async function requestYogaScreenWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            yogaWakeLock = await navigator.wakeLock.request('screen');
            document.addEventListener('visibilitychange', async () => {
                if (yogaWakeLock !== null && document.visibilityState === 'visible') {
                    yogaWakeLock = await navigator.wakeLock.request('screen');
                }
            });
        }
    } catch (err) {
        console.log("Yoga WakeLock info:", err.message);
    }
}

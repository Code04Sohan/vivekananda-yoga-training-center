// ============================================================================
// MYST 2.0: CULTURAL & PERFORMING ARTS BROADCAST DISPLAY ENGINE
// Fluid 100vh Olympic Split-Screen with Auto-Cycle Leaderboard & Keyboard Nav
// ============================================================================

import { 
    collection, 
    doc, 
    onSnapshot, 
    getDoc, 
    getDocs, 
    query, 
    where 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

// --- STATE ---
let unsubscribeDisplay = null;
let currentFilter = { comp: 'drawing', group: '', gender: '', district: '' };

let currentStandingsList = [];
let currentPanelSize = 2;
let currentCultPage = 0;
const ITEMS_PER_PAGE = 7;
const PAGE_DURATION_MS = 7000; // 7 seconds per page
let autoCycleTimer = null;
let isAutoCyclePaused = false;
let wakeLock = null;

const COMP_ICONS = {
    drawing: '🎨',
    song: '🎵',
    dance: '💃',
    recital: '📜'
};

let isCultDisplayInitialized = false;

export function initCultDisplay() {
    if (isCultDisplayInitialized) return;
    initDisplayControls();
    initSettingsModal();
    initKeyboardShortcuts();
    startClock();
    requestScreenWakeLock();
    bindDisplaySync();
    isCultDisplayInitialized = true;
}

// ==========================================
// 1. BROADCAST CONTROLS & SETTINGS MODAL
// ==========================================
function initDisplayControls() {
    const btnFullscreen = document.getElementById('btn-toggle-fullscreen');
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', toggleFullscreen);
    }

    const btnPause = document.getElementById('btn-toggle-pause');
    if (btnPause) {
        btnPause.addEventListener('click', toggleAutoCyclePause);
    }

    const btnPrev = document.getElementById('btn-page-prev');
    const btnNext = document.getElementById('btn-page-next');
    if (btnPrev) btnPrev.addEventListener('click', prevPage);
    if (btnNext) btnNext.addEventListener('click', nextPage);
}

function initSettingsModal() {
    const modal = document.getElementById('cult-settings-modal');
    const btnOpen = document.getElementById('btn-open-settings');
    const btnClose = document.getElementById('btn-close-settings');
    const btnApply = document.getElementById('btn-apply-settings');

    const compSelect = document.getElementById('disp-comp-select');
    const groupSelect = document.getElementById('disp-group-select');
    const genderSelect = document.getElementById('disp-gender-select');
    const districtSelect = document.getElementById('disp-district-select');

    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            loadFilterOptions();
        });
    }

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        });
    }

    if (compSelect) {
        compSelect.addEventListener('change', async () => {
            await loadFilterOptions();
        });
    }

    if (btnApply) {
        btnApply.addEventListener('click', () => {
            currentFilter.comp = compSelect ? compSelect.value : 'drawing';
            currentFilter.group = groupSelect ? groupSelect.value : '';
            currentFilter.gender = genderSelect ? genderSelect.value : '';
            currentFilter.district = districtSelect ? districtSelect.value : '';

            updateHeaderTitles();

            modal.classList.add('hidden');
            modal.classList.remove('flex');

            bindDisplaySync();
        });
    }
}

function updateHeaderTitles() {
    const compName = currentFilter.comp.toUpperCase();
    const icon = COMP_ICONS[currentFilter.comp] || '🎭';
    
    const iconEl = document.getElementById('disp-comp-icon');
    const titleEl = document.getElementById('disp-broadcast-title');
    const subEl = document.getElementById('disp-filter-subtitle');

    if (iconEl) iconEl.textContent = icon;
    if (titleEl) titleEl.textContent = `MYST CULTURAL CHAMPIONSHIP · ${compName}`;
    
    const grp = currentFilter.group || 'All Groups';
    const gen = currentFilter.gender || 'All Genders';
    const dist = currentFilter.district || 'All Districts';
    if (subEl) subEl.textContent = `${currentFilter.comp.toUpperCase()} · ${grp} · ${gen} · ${dist}`;
}

async function loadFilterOptions() {
    const compSelect = document.getElementById('disp-comp-select');
    const groupSelect = document.getElementById('disp-group-select');
    const genderSelect = document.getElementById('disp-gender-select');
    const districtSelect = document.getElementById('disp-district-select');

    const comp = compSelect ? compSelect.value : currentFilter.comp;

    try {
        const metaDoc = await getDoc(doc(db, 'cult_metadata', comp));
        let groups = [];
        let districts = [];
        let genders = [];

        if (metaDoc.exists()) {
            const data = metaDoc.data();
            groups = data.groups || [];
            districts = data.districts || [];
            genders = data.genders || [];
        }

        if (groupSelect) {
            const currentVal = groupSelect.value;
            groupSelect.innerHTML = '<option value="">-- All Age Groups --</option>' + 
                groups.sort().map(g => `<option value="${g}">${g}</option>`).join('');
            if (currentVal) groupSelect.value = currentVal;
        }

        if (genderSelect) {
            const currentVal = genderSelect.value;
            genderSelect.innerHTML = '<option value="">-- All Genders --</option>' + 
                genders.sort().map(gen => `<option value="${gen}">${gen}</option>`).join('');
            if (currentVal) genderSelect.value = currentVal;
        }

        if (districtSelect) {
            const currentVal = districtSelect.value;
            districtSelect.innerHTML = '<option value="">-- All Districts --</option>' + 
                districts.sort().map(d => `<option value="${d}">${d}</option>`).join('');
            if (currentVal) districtSelect.value = currentVal;
        }
    } catch (err) {
        console.error("Filter load error:", err);
    }
}

// ==========================================
// 2. REAL-TIME DATA SYNC
// ==========================================
function bindDisplaySync() {
    if (unsubscribeDisplay) unsubscribeDisplay();

    const { comp, group, gender, district } = currentFilter;
    const cleanComp = comp.replace(/[^a-zA-Z0-9]/g, '');
    const cleanGroup = (group || 'All').replace(/[^a-zA-Z0-9]/g, '');
    const cleanGen = (gender || 'All').replace(/[^a-zA-Z0-9]/g, '');
    const cleanDist = (district || 'All').replace(/[^a-zA-Z0-9]/g, '');

    const docId = `RES_${cleanComp}_${cleanGroup}_${cleanGen}_${cleanDist}`;
    const resultRef = doc(db, 'cult_published_results', docId);

    const statusText = document.getElementById('disp-status-text');
    const badgeOfficial = document.getElementById('disp-badge-official');

    // 1. Try listening to Official Published Results
    unsubscribeDisplay = onSnapshot(resultRef, async (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const panelSize = data.panelSize !== undefined ? parseInt(data.panelSize) : (comp === 'song' ? 1 : 2);
            if (statusText) statusText.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> Official Published Podium`;
            if (badgeOfficial) badgeOfficial.classList.remove('hidden');
            handleNewStandings(data.standings || [], panelSize);
        } else {
            // Fallback to live scoring calculation
            if (statusText) statusText.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span> Live Stage In Progress`;
            if (badgeOfficial) badgeOfficial.classList.add('hidden');
            await fallbackLiveCalculation();
        }
    }, async (err) => {
        console.error("Display sync error:", err);
        await fallbackLiveCalculation();
    });
}

async function fallbackLiveCalculation() {
    const { comp, group, gender, district } = currentFilter;

    try {
        const stageDoc = await getDoc(doc(db, 'cult_stages', comp));
        const stageData = stageDoc.exists() ? stageDoc.data() : {};
        const panelSize = stageData.panelSize !== undefined ? parseInt(stageData.panelSize) : (comp === 'song' ? 1 : 2);

        const candSnap = await getDocs(query(collection(db, 'cult_candidates'), where('competition', '==', comp)));
        const candsMap = {};

        candSnap.forEach(d => {
            const c = d.data();
            const groupMatch = !group || (c.groupName === group);
            const genderMatch = !gender || (c.gender === gender);
            const districtMatch = !district || (c.district === district);
            if (groupMatch && genderMatch && districtMatch) {
                candsMap[c.trackNo] = c;
            }
        });

        const scoreSnap = await getDocs(query(collection(db, 'cult_scores'), where('competition', '==', comp)));
        let list = [];

        scoreSnap.forEach(d => {
            const s = d.data();
            if (candsMap[s.trackNo]) {
                const c = candsMap[s.trackNo];
                const j1 = s.j1_score !== undefined ? parseFloat(s.j1_score) : null;
                const j2 = s.j2_score !== undefined ? parseFloat(s.j2_score) : null;

                let isComplete = false;
                let total = 0;

                if (panelSize === 1) {
                    if (j1 !== null) {
                        isComplete = true;
                        total = j1;
                    }
                } else {
                    if (j1 !== null && j2 !== null) {
                        isComplete = true;
                        total = j1 + j2;
                    }
                }

                if (isComplete) {
                    list.push({
                        trackNo: s.trackNo,
                        name: c.name || s.candidateName,
                        groupName: c.groupName,
                        gender: c.gender,
                        district: c.district,
                        institution: c.institution || '-',
                        j1Score: j1,
                        j2Score: j2,
                        totalScore: total,
                        finalScore: total.toFixed(2),
                        panelSize: panelSize
                    });
                }
            }
        });

        // Sort descending
        list.sort((a, b) => {
            if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
            return (b.j1Score || 0) - (a.j1Score || 0);
        });

        const ranked = list.map((item, index) => {
            const rank = index + 1;
            let medal = '-';
            if (rank === 1) medal = '🥇 Gold';
            else if (rank === 2) medal = '🥈 Silver';
            else if (rank === 3) medal = '🥉 Bronze';

            return { rank, medal, ...item };
        });

        handleNewStandings(ranked, panelSize);

    } catch (err) {
        console.error("Fallback live calculation error:", err);
    }
}

// ==========================================
// 3. STANDINGS & 3D PODIUM UPDATE
// ==========================================
function handleNewStandings(standings, panelSize) {
    currentStandingsList = standings;
    currentPanelSize = panelSize;

    // 1. Update Left Panel: 3D Top 3 Podium Hero
    const maxScoreLabel = panelSize === 1 ? "/ 50" : "/ 100";
    ['podium-1-max', 'podium-2-max', 'podium-3-max'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = maxScoreLabel;
    });

    updatePodiumCard(1, standings[0] || null);
    updatePodiumCard(2, standings[1] || null);
    updatePodiumCard(3, standings[2] || null);

    // 2. Update Table Header Labels for 1-Judge vs 2-Judge
    const thJ2 = document.getElementById('disp-th-j2');
    const thTotal = document.getElementById('disp-th-total');
    if (thJ2) thJ2.innerHTML = panelSize === 1 ? 'J2 <span class="text-[9px] text-slate-500 font-normal">(N/A)</span>' : 'J2';
    if (thTotal) thTotal.innerHTML = panelSize === 1 ? 'Total (/50)' : 'Total (/100)';

    const totalRankedEl = document.getElementById('disp-total-ranked');
    if (totalRankedEl) totalRankedEl.textContent = `${standings.length} Ranked`;

    // 3. Reset and Start Auto-Cycling Leaderboard
    currentCultPage = 0;
    renderCurrentPage();
    restartAutoCycleTimer();
}

function updatePodiumCard(place, candidate) {
    const nameEl = document.getElementById(`podium-${place}-name`);
    const trackEl = document.getElementById(`podium-${place}-track`);
    const metaEl = document.getElementById(`podium-${place}-meta`);
    const scoreEl = document.getElementById(`podium-${place}-score`);

    if (!nameEl) return;

    if (candidate) {
        nameEl.textContent = candidate.name;
        if (trackEl) trackEl.textContent = `Track #${candidate.trackNo}`;
        const metaStr = [candidate.district, candidate.institution].filter(Boolean).join(' · ');
        if (metaEl) metaEl.textContent = metaStr || candidate.groupName || '';
        if (scoreEl) scoreEl.textContent = candidate.finalScore || `${candidate.totalScore.toFixed(1)}`;
    } else {
        nameEl.textContent = "-- Awaiting --";
        if (trackEl) trackEl.textContent = "Track #--";
        if (metaEl) metaEl.textContent = "--";
        if (scoreEl) scoreEl.textContent = "--";
    }
}

// ==========================================
// 4. ROTATING AUTO-CYCLE LEADERBOARD ENGINE
// ==========================================
function renderCurrentPage() {
    const tbody = document.getElementById('disp-leaderboard-tbody');
    const pageIndicator = document.getElementById('disp-page-indicator');
    if (!tbody) return;

    if (currentStandingsList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-12 text-center text-slate-500 font-mono text-sm">
                    No completed scores found for this filter criteria.
                </td>
            </tr>
        `;
        if (pageIndicator) pageIndicator.textContent = "Page 1 of 1";
        return;
    }

    const totalPages = Math.ceil(currentStandingsList.length / ITEMS_PER_PAGE);
    if (currentCultPage >= totalPages) currentCultPage = 0;
    if (currentCultPage < 0) currentCultPage = totalPages - 1;

    if (pageIndicator) {
        pageIndicator.textContent = `Page ${currentCultPage + 1} of ${totalPages}`;
    }

    const startIndex = currentCultPage * ITEMS_PER_PAGE;
    const pageItems = currentStandingsList.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    let rowsHtml = '';
    pageItems.forEach(s => {
        const isPodium = s.rank <= 3;
        const j2Display = currentPanelSize === 1
            ? '<span class="text-xs text-slate-600 font-mono italic">−</span>'
            : (s.j2Score !== null && s.j2Score !== undefined ? (typeof s.j2Score === 'number' ? s.j2Score.toFixed(1) : s.j2Score) : '−');

        const medalBadge = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : `#${s.rank}`;
        const rowBg = s.rank === 1 
            ? 'bg-yellow-950/20 text-white border-yellow-500/30' 
            : s.rank === 2 
            ? 'bg-slate-900/60 text-white border-slate-700/50' 
            : s.rank === 3 
            ? 'bg-amber-950/20 text-white border-amber-800/30' 
            : 'text-slate-300 border-slate-800/60';

        rowsHtml += `
            <tr class="${rowBg} border-b hover:bg-slate-800/60 transition-colors h-[14.28%]">
                <td class="p-2 sm:p-3 text-center text-base sm:text-lg font-black">${medalBadge}</td>
                <td class="p-2 sm:p-3 font-mono font-bold text-purple-400 text-xs sm:text-sm">#${s.trackNo}</td>
                <td class="p-2 sm:p-3 font-bold text-white text-xs sm:text-sm md:text-base truncate">
                    <span class="block truncate" title="${s.name}">${s.name}</span>
                </td>
                <td class="p-2 sm:p-3 text-slate-400 text-[11px] sm:text-xs truncate">
                    <span class="block truncate" title="${s.district || ''}">${s.district || s.institution || '-'}</span>
                </td>
                <td class="p-2 sm:p-3 text-center font-mono font-bold text-slate-300 text-xs sm:text-sm">
                    ${typeof s.j1Score === 'number' ? s.j1Score.toFixed(1) : s.j1Score}
                </td>
                <td class="p-2 sm:p-3 text-center font-mono font-bold text-slate-300 text-xs sm:text-sm">
                    ${j2Display}
                </td>
                <td class="p-2 sm:p-3 text-right font-mono font-black text-sm sm:text-lg text-emerald-400">
                    ${s.finalScore}
                </td>
            </tr>
        `;
    });

    // Fill remaining rows if last page has fewer than 7 items to keep rigid geometry
    const emptyRowCount = ITEMS_PER_PAGE - pageItems.length;
    for (let i = 0; i < emptyRowCount; i++) {
        rowsHtml += `
            <tr class="border-b border-slate-800/20 h-[14.28%] text-slate-800 select-none">
                <td class="p-2 sm:p-3 text-center">-</td>
                <td class="p-2 sm:p-3">-</td>
                <td class="p-2 sm:p-3">-</td>
                <td class="p-2 sm:p-3">-</td>
                <td class="p-2 sm:p-3 text-center">-</td>
                <td class="p-2 sm:p-3 text-center">-</td>
                <td class="p-2 sm:p-3 text-right">-</td>
            </tr>
        `;
    }

    tbody.innerHTML = rowsHtml;
}

function restartAutoCycleTimer() {
    stopAutoCycleTimer();

    const totalPages = Math.ceil(currentStandingsList.length / ITEMS_PER_PAGE);
    const bar = document.getElementById('cult-progress-bar');

    if (totalPages <= 1 || isAutoCyclePaused) {
        if (bar) bar.style.width = '0%';
        return;
    }

    // Trigger smooth CSS progress bar animation
    if (bar) {
        bar.style.transition = 'none';
        bar.style.width = '0%';
        void bar.offsetWidth; // Force reflow
        bar.style.transition = `width ${PAGE_DURATION_MS}ms linear`;
        bar.style.width = '100%';
    }

    autoCycleTimer = setTimeout(() => {
        if (!isAutoCyclePaused) {
            currentCultPage++;
            renderCurrentPage();
            restartAutoCycleTimer();
        }
    }, PAGE_DURATION_MS);
}

function stopAutoCycleTimer() {
    if (autoCycleTimer) {
        clearTimeout(autoCycleTimer);
        autoCycleTimer = null;
    }
}

function toggleAutoCyclePause() {
    isAutoCyclePaused = !isAutoCyclePaused;
    
    const icon = document.getElementById('cycle-play-icon');
    const text = document.getElementById('cycle-play-text');
    const bar = document.getElementById('cult-progress-bar');

    if (isAutoCyclePaused) {
        stopAutoCycleTimer();
        if (icon) icon.textContent = '⏸';
        if (text) text.textContent = 'PAUSED';
        if (bar) bar.style.width = '0%';
    } else {
        if (icon) icon.textContent = '▶';
        if (text) text.textContent = 'AUTO-CYCLE';
        restartAutoCycleTimer();
    }
}

function prevPage() {
    const totalPages = Math.ceil(currentStandingsList.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;
    currentCultPage--;
    renderCurrentPage();
    if (!isAutoCyclePaused) restartAutoCycleTimer();
}

function nextPage() {
    const totalPages = Math.ceil(currentStandingsList.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;
    currentCultPage++;
    renderCurrentPage();
    if (!isAutoCyclePaused) restartAutoCycleTimer();
}

// ==========================================
// 5. KEYBOARD NAVIGATION & UTILITIES
// ==========================================
function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        // If typing in an input or select, skip
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
                toggleAutoCyclePause();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                prevPage();
                break;
            case 'ArrowRight':
                e.preventDefault();
                nextPage();
                break;
            case 'Escape':
                closeSettingsModal();
                break;
        }
    });
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
    const modal = document.getElementById('cult-settings-modal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        loadFilterOptions();
    } else {
        closeSettingsModal();
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('cult-settings-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function startClock() {
    const clockEl = document.getElementById('disp-clock');
    if (!clockEl) return;
    const tick = () => {
        clockEl.textContent = new Date().toLocaleTimeString();
    };
    tick();
    setInterval(tick, 1000);
}

async function requestScreenWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            document.addEventListener('visibilitychange', async () => {
                if (wakeLock !== null && document.visibilityState === 'visible') {
                    wakeLock = await navigator.wakeLock.request('screen');
                }
            });
        }
    } catch (err) {
        // WakeLock may be rejected if low battery or unsupported
        console.log("WakeLock info:", err.message);
    }
}

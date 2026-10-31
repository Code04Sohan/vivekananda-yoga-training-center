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

// Mode state: 'live' (Reality Show On-Stage) or 'podium' (Leaderboard Standings)
let currentDisplayMode = localStorage.getItem('myst_cult_display_mode') || 'live';
let unsubscribeStageLive = null;
let unsubscribeActiveScore = null;
let unsubscribeRecentPerformers = null;
let currentActiveTrackNo = null;

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
    switchDisplayMode(currentDisplayMode);
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

    const btnToggleMode = document.getElementById('btn-toggle-mode');
    if (btnToggleMode) {
        btnToggleMode.addEventListener('click', () => {
            const nextMode = currentDisplayMode === 'live' ? 'podium' : 'live';
            switchDisplayMode(nextMode);
        });
    }
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

    const btnModeLive = document.getElementById('btn-mode-live');
    const btnModePodium = document.getElementById('btn-mode-podium');
    if (btnModeLive) {
        btnModeLive.addEventListener('click', () => {
            switchDisplayMode('live');
        });
    }
    if (btnModePodium) {
        btnModePodium.addEventListener('click', () => {
            switchDisplayMode('podium');
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

            if (currentDisplayMode === 'live') {
                bindLiveStageSync();
            } else {
                bindDisplaySync();
            }
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
            case 'l':
            case 'L':
                e.preventDefault();
                switchDisplayMode('live');
                break;
            case 'p':
            case 'P':
                e.preventDefault();
                switchDisplayMode('podium');
                break;
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


// ============================================================================
// 6. LIVE ON-STAGE REALITY ARENA ENGINE
// ============================================================================

const STAGE_BACKGROUNDS = {
    drawing: `
        <div class="absolute inset-0 bg-gradient-to-br from-indigo-950/70 via-slate-950 to-purple-950/80"></div>
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(139,92,246,0.18)_0%,transparent_50%),radial-gradient(circle_at_80%_70%,rgba(6,182,212,0.15)_0%,transparent_50%)]"></div>
        <svg class="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid-art" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" stroke-width="0.5" class="text-purple-400" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid-art)" />
          <circle cx="85%" cy="30%" r="180" fill="none" stroke="currentColor" stroke-width="1.5" class="text-purple-500" stroke-dasharray="8 8" />
        </svg>
    `,
    song: `
        <div class="absolute inset-0 bg-gradient-to-br from-blue-950/70 via-slate-950 to-amber-950/50"></div>
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.2)_0%,transparent_60%),radial-gradient(circle_at_80%_80%,rgba(245,158,11,0.15)_0%,transparent_50%)]"></div>
        <svg class="absolute bottom-0 inset-x-0 h-48 w-full opacity-15" preserveAspectRatio="none" viewBox="0 0 1200 200" xmlns="http://www.w3.org/2000/svg">
          <path d="M0,100 C150,160 300,40 450,110 C600,180 750,20 900,90 C1050,160 1150,60 1200,100 L1200,200 L0,200 Z" fill="currentColor" class="text-blue-500" />
          <path d="M0,130 C200,70 350,170 500,120 C650,70 800,160 950,110 C1100,60 1150,140 1200,130 L1200,200 L0,200 Z" fill="currentColor" class="text-amber-500" opacity="0.6" />
        </svg>
    `,
    dance: `
        <div class="absolute inset-0 bg-gradient-to-br from-fuchsia-950/70 via-slate-950 to-purple-950/80"></div>
        <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(217,70,239,0.22)_0%,transparent_60%),radial-gradient(circle_at_20%_80%,rgba(168,85,247,0.18)_0%,transparent_50%)]"></div>
        <svg class="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
          <polygon points="100,0 250,0 600,800 0,800" fill="url(#dance-spotlight-1)" />
          <polygon points="1100,0 950,0 600,800 1200,800" fill="url(#dance-spotlight-2)" />
          <defs>
            <linearGradient id="dance-spotlight-1" x1="0%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stop-color="#d946ef" stop-opacity="0.4" />
              <stop offset="100%" stop-color="#d946ef" stop-opacity="0" />
            </linearGradient>
            <linearGradient id="dance-spotlight-2" x1="100%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.4" />
              <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0" />
            </linearGradient>
          </defs>
        </svg>
    `,
    recital: `
        <div class="absolute inset-0 bg-gradient-to-br from-amber-950/70 via-slate-950 to-yellow-950/60"></div>
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(245,158,11,0.2)_0%,transparent_50%),radial-gradient(circle_at_80%_80%,rgba(217,119,6,0.12)_0%,transparent_50%)]"></div>
        <svg class="absolute inset-0 w-full h-full opacity-15" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="recital-scroll" width="60" height="60" patternUnits="userSpaceOnUse">
              <circle cx="30" cy="30" r="1.5" fill="#f59e0b" />
              <path d="M 0 30 Q 30 0 60 30" fill="none" stroke="#d97706" stroke-width="0.5" opacity="0.4" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#recital-scroll)" />
        </svg>
    `
};

function switchDisplayMode(mode) {
    currentDisplayMode = mode;
    localStorage.setItem('myst_cult_display_mode', mode);

    const viewLive = document.getElementById('view-cult-live');
    const viewPodium = document.getElementById('view-cult-podium');
    const btnModeLive = document.getElementById('btn-mode-live');
    const btnModePodium = document.getElementById('btn-mode-podium');
    const headerModeText = document.getElementById('mode-text');
    const headerModeIcon = document.getElementById('mode-icon');
    const btnPause = document.getElementById('btn-toggle-pause');
    const progressBar = document.getElementById('cult-progress-bar');

    if (mode === 'live') {
        if (viewLive) { viewLive.classList.remove('hidden'); viewLive.classList.add('flex'); }
        if (viewPodium) { viewPodium.classList.add('hidden'); viewPodium.classList.remove('flex'); }
        
        if (btnModeLive) btnModeLive.className = "flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-purple-600 text-white transition-all shadow-md cursor-pointer";
        if (btnModePodium) btnModePodium.className = "flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-slate-400 hover:text-white transition-all cursor-pointer";
        
        if (headerModeText) headerModeText.textContent = "LIVE ON-STAGE";
        if (headerModeIcon) { headerModeIcon.textContent = "🔴"; headerModeIcon.className = "text-red-500 animate-pulse"; }
        if (btnPause) btnPause.classList.add('hidden');
        if (progressBar) progressBar.classList.add('hidden');

        stopAutoCycleTimer();
        bindLiveStageSync();
    } else {
        if (viewLive) { viewLive.classList.add('hidden'); viewLive.classList.remove('flex'); }
        if (viewPodium) { viewPodium.classList.remove('hidden'); viewPodium.classList.add('flex'); }
        
        if (btnModeLive) btnModeLive.className = "flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-slate-400 hover:text-white transition-all cursor-pointer";
        if (btnModePodium) btnModePodium.className = "flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-purple-600 text-white transition-all shadow-md cursor-pointer";

        if (headerModeText) headerModeText.textContent = "STANDINGS PODIUM";
        if (headerModeIcon) { headerModeIcon.textContent = "🏆"; headerModeIcon.className = "text-yellow-400"; }
        if (btnPause) btnPause.classList.remove('hidden');
        if (progressBar) progressBar.classList.remove('hidden');

        if (unsubscribeStageLive) unsubscribeStageLive();
        if (unsubscribeActiveScore) unsubscribeActiveScore();
        if (unsubscribeRecentPerformers) unsubscribeRecentPerformers();

        bindDisplaySync();
        if (!isAutoCyclePaused) restartAutoCycleTimer();
    }
}

function bindLiveStageSync() {
    if (unsubscribeStageLive) unsubscribeStageLive();
    if (unsubscribeActiveScore) unsubscribeActiveScore();
    if (unsubscribeRecentPerformers) unsubscribeRecentPerformers();

    const comp = currentFilter.comp || 'drawing';
    renderLiveStageBackground(comp);

    // 1. Listen to cult_stages/{comp} for activeCandidate & panelSize
    const stageRef = doc(db, 'cult_stages', comp);
    unsubscribeStageLive = onSnapshot(stageRef, (docSnap) => {
        let stageData = docSnap.exists() ? docSnap.data() : null;
        let activeCand = stageData?.activeCandidate || null;
        let panelSize = stageData?.panelSize !== undefined ? parseInt(stageData.panelSize) : (comp === 'song' ? 1 : 2);
        currentPanelSize = panelSize;

        const j1Name = stageData?.j1_name || 'Judge 1';
        const j2Name = stageData?.j2_name || 'Judge 2';
        updateJudgeLabels(panelSize, j1Name, j2Name);

        const isDifferentCandidate = (activeCand?.trackNo || null) !== currentActiveTrackNo;
        currentActiveTrackNo = activeCand?.trackNo || null;

        renderActivePerformer(activeCand, panelSize, isDifferentCandidate);

        if (activeCand?.trackNo) {
            if (isDifferentCandidate) {
                listenToActiveCandidateScore(comp, activeCand.trackNo, panelSize);
            }
        } else {
            if (unsubscribeActiveScore) unsubscribeActiveScore();
            resetActiveScoreDisplay(panelSize);
        }
    });

    // 2. Listen to Recent Performers (completed scores in this comp)
    const qRecent = query(
        collection(db, 'cult_scores'), 
        where('competition', '==', comp),
        where('status', '==', 'completed')
    );
    unsubscribeRecentPerformers = onSnapshot(qRecent, (snapshot) => {
        const completedList = [];
        snapshot.forEach(docSnap => {
            completedList.push(docSnap.data());
        });
        completedList.sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));
        renderRecentPerformers(completedList);
    });
}

function renderLiveStageBackground(comp) {
    const bgContainer = document.getElementById('live-stage-bg');
    if (bgContainer) {
        bgContainer.innerHTML = STAGE_BACKGROUNDS[comp] || STAGE_BACKGROUNDS.drawing;
    }

    const pill = document.getElementById('live-comp-pill');
    const compIcons = { drawing: '🎨', song: '🎵', dance: '💃', recital: '📜' };
    const compNames = { drawing: 'Drawing Arena', song: 'Song (Music) Arena', dance: 'Dance Arena', recital: 'Recital Arena' };
    if (pill) {
        pill.textContent = `${compIcons[comp] || '🎭'} ${compNames[comp] || comp.toUpperCase()}`;
    }

    const watermark = document.getElementById('live-watermark-icon');
    if (watermark) {
        watermark.textContent = compIcons[comp] || '🎭';
    }
}

function updateJudgeLabels(panelSize, j1Name, j2Name) {
    const j1Label = document.getElementById('live-j1-label');
    const j1NameEl = document.getElementById('live-j1-name');
    const j2Label = document.getElementById('live-j2-label');
    const j2NameEl = document.getElementById('live-j2-name');
    const j2Card = document.getElementById('live-j2-card');

    if (panelSize === 1) {
        if (j1Label) j1Label.textContent = "Solo Judge";
        if (j1NameEl) j1NameEl.textContent = j1Name;
        if (j2Card) j2Card.classList.add('hidden');
    } else {
        if (j1Label) j1Label.textContent = "Judge 1 (Head)";
        if (j1NameEl) j1NameEl.textContent = j1Name;
        if (j2Label) j2Label.textContent = "Judge 2 (Panel)";
        if (j2NameEl) j2NameEl.textContent = j2Name;
        if (j2Card) j2Card.classList.remove('hidden');
    }
}

function renderActivePerformer(candidate, panelSize, isNewPerformer = false) {
    const activeSection = document.getElementById('live-active-performer');
    const standbySection = document.getElementById('live-stage-standby');

    const trackEl = document.getElementById('live-performer-track');
    const nameEl = document.getElementById('live-performer-name');
    const groupEl = document.getElementById('live-performer-group');
    const genderEl = document.getElementById('live-performer-gender');
    const distEl = document.getElementById('live-performer-district');

    if (!candidate) {
        currentActiveTrackNo = null;
        if (activeSection) activeSection.classList.add('hidden');
        if (standbySection) { standbySection.classList.remove('hidden'); standbySection.classList.add('flex'); }
        resetActiveScoreDisplay(panelSize);
        return;
    }

    if (standbySection) { standbySection.classList.add('hidden'); standbySection.classList.remove('flex'); }
    if (activeSection) {
        activeSection.classList.remove('hidden');
        if (isNewPerformer) {
            activeSection.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            activeSection.style.opacity = '0';
            activeSection.style.transform = 'scale(0.98)';
            setTimeout(() => {
                activeSection.style.opacity = '1';
                activeSection.style.transform = 'scale(1)';
            }, 30);
        }
    }

    if (trackEl) trackEl.textContent = `#${candidate.trackNo || '--'}`;
    if (nameEl) nameEl.textContent = candidate.name || 'Performer';
    if (groupEl) groupEl.textContent = candidate.groupName || 'All Groups';
    if (genderEl) genderEl.textContent = candidate.gender || 'All Genders';
    if (distEl) distEl.textContent = `${candidate.district || ''} ${candidate.institution ? '· ' + candidate.institution : ''}`;
}

function listenToActiveCandidateScore(comp, trackNo, panelSize) {
    if (unsubscribeActiveScore) unsubscribeActiveScore();
    const scoreRef = doc(db, 'cult_scores', `${comp}_${trackNo}`);

    unsubscribeActiveScore = onSnapshot(scoreRef, (docSnap) => {
        if (!docSnap.exists()) {
            resetActiveScoreDisplay(panelSize);
            return;
        }
        const scoreData = docSnap.data();
        renderLiveScoreboard(scoreData, panelSize);
    });
}

function renderLiveScoreboard(scoreData, panelSize) {
    const j1ScoreEl = document.getElementById('live-j1-score');
    const j1Badge = document.getElementById('live-j1-badge');
    const j1Card = document.getElementById('live-j1-card');

    const j2ScoreEl = document.getElementById('live-j2-score');
    const j2Badge = document.getElementById('live-j2-badge');
    const j2Card = document.getElementById('live-j2-card');

    const totalScoreEl = document.getElementById('live-total-score');
    const totalMaxEl = document.getElementById('live-total-max');
    const totalStatusEl = document.getElementById('live-total-status');
    const totalCard = document.getElementById('live-total-card');
    const totalIcon = document.getElementById('live-total-icon');
    const stageStatusBadge = document.getElementById('live-stage-status-badge');
    const stageStatusText = document.getElementById('live-stage-status-text');

    if (!scoreData) {
        resetActiveScoreDisplay(panelSize);
        return;
    }

    // --- JUDGE 1 EVALUATION ---
    const hasJ1 = scoreData.j1_score !== undefined && scoreData.j1_score !== null;
    if (hasJ1) {
        const val1 = parseFloat(scoreData.j1_score);
        if (j1ScoreEl) {
            j1ScoreEl.textContent = val1.toFixed(1);
            j1ScoreEl.className = "text-2xl sm:text-3xl font-black font-mono text-emerald-400 transition-colors duration-300";
        }
        if (j1Badge) {
            j1Badge.textContent = "✅ Locked In";
            j1Badge.className = "text-[9px] sm:text-[10px] font-mono font-bold px-2.5 py-1 rounded-full uppercase tracking-wider bg-emerald-950/80 text-emerald-300 border border-emerald-700/80";
        }
        if (j1Card) {
            j1Card.className = "bg-slate-950/90 border-2 border-emerald-500/80 rounded-2xl p-3 sm:p-3.5 flex flex-col justify-between shadow-xl shadow-emerald-950/30 transition-all duration-500 relative overflow-hidden";
        }
    } else {
        if (j1ScoreEl) {
            j1ScoreEl.textContent = "--.-";
            j1ScoreEl.className = "text-2xl sm:text-3xl font-black font-mono text-slate-400 transition-colors duration-300";
        }
        if (j1Badge) {
            j1Badge.textContent = "⏳ Evaluating";
            j1Badge.className = "text-[9px] sm:text-[10px] font-mono font-bold px-2.5 py-1 rounded-full uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700";
        }
        if (j1Card) {
            j1Card.className = "bg-slate-950/90 border-2 border-slate-700 rounded-2xl p-3 sm:p-3.5 flex flex-col justify-between shadow-xl transition-all duration-500 relative overflow-hidden";
        }
    }

    // --- JUDGE 2 EVALUATION (IF 2 JUDGES) ---
    if (panelSize === 2) {
        if (j2Card) j2Card.classList.remove('hidden');
        const hasJ2 = scoreData.j2_score !== undefined && scoreData.j2_score !== null;
        if (hasJ2) {
            const val2 = parseFloat(scoreData.j2_score);
            if (j2ScoreEl) {
                j2ScoreEl.textContent = val2.toFixed(1);
                j2ScoreEl.className = "text-2xl sm:text-3xl font-black font-mono text-emerald-400 transition-colors duration-300";
            }
            if (j2Badge) {
                j2Badge.textContent = "✅ Locked In";
                j2Badge.className = "text-[9px] sm:text-[10px] font-mono font-bold px-2.5 py-1 rounded-full uppercase tracking-wider bg-emerald-950/80 text-emerald-300 border border-emerald-700/80";
            }
            if (j2Card) {
                j2Card.className = "bg-slate-950/90 border-2 border-emerald-500/80 rounded-2xl p-3 sm:p-3.5 flex flex-col justify-between shadow-xl shadow-emerald-950/30 transition-all duration-500 relative overflow-hidden";
            }
        } else {
            if (j2ScoreEl) {
                j2ScoreEl.textContent = "--.-";
                j2ScoreEl.className = "text-2xl sm:text-3xl font-black font-mono text-slate-400 transition-colors duration-300";
            }
            if (j2Badge) {
                j2Badge.textContent = "⏳ Evaluating";
                j2Badge.className = "text-[9px] sm:text-[10px] font-mono font-bold px-2.5 py-1 rounded-full uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700";
            }
            if (j2Card) {
                j2Card.className = "bg-slate-950/90 border-2 border-slate-700 rounded-2xl p-3 sm:p-3.5 flex flex-col justify-between shadow-xl transition-all duration-500 relative overflow-hidden";
            }
        }
    } else {
        if (j2Card) j2Card.classList.add('hidden');
    }

    // --- GRAND TOTAL REVEAL ---
    if (panelSize === 1) {
        if (totalMaxEl) totalMaxEl.textContent = "/ 50";
        if (hasJ1) {
            const val1 = parseFloat(scoreData.j1_score);
            if (totalScoreEl) {
                totalScoreEl.textContent = val1.toFixed(1);
                totalScoreEl.className = "text-2xl sm:text-4xl font-black font-mono text-yellow-400 tracking-tight";
            }
            if (totalStatusEl) totalStatusEl.textContent = "🏆 Solo Performance Scored & Locked";
            if (totalCard) {
                totalCard.className = "bg-gradient-to-r from-yellow-950/40 via-slate-900 to-amber-950/40 border-2 border-yellow-500/80 rounded-2xl p-3 sm:p-4 flex items-center justify-between shadow-2xl shadow-yellow-950/50 transition-all duration-500";
            }
            if (totalIcon) totalIcon.textContent = "🏆";
            if (stageStatusBadge) {
                stageStatusBadge.className = "text-[10px] sm:text-xs font-mono font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5";
            }
            if (stageStatusText) stageStatusText.textContent = "Performance Scored";
        } else {
            if (totalScoreEl) {
                totalScoreEl.textContent = "--.-";
                totalScoreEl.className = "text-2xl sm:text-4xl font-black font-mono text-white tracking-tight";
            }
            if (totalStatusEl) totalStatusEl.textContent = "Waiting for solo judge score...";
            if (totalCard) {
                totalCard.className = "bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-2 border-slate-700 rounded-2xl p-3 sm:p-4 flex items-center justify-between shadow-2xl transition-all duration-500";
            }
            if (totalIcon) totalIcon.textContent = "🎯";
            if (stageStatusBadge) {
                stageStatusBadge.className = "text-[10px] sm:text-xs font-mono font-bold text-amber-400 bg-amber-950/40 border border-amber-800/60 px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5";
            }
            if (stageStatusText) stageStatusText.textContent = "Performance in Progress";
        }
    } else {
        if (totalMaxEl) totalMaxEl.textContent = "/ 100";
        const isComplete = scoreData.status === 'completed' || (hasJ1 && scoreData.j2_score !== undefined && scoreData.j2_score !== null);
        if (isComplete) {
            const tot = scoreData.total_score !== undefined ? parseFloat(scoreData.total_score) : (parseFloat(scoreData.j1_score) + parseFloat(scoreData.j2_score));
            if (totalScoreEl) {
                totalScoreEl.textContent = tot.toFixed(1);
                totalScoreEl.className = "text-2xl sm:text-4xl font-black font-mono text-yellow-400 tracking-tight animate-bounce";
                setTimeout(() => {
                    totalScoreEl.classList.remove('animate-bounce');
                }, 1000);
            }
            if (totalStatusEl) totalStatusEl.textContent = "🏆 Official Combined Score Confirmed";
            if (totalCard) {
                totalCard.className = "bg-gradient-to-r from-yellow-950/40 via-slate-900 to-amber-950/40 border-2 border-yellow-500/80 rounded-2xl p-3 sm:p-4 flex items-center justify-between shadow-2xl shadow-yellow-950/50 transition-all duration-500";
            }
            if (totalIcon) totalIcon.textContent = "🏆";
            if (stageStatusBadge) {
                stageStatusBadge.className = "text-[10px] sm:text-xs font-mono font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5";
            }
            if (stageStatusText) stageStatusText.textContent = "Performance Scored";
        } else if (hasJ1 || (scoreData.j2_score !== undefined && scoreData.j2_score !== null)) {
            if (totalScoreEl) {
                totalScoreEl.textContent = "--.-";
                totalScoreEl.className = "text-2xl sm:text-4xl font-black font-mono text-slate-300 tracking-tight";
            }
            if (totalStatusEl) totalStatusEl.textContent = "1 of 2 Judges Submitted · Awaiting Final Score...";
            if (totalCard) {
                totalCard.className = "bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-2 border-indigo-500/60 rounded-2xl p-3 sm:p-4 flex items-center justify-between shadow-2xl transition-all duration-500";
            }
            if (totalIcon) totalIcon.textContent = "✍️";
            if (stageStatusBadge) {
                stageStatusBadge.className = "text-[10px] sm:text-xs font-mono font-bold text-amber-400 bg-amber-950/40 border border-amber-800/60 px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5";
            }
            if (stageStatusText) stageStatusText.textContent = "Scoring in Progress";
        } else {
            if (totalScoreEl) {
                totalScoreEl.textContent = "--.-";
                totalScoreEl.className = "text-2xl sm:text-4xl font-black font-mono text-white tracking-tight";
            }
            if (totalStatusEl) totalStatusEl.textContent = "Waiting for official scores...";
            if (totalCard) {
                totalCard.className = "bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-2 border-slate-700 rounded-2xl p-3 sm:p-4 flex items-center justify-between shadow-2xl transition-all duration-500";
            }
            if (totalIcon) totalIcon.textContent = "🎯";
            if (stageStatusBadge) {
                stageStatusBadge.className = "text-[10px] sm:text-xs font-mono font-bold text-amber-400 bg-amber-950/40 border border-amber-800/60 px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5";
            }
            if (stageStatusText) stageStatusText.textContent = "Performance in Progress";
        }
    }
}

function resetActiveScoreDisplay(panelSize) {
    const j1ScoreEl = document.getElementById('live-j1-score');
    const j1Badge = document.getElementById('live-j1-badge');
    const j1Card = document.getElementById('live-j1-card');

    const j2ScoreEl = document.getElementById('live-j2-score');
    const j2Badge = document.getElementById('live-j2-badge');
    const j2Card = document.getElementById('live-j2-card');

    const totalScoreEl = document.getElementById('live-total-score');
    const totalMaxEl = document.getElementById('live-total-max');
    const totalStatusEl = document.getElementById('live-total-status');
    const totalCard = document.getElementById('live-total-card');
    const totalIcon = document.getElementById('live-total-icon');
    const stageStatusBadge = document.getElementById('live-stage-status-badge');
    const stageStatusText = document.getElementById('live-stage-status-text');

    if (j1ScoreEl) {
        j1ScoreEl.textContent = "--.-";
        j1ScoreEl.className = "text-2xl sm:text-3xl font-black font-mono text-slate-400 transition-colors duration-300";
    }
    if (j1Badge) {
        j1Badge.textContent = "⏳ Evaluating";
        j1Badge.className = "text-[9px] sm:text-[10px] font-mono font-bold px-2.5 py-1 rounded-full uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700";
    }
    if (j1Card) {
        j1Card.className = "bg-slate-950/90 border-2 border-slate-700 rounded-2xl p-3 sm:p-3.5 flex flex-col justify-between shadow-xl transition-all duration-500 relative overflow-hidden";
    }

    if (panelSize === 1) {
        if (j2Card) j2Card.classList.add('hidden');
        if (totalMaxEl) totalMaxEl.textContent = "/ 50";
    } else {
        if (j2Card) j2Card.classList.remove('hidden');
        if (totalMaxEl) totalMaxEl.textContent = "/ 100";
        if (j2ScoreEl) {
            j2ScoreEl.textContent = "--.-";
            j2ScoreEl.className = "text-2xl sm:text-3xl font-black font-mono text-slate-400 transition-colors duration-300";
        }
        if (j2Badge) {
            j2Badge.textContent = "⏳ Evaluating";
            j2Badge.className = "text-[9px] sm:text-[10px] font-mono font-bold px-2.5 py-1 rounded-full uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700";
        }
        if (j2Card) {
            j2Card.className = "bg-slate-950/90 border-2 border-slate-700 rounded-2xl p-3 sm:p-3.5 flex flex-col justify-between shadow-xl transition-all duration-500 relative overflow-hidden";
        }
    }

    if (totalScoreEl) {
        totalScoreEl.textContent = "--.-";
        totalScoreEl.className = "text-2xl sm:text-4xl font-black font-mono text-white tracking-tight";
    }
    if (totalStatusEl) totalStatusEl.textContent = "Waiting for official scores...";
    if (totalCard) {
        totalCard.className = "bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-2 border-slate-700 rounded-2xl p-3 sm:p-4 flex items-center justify-between shadow-2xl transition-all duration-500";
    }
    if (totalIcon) totalIcon.textContent = "🎯";
    if (stageStatusBadge) {
        stageStatusBadge.className = "text-[10px] sm:text-xs font-mono font-bold text-amber-400 bg-amber-950/40 border border-amber-800/60 px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5";
    }
    if (stageStatusText) stageStatusText.textContent = "Performance in Progress";
}

function renderRecentPerformers(completedList) {
    const listEl = document.getElementById('live-recent-list');
    const countEl = document.getElementById('live-recent-count');

    if (countEl) countEl.textContent = `${completedList.length} Recorded`;
    if (!listEl) return;

    if (!completedList || completedList.length === 0) {
        listEl.innerHTML = `<div class="p-8 text-center text-slate-500 font-mono text-xs">No recent performers recorded yet.</div>`;
        return;
    }

    const recent = completedList.slice(0, 6);

    listEl.innerHTML = recent.map((item, idx) => {
        const isSolo = item.panelSize === 1;
        const maxScore = isSolo ? 50 : 100;
        const scoreVal = item.total_score !== undefined ? parseFloat(item.total_score).toFixed(1) : (isSolo && item.j1_score !== undefined ? parseFloat(item.j1_score).toFixed(1) : '--');

        let medalBadge = '';
        if (idx === 0) medalBadge = '🥇';
        else if (idx === 1) medalBadge = '🥈';
        else if (idx === 2) medalBadge = '🥉';

        const isCurrentlyOnStage = currentActiveTrackNo && String(item.trackNo) === String(currentActiveTrackNo);
        const cardBorderClass = isCurrentlyOnStage 
            ? 'border-purple-500/80 bg-purple-950/30 shadow-md shadow-purple-950/40' 
            : 'border-slate-800/80 bg-slate-950/60 hover:border-purple-500/40';

        return `
            <div class="${cardBorderClass} border rounded-xl p-2.5 sm:p-3 flex items-center justify-between gap-3 transition-colors">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-8 h-8 rounded-lg ${isCurrentlyOnStage ? 'bg-purple-900 border-purple-500 text-purple-200' : 'bg-slate-800 border-slate-700 text-purple-300'} border flex items-center justify-center font-mono font-black text-xs shrink-0">
                        #${item.trackNo || '-'}
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <h4 class="text-xs sm:text-sm font-black text-white truncate">${item.candidateName || 'Candidate'}</h4>
                            ${medalBadge ? `<span class="text-xs">${medalBadge}</span>` : ''}
                            ${isCurrentlyOnStage ? `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-300 border border-purple-700/60">Stage Result</span>` : ''}
                        </div>
                        <p class="text-[10px] text-slate-400 truncate">${item.groupName || ''} · ${item.district || '-'}</p>
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <div class="text-sm sm:text-base font-black font-mono text-emerald-400">${scoreVal}</div>
                    <div class="text-[9px] text-slate-500 font-mono">/ ${maxScore}</div>
                </div>
            </div>
        `;
    }).join('');
}

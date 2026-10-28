// ============================================================================
// MYST 2.0: CULTURAL & PERFORMING ARTS PUBLIC DISPLAY ENGINE
// Real-time Projector / Screen Leaderboard for Drawing, Song, Dance, Recital
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

let unsubscribeDisplay = null;
let currentFilter = { comp: 'drawing', group: '', gender: '', district: '' };

document.addEventListener('DOMContentLoaded', () => {
    initDisplayControls();
    initFilterSelectors();
    bindDisplaySync();
});

function initDisplayControls() {
    const btnFullscreen = document.getElementById('btn-toggle-fullscreen');
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.warn("Fullscreen request error:", err);
                });
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
            }
        });
    }
}

async function initFilterSelectors() {
    const compSelect = document.getElementById('disp-comp-select');
    const groupSelect = document.getElementById('disp-group-select');
    const genderSelect = document.getElementById('disp-gender-select');
    const districtSelect = document.getElementById('disp-district-select');

    if (compSelect) {
        compSelect.addEventListener('change', async () => {
            currentFilter.comp = compSelect.value;
            await loadFilterOptions();
            bindDisplaySync();
        });
    }

    [groupSelect, genderSelect, districtSelect].forEach(sel => {
        if (sel) {
            sel.addEventListener('change', () => {
                currentFilter.group = groupSelect ? groupSelect.value : '';
                currentFilter.gender = genderSelect ? genderSelect.value : '';
                currentFilter.district = districtSelect ? districtSelect.value : '';
                bindDisplaySync();
            });
        }
    });

    await loadFilterOptions();
}

async function loadFilterOptions() {
    const comp = currentFilter.comp;
    const groupSelect = document.getElementById('disp-group-select');
    const genderSelect = document.getElementById('disp-gender-select');
    const districtSelect = document.getElementById('disp-district-select');

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
            groupSelect.innerHTML = '<option value="">-- All Age Groups --</option>' + 
                groups.sort().map(g => `<option value="${g}">${g}</option>`).join('');
        }

        if (genderSelect) {
            genderSelect.innerHTML = '<option value="">-- All Genders --</option>' + 
                genders.sort().map(gen => `<option value="${gen}">${gen}</option>`).join('');
        }

        if (districtSelect) {
            districtSelect.innerHTML = '<option value="">-- All Districts --</option>' + 
                districts.sort().map(d => `<option value="${d}">${d}</option>`).join('');
        }
    } catch (err) {
        console.error("Filter load error:", err);
    }
}

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
    const timestampEl = document.getElementById('disp-timestamp');

    // 1. Try listening to Official Published Results
    unsubscribeDisplay = onSnapshot(resultRef, async (docSnap) => {
        if (timestampEl) timestampEl.textContent = `Last Synced: ${new Date().toLocaleTimeString()}`;

        if (docSnap.exists()) {
            const data = docSnap.data();
            if (statusText) statusText.textContent = `Official Published Podium (${cleanComp.toUpperCase()}) · Verified Official`;
            renderPodiumAndTable(data.standings || []);
        } else {
            // If not published yet, fallback to live calculation
            if (statusText) statusText.textContent = `Live Stage Standings (${cleanComp.toUpperCase()}) · Live Scoring in Progress`;
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

                if (j1 !== null && j2 !== null) {
                    const total = j1 + j2;
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
                        finalScore: total.toFixed(2)
                    });
                }
            }
        });

        // Sort
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

        renderPodiumAndTable(ranked);

    } catch (err) {
        console.error("Fallback live calculation error:", err);
    }
}

function renderPodiumAndTable(standings) {
    const totalRankedEl = document.getElementById('disp-total-ranked');
    const tbody = document.getElementById('disp-leaderboard-tbody');

    if (totalRankedEl) totalRankedEl.textContent = `${standings.length} Candidates Ranked`;

    // 1. Update Podium Cards
    const first = standings[0] || null;
    const second = standings[1] || null;
    const third = standings[2] || null;

    updatePodiumCard(1, first);
    updatePodiumCard(2, second);
    updatePodiumCard(3, third);

    // 2. Render Full Standings Table
    if (!tbody) return;

    if (standings.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="p-12 text-center text-slate-500 font-mono text-sm">
                    No completed scores found for this filter criteria.
                </td>
            </tr>
        `;
        return;
    }

    let rowsHtml = '';
    standings.forEach(s => {
        const isPodium = s.rank <= 3;
        rowsHtml += `
            <tr class="${isPodium ? 'bg-slate-900/90 font-bold border-purple-500/20' : 'text-slate-400'} border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                <td class="p-4 text-xl tracking-tight font-black">${s.medal !== '-' ? s.medal : s.rank}</td>
                <td class="p-4 font-mono font-black text-purple-400 text-base">#${s.trackNo}</td>
                <td class="p-4 text-white text-base font-bold">${s.name}</td>
                <td class="p-4 text-xs text-slate-300">${s.groupName || '-'}</td>
                <td class="p-4 text-xs text-slate-400">${s.district || '-'}</td>
                <td class="p-4 text-xs text-slate-400">${s.institution || '-'}</td>
                <td class="p-4 text-center font-mono font-bold text-slate-300">${typeof s.j1Score === 'number' ? s.j1Score.toFixed(1) : s.j1Score}</td>
                <td class="p-4 text-center font-mono font-bold text-slate-300">${typeof s.j2Score === 'number' ? s.j2Score.toFixed(1) : s.j2Score}</td>
                <td class="p-4 text-right font-mono font-black text-2xl text-emerald-400">${s.finalScore}</td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
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
        if (metaEl) metaEl.textContent = `${candidate.district || ''} ${candidate.institution ? `· ${candidate.institution}` : ''}`;
        if (scoreEl) scoreEl.textContent = candidate.finalScore || `${candidate.totalScore.toFixed(1)}`;
    } else {
        nameEl.textContent = "-- Awaiting Results --";
        if (trackEl) trackEl.textContent = "Track #--";
        if (metaEl) metaEl.textContent = "--";
        if (scoreEl) scoreEl.textContent = "--";
    }
}


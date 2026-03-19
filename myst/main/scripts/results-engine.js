// ============================================================================
// MODULE 8: RESULTS & MEDALS ENGINE
// Strictly Calculation and Publishing Logic
// ============================================================================

import { collection, getDocs, getDoc, doc, setDoc, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

let currentCalculatedStandings = [];
let currentTarget = {};

export function initResultsEngine() {
    const btnCalc = document.getElementById('btn-calculate-results');
    const btnPublish = document.getElementById('btn-publish-results');

    // Auto-populate the dropdowns when the tab is clicked
    document.getElementById('nav-results-engine')?.addEventListener('click', () => {
        populateResultFilters();
    });

    if (btnCalc) btnCalc.addEventListener('click', calculateGroupResults);
    if (btnPublish) btnPublish.addEventListener('click', publishGroupResults);
}

// 1. Populate filters (Group, Gender, District)
async function populateResultFilters() {
    try {
        const snap = await getDocs(collection(db, 'candidates'));
        const cats = new Set(), gens = new Set(), dists = new Set();
        
        snap.forEach(doc => {
            const data = doc.data();
            if (data.groupName || data.group) cats.add(data.groupName || data.group);
            if (data.gender) gens.add(data.gender);
            if (data.state || data.district) dists.add(data.state || data.district);
        });

        const fillSelect = (id, set, defaultText) => {
            const el = document.getElementById(id);
            if(!el) return;
            el.innerHTML = `<option value="">-- ${defaultText} --</option>`;
            [...set].sort().forEach(item => el.innerHTML += `<option value="${item}">${item}</option>`);
        };

        fillSelect('res-category-select', cats, 'Select Group');
        fillSelect('res-gender-select', gens, 'Select Gender');
        fillSelect('res-district-select', dists, 'All Districts (Optional)');
    } catch (error) {
        console.error("Error loading result filters:", error);
    }
}

// 2. The Multi-Division Olympic Math Engine
async function calculateGroupResults() {
    const cat = document.getElementById('res-category-select').value;
    const gen = document.getElementById('res-gender-select').value;
    const dist = document.getElementById('res-district-select')?.value;

    if (!cat || !gen) return alert("Please select Group and Gender to calculate.");

    currentTarget = { group: cat, gender: gen, district: dist };
    const btnCalc = document.getElementById('btn-calculate-results');
    btnCalc.innerText = "⏳ Processing Olympic Math...";

    try {
        const qCands = query(collection(db, 'candidates'), where('gender', '==', gen));
        const candSnap = await getDocs(qCands);
        
        const targetCandidates = {};
        candSnap.forEach(d => {
            const data = d.data();
            const groupMatch = (data.groupName === cat || data.group === cat);
            const distMatch = !dist || (data.state === dist || data.district === dist);
            if (groupMatch && distMatch) targetCandidates[d.id] = data;
        });

        if (Object.keys(targetCandidates).length === 0) {
            alert("No athletes found for this specific filter.");
            btnCalc.innerText = "📊 Calculate Standings";
            return;
        }

        const scoresQ = query(collection(db, 'scores'), where('status', '==', 'active'));
        const scoresSnap = await getDocs(scoresQ);
        
        let rawResults = [];

        scoresSnap.forEach(d => {
            const scoreData = d.data();
            const trackNo = scoreData.trackNo || d.id; 
            
            if (targetCandidates[trackNo]) {
                const c = targetCandidates[trackNo];
                const getJudgeSum = (prefix) => (parseFloat(scoreData[`${prefix}_a1`])||0) + (parseFloat(scoreData[`${prefix}_a2`])||0) + (parseFloat(scoreData[`${prefix}_opt`])||0);
                const getOptSum = (prefix) => parseFloat(scoreData[`${prefix}_opt`]) || 0;

                const j1 = getJudgeSum('j1'), j2 = getJudgeSum('j2'), j3 = getJudgeSum('j3'), j4 = getJudgeSum('j4'), j5 = getJudgeSum('j5');
                const panel = [j1, j2, j3, j4, j5];
                const totalScore = j1 + j2 + j3 + j4 + j5 - Math.max(...panel) - Math.min(...panel);
                const totalOpt = getOptSum('j1') + getOptSum('j2') + getOptSum('j3') + getOptSum('j4') + getOptSum('j5');

                rawResults.push({
                    trackNo: trackNo,
                    name: c.name || scoreData.candidateName,
                    coachName: c.coachName || 'Independent',
                    division: c.division || scoreData.division || 'Unassigned',
                    district: c.state || c.district || scoreData.state || 'Unknown',
                    totalOpt: totalOpt,
                    j1Score: j1,
                    finalScore: totalScore.toFixed(2)
                });
            }
        });

        if (rawResults.length === 0) {
            document.getElementById('results-table-container').innerHTML = `<p class="text-red-400">Athletes found, but no active scores exist yet.</p>`;
            return;
        }

        const useOptTie = document.getElementById('setting-tie-optional')?.checked;
        const useJ1Tie = document.getElementById('setting-tie-headjudge')?.checked;
        const divisionsMap = {};
        rawResults.forEach(r => {
            if (!divisionsMap[r.division]) divisionsMap[r.division] = [];
            divisionsMap[r.division].push(r);
        });

        currentCalculatedStandings = [];

        Object.keys(divisionsMap).sort().forEach(div => {
            let divResults = divisionsMap[div];
            divResults.sort((a, b) => {
                if (parseFloat(b.finalScore) !== parseFloat(a.finalScore)) return parseFloat(b.finalScore) - parseFloat(a.finalScore);
                if (useOptTie && b.totalOpt !== a.totalOpt) return b.totalOpt - a.totalOpt;
                if (useJ1Tie && b.j1Score !== a.j1Score) return b.j1Score - a.j1Score;
                return 0; 
            });

            divResults.forEach((r, index) => {
                currentCalculatedStandings.push({
                    rank: index + 1,
                    medal: index === 0 ? '🥇 Gold' : index === 1 ? '🥈 Silver' : index === 2 ? '🥉 Bronze' : '-',
                    ...r
                });
            });
        });

        renderResultsTable(currentCalculatedStandings);
        document.getElementById('btn-publish-results').disabled = false;

    } catch (error) {
        console.error("Results Error:", error);
    } finally {
        btnCalc.innerText = "📊 Calculate Group Standings";
    }
}

// 3. Render Preview UI
function renderResultsTable(standings) {
    const container = document.getElementById('results-table-container');
    let html = `<table class="w-full text-left border-collapse text-sm"><thead class="bg-gray-900 border-b border-gray-700 text-xs uppercase text-gray-400"><tr><th class="p-3">Division</th><th class="p-3">Rank</th><th class="p-3">Track</th><th class="p-3">Athlete</th><th class="p-3">Coach</th><th class="p-3">District</th><th class="p-3 text-right">Final Score</th></tr></thead><tbody class="divide-y divide-gray-800">`;
    standings.forEach(s => {
        const isPodium = s.rank <= 3;
        html += `<tr class="${isPodium ? "bg-gray-800/80 font-bold" : "text-gray-400"} hover:bg-gray-700">
            <td class="p-3 text-brand-400 font-bold text-xs uppercase tracking-widest">${s.division}</td>
            <td class="p-3 text-lg">${isPodium ? s.medal : s.rank}</td>
            <td class="p-3 font-mono text-xs">${s.trackNo}</td>
            <td class="p-3 text-white">${s.name}</td>
            <td class="p-3 text-gray-400 text-xs italic">${s.coachName}</td>
            <td class="p-3">${s.district}</td>
            <td class="p-3 text-right text-blue-400 font-black text-lg">${s.finalScore}</td></tr>`;
    });
    container.innerHTML = html + `</tbody></table>`;
}

// 4. Publish to Database (WITH OVERWRITE WARNING)
async function publishGroupResults() {
    if (currentCalculatedStandings.length === 0) return;
    
    const btn = document.getElementById('btn-publish-results');
    btn.innerText = "⏳ Checking Vault...";
    btn.disabled = true;

    try {
        const cleanCat = currentTarget.group.replace(/[^a-zA-Z0-9]/g, '');
        const cleanGen = currentTarget.gender.replace(/[^a-zA-Z0-9]/g, '');
        const cleanDist = currentTarget.district ? currentTarget.district.replace(/[^a-zA-Z0-9]/g, '') : 'All';
        const resultDocId = `RES_${cleanCat}_${cleanGen}_${cleanDist}`;
        const resultRef = doc(db, 'published_results', resultDocId);

        // FEATURE: Check if already published
        const existingDoc = await getDoc(resultRef);
        if (existingDoc.exists()) {
            const proceed = confirm(`⚠️ WARNING: Results for [${currentTarget.group} - ${currentTarget.gender}] are already published in the database!\n\nDo you want to OVERWRITE the existing official results?`);
            if (!proceed) {
                btn.innerHTML = `<span class="mr-3">🏅</span> PUBLISH PODIUM TO DATABASE`;
                btn.disabled = false;
                return;
            }
        }

        btn.innerText = "⏳ Publishing...";

        await setDoc(resultRef, {
            docId: resultDocId,
            group: currentTarget.group,
            gender: currentTarget.gender,
            district: currentTarget.district || 'All',
            standings: currentCalculatedStandings,
            publishedAt: new Date().toISOString(),
            status: 'OFFICIAL'
        });

        alert(`✅ Official Results successfully published!`);
        
        // Let the user know to check the Explorer tab
        document.getElementById('results-table-container').innerHTML = `<p class="text-green-400 text-center italic py-8">Results successfully published to the vault. Click the <b>"Published Results"</b> tab on the left to view them.</p>`;
        
    } catch (error) {
        console.error("Publish Error:", error);
        alert("Failed to save results to database.");
    } finally {
        btn.innerHTML = `<span class="mr-3">🏅</span> PUBLISH PODIUM TO DATABASE`;
        btn.disabled = false;
    }
}
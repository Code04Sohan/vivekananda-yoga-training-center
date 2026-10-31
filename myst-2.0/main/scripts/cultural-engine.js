// ============================================================================
// MYST 2.0: CULTURAL & PERFORMING ARTS ENGINE
// Dedicated 2-Judge Scoring Hub for Drawing, Song, Dance, Recital
// Isolated from Yoga Tournament Engine (zero collision guarantee)
// ============================================================================

import { 
    collection, 
    doc, 
    getDoc, 
    getDocs, 
    setDoc, 
    updateDoc, 
    onSnapshot, 
    query, 
    where, 
    writeBatch,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

// --- CONSTANTS ---
export const CULTURAL_COMPETITIONS = [
    { id: 'drawing', name: 'Drawing', icon: '🎨', color: 'purple' },
    { id: 'song', name: 'Song (Music)', icon: '🎵', color: 'blue' },
    { id: 'dance', name: 'Dance', icon: '💃', color: 'pink' },
    { id: 'recital', name: 'Recital', icon: '📜', color: 'amber' }
];

// --- MODULE STATE ---
let cachedStaff = [];
let unsubscribeStages = null;
let unsubscribeLiveScores = null;
let currentSelectedCompForScores = 'drawing';
let currentCalculatedStandings = [];
let currentResultsFilter = { comp: 'drawing', group: '', gender: '', district: '' };
let allPublishedCulturalPodiums = [];

export function initCulturalEngine() {
    initSubTabNavigation();
    initStaffCache();
    initCSVImporter();
    initCulturalCandidateManager();
    initStageMasterControls();
    initLiveScoresMonitor();
    initResultsEngine();
    initCulturalWipeModals();
    initPublishedPodiumsExplorer();
}

// ============================================================================
// 1. SUB-TAB NAVIGATION
// ============================================================================
function initSubTabNavigation() {
    const tabs = ['import', 'candidates', 'stages', 'live', 'results', 'podiums'];
    tabs.forEach(tab => {
        const btn = document.getElementById(`btn-cult-tab-${tab}`);
        const panel = document.getElementById(`cult-panel-${tab}`);
        if (!btn || !panel) return;

        btn.addEventListener('click', () => {
            tabs.forEach(t => {
                const b = document.getElementById(`btn-cult-tab-${t}`);
                const p = document.getElementById(`cult-panel-${t}`);
                if (b) {
                    b.classList.remove('bg-brand-600', 'text-white', 'border-brand-500');
                    b.classList.add('text-slate-400', 'hover:text-white', 'border-transparent');
                }
                if (p) p.classList.add('hidden');
            });

            btn.classList.remove('text-slate-400', 'hover:text-white', 'border-transparent');
            btn.classList.add('bg-brand-600', 'text-white', 'border-brand-500');
            panel.classList.remove('hidden');

            if (tab === 'live') {
                bindLiveScoresSubscription(currentSelectedCompForScores);
            } else if (tab === 'results') {
                populateResultsFilters();
            } else if (tab === 'podiums') {
                loadCulturalPublishedPodiums();
            }
        });
    });
}

// ============================================================================
// 2. STAFF CACHE (Re-uses existing /users collection)
// ============================================================================
function initStaffCache() {
    onSnapshot(collection(db, 'users'), (snapshot) => {
        cachedStaff = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.role === 'JUDGE' || data.role === 'ADMIN' || data.role === 'STAGE_MGR') {
                cachedStaff.push({
                    uid: docSnap.id,
                    name: data.name || data.email || 'Judge',
                    email: data.email || '',
                    role: data.role || 'JUDGE'
                });
            }
        });
        // Refresh stage dropdowns
        renderAllStageControls();
    }, (err) => {
        console.error("Staff snapshot error:", err);
    });
}

// ============================================================================
// 3. CSV IMPORTER FOR CULTURAL COMPETITIONS
// ============================================================================
function initCSVImporter() {
    const form = document.getElementById('cult-csv-form');
    const compSelect = document.getElementById('cult-csv-comp-select');
    const fileInput = document.getElementById('cult-csv-file-input');
    const consoleEl = document.getElementById('cult-csv-console');

    if (!form || !fileInput) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const comp = compSelect ? compSelect.value : '';
        if (!comp) {
            alert("Please select a target competition.");
            return;
        }

        const file = fileInput.files[0];
        if (!file) {
            alert("Please select a CSV file to upload.");
            return;
        }

        logConsole(consoleEl, `⏳ Reading file: ${file.name} (${file.size} bytes)...`);

        // Guard: Excel binary .xlsx or .xls files
        if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
            logConsole(consoleEl, `❌ ERROR: '${file.name}' is an Excel Workbook (.xlsx/.xls), NOT a CSV file!`);
            logConsole(consoleEl, `👉 Solution: In Excel, click 'File' > 'Save As' and select 'CSV (Comma delimited) (*.csv)'.`);
            alert("Please upload a .csv file, not an Excel .xlsx workbook. In Excel, choose 'Save As' -> 'CSV (Comma delimited)'.");
            return;
        }

        try {
            const rawText = await file.text();

            // Guard: Binary content / zip file
            if (rawText.includes('\0') || rawText.startsWith('PK')) {
                logConsole(consoleEl, `❌ ERROR: File contains binary data (e.g. renamed .xlsx). Please save as standard plain-text CSV.`);
                return;
            }

            // Remove UTF-8 BOM if present
            const cleanText = rawText.replace(/^\uFEFF/, '').trim();
            if (!cleanText) {
                logConsole(consoleEl, `❌ ERROR: The selected file is completely empty (0 bytes text).`);
                return;
            }

            const rawLines = cleanText.split(/\r?\n/).filter(l => l.trim().length > 0);
            if (rawLines.length <= 1) {
                logConsole(consoleEl, `⚠️ WARNING: File has ${rawLines.length} line(s). If there is only a header, please add candidate data rows below it!`);
                logConsole(consoleEl, `File header content: "${rawLines[0] || ''}"`);
                return;
            }

            logConsole(consoleEl, `⏳ Detected ${rawLines.length} lines. Auto-detecting delimiters (comma, tab, semicolon, pipe)...`);

            Papa.parse(cleanText, {
                header: true,
                skipEmptyLines: 'greedy',
                delimitersToGuess: [',', '\t', ';', '|'],
                complete: async function(results) {
                    const data = results.data || [];
                    const delim = results.meta?.delimiter || ',';
                    const delimName = delim === '\t' ? 'TAB' : delim === ';' ? 'SEMICOLON' : delim === '|' ? 'PIPE' : 'COMMA';
                    
                    logConsole(consoleEl, `✅ Parsed ${data.length} candidate rows (Delimiter: ${delimName}).`);
                    
                    if (data.length === 0) {
                        logConsole(consoleEl, `❌ ERROR: 0 data rows were found below the headers.`);
                        if (results.errors && results.errors.length > 0) {
                            logConsole(consoleEl, `Parse details: ${results.errors.map(e => e.message).join('; ')}`);
                        }
                        return;
                    }

                    // Check headers of first row
                    const firstRow = data[0];
                    const detectedHeaders = Object.keys(firstRow).map(k => k.trim());
                    logConsole(consoleEl, `📋 Detected Columns: [${detectedHeaders.join(', ')}]`);

                    await processAndInjectCulturalCandidates(comp, data, consoleEl);
                },
                error: function(err) {
                    logConsole(consoleEl, `❌ Parsing Error: ${err.message}`);
                }
            });
        } catch (readErr) {
            console.error("File read error:", readErr);
            logConsole(consoleEl, `❌ File Read Error: ${readErr.message}`);
        }
    });
}

async function processAndInjectCulturalCandidates(comp, rows, consoleEl) {
    try {
        let totalAdded = 0;
        let skippedRows = 0;
        const CHUNK_SIZE = 400;

        const metaGroups = new Set();
        const metaDistricts = new Set();
        const metaGenders = new Set();

        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);

            chunk.forEach(row => {
                const cleanRow = {};
                for (const key in row) {
                    const normKey = key.trim().toUpperCase().replace(/\s+/g, ' ');
                    cleanRow[normKey] = row[key] ? String(row[key]).trim() : '';
                }

                const rawTrack = cleanRow['TRACK NO'] || cleanRow['TRACKNO'] || cleanRow['TRACK NUMBER'] || cleanRow['TRACK_NO'] || cleanRow['TRACK'] || cleanRow['REG. NO'] || cleanRow['REG NO'] || cleanRow['REGNO'] || cleanRow['ID'] || cleanRow['SL NO'] || cleanRow['SL. NO'] || cleanRow['SLNO'] || cleanRow['CHEST NO'] || cleanRow['CHESTNO'] || cleanRow['ROLL NO'] || cleanRow['ROLL'];
                if (!rawTrack) {
                    skippedRows++;
                    return;
                }

                // Clean leading zeros: '014' -> '14', '001' -> '1'
                const cleanTrack = String(rawTrack).trim().replace(/^0+/, '') || '0';
                const docId = `${comp}_${cleanTrack}`;
                const docRef = doc(db, 'cult_candidates', docId);

                const groupVal = cleanRow['AGE GROUP NAME'] || cleanRow['AGE GROUP'] || cleanRow['GROUP NAME'] || cleanRow['GROUP'] || 'Unassigned';
                const distVal = cleanRow['DISTRICT'] || cleanRow['NAME OF DISTRICT'] || cleanRow['STATE'] || 'Unknown';
                const genVal = cleanRow['GENDER'] || cleanRow['M/F'] || cleanRow['SEX'] || 'Unknown';
                const instVal = cleanRow['INSTITUTION'] || cleanRow['SCHOOL'] || cleanRow['ACADEMY'] || cleanRow['COACH NAME'] || cleanRow['COACH'] || 'Independent';

                if (groupVal) metaGroups.add(groupVal);
                if (distVal) metaDistricts.add(distVal);
                if (genVal) metaGenders.add(genVal);

                const profile = {
                    competition: comp,
                    trackNo: cleanTrack,
                    regNo: cleanRow['REG. NO'] || cleanRow['REG NO'] || cleanTrack,
                    name: cleanRow['NAME'] || cleanRow['CANDIDATE NAME'] || 'Unknown',
                    gender: genVal,
                    groupName: groupVal,
                    district: distVal,
                    institution: instVal,
                    dob: cleanRow['DOB'] || cleanRow['DATE OF BIRTH'] || '',
                    status: 'pending',
                    j1_status: false,
                    j2_status: false,
                    createdAt: new Date().toISOString()
                };

                batch.set(docRef, profile, { merge: true });
                totalAdded++;
            });

            logConsole(consoleEl, `⏳ Writing chunk ${Math.ceil((i + 1) / CHUNK_SIZE)}...`);
            await batch.commit();
        }

        // Save metadata filters
        const metaRef = doc(db, 'cult_metadata', comp);
        await setDoc(metaRef, {
            competition: comp,
            groups: Array.from(metaGroups),
            districts: Array.from(metaDistricts),
            genders: Array.from(metaGenders),
            updatedAt: new Date().toISOString()
        }, { merge: true });

        logConsole(consoleEl, `🏆 SUCCESS: ${totalAdded} candidates registered for [${comp.toUpperCase()}]!`);
        if (skippedRows > 0) {
            logConsole(consoleEl, `⚠️ Skipped ${skippedRows} empty rows.`);
        }
    } catch (err) {
        console.error("Cultural CSV Injection Error:", err);
        logConsole(consoleEl, `❌ Database Error: ${err.message}`);
    }
}

// ============================================================================
// 4. MASTER STAGE & JUDGE CONTROLS (Set 2 Judges & Lock Panel)
// ============================================================================
let stageStateMap = {};

function initStageMasterControls() {
    const container = document.getElementById('cult-stages-container');
    if (!container) return;

    if (unsubscribeStages) unsubscribeStages();

    unsubscribeStages = onSnapshot(collection(db, 'cult_stages'), (snapshot) => {
        stageStateMap = {};
        snapshot.forEach(docSnap => {
            stageStateMap[docSnap.id] = docSnap.data();
        });
        renderAllStageControls();
    }, (err) => {
        console.error("Stages snapshot error:", err);
    });
}

function renderAllStageControls() {
    const container = document.getElementById('cult-stages-container');
    if (!container) return;

    container.innerHTML = '';

    CULTURAL_COMPETITIONS.forEach(comp => {
        const state = stageStateMap[comp.id] || {
            competition: comp.id,
            panelSize: comp.id === 'song' ? 1 : 2,
            isLocked: false,
            j1_uid: '',
            j1_name: '',
            j2_uid: '',
            j2_name: '',
            updatedAt: null
        };

        const panelSize = state.panelSize !== undefined ? parseInt(state.panelSize) : (comp.id === 'song' ? 1 : 2);

        const card = document.createElement('div');
        card.className = "bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-md flex flex-col justify-between";

        const judgeOptionsJ1 = cachedStaff.map(s => {
            const isSelected = s.uid === state.j1_uid;
            return `<option value="${s.uid}" data-name="${s.name}" ${isSelected ? 'selected' : ''}>${s.name} (${s.email || s.role})</option>`;
        }).join('');

        const judgeOptionsJ2 = cachedStaff.map(s => {
            const isSelected = s.uid === state.j2_uid;
            return `<option value="${s.uid}" data-name="${s.name}" ${isSelected ? 'selected' : ''}>${s.name} (${s.email || s.role})</option>`;
        }).join('');

        card.innerHTML = `
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
                <div class="flex items-center gap-3">
                    <span class="text-3xl">${comp.icon}</span>
                    <div>
                        <h4 class="text-lg font-black text-white tracking-wide uppercase">${comp.name}</h4>
                        <span class="text-[11px] font-mono text-slate-400">ID: cult_${comp.id}</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold uppercase ${state.isLocked ? 'text-red-400' : 'text-emerald-400'}">
                        ${state.isLocked ? '🔒 Locked' : '🟢 Active'}
                    </span>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only toggle-lock-stage" data-comp="${comp.id}" ${state.isLocked ? 'checked' : ''}>
                        <div class="w-11 h-6 bg-slate-800 rounded-full peer peer-checked:bg-red-600 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all ${state.isLocked ? 'after:translate-x-full' : ''}"></div>
                    </label>
                </div>
            </div>

            <div class="space-y-4 my-2">
                <!-- Panel Size Selector (1 or 2 Judges) -->
                <div class="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex items-center justify-between">
                    <div>
                        <label class="text-xs font-bold text-slate-300 uppercase tracking-wider block">Panel Configuration</label>
                        <span class="text-[10px] text-slate-500 font-mono">Solo or Dual Evaluator</span>
                    </div>
                    <select class="bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-brand-500 select-panel-size cursor-pointer" data-comp="${comp.id}">
                        <option value="1" ${panelSize === 1 ? 'selected' : ''}>1 Judge (Max 50)</option>
                        <option value="2" ${panelSize === 2 ? 'selected' : ''}>2 Judges (Max 100)</option>
                    </select>
                </div>

                <!-- Judge 1 Selection -->
                <div class="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                    <div class="flex items-center justify-between mb-1.5">
                        <label class="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5">
                            <span>⚖️</span> ${panelSize === 1 ? 'Judge 1 (Solo Judge)' : 'Judge 1 (Head Judge)'}
                        </label>
                        <span class="text-[10px] font-mono font-bold text-slate-500 uppercase">Weight: 50 Marks</span>
                    </div>
                    <select class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm font-semibold select-judge" data-comp="${comp.id}" data-seat="j1">
                        <option value="">-- Assign Judge 1 --</option>
                        ${judgeOptionsJ1}
                    </select>
                </div>

                <!-- Judge 2 Selection -->
                <div id="stage-j2-box-${comp.id}" class="bg-slate-950 p-3.5 rounded-xl border border-slate-800 ${panelSize === 1 ? 'hidden' : ''}">
                    <div class="flex items-center justify-between mb-1.5">
                        <label class="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                            <span>⚖️</span> Judge 2 (Panel Judge)
                        </label>
                        <span class="text-[10px] font-mono font-bold text-slate-500 uppercase">Weight: 50 Marks</span>
                    </div>
                    <select class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm font-semibold select-judge" data-comp="${comp.id}" data-seat="j2">
                        <option value="">-- Assign Judge 2 --</option>
                        ${judgeOptionsJ2}
                    </select>
                </div>

                <!-- 1-Judge Informational Notice -->
                <div id="stage-j2-disabled-note-${comp.id}" class="bg-slate-950/60 p-3 rounded-xl border border-dashed border-slate-800 text-center ${panelSize === 1 ? '' : 'hidden'}">
                    <span class="text-xs text-slate-400 font-mono">1-Judge Mode: Evaluated solely by Judge 1 (Max 50 Marks).</span>
                </div>
            </div>

            <!-- Footer Save Actions -->
            <div class="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                <span class="text-[10px] font-mono text-slate-500">
                    ${state.updatedAt ? `Saved: ${new Date(state.updatedAt).toLocaleTimeString()}` : 'Not configured'}
                </span>
                <div class="flex items-center gap-2">
                    <button type="button" class="btn-standby-stage bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs uppercase px-3 py-2 rounded-lg transition-colors cursor-pointer border border-slate-700" data-comp="${comp.id}" title="Reset live TV stage to Standby">
                        ⏸ Standby
                    </button>
                    <button type="button" class="btn-save-stage bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs uppercase px-4 py-2 rounded-lg transition-colors cursor-pointer" data-comp="${comp.id}">
                        Save Assignment
                    </button>
                </div>
            </div>
        `;

        container.appendChild(card);
    });

    // Panel size switcher dynamic visibility
    container.querySelectorAll('.select-panel-size').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const comp = e.target.dataset.comp;
            const newSize = parseInt(e.target.value);
            const j2Box = document.getElementById(`stage-j2-box-${comp}`);
            const j2Note = document.getElementById(`stage-j2-disabled-note-${comp}`);
            if (newSize === 1) {
                if (j2Box) j2Box.classList.add('hidden');
                if (j2Note) j2Note.classList.remove('hidden');
            } else {
                if (j2Box) j2Box.classList.remove('hidden');
                if (j2Note) j2Note.classList.add('hidden');
            }
        });
    });

    // Attach listeners
    container.querySelectorAll('.btn-standby-stage').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const comp = e.currentTarget.dataset.comp;
            await resetStageToStandby(comp);
        });
    });

    container.querySelectorAll('.btn-save-stage').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const comp = e.currentTarget.dataset.comp;
            await saveStageConfig(comp);
        });
    });

    container.querySelectorAll('.toggle-lock-stage').forEach(chk => {
        chk.addEventListener('change', async (e) => {
            const comp = e.target.dataset.comp;
            const isLocked = e.target.checked;
            await updateStageLock(comp, isLocked);
        });
    });
}

async function saveStageConfig(comp) {
    const panelSizeSelect = document.querySelector(`.select-panel-size[data-comp="${comp}"]`);
    const panelSize = panelSizeSelect ? parseInt(panelSizeSelect.value) : (comp === 'song' ? 1 : 2);

    const j1Select = document.querySelector(`.select-judge[data-comp="${comp}"][data-seat="j1"]`);
    const j2Select = document.querySelector(`.select-judge[data-comp="${comp}"][data-seat="j2"]`);

    const j1Uid = j1Select ? j1Select.value : '';
    const j1Name = j1Select?.selectedOptions[0]?.dataset?.name || '';
    const j2Uid = (panelSize === 2 && j2Select) ? j2Select.value : '';
    const j2Name = (panelSize === 2 && j2Select) ? (j2Select?.selectedOptions[0]?.dataset?.name || '') : '';

    if (panelSize === 2 && j1Uid && j2Uid && j1Uid === j2Uid) {
        alert("Judge 1 and Judge 2 cannot be the same staff member.");
        return;
    }

    try {
        const stageRef = doc(db, 'cult_stages', comp);
        await setDoc(stageRef, {
            competition: comp,
            panelSize: panelSize,
            j1_uid: j1Uid,
            j1_name: j1Name,
            j2_uid: j2Uid,
            j2_name: j2Name,
            updatedAt: new Date().toISOString()
        }, { merge: true });

        alert(`✅ Stage assignments for [${comp.toUpperCase()}] (${panelSize} Judge${panelSize > 1 ? 's' : ''}) saved successfully!`);
    } catch (err) {
        console.error("Save stage error:", err);
        alert("Failed to save stage configuration.");
    }
}

async function resetStageToStandby(comp) {
    if (!confirm(`Reset the live TV display for [${comp.toUpperCase()}] to Standby?`)) return;
    try {
        const stageRef = doc(db, 'cult_stages', comp);
        await updateDoc(stageRef, { activeCandidate: null });
        alert(`✅ [${comp.toUpperCase()}] live stage reset to Standby successfully!`);
    } catch (err) {
        console.error("Standby reset error:", err);
        alert("Failed to reset stage: " + err.message);
    }
}

async function updateStageLock(comp, isLocked) {
    try {
        const stageRef = doc(db, 'cult_stages', comp);
        await setDoc(stageRef, {
            isLocked: isLocked,
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (err) {
        console.error("Lock error:", err);
    }
}

// ============================================================================
// 5. LIVE SCORES MONITOR
// ============================================================================
function initLiveScoresMonitor() {
    const compPills = document.querySelectorAll('.cult-live-comp-pill');
    compPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            compPills.forEach(p => {
                p.classList.remove('bg-brand-600', 'text-white');
                p.classList.add('bg-slate-900', 'text-slate-400');
            });
            e.currentTarget.classList.remove('bg-slate-900', 'text-slate-400');
            e.currentTarget.classList.add('bg-brand-600', 'text-white');

            const comp = e.currentTarget.dataset.comp;
            currentSelectedCompForScores = comp;
            bindLiveScoresSubscription(comp);
        });
    });

    const searchInput = document.getElementById('cult-live-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            filterLiveScoresTable();
        });
    }

    document.getElementById('cult-edit-input-j1')?.addEventListener('input', updateCultEditTotalPreview);
    document.getElementById('cult-edit-input-j2')?.addEventListener('input', updateCultEditTotalPreview);
}

let cachedLiveCandidates = [];
let cachedLiveScores = {};

function bindLiveScoresSubscription(comp) {
    if (unsubscribeLiveScores) unsubscribeLiveScores();

    const tbody = document.getElementById('cult-live-tbody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center p-8 text-slate-500 font-mono text-sm">⏳ Connecting live listener for ${comp.toUpperCase()}...</td></tr>`;
    }

    // Subscribe to candidates of this comp
    const qCands = query(collection(db, 'cult_candidates'), where('competition', '==', comp));
    const unsubCands = onSnapshot(qCands, (snap) => {
        cachedLiveCandidates = [];
        snap.forEach(d => cachedLiveCandidates.push({ id: d.id, ...d.data() }));

        // Now subscribe to scores
        const qScores = query(collection(db, 'cult_scores'), where('competition', '==', comp));
        const unsubScores = onSnapshot(qScores, (scoreSnap) => {
            cachedLiveScores = {};
            scoreSnap.forEach(d => {
                const s = d.data();
                cachedLiveScores[s.trackNo] = s;
            });
            renderLiveScoresTable();
        });

        unsubscribeLiveScores = () => {
            unsubCands();
            unsubScores();
        };
    }, (err) => {
        console.error("Live listener error:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center p-8 text-red-400 font-mono text-sm">Error loading live scores: ${err.message}</td></tr>`;
        }
    });
}

function renderLiveScoresTable() {
    const tbody = document.getElementById('cult-live-tbody');
    const countTotal = document.getElementById('cult-live-count-total');
    const countCompleted = document.getElementById('cult-live-count-completed');
    const countPending = document.getElementById('cult-live-count-pending');

    if (!tbody) return;

    const stage = stageStateMap[currentSelectedCompForScores] || {};
    const panelSize = stage.panelSize !== undefined ? parseInt(stage.panelSize) : (currentSelectedCompForScores === 'song' ? 1 : 2);

    // Update dynamic header indicators
    const thJ2 = document.getElementById('cult-live-th-j2');
    const thTotal = document.getElementById('cult-live-th-total');
    if (thJ2) thJ2.innerHTML = panelSize === 1 ? 'J2 <span class="text-[10px] text-slate-500 font-normal">(N/A)</span>' : 'J2 (/50)';
    if (thTotal) thTotal.innerHTML = panelSize === 1 ? 'Total (/50)' : 'Total (/100)';

    if (cachedLiveCandidates.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center p-8 text-slate-500 font-mono text-sm">No candidates imported yet for this competition. Go to CSV Importer to upload.</td></tr>`;
        if (countTotal) countTotal.textContent = '0';
        if (countCompleted) countCompleted.textContent = '0';
        if (countPending) countPending.textContent = '0';
        return;
    }

    // Sort numerically by Track No
    cachedLiveCandidates.sort((a, b) => (parseInt(a.trackNo) || 0) - (parseInt(b.trackNo) || 0));

    let completed = 0;
    let partial = 0;

    let rowsHtml = '';
    cachedLiveCandidates.forEach(cand => {
        const score = cachedLiveScores[cand.trackNo] || {};
        const j1Val = score.j1_score !== undefined ? parseFloat(score.j1_score).toFixed(1) : null;
        const j2Val = score.j2_score !== undefined ? parseFloat(score.j2_score).toFixed(1) : null;
        
        let totalVal = null;
        let badgeHtml = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">Pending</span>';

        if (panelSize === 1) {
            if (j1Val !== null) {
                totalVal = parseFloat(j1Val).toFixed(1);
                badgeHtml = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/60 text-emerald-400 border border-emerald-800">Completed (1/1)</span>';
                completed++;
            }
        } else {
            if (j1Val !== null && j2Val !== null) {
                totalVal = (parseFloat(j1Val) + parseFloat(j2Val)).toFixed(1);
                badgeHtml = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/60 text-emerald-400 border border-emerald-800">Completed (2/2)</span>';
                completed++;
            } else if (j1Val !== null || j2Val !== null) {
                badgeHtml = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-950/60 text-amber-400 border border-amber-800">Partial (1/2)</span>';
                partial++;
            }
        }

        const j2DisplayHtml = panelSize === 1 
            ? '<span class="text-xs text-slate-600 font-mono italic">−</span>'
            : (j2Val !== null ? `${j2Val} <span class="text-[10px] text-slate-500">/50</span>` : '−');

        rowsHtml += `
            <tr class="border-b border-slate-800 hover:bg-slate-900/60 transition-colors font-medium">
                <td class="p-4 font-mono font-black text-brand-400 text-base">#${cand.trackNo}</td>
                <td class="p-4 text-white font-bold">${cand.name}</td>
                <td class="p-4 text-slate-400 text-xs">${cand.groupName || '-'}</td>
                <td class="p-4 text-slate-400 text-xs">${cand.gender || '-'}</td>
                <td class="p-4 text-slate-400 text-xs">${cand.district || '-'}</td>
                <td class="p-4 text-center font-mono font-bold ${j1Val !== null ? 'text-emerald-400' : 'text-slate-600'}">
                    ${j1Val !== null ? `${j1Val} <span class="text-[10px] text-slate-500">/50</span>` : '−'}
                </td>
                <td class="p-4 text-center font-mono font-bold ${panelSize === 1 ? 'text-slate-600' : (j2Val !== null ? 'text-emerald-400' : 'text-slate-600')}">
                    ${j2DisplayHtml}
                </td>
                <td class="p-4 text-center font-mono font-black text-lg ${totalVal !== null ? 'text-yellow-400' : 'text-slate-600'}">
                    ${totalVal !== null ? `${totalVal} <span class="text-[10px] text-slate-500">/${panelSize === 1 ? '50' : '100'}</span>` : '−'}
                </td>
                <td class="p-4 text-center">${badgeHtml}</td>
                <td class="p-4 text-center">
                    ${j1Val !== null || j2Val !== null 
                        ? `<div class="flex items-center justify-center gap-1.5">
                            <button type="button" onclick="openCultScoreEditor('${cand.trackNo}')" class="px-2.5 py-1 text-xs font-bold bg-brand-900/50 hover:bg-brand-800 text-brand-300 border border-brand-700/80 rounded-lg transition-colors cursor-pointer shadow-xs">Edit</button>
                            <button type="button" onclick="confirmResetCultScore('${cand.trackNo}')" class="px-2.5 py-1 text-xs font-bold bg-red-950/60 hover:bg-red-800 text-red-300 border border-red-800/80 rounded-lg transition-colors cursor-pointer shadow-xs" title="Void score and allow judge to re-score">Reset</button>
                        </div>`
                        : `<span class="text-xs text-slate-600 font-mono italic">Unscored</span>`
                    }
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;

    if (countTotal) countTotal.textContent = String(cachedLiveCandidates.length);
    if (countCompleted) countCompleted.textContent = String(completed);
    if (countPending) countPending.textContent = String(cachedLiveCandidates.length - completed);
}

function filterLiveScoresTable() {
    const queryStr = document.getElementById('cult-live-search')?.value.trim().toLowerCase() || '';
    const rows = document.querySelectorAll('#cult-live-tbody tr');
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(queryStr) ? '' : 'none';
    });
}

// ============================================================================
// 5.1 CULTURAL SCORE AUDIT OVERRIDE (ADMIN EDIT & VOID)
// ============================================================================
let editingScoreTarget = null; // { comp, trackNo, cand, score, panelSize }

function openCultScoreEditor(trackNo) {
    const comp = currentSelectedCompForScores;
    const cand = cachedLiveCandidates.find(c => String(c.trackNo) === String(trackNo));
    if (!cand) return alert("Candidate not found in local cache.");

    const score = cachedLiveScores[trackNo] || {};
    const stage = stageStateMap[comp] || {};
    const panelSize = stage.panelSize !== undefined ? parseInt(stage.panelSize) : (comp === 'song' ? 1 : 2);

    editingScoreTarget = { comp, trackNo, cand, score, panelSize };

    // Fill candidate details in modal
    const trackEl = document.getElementById('cult-edit-track');
    const nameEl = document.getElementById('cult-edit-name');
    const metaEl = document.getElementById('cult-edit-meta');
    const j1Input = document.getElementById('cult-edit-input-j1');
    const j2Input = document.getElementById('cult-edit-input-j2');
    const j2Container = document.getElementById('cult-edit-j2-container');
    const j1JudgeName = document.getElementById('cult-edit-j1-judge-name');
    const j2JudgeName = document.getElementById('cult-edit-j2-judge-name');

    if (trackEl) trackEl.textContent = `#${trackNo}`;
    if (nameEl) nameEl.textContent = cand.name;
    if (metaEl) metaEl.textContent = `${cand.groupName || '-'} · ${cand.gender || '-'} · ${cand.district || '-'} (${comp.toUpperCase()})`;

    if (j1Input) j1Input.value = score.j1_score !== undefined ? parseFloat(score.j1_score).toFixed(1) : '';
    if (j2Input) j2Input.value = score.j2_score !== undefined ? parseFloat(score.j2_score).toFixed(1) : '';

    if (j1JudgeName) j1JudgeName.textContent = score.j1_name ? `Judge: ${score.j1_name}` : 'Judge 1';
    if (j2JudgeName) j2JudgeName.textContent = score.j2_name ? `Judge: ${score.j2_name}` : 'Judge 2';

    if (j2Container) {
        if (panelSize === 1) j2Container.classList.add('hidden');
        else j2Container.classList.remove('hidden');
    }

    updateCultEditTotalPreview();

    const modal = document.getElementById('modal-cult-edit-score');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeCultScoreEditor() {
    editingScoreTarget = null;
    const modal = document.getElementById('modal-cult-edit-score');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function updateCultEditTotalPreview() {
    if (!editingScoreTarget) return;
    const j1Input = document.getElementById('cult-edit-input-j1');
    const j2Input = document.getElementById('cult-edit-input-j2');
    const previewEl = document.getElementById('cult-edit-total-preview');

    const j1Val = parseFloat(j1Input?.value);
    const j2Val = parseFloat(j2Input?.value);
    const panelSize = editingScoreTarget.panelSize;

    if (isNaN(j1Val) || j1Val < 0) {
        if (previewEl) previewEl.textContent = `-- / ${panelSize === 1 ? '50' : '100'}`;
        return;
    }

    if (panelSize === 1) {
        if (previewEl) previewEl.textContent = `${j1Val.toFixed(1)} / 50`;
    } else {
        if (isNaN(j2Val) || j2Val < 0) {
            if (previewEl) previewEl.textContent = `${j1Val.toFixed(1)} (Partial) / 100`;
        } else {
            const tot = j1Val + j2Val;
            if (previewEl) previewEl.textContent = `${tot.toFixed(1)} / 100`;
        }
    }
}

async function saveCultScoreEdit() {
    if (!editingScoreTarget) return;
    const { comp, trackNo, cand, score, panelSize } = editingScoreTarget;

    const j1Input = document.getElementById('cult-edit-input-j1');
    const j2Input = document.getElementById('cult-edit-input-j2');
    const btnSave = document.getElementById('btn-cult-save-score-edit');

    const j1Val = parseFloat(j1Input.value);
    if (isNaN(j1Val) || j1Val < 0 || j1Val > 50) {
        return alert("Please enter a valid score between 0.0 and 50.0 for Judge 1.");
    }

    let j2Val = null;
    if (panelSize === 2) {
        j2Val = parseFloat(j2Input.value);
        if (isNaN(j2Val) || j2Val < 0 || j2Val > 50) {
            return alert("Please enter a valid score between 0.0 and 50.0 for Judge 2.");
        }
    }

    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerText = "⏳ Saving...";
    }

    try {
        const docId = `${comp}_${trackNo}`;
        const scoreRef = doc(db, 'cult_scores', docId);
        const candRef = doc(db, 'cult_candidates', docId);

        const updatePayload = {
            competition: comp,
            trackNo: trackNo,
            panelSize: panelSize,
            candidateName: cand.name || '',
            groupName: cand.groupName || '',
            gender: cand.gender || '',
            district: cand.district || '',
            institution: cand.institution || '',
            j1_score: j1Val,
            admin_edited: true,
            admin_editedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        if (panelSize === 1) {
            updatePayload.total_score = j1Val;
            updatePayload.max_score = 50;
            updatePayload.status = 'completed';
        } else {
            updatePayload.j2_score = j2Val;
            updatePayload.total_score = j1Val + j2Val;
            updatePayload.max_score = 100;
            updatePayload.status = 'completed';
        }

        await setDoc(scoreRef, updatePayload, { merge: true });

        const candUpdate = {
            j1_status: true,
            status: 'completed'
        };
        if (panelSize === 2) {
            candUpdate.j2_status = true;
        }
        await updateDoc(candRef, candUpdate);

        closeCultScoreEditor();
        alert(`✅ Score updated successfully for Candidate #${trackNo} (${cand.name}).`);
    } catch (err) {
        console.error("Save score error:", err);
        alert(`Failed to save edited score: ${err.message}`);
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerText = "Save Changes";
        }
    }
}

async function confirmResetCultScore(trackNo) {
    const comp = currentSelectedCompForScores;
    const cand = cachedLiveCandidates.find(c => String(c.trackNo) === String(trackNo));
    const candName = cand ? cand.name : `Track #${trackNo}`;

    const proceed = confirm(`⚠️ Are you sure you want to VOID and RESET the score for Candidate #${trackNo} (${candName})?\n\n` +
        `• This will permanently delete the score from the database.\n` +
        `• The candidate status will return to "Pending (Unscored)".\n` +
        `• Cultural Judges will be unlocked and able to score this candidate again.\n\n` +
        `Do you want to proceed?`);

    if (!proceed) return;

    try {
        const docId = `${comp}_${trackNo}`;
        await deleteDoc(doc(db, 'cult_scores', docId));
        await updateDoc(doc(db, 'cult_candidates', docId), {
            status: 'pending',
            j1_status: false,
            j2_status: false
        });
        alert(`✅ Candidate #${trackNo} (${candName}) has been reset to Unscored.\nJudges can now re-score this candidate.`);
    } catch (err) {
        console.error("Reset score error:", err);
        alert(`Failed to reset score: ${err.message}`);
    }
}

// Window bindings for HTML onClick
window.openCultScoreEditor = openCultScoreEditor;
window.closeCultScoreEditor = closeCultScoreEditor;
window.saveCultScoreEdit = saveCultScoreEdit;
window.confirmResetCultScore = confirmResetCultScore;

// ============================================================================
// 6. RESULTS & RANKINGS ENGINE
// ============================================================================
function initResultsEngine() {
    const compSelect = document.getElementById('cult-res-comp-select');
    const btnCalc = document.getElementById('btn-cult-calc-results');
    const btnPublish = document.getElementById('btn-cult-publish-results');
    const btnExportCsv = document.getElementById('btn-cult-export-csv');

    if (compSelect) {
        compSelect.addEventListener('change', () => {
            populateResultsFilters();
        });
    }

    if (btnCalc) btnCalc.addEventListener('click', calculateCulturalStandings);
    if (btnPublish) btnPublish.addEventListener('click', publishCulturalPodium);
    if (btnExportCsv) btnExportCsv.addEventListener('click', exportResultsToCsv);
}

async function populateResultsFilters() {
    const compSelect = document.getElementById('cult-res-comp-select');
    const groupSelect = document.getElementById('cult-res-group-select');
    const genderSelect = document.getElementById('cult-res-gender-select');
    const districtSelect = document.getElementById('cult-res-district-select');

    const comp = compSelect ? compSelect.value : 'drawing';

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
        } else {
            // Fallback scan
            const q = query(collection(db, 'cult_candidates'), where('competition', '==', comp));
            const snap = await getDocs(q);
            const gSet = new Set(), dSet = new Set(), genSet = new Set();
            snap.forEach(d => {
                const c = d.data();
                if (c.groupName) gSet.add(c.groupName);
                if (c.district) dSet.add(c.district);
                if (c.gender) genSet.add(c.gender);
            });
            groups = Array.from(gSet);
            districts = Array.from(dSet);
            genders = Array.from(genSet);
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
            districtSelect.innerHTML = '<option value="">-- All Districts (Optional) --</option>' + 
                districts.sort().map(d => `<option value="${d}">${d}</option>`).join('');
        }
    } catch (err) {
        console.error("Filter populate error:", err);
    }
}

async function calculateCulturalStandings() {
    const comp = document.getElementById('cult-res-comp-select')?.value || 'drawing';
    const group = document.getElementById('cult-res-group-select')?.value || '';
    const gender = document.getElementById('cult-res-gender-select')?.value || '';
    const district = document.getElementById('cult-res-district-select')?.value || '';
    const tieBreakByJ1 = document.getElementById('cult-setting-tie-j1')?.checked ?? true;

    currentResultsFilter = { comp, group, gender, district };

    const btn = document.getElementById('btn-cult-calc-results');
    if (btn) btn.innerText = "⏳ Processing Standings...";

    try {
        const stage = stageStateMap[comp] || {};
        const panelSize = stage.panelSize !== undefined ? parseInt(stage.panelSize) : (comp === 'song' ? 1 : 2);

        // Query candidates
        const candSnap = await getDocs(query(collection(db, 'cult_candidates'), where('competition', '==', comp)));
        const candidatesMap = {};

        candSnap.forEach(d => {
            const c = d.data();
            const groupMatch = !group || (c.groupName === group);
            const genderMatch = !gender || (c.gender === gender);
            const districtMatch = !district || (c.district === district);

            if (groupMatch && genderMatch && districtMatch) {
                candidatesMap[c.trackNo] = c;
            }
        });

        if (Object.keys(candidatesMap).length === 0) {
            alert("No candidates found matching the selected filters.");
            if (btn) btn.innerText = "📊 Calculate Standings";
            return;
        }

        // Query scores
        const scoreSnap = await getDocs(query(collection(db, 'cult_scores'), where('competition', '==', comp)));
        let calculated = [];

        scoreSnap.forEach(d => {
            const s = d.data();
            const track = s.trackNo;
            if (candidatesMap[track]) {
                const c = candidatesMap[track];
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
                    calculated.push({
                        trackNo: track,
                        name: c.name || s.candidateName,
                        groupName: c.groupName,
                        gender: c.gender,
                        district: c.district,
                        institution: c.institution || '-',
                        j1Score: j1,
                        j2Score: j2,
                        totalScore: total,
                        finalScore: total.toFixed(2),
                        panelSize: panelSize,
                        maxScore: panelSize === 1 ? 50 : 100
                    });
                }
            }
        });

        if (calculated.length === 0) {
            const reqMsg = panelSize === 1 ? "Judge 1 score required" : "both J1 and J2 required";
            alert(`Candidates found, but none have completed scores (${reqMsg}).`);
            if (btn) btn.innerText = "📊 Calculate Standings";
            return;
        }

        // Sort descending: Total Score first, then J1 tie-breaker if enabled
        calculated.sort((a, b) => {
            if (b.totalScore !== a.totalScore) {
                return b.totalScore - a.totalScore;
            }
            if (tieBreakByJ1 && b.j1Score !== a.j1Score) {
                return b.j1Score - a.j1Score;
            }
            return 0;
        });

        // Assign ranks and medals
        currentCalculatedStandings = calculated.map((item, index) => {
            const rank = index + 1;
            let medal = '-';
            if (rank === 1) medal = '🥇 Gold';
            else if (rank === 2) medal = '🥈 Silver';
            else if (rank === 3) medal = '🥉 Bronze';

            return {
                rank: rank,
                medal: medal,
                ...item
            };
        });

        renderCulturalResultsTable(currentCalculatedStandings);

        const btnPublish = document.getElementById('btn-cult-publish-results');
        const btnExport = document.getElementById('btn-cult-export-csv');
        if (btnPublish) btnPublish.disabled = false;
        if (btnExport) btnExport.disabled = false;

    } catch (err) {
        console.error("Calculate Error:", err);
        alert("Failed to calculate standings: " + err.message);
    } finally {
        if (btn) btn.innerText = "📊 Calculate Standings";
    }
}

function renderCulturalResultsTable(standings) {
    const container = document.getElementById('cult-results-table-container');
    if (!container) return;

    if (standings.length === 0) {
        container.innerHTML = '<p class="text-slate-500 text-center py-8 font-mono">No standings calculated yet.</p>';
        return;
    }

    const isSingleJudge = standings[0]?.panelSize === 1;

    let rowsHtml = '';
    standings.forEach(s => {
        const isPodium = s.rank <= 3;
        const j2Display = isSingleJudge
            ? '<span class="text-xs text-slate-600 font-mono italic">−</span>'
            : (s.j2Score !== null ? s.j2Score.toFixed(1) : '−');

        rowsHtml += `
            <tr class="${isPodium ? 'bg-slate-900/90 font-bold border-brand-500/30' : 'text-slate-400'} border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                <td class="p-4 text-xl tracking-tight font-black">${s.medal !== '-' ? s.medal : s.rank}</td>
                <td class="p-4 font-mono font-black text-brand-400 text-base">#${s.trackNo}</td>
                <td class="p-4 text-white text-base font-bold">${s.name}</td>
                <td class="p-4 text-xs text-slate-300">${s.groupName || '-'}</td>
                <td class="p-4 text-xs text-slate-400">${s.district || '-'}</td>
                <td class="p-4 text-xs text-slate-400">${s.institution || '-'}</td>
                <td class="p-4 text-center font-mono font-bold text-slate-300">${s.j1Score.toFixed(1)}</td>
                <td class="p-4 text-center font-mono font-bold text-slate-300">${j2Display}</td>
                <td class="p-4 text-right font-mono font-black text-2xl text-emerald-400">${s.finalScore}</td>
            </tr>
        `;
    });

    container.innerHTML = `
        <table class="w-full text-left border-collapse min-w-[800px]">
            <thead class="bg-slate-950 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                    <th class="p-4">Rank</th>
                    <th class="p-4">Track</th>
                    <th class="p-4">Candidate</th>
                    <th class="p-4">Group</th>
                    <th class="p-4">District</th>
                    <th class="p-4">Institute</th>
                    <th class="p-4 text-center">J1 (/50)</th>
                    <th class="p-4 text-center">${isSingleJudge ? 'J2 (N/A)' : 'J2 (/50)'}</th>
                    <th class="p-4 text-right">Total Score (${isSingleJudge ? '/50' : '/100'})</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;
}

async function publishCulturalPodium() {
    if (currentCalculatedStandings.length === 0) return;

    const btn = document.getElementById('btn-cult-publish-results');
    if (btn) {
        btn.innerText = "⏳ Publishing Official Podium...";
        btn.disabled = true;
    }

    try {
        const { comp, group, gender, district } = currentResultsFilter;
        const cleanComp = comp.replace(/[^a-zA-Z0-9]/g, '');
        const cleanGroup = (group || 'All').replace(/[^a-zA-Z0-9]/g, '');
        const cleanGen = (gender || 'All').replace(/[^a-zA-Z0-9]/g, '');
        const cleanDist = (district || 'All').replace(/[^a-zA-Z0-9]/g, '');

        const docId = `RES_${cleanComp}_${cleanGroup}_${cleanGen}_${cleanDist}`;
        const resultRef = doc(db, 'cult_published_results', docId);

        // Check if existing
        const existing = await getDoc(resultRef);
        if (existing.exists()) {
            const proceed = confirm(`⚠️ Official results for this filter are already published in the database!\n\nDo you want to OVERWRITE the published results?`);
            if (!proceed) {
                if (btn) {
                    btn.innerHTML = `<span>🏅</span> Publish Podium`;
                    btn.disabled = false;
                }
                return;
            }
        }

        const activePanelSize = currentCalculatedStandings[0]?.panelSize || 2;

        await setDoc(resultRef, {
            docId: docId,
            competition: comp,
            group: group || 'All',
            gender: gender || 'All',
            district: district || 'All',
            standings: currentCalculatedStandings,
            panelSize: activePanelSize,
            maxScore: activePanelSize === 1 ? 50 : 100,
            publishedAt: new Date().toISOString(),
            status: 'OFFICIAL'
        });

        alert("✅ Official Podium successfully published to the vault! Display screens will sync automatically.");
    } catch (err) {
        console.error("Publish error:", err);
        alert("Failed to publish results: " + err.message);
    } finally {
        if (btn) {
            btn.innerHTML = `<span>🏅</span> Publish Podium`;
            btn.disabled = false;
        }
    }
}

function exportResultsToCsv() {
    if (currentCalculatedStandings.length === 0) return;

    const isSingleJudge = currentCalculatedStandings[0]?.panelSize === 1;

    let csv = isSingleJudge
        ? "Rank,Medal,Track No,Candidate Name,Group,Gender,District,Institute,Judge 1 Score (/50),Total Score (/50)\n"
        : "Rank,Medal,Track No,Candidate Name,Group,Gender,District,Institute,J1 Score (/50),J2 Score (/50),Total Score (/100)\n";

    currentCalculatedStandings.forEach(s => {
        if (isSingleJudge) {
            csv += `"${s.rank}","${s.medal}","${s.trackNo}","${s.name}","${s.groupName || ''}","${s.gender || ''}","${s.district || ''}","${s.institution || ''}","${s.j1Score}","${s.finalScore}"\n`;
        } else {
            csv += `"${s.rank}","${s.medal}","${s.trackNo}","${s.name}","${s.groupName || ''}","${s.gender || ''}","${s.district || ''}","${s.institution || ''}","${s.j1Score}","${s.j2Score !== null ? s.j2Score : ''}","${s.finalScore}"\n`;
        }
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const { comp, group, gender } = currentResultsFilter;
    link.setAttribute("href", url);
    link.setAttribute("download", `Results_${comp}_${group || 'All'}_${gender || 'All'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Helper: console log
function logConsole(el, msg) {
    if (!el) return;
    el.textContent += `${new Date().toLocaleTimeString()} - ${msg}\n`;
    el.scrollTop = el.scrollHeight;
}



// ============================================================================
// 7. CULTURAL MASTER CANDIDATE MANAGER (LIVE ROSTER)
// ============================================================================
let allCulturalCandidatesList = [];
let allCulturalScoresMap = {};
let unsubscribeCulturalCandidates = null;
let unsubscribeCandidateScores = null;

export function initCulturalCandidateManager() {
    const tbody = document.getElementById('cult-candidates-tbody');
    const searchInput = document.getElementById('cult-cand-search');
    const compFilter = document.getElementById('cult-cand-filter-comp');
    const groupFilter = document.getElementById('cult-cand-filter-group');
    const genderFilter = document.getElementById('cult-cand-filter-gender');
    const distFilter = document.getElementById('cult-cand-filter-district');
    const btnRefresh = document.getElementById('btn-cult-refresh-cands');

    if (!tbody) return;

    bindCulturalCandidatesListener();

    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            bindCulturalCandidatesListener();
        });
    }

    const triggerFilter = () => applyCulturalCandidateFilters();

    if (searchInput) searchInput.addEventListener('input', triggerFilter);
    if (compFilter) compFilter.addEventListener('change', triggerFilter);
    if (groupFilter) groupFilter.addEventListener('change', triggerFilter);
    if (genderFilter) genderFilter.addEventListener('change', triggerFilter);
    if (distFilter) distFilter.addEventListener('change', triggerFilter);

    // Event delegation for Candidate Deletion
    tbody.addEventListener('click', async (e) => {
        const btnDelete = e.target.closest('.btn-delete-cult-cand');
        if (!btnDelete) return;

        const docId = btnDelete.dataset.docid;
        const trackNo = btnDelete.dataset.track;
        const name = btnDelete.dataset.name;
        const comp = btnDelete.dataset.comp;

        if (!docId) return;

        const confirmed = confirm(`⚠️ Are you sure you want to delete candidate #${trackNo} (${name}) from ${comp.toUpperCase()}?

This will remove their candidate profile and any submitted scorecards permanently.`);
        if (!confirmed) return;

        try {
            await deleteDoc(doc(db, 'cult_candidates', docId));
            // Also clean up any scorecard
            try {
                await deleteDoc(doc(db, 'cult_scores', docId));
            } catch (err) {}

            alert(`✅ Candidate #${trackNo} (${name}) successfully removed.`);
        } catch (err) {
            console.error("Delete candidate error:", err);
            alert("Failed to delete candidate: " + err.message);
        }
    });
}

function bindCulturalCandidatesListener() {
    if (unsubscribeCulturalCandidates) unsubscribeCulturalCandidates();
    if (unsubscribeCandidateScores) unsubscribeCandidateScores();

    const tbody = document.getElementById('cult-candidates-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-500 font-mono text-xs">⏳ Syncing live candidate roster...</td></tr>';
    }

    // 1. Listen to all candidates in /cult_candidates
    unsubscribeCulturalCandidates = onSnapshot(collection(db, 'cult_candidates'), (snapshot) => {
        allCulturalCandidatesList = [];
        snapshot.forEach(docSnap => {
            allCulturalCandidatesList.push({ docId: docSnap.id, ...docSnap.data() });
        });

        // 2. Listen to /cult_scores for live status badges
        if (!unsubscribeCandidateScores) {
            unsubscribeCandidateScores = onSnapshot(collection(db, 'cult_scores'), (scoreSnap) => {
                allCulturalScoresMap = {};
                scoreSnap.forEach(sDoc => {
                    allCulturalScoresMap[sDoc.id] = sDoc.data();
                });
                applyCulturalCandidateFilters();
            });
        }

        populateCandidateFilterDropdowns(allCulturalCandidatesList);
        applyCulturalCandidateFilters();
    }, (err) => {
        console.error("Candidate roster error:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-red-400 font-mono text-xs">Error loading candidates: ${err.message}</td></tr>`;
        }
    });
}

function populateCandidateFilterDropdowns(candidates) {
    const groupSelect = document.getElementById('cult-cand-filter-group');
    const genderSelect = document.getElementById('cult-cand-filter-gender');
    const districtSelect = document.getElementById('cult-cand-filter-district');

    if (!groupSelect || !genderSelect || !districtSelect) return;

    const savedGroup = groupSelect.value;
    const savedGender = genderSelect.value;
    const savedDistrict = districtSelect.value;

    const groups = new Set();
    const genders = new Set();
    const districts = new Set();

    candidates.forEach(c => {
        if (c.groupName) groups.add(c.groupName);
        if (c.gender) genders.add(c.gender);
        if (c.district) districts.add(c.district);
    });

    groupSelect.innerHTML = '<option value="All">All Age Groups</option>' +
        Array.from(groups).sort().map(g => `<option value="${g}" ${g === savedGroup ? 'selected' : ''}>${g}</option>`).join('');

    genderSelect.innerHTML = '<option value="All">All Genders</option>' +
        Array.from(genders).sort().map(gen => `<option value="${gen}" ${gen === savedGender ? 'selected' : ''}>${gen}</option>`).join('');

    districtSelect.innerHTML = '<option value="All">All Districts</option>' +
        Array.from(districts).sort().map(d => `<option value="${d}" ${d === savedDistrict ? 'selected' : ''}>${d}</option>`).join('');
}

function applyCulturalCandidateFilters() {
    const tbody = document.getElementById('cult-candidates-tbody');
    const searchInput = document.getElementById('cult-cand-search');
    const compFilter = document.getElementById('cult-cand-filter-comp');
    const groupFilter = document.getElementById('cult-cand-filter-group');
    const genderFilter = document.getElementById('cult-cand-filter-gender');
    const distFilter = document.getElementById('cult-cand-filter-district');

    if (!tbody) return;

    const queryStr = (searchInput?.value || '').trim().toLowerCase();
    const selectedComp = compFilter?.value || 'All';
    const selectedGroup = groupFilter?.value || 'All';
    const selectedGen = genderFilter?.value || 'All';
    const selectedDist = distFilter?.value || 'All';

    // 1. Update Global Counters
    let countTotal = allCulturalCandidatesList.length;
    let countDrawing = 0;
    let countSong = 0;
    let countDance = 0;
    let countRecital = 0;

    allCulturalCandidatesList.forEach(c => {
        if (c.competition === 'drawing') countDrawing++;
        else if (c.competition === 'song') countSong++;
        else if (c.competition === 'dance') countDance++;
        else if (c.competition === 'recital') countRecital++;
    });

    const elTotal = document.getElementById('cult-cands-count-total');
    const elDrawing = document.getElementById('cult-cands-count-drawing');
    const elSong = document.getElementById('cult-cands-count-song');
    const elDance = document.getElementById('cult-cands-count-dance');
    const elRecital = document.getElementById('cult-cands-count-recital');

    if (elTotal) elTotal.textContent = String(countTotal);
    if (elDrawing) elDrawing.textContent = String(countDrawing);
    if (elSong) elSong.textContent = String(countSong);
    if (elDance) elDance.textContent = String(countDance);
    if (elRecital) elRecital.textContent = String(countRecital);

    // 2. Filter Candidates
    const filtered = allCulturalCandidatesList.filter(c => {
        // Competition match
        if (selectedComp !== 'All' && c.competition !== selectedComp) return false;

        // Group match
        if (selectedGroup !== 'All' && c.groupName !== selectedGroup) return false;

        // Gender match
        if (selectedGen !== 'All' && c.gender !== selectedGen) return false;

        // District match
        if (selectedDist !== 'All' && c.district !== selectedDist) return false;

        // Search query match (Track No, Name, District, Institution)
        if (queryStr) {
            const trackMatch = String(c.trackNo || '').toLowerCase().includes(queryStr);
            const nameMatch = String(c.name || '').toLowerCase().includes(queryStr);
            const distMatch = String(c.district || '').toLowerCase().includes(queryStr);
            const instMatch = String(c.institution || '').toLowerCase().includes(queryStr);
            if (!trackMatch && !nameMatch && !distMatch && !instMatch) return false;
        }

        return true;
    });

    const elFiltered = document.getElementById('cult-cands-count-filtered');
    if (elFiltered) elFiltered.textContent = String(filtered.length);

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-500 font-mono text-xs">No candidates found matching the selected filters.</td></tr>';
        return;
    }

    // Sort by Competition then numerically by Track No
    filtered.sort((a, b) => {
        if (a.competition !== b.competition) return (a.competition || '').localeCompare(b.competition || '');
        return (parseInt(a.trackNo) || 0) - (parseInt(b.trackNo) || 0);
    });

    // 3. Render Table Rows
    const compBadgeMap = {
        drawing: '<span class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-purple-950/80 border border-purple-800 text-purple-300">🎨 Drawing</span>',
        song: '<span class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-blue-950/80 border border-blue-800 text-blue-300">🎵 Song</span>',
        dance: '<span class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-pink-950/80 border border-pink-800 text-pink-300">💃 Dance</span>',
        recital: '<span class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-amber-950/80 border border-amber-800 text-amber-300">📜 Recital</span>'
    };

    let rowsHtml = '';
    filtered.forEach(c => {
        const score = allCulturalScoresMap[c.docId] || {};
        const stage = stageStateMap[c.competition] || {};
        const panelSize = stage.panelSize !== undefined ? parseInt(stage.panelSize) : (c.competition === 'song' ? 1 : 2);

        const j1Done = score.j1_score !== undefined || c.j1_status;
        const j2Done = score.j2_score !== undefined || c.j2_status;

        let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">Pending</span>';

        if (panelSize === 1) {
            if (j1Done) {
                const tot = score.total_score !== undefined ? parseFloat(score.total_score).toFixed(1) : (parseFloat(score.j1_score) || 0).toFixed(1);
                statusBadge = `<span class="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/80 text-emerald-400 border border-emerald-800">Scored (${tot}/50)</span>`;
            }
        } else {
            if (j1Done && j2Done) {
                const tot = score.total_score !== undefined ? parseFloat(score.total_score).toFixed(1) : ((parseFloat(score.j1_score)||0) + (parseFloat(score.j2_score)||0)).toFixed(1);
                statusBadge = `<span class="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/80 text-emerald-400 border border-emerald-800">Scored (${tot}/100)</span>`;
            } else if (j1Done) {
                statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-950/70 text-amber-300 border border-amber-700">J1 Scored (1/2)</span>';
            } else if (j2Done) {
                statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-950/70 text-amber-300 border border-amber-700">J2 Scored (1/2)</span>';
            }
        }

        const compBadge = compBadgeMap[c.competition] || `<span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-800 text-slate-300">${c.competition}</span>`;

        rowsHtml += `
            <tr class="border-b border-slate-800/80 hover:bg-slate-800/40 transition-colors font-medium">
                <td class="p-4 font-mono font-black text-brand-400 text-base">#${c.trackNo}</td>
                <td class="p-4">${compBadge}</td>
                <td class="p-4">
                    <div class="font-bold text-white text-sm">${c.name}</div>
                    <div class="text-[11px] text-purple-400/80 font-medium truncate max-w-[240px]">${c.institution || 'Independent'}</div>
                </td>
                <td class="p-4 text-xs text-slate-300">${c.groupName || '-'}</td>
                <td class="p-4 text-xs text-slate-400">${c.gender || '-'}</td>
                <td class="p-4 text-xs text-slate-400">${c.district || '-'}</td>
                <td class="p-4 text-center">${statusBadge}</td>
                <td class="p-4 text-right">
                    <button type="button" class="btn-delete-cult-cand bg-red-950/40 hover:bg-red-800 text-red-400 hover:text-white px-2.5 py-1 rounded-lg text-xs font-bold border border-red-900/60 transition-colors cursor-pointer" data-docid="${c.docId}" data-track="${c.trackNo}" data-name="${c.name}" data-comp="${c.competition}" title="Delete Candidate">
                        ✕ Delete
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
}


// ============================================================================
// 8. CULTURAL DATA PURGE & WIPE OPERATIONS (CANDIDATES & SCORES)
// ============================================================================
function initCulturalWipeModals() {
    // --- 1. WIPE CANDIDATES MODAL ---
    const btnOpenWipeCands = document.getElementById('btn-cult-trigger-wipe-cands');
    const modalWipeCands = document.getElementById('modal-cult-wipe-cands');
    const btnCancelWipeCands = document.getElementById('btn-cancel-cult-wipe-cands');
    const btnExecuteWipeCands = document.getElementById('btn-execute-cult-wipe-cands');
    const inputConfirmWipeCands = document.getElementById('input-confirm-cult-wipe-cands');
    const scopeSelectWipeCands = document.getElementById('cult-wipe-cands-scope');

    if (btnOpenWipeCands && modalWipeCands) {
        btnOpenWipeCands.addEventListener('click', () => {
            modalWipeCands.classList.remove('hidden');
            modalWipeCands.classList.add('flex');
            if (inputConfirmWipeCands) {
                inputConfirmWipeCands.value = '';
                inputConfirmWipeCands.focus();
            }
            if (btnExecuteWipeCands) btnExecuteWipeCands.disabled = true;
        });

        btnCancelWipeCands?.addEventListener('click', () => {
            modalWipeCands.classList.add('hidden');
            modalWipeCands.classList.remove('flex');
        });

        inputConfirmWipeCands?.addEventListener('input', (e) => {
            if (btnExecuteWipeCands) {
                btnExecuteWipeCands.disabled = (e.target.value.trim().toLowerCase() !== 'confirm');
            }
        });

        btnExecuteWipeCands?.addEventListener('click', async () => {
            const scope = scopeSelectWipeCands ? scopeSelectWipeCands.value : 'all';
            await executeWipeCulturalCandidates(scope, modalWipeCands, btnExecuteWipeCands);
        });
    }

    // --- 2. WIPE SCORES MODAL ---
    const btnOpenWipeScores = document.getElementById('btn-cult-trigger-wipe-scores');
    const modalWipeScores = document.getElementById('modal-cult-wipe-scores');
    const btnCancelWipeScores = document.getElementById('btn-cancel-cult-wipe-scores');
    const btnExecuteWipeScores = document.getElementById('btn-execute-cult-wipe-scores');
    const inputConfirmWipeScores = document.getElementById('input-confirm-cult-wipe-scores');
    const scopeSelectWipeScores = document.getElementById('cult-wipe-scores-scope');

    if (btnOpenWipeScores && modalWipeScores) {
        btnOpenWipeScores.addEventListener('click', () => {
            modalWipeScores.classList.remove('hidden');
            modalWipeScores.classList.add('flex');
            if (inputConfirmWipeScores) {
                inputConfirmWipeScores.value = '';
                inputConfirmWipeScores.focus();
            }
            if (btnExecuteWipeScores) btnExecuteWipeScores.disabled = true;
        });

        btnCancelWipeScores?.addEventListener('click', () => {
            modalWipeScores.classList.add('hidden');
            modalWipeScores.classList.remove('flex');
        });

        inputConfirmWipeScores?.addEventListener('input', (e) => {
            if (btnExecuteWipeScores) {
                btnExecuteWipeScores.disabled = (e.target.value.trim().toLowerCase() !== 'confirm');
            }
        });

        btnExecuteWipeScores?.addEventListener('click', async () => {
            const scope = scopeSelectWipeScores ? scopeSelectWipeScores.value : 'all';
            await executeWipeCulturalScores(scope, modalWipeScores, btnExecuteWipeScores);
        });
    }
}

async function executeWipeCulturalCandidates(scope, modalEl, btnEl) {
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerText = "⏳ Deleting from Vault...";
    }

    try {
        let q;
        if (scope === 'all') {
            q = collection(db, 'cult_candidates');
        } else {
            q = query(collection(db, 'cult_candidates'), where('competition', '==', scope));
        }

        const snap = await getDocs(q);
        if (snap.empty) {
            alert("No candidates found matching the selected scope.");
            if (modalEl) { modalEl.classList.add('hidden'); modalEl.classList.remove('flex'); }
            return;
        }

        let totalDeleted = 0;
        const docsArray = snap.docs;
        const CHUNK_SIZE = 400;

        for (let i = 0; i < docsArray.length; i += CHUNK_SIZE) {
            const chunk = docsArray.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);

            chunk.forEach(d => {
                batch.delete(d.ref);
                // Also delete matching scorecard if exists
                const scoreRef = doc(db, 'cult_scores', d.id);
                batch.delete(scoreRef);
                totalDeleted++;
            });

            await batch.commit();
        }

        // Also clean metadata if scope === all
        if (scope === 'all') {
            const comps = ['drawing', 'song', 'dance', 'recital'];
            const metaBatch = writeBatch(db);
            comps.forEach(c => {
                metaBatch.delete(doc(db, 'cult_metadata', c));
            });
            await metaBatch.commit();
        }

        alert(`✅ Successfully deleted ${totalDeleted} candidate profile(s) and associated scorecards.`);
    } catch (err) {
        console.error("Wipe candidates error:", err);
        alert("Failed to delete candidates: " + err.message);
    } finally {
        if (modalEl) {
            modalEl.classList.add('hidden');
            modalEl.classList.remove('flex');
        }
        if (btnEl) {
            btnEl.innerText = "Delete Candidates";
            btnEl.disabled = false;
        }
    }
}

async function executeWipeCulturalScores(scope, modalEl, btnEl) {
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerText = "⏳ Deleting Scores...";
    }

    try {
        let scoreQuery;
        let candQuery;

        if (scope === 'all') {
            scoreQuery = collection(db, 'cult_scores');
            candQuery = collection(db, 'cult_candidates');
        } else {
            scoreQuery = query(collection(db, 'cult_scores'), where('competition', '==', scope));
            candQuery = query(collection(db, 'cult_candidates'), where('competition', '==', scope));
        }

        const scoreSnap = await getDocs(scoreQuery);
        let totalScoresDeleted = 0;

        // 1. Delete all matching scorecards
        if (!scoreSnap.empty) {
            const scoreDocs = scoreSnap.docs;
            const CHUNK_SIZE = 400;

            for (let i = 0; i < scoreDocs.length; i += CHUNK_SIZE) {
                const chunk = scoreDocs.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);

                chunk.forEach(d => {
                    batch.delete(d.ref);
                    totalScoresDeleted++;
                });

                await batch.commit();
            }
        }

        // 2. Reset candidates j1_status & j2_status to false
        const candSnap = await getDocs(candQuery);
        if (!candSnap.empty) {
            const candDocs = candSnap.docs;
            const CHUNK_SIZE = 400;

            for (let i = 0; i < candDocs.length; i += CHUNK_SIZE) {
                const chunk = candDocs.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);

                chunk.forEach(d => {
                    batch.update(d.ref, {
                        j1_status: false,
                        j2_status: false,
                        status: 'pending'
                    });
                });

                await batch.commit();
            }
        }

        alert(`✅ Successfully deleted ${totalScoresDeleted} score(s). All matching candidates have been reset back to 'Pending'.`);
    } catch (err) {
        console.error("Wipe scores error:", err);
        alert("Failed to delete scores: " + err.message);
    } finally {
        if (modalEl) {
            modalEl.classList.add('hidden');
            modalEl.classList.remove('flex');
        }
        if (btnEl) {
            btnEl.innerText = "Delete Scores";
            btnEl.disabled = false;
        }
    }
}

// ============================================================================
// 10. PUBLISHED PODIUMS EXPLORER (CULTURAL VAULT)
// ============================================================================
function initPublishedPodiumsExplorer() {
    const btnRefresh = document.getElementById('btn-cult-podiums-refresh');
    const btnWipe = document.getElementById('btn-cult-podiums-wipe-all');
    const compFilter = document.getElementById('cult-podiums-filter-comp');

    if (btnRefresh) btnRefresh.addEventListener('click', loadCulturalPublishedPodiums);
    if (btnWipe) btnWipe.addEventListener('click', wipeAllCulturalPublishedPodiums);
    if (compFilter) compFilter.addEventListener('change', renderCulturalPodiumsList);
}

async function loadCulturalPublishedPodiums() {
    const grid = document.getElementById('cult-podiums-grid');
    const details = document.getElementById('cult-podium-details');
    if (!grid) return;

    grid.innerHTML = `
        <div class="col-span-1 md:col-span-2 lg:col-span-3 flex justify-center py-12">
            <p class="text-slate-500 italic font-mono text-sm flex items-center">
                <span class="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-3"></span>
                Fetching official published podiums from vault...
            </p>
        </div>
    `;
    if (details) details.classList.add('hidden');

    try {
        const snap = await getDocs(collection(db, 'cult_published_results'));
        allPublishedCulturalPodiums = [];
        snap.forEach(d => {
            allPublishedCulturalPodiums.push(d.data());
        });

        // Sort latest published first
        allPublishedCulturalPodiums.sort((a, b) => {
            const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
            const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
            return timeB - timeA;
        });

        renderCulturalPodiumsList();
    } catch (err) {
        console.error("Load cultural podiums error:", err);
        grid.innerHTML = `
            <div class="col-span-1 md:col-span-2 lg:col-span-3 text-center py-12">
                <p class="text-red-400 font-bold mb-2">❌ Failed to load published podiums.</p>
                <p class="text-xs text-slate-500 font-mono">${err.message}</p>
            </div>
        `;
    }
}

function renderCulturalPodiumsList() {
    const grid = document.getElementById('cult-podiums-grid');
    const compFilterEl = document.getElementById('cult-podiums-filter-comp');
    if (!grid) return;

    const filterVal = compFilterEl ? compFilterEl.value : 'ALL';
    const filtered = allPublishedCulturalPodiums.filter(p => {
        if (filterVal !== 'ALL' && p.competition !== filterVal) return false;
        return true;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-1 md:col-span-2 lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
                <div class="w-14 h-14 bg-slate-800 text-slate-500 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-3">🏛️</div>
                <h4 class="text-base font-bold text-white mb-1">No Published Podiums Found</h4>
                <p class="text-xs text-slate-500 max-w-md mx-auto">
                    ${filterVal !== 'ALL' ? `No official podiums found for ${filterVal.toUpperCase()}.` : 'No official cultural podiums have been published yet.'}
                    You can compute standings and click "Publish Podium" in the Results & Podiums tab.
                </p>
            </div>
        `;
        return;
    }

    grid.innerHTML = '';
    const compIcons = { drawing: '🎨', song: '🎵', dance: '💃', recital: '📜' };
    const compColors = {
        drawing: 'bg-purple-950/60 border-purple-800/80 text-purple-300',
        song: 'bg-blue-950/60 border-blue-800/80 text-blue-300',
        dance: 'bg-pink-950/60 border-pink-800/80 text-pink-300',
        recital: 'bg-amber-950/60 border-amber-800/80 text-amber-300'
    };

    filtered.forEach(p => {
        const comp = p.competition || 'drawing';
        const compIcon = compIcons[comp] || '🎭';
        const colorClasses = compColors[comp] || 'bg-slate-800 border-slate-700 text-slate-300';
        const panelSize = p.panelSize !== undefined ? parseInt(p.panelSize) : (comp === 'song' ? 1 : 2);
        const dateStr = p.publishedAt ? new Date(p.publishedAt).toLocaleString() : 'N/A';
        const standingsCount = Array.isArray(p.standings) ? p.standings.length : 0;

        // Top 3 preview
        const top1 = p.standings?.[0]?.name ? `🥇 ${p.standings[0].name}` : null;
        const top2 = p.standings?.[1]?.name ? `🥈 ${p.standings[1].name}` : null;
        const top3 = p.standings?.[2]?.name ? `🥉 ${p.standings[2].name}` : null;

        const card = document.createElement('div');
        card.className = "bg-slate-900 border border-slate-800 hover:border-brand-500/60 p-5 sm:p-6 rounded-2xl cursor-pointer hover:bg-slate-850 transition-all flex flex-col justify-between group shadow-sm";
        card.innerHTML = `
            <div>
                <div class="flex justify-between items-start mb-3">
                    <span class="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${colorClasses} flex items-center gap-1.5 shadow-sm">
                        <span>${compIcon}</span> ${comp.toUpperCase()}
                    </span>
                    <span class="text-[10px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded flex items-center gap-1">
                        <span class="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span> OFFICIAL
                    </span>
                </div>

                <div class="font-black text-white text-lg tracking-tight mb-2 group-hover:text-brand-400 transition-colors">
                    ${p.group || 'All Groups'}
                </div>

                <div class="flex flex-wrap gap-1.5 mb-4">
                    <span class="text-[11px] font-bold text-slate-300 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800">
                        ${p.gender || 'All'}
                    </span>
                    <span class="text-[11px] font-bold text-slate-400 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800">
                        ${p.district || 'All Districts'}
                    </span>
                    <span class="text-[11px] font-bold text-indigo-300 bg-indigo-950/40 px-2.5 py-1 rounded-md border border-indigo-800/50">
                        ${panelSize === 1 ? '1 Judge (/50)' : '2 Judges (/100)'}
                    </span>
                </div>

                ${top1 ? `
                <div class="bg-slate-950/80 rounded-xl p-3 border border-slate-800/80 mb-3 space-y-1">
                    <div class="text-xs text-yellow-300 font-bold truncate">${top1}</div>
                    ${top2 ? `<div class="text-xs text-slate-300 font-medium truncate">${top2}</div>` : ''}
                    ${top3 ? `<div class="text-xs text-amber-500 font-medium truncate">${top3}</div>` : ''}
                </div>
                ` : ''}
            </div>

            <div class="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span class="text-slate-500 font-mono text-[11px]">${dateStr}</span>
                <span class="font-bold text-brand-400 group-hover:translate-x-1 transition-transform flex items-center gap-1">
                    ${standingsCount} Ranked →
                </span>
            </div>
        `;

        card.addEventListener('click', () => showCulturalPodiumDetails(p));
        grid.appendChild(card);
    });
}

function showCulturalPodiumDetails(p) {
    const details = document.getElementById('cult-podium-details');
    if (!details) return;

    details.classList.remove('hidden');

    const comp = p.competition || 'drawing';
    const compIcons = { drawing: '🎨', song: '🎵', dance: '💃', recital: '📜' };
    const compIcon = compIcons[comp] || '🎭';
    const panelSize = p.panelSize !== undefined ? parseInt(p.panelSize) : (comp === 'song' ? 1 : 2);
    const dateStr = p.publishedAt ? new Date(p.publishedAt).toLocaleString() : 'N/A';
    const standings = Array.isArray(p.standings) ? p.standings : [];

    let rowsHtml = '';
    standings.forEach(s => {
        const isPodium = s.rank <= 3;
        const j2Display = panelSize === 1
            ? '<span class="text-xs text-slate-600 font-mono italic">−</span>'
            : (s.j2Score !== null && s.j2Score !== undefined ? (typeof s.j2Score === 'number' ? s.j2Score.toFixed(1) : s.j2Score) : '−');

        rowsHtml += `
            <tr class="${isPodium ? 'bg-slate-950/60 font-bold' : 'text-slate-400'} border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                <td class="p-4 text-center text-lg font-black">${s.medal && s.medal !== '-' ? s.medal : s.rank}</td>
                <td class="p-4 font-mono font-bold text-xs text-slate-300">${s.trackNo}</td>
                <td class="p-4 font-bold ${isPodium ? 'text-white' : 'text-slate-300'}">${s.name}</td>
                <td class="p-4 text-xs text-slate-400">${s.groupName || p.group || '-'}</td>
                <td class="p-4 text-xs text-slate-400">${s.gender || p.gender || '-'}</td>
                <td class="p-4 text-xs text-slate-400">${s.district || p.district || '-'}</td>
                <td class="p-4 text-xs text-slate-400">${s.institution || '-'}</td>
                <td class="p-4 text-center font-mono font-bold text-slate-300">${s.j1Score !== null && s.j1Score !== undefined ? (typeof s.j1Score === 'number' ? s.j1Score.toFixed(1) : s.j1Score) : '−'}</td>
                <td class="p-4 text-center font-mono font-bold text-slate-300">${j2Display}</td>
                <td class="p-4 text-right font-mono font-black text-xl text-emerald-400">${s.finalScore || (typeof s.totalScore === 'number' ? s.totalScore.toFixed(2) : s.totalScore)}</td>
            </tr>
        `;
    });

    details.innerHTML = `
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 mb-6 border-b border-slate-800 gap-4">
            <div>
                <div class="flex items-center gap-2 mb-1.5">
                    <span class="text-2xl">${compIcon}</span>
                    <h4 class="text-2xl font-black text-white uppercase tracking-tight">${comp.toUpperCase()} PODIUM</h4>
                    <span class="bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-xs font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">OFFICIAL VAULT</span>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-xs">
                    <span class="font-black text-brand-400">${p.group || 'All Groups'}</span>
                    <span class="text-slate-600">·</span>
                    <span class="text-slate-300">${p.gender || 'All'}</span>
                    <span class="text-slate-600">·</span>
                    <span class="text-slate-400">${p.district || 'All Districts'}</span>
                    <span class="text-slate-600">·</span>
                    <span class="text-indigo-400 font-bold">${panelSize === 1 ? '1 Judge (/50)' : '2 Judges (/100)'}</span>
                    <span class="text-slate-600">·</span>
                    <span class="text-slate-500 font-mono">Published: ${dateStr}</span>
                </div>
            </div>

            <div class="flex flex-wrap gap-2.5 w-full md:w-auto">
                <button type="button" id="btn-cult-podium-download-csv" class="bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 hover:text-white border border-emerald-800 text-xs font-bold py-2.5 px-4 rounded-xl transition-colors flex items-center gap-2 cursor-pointer shadow-sm">
                    <span>⬇️</span> Download CSV
                </button>
                <button type="button" id="btn-cult-podium-delete-single" class="bg-red-950/60 hover:bg-red-900 text-red-300 hover:text-white border border-red-800 text-xs font-bold py-2.5 px-4 rounded-xl transition-colors flex items-center gap-2 cursor-pointer shadow-sm">
                    <span>🗑️</span> Delete Result
                </button>
                <button type="button" id="btn-cult-podium-close-details" class="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-bold py-2.5 px-4 rounded-xl transition-colors flex items-center gap-2 cursor-pointer">
                    <span>✖</span> Close View
                </button>
            </div>
        </div>

        <div class="overflow-x-auto w-full custom-scrollbar rounded-xl border border-slate-800">
            <table class="w-full text-left border-collapse text-sm">
                <thead class="bg-slate-950 border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                    <tr>
                        <th class="p-4 text-center">Rank</th>
                        <th class="p-4">Track</th>
                        <th class="p-4">Candidate</th>
                        <th class="p-4">Group</th>
                        <th class="p-4">Gender</th>
                        <th class="p-4">District</th>
                        <th class="p-4">Institution</th>
                        <th class="p-4 text-center">J1 (/50)</th>
                        <th class="p-4 text-center">${panelSize === 1 ? 'J2 (N/A)' : 'J2 (/50)'}</th>
                        <th class="p-4 text-right">${panelSize === 1 ? 'Total (/50)' : 'Total (/100)'}</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/80">
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;

    // Button event bindings:
    document.getElementById('btn-cult-podium-close-details')?.addEventListener('click', () => {
        details.classList.add('hidden');
    });

    document.getElementById('btn-cult-podium-download-csv')?.addEventListener('click', () => {
        downloadSingleCultPodiumCSV(p);
    });

    document.getElementById('btn-cult-podium-delete-single')?.addEventListener('click', async () => {
        const confirmDelete = confirm(`⚠️ Are you sure you want to permanently delete the official published podium for:\n\nCompetition: ${comp.toUpperCase()}\nGroup: ${p.group || 'All'}\nGender: ${p.gender || 'All'}\nDistrict: ${p.district || 'All'}\n\nDisplay screens synced to this filter will immediately revert to live mode.`);
        if (!confirmDelete) return;

        try {
            await deleteDoc(doc(db, 'cult_published_results', p.docId));
            alert("✅ Official published podium successfully deleted from the vault.");
            details.classList.add('hidden');
            await loadCulturalPublishedPodiums();
        } catch (err) {
            console.error("Delete published podium error:", err);
            alert("Failed to delete podium: " + err.message);
        }
    });

    details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function downloadSingleCultPodiumCSV(p) {
    const standings = Array.isArray(p.standings) ? p.standings : [];
    if (standings.length === 0) return;

    const panelSize = p.panelSize !== undefined ? parseInt(p.panelSize) : (p.competition === 'song' ? 1 : 2);
    const isSingleJudge = panelSize === 1;

    let csv = isSingleJudge
        ? "Rank,Medal,Track No,Candidate Name,Group,Gender,District,Institute,Judge 1 Score (/50),Total Score (/50)\n"
        : "Rank,Medal,Track No,Candidate Name,Group,Gender,District,Institute,J1 Score (/50),J2 Score (/50),Total Score (/100)\n";

    standings.forEach(s => {
        const j1 = s.j1Score !== null && s.j1Score !== undefined ? s.j1Score : '';
        const j2 = s.j2Score !== null && s.j2Score !== undefined ? s.j2Score : '';
        const finalScore = s.finalScore || s.totalScore || '';

        if (isSingleJudge) {
            csv += `"${s.rank}","${s.medal || ''}","${s.trackNo}","${s.name}","${s.groupName || p.group || ''}","${s.gender || p.gender || ''}","${s.district || p.district || ''}","${s.institution || ''}","${j1}","${finalScore}"\n`;
        } else {
            csv += `"${s.rank}","${s.medal || ''}","${s.trackNo}","${s.name}","${s.groupName || p.group || ''}","${s.gender || p.gender || ''}","${s.district || p.district || ''}","${s.institution || ''}","${j1}","${j2}","${finalScore}"\n`;
        }
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CULT_PODIUM_${p.competition}_${(p.group||'ALL').replace(/[^a-zA-Z0-9]/g,'')}_${(p.gender||'ALL').replace(/[^a-zA-Z0-9]/g,'')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function wipeAllCulturalPublishedPodiums() {
    const count = allPublishedCulturalPodiums.length;
    if (count === 0) {
        alert("There are no published podiums in the vault to delete.");
        return;
    }

    const confirm1 = confirm(`⚠️ DANGER: You are about to permanently delete ALL ${count} published official cultural podiums from the vault!\n\nThis will remove official podiums for all cultural competitions (Drawing, Song, Dance, Recital).\n\nDo you want to proceed?`);
    if (!confirm1) return;

    const confirm2 = prompt(`To confirm complete deletion of all published cultural podiums, type 'DELETE ALL PODIUMS':`);
    if (confirm2 !== 'DELETE ALL PODIUMS') {
        alert("Operation cancelled. Confirmation text did not match.");
        return;
    }

    try {
        const snap = await getDocs(collection(db, 'cult_published_results'));
        if (!snap.empty) {
            const docs = snap.docs;
            const CHUNK_SIZE = 400;
            for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
                const chunk = docs.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                chunk.forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        }

        alert(`✅ Successfully deleted all ${count} published podiums from the vault.`);
        const details = document.getElementById('cult-podium-details');
        if (details) details.classList.add('hidden');
        await loadCulturalPublishedPodiums();
    } catch (err) {
        console.error("Wipe all published podiums error:", err);
        alert("Failed to delete podiums: " + err.message);
    }
}

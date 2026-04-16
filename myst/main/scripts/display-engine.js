// ============================================================================
// MYST LIVE TV DISPLAY ENGINE
// Real-Time Matrix Observer (Read-Only)
// ============================================================================

import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

// --- GLOBAL STATE CACHES ---
let currentMatId = null;
let currentQueue = [];
let candidatesCache = {};
let liveScoresCache = {};

document.addEventListener('DOMContentLoaded', () => {
    // 1. Listen for Authentication
    onAuthStateChanged(auth, (user) => {
        if (user) {
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('setup-screen').classList.remove('hidden');
            document.getElementById('setup-screen').classList.add('flex');
            
            // Boot the data engines
            loadMats();
            startGlobalDataCache();
        } else {
            document.getElementById('auth-screen').classList.remove('hidden');
            document.getElementById('setup-screen').classList.add('hidden');
            document.getElementById('setup-screen').classList.remove('flex');
        }
    });

    // 2. Login Button Binding
    document.getElementById('btn-login').addEventListener('click', async () => {
        const email = document.getElementById('display-email').value;
        const pass = document.getElementById('display-pass').value;
        const errorMsg = document.getElementById('login-error');
        const btn = document.getElementById('btn-login');

        btn.innerText = "Connecting..."; btn.disabled = true;
        try {
            await signInWithEmailAndPassword(auth, email, pass);
            errorMsg.classList.add('hidden');
        } catch (error) {
            errorMsg.innerText = "Invalid Credentials";
            errorMsg.classList.remove('hidden');
            btn.innerText = "Connect Display"; btn.disabled = false;
        }
    });

    // 3. Mat Binding Button
    document.getElementById('btn-bind-mat').addEventListener('click', () => {
        const select = document.getElementById('select-mat');
        currentMatId = select.value;
        const matNumber = select.options[select.selectedIndex].text;

        // Update UI
        document.getElementById('display-mat-number').innerText = matNumber.toUpperCase();
        document.getElementById('setup-screen').classList.remove('flex');
        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('main-display').classList.remove('hidden');
        document.getElementById('main-display').classList.add('flex');

        // Start listening to this specific mat's queue
        startQueueObserver();
    });
});

// ==========================================
// DATA FETCHING & CACHING
// ==========================================

function loadMats() {
    onSnapshot(collection(db, 'active_mats'), snap => {
        const select = document.getElementById('select-mat');
        const btn = document.getElementById('btn-bind-mat');
        
        select.innerHTML = '<option value="">-- Select Mat to Broadcast --</option>';
        snap.forEach(doc => {
            select.innerHTML += `<option value="${doc.id}">Mat ${doc.data().matNumber}</option>`;
        });
        
        select.addEventListener('change', e => {
            btn.disabled = !e.target.value;
        });
    });
}

// Caches the heavy profiles and scores so the table renders instantly
function startGlobalDataCache() {
    onSnapshot(collection(db, 'candidates'), snap => {
        snap.forEach(doc => candidatesCache[doc.id] = doc.data());
        renderLiveScoreboard();
    });

    onSnapshot(collection(db, 'scores'), snap => {
        snap.forEach(doc => liveScoresCache[doc.id] = doc.data());
        renderLiveScoreboard();
    });
}

function startQueueObserver() {
    const q = query(collection(db, 'scoring_queue'), where('stageId', '==', currentMatId));
    onSnapshot(q, snap => {
        currentQueue = snap.docs.map(doc => doc.data());
        
        // Sort by Batch Number, then by Time (Matches the Judge/Stage Manager view exactly)
        currentQueue.sort((a, b) => {
            if (a.batchNo === b.batchNo) return a.timestamp - b.timestamp;
            return a.batchNo - b.batchNo;
        });
        
        renderLiveScoreboard();
    });
}

// ==========================================
// RENDERING ENGINE
// ==========================================

function renderLiveScoreboard() {
    const tbody = document.getElementById('live-scores-tbody');
    if (!currentMatId || !tbody) return;

    if (currentQueue.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-12 text-center text-gray-500 italic tracking-widest uppercase">Awaiting athletes from Stage Manager...</td></tr>`;
        return;
    }

    tbody.innerHTML = '';

    currentQueue.forEach(qItem => {
        const trackNo = qItem.trackNo;
        const c = candidatesCache[trackNo] || {};
        const s = liveScoresCache[trackNo] || {};

        // Helper: Safely calculate a single judge's live total
        const getJudgeMarks = (judgePrefix) => {
            const a1 = parseFloat(s[`${judgePrefix}_a1`]);
            const a2 = parseFloat(s[`${judgePrefix}_a2`]);
            const opt = parseFloat(s[`${judgePrefix}_opt`]);
            
            let total = 0;
            let isTyping = false;
            
            if(!isNaN(a1)) { total += a1; isTyping = true; }
            if(!isNaN(a2)) { total += a2; isTyping = true; }
            if(!isNaN(opt)) { total += opt; isTyping = true; }
            
            return { total, isTyping };
        };

        const j1 = getJudgeMarks('j1'), j2 = getJudgeMarks('j2'), j3 = getJudgeMarks('j3'), j4 = getJudgeMarks('j4'), j5 = getJudgeMarks('j5');

        // Helper: Format the UI text based on the Judge's Lock Status
        const formatScoreCell = (judgeObj, isLocked) => {
            if (isLocked) return `<span class="text-white">${judgeObj.total.toFixed(1)}</span>`;
            if (judgeObj.isTyping) return `<span class="text-yellow-400 animate-pulse">${judgeObj.total.toFixed(1)}</span>`;
            return `<span class="text-gray-700">-</span>`; // Empty state
        };

        // Olympic Math Engine (Only reveals final score if all 5 judges are locked!)
        let finalScoreHtml = `<span class="text-gray-600 text-sm tracking-widest uppercase">Scoring...</span>`;
        const isFullyScored = qItem.j1_status && qItem.j2_status && qItem.j3_status && qItem.j4_status && qItem.j5_status;

        if (isFullyScored) {
            const panel = [j1.total, j2.total, j3.total, j4.total, j5.total];
            const olympicTotal = panel.reduce((a,b)=>a+b, 0) - Math.max(...panel) - Math.min(...panel);
            finalScoreHtml = `<span class="text-green-400 font-black text-3xl drop-shadow-[0_0_12px_rgba(74,222,128,0.5)]">${olympicTotal.toFixed(2)}</span>`;
        }

        // Build the Row
        tbody.innerHTML += `
            <tr class="hover:bg-gray-800/50 transition-colors border-b border-gray-800">
                <td class="p-4 font-mono text-blue-500 font-bold">${trackNo}</td>
                <td class="p-4 font-black tracking-wide">${c.name || 'Unknown'}</td>
                <td class="p-4 text-center text-yellow-500 text-sm font-bold uppercase tracking-widest">${c.division || ''}</td>
                <td class="p-4 text-center">${formatScoreCell(j1, qItem.j1_status)}</td>
                <td class="p-4 text-center">${formatScoreCell(j2, qItem.j2_status)}</td>
                <td class="p-4 text-center">${formatScoreCell(j3, qItem.j3_status)}</td>
                <td class="p-4 text-center">${formatScoreCell(j4, qItem.j4_status)}</td>
                <td class="p-4 text-center">${formatScoreCell(j5, qItem.j5_status)}</td>
                <td class="p-4 text-right">${finalScoreHtml}</td>
            </tr>
        `;
    });
}
// ============================================================================
// MODULE 10: PUBLISHED RESULTS EXPLORER
// Standalone Viewer for Official Database Podiums
// ============================================================================

import { collection, getDocs, doc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

export function initResultsExplorer() {
    const btnRefresh = document.getElementById('btn-refresh-explorer');
    const btnWipe = document.getElementById('btn-wipe-results');
    const navBtn = document.getElementById('nav-results-explorer'); // The new sidebar button

    if (btnRefresh) btnRefresh.addEventListener('click', loadPublishedExplorer);
    if (btnWipe) btnWipe.addEventListener('click', wipeAllResults);
    
    // Auto-fetch data whenever the Admin clicks the Sidebar Tab
    if (navBtn) navBtn.addEventListener('click', loadPublishedExplorer);
}

async function loadPublishedExplorer() {
    const container = document.getElementById('explorer-list');
    const details = document.getElementById('explorer-details');
    if(!container) return;
    
    container.innerHTML = '<p class="text-gray-500 italic">Fetching from database...</p>';
    details.classList.add('hidden');

    try {
        const snap = await getDocs(collection(db, 'published_results'));
        if(snap.empty) {
            container.innerHTML = '<p class="text-gray-500 italic">No official results published yet.</p>';
            return;
        }

        container.innerHTML = '';
        snap.forEach(d => {
            const data = d.data();
            const dateStr = new Date(data.publishedAt).toLocaleString();
            
            const card = document.createElement('div');
            card.className = "bg-gray-800 border border-gray-700 p-5 rounded-xl cursor-pointer hover:bg-gray-700 hover:border-blue-500 transition-all shadow-md active:scale-95 flex flex-col justify-between";
            card.innerHTML = `
                <div>
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[10px] font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded uppercase tracking-wider border border-green-800">OFFICIAL</span>
                        <span class="text-xs text-gray-500">${dateStr}</span>
                    </div>
                    <div class="font-black text-blue-400 text-lg leading-tight mb-1">${data.group}</div>
                    <div class="text-white text-sm font-bold">${data.gender} <span class="text-gray-500 font-normal">| ${data.district}</span></div>
                </div>
                <div class="mt-4 text-xs text-gray-400 italic text-right">Click to view ${data.standings.length} athletes -></div>
            `;
            
            card.addEventListener('click', () => showExplorerDetails(data));
            container.appendChild(card);
        });
    } catch(e) {
        console.error("Explorer error:", e);
        container.innerHTML = '<p class="text-red-500">Failed to load explorer.</p>';
    }
}

function showExplorerDetails(data) {
    const details = document.getElementById('explorer-details');
    details.classList.remove('hidden');
    
    let html = `
        <div class="flex justify-between items-center mb-6 border-b border-gray-800 pb-4">
            <div>
                <h4 class="text-2xl font-black text-white uppercase tracking-tight">${data.group}</h4>
                <p class="text-blue-400 font-bold">${data.gender} <span class="text-gray-400 font-normal">| ${data.district}</span></p>
            </div>
            <div class="flex space-x-3">
                <button id="btn-download-csv" class="bg-green-900/40 hover:bg-green-800 text-green-200 border border-green-700 text-sm font-bold py-2 px-4 rounded shadow transition-colors">
                    ⬇️ Download CSV
                </button>
                <button id="btn-delete-single-result" class="bg-red-900/40 hover:bg-red-800 text-red-200 border border-red-700 text-sm font-bold py-2 px-4 rounded shadow transition-colors">
                    🗑️ Delete Result
                </button>
                <button id="btn-close-details" class="bg-gray-800 hover:bg-gray-700 text-white border border-gray-600 text-sm font-bold py-2 px-4 rounded shadow transition-colors">
                    ✖ Close View
                </button>
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-sm">
                <thead class="bg-gray-900 text-gray-400 uppercase text-xs">
                    <tr><th class="p-3">Div</th><th class="p-3">Rank</th><th class="p-3">Track No</th><th class="p-3">Athlete</th><th class="p-3">District</th><th class="p-3 text-right">Final Score</th></tr>
                </thead>
                <tbody class="divide-y divide-gray-800">
    `;
    
    data.standings.forEach(s => {
        const isPodium = s.rank <= 3;
        html += `<tr class="hover:bg-gray-800 ${isPodium ? 'text-gray-200' : 'text-gray-500'}"><td class="p-3 font-bold text-brand-400">${s.division}</td><td class="p-3 text-lg">${isPodium ? s.medal : s.rank}</td><td class="p-3 font-mono text-xs">${s.trackNo}</td><td class="p-3 font-bold">${s.name}</td><td class="p-3">${s.district}</td><td class="p-3 text-right font-black ${isPodium ? 'text-blue-400' : 'text-gray-400'}">${s.finalScore}</td></tr>`;
    });
    
    details.innerHTML = html + `</tbody></table></div>`;
    
    // Bind the standard buttons
    document.getElementById('btn-close-details').addEventListener('click', () => {
        details.classList.add('hidden');
    });

    document.getElementById('btn-delete-single-result').addEventListener('click', async () => {
        if(confirm(`⚠️ Are you sure you want to permanently delete the official results for ${data.group}?`)) {
            try {
                await deleteDoc(doc(db, 'published_results', data.docId));
                alert("Result successfully deleted.");
                details.classList.add('hidden');
                loadPublishedExplorer(); 
            } catch (e) {
                console.error("Delete error:", e);
                alert("Failed to delete result.");
            }
        }
    });

    // BIND THE NEW DOWNLOAD BUTTON
    document.getElementById('btn-download-csv').addEventListener('click', () => {
        downloadResultCSV(data);
    });
    
    details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ==========================================
// CSV GENERATOR EXPORT LOGIC
// ==========================================
function downloadResultCSV(data) {
    // 1. Setup the Headers
    const headers = ["Division", "Rank", "Medal", "Track No", "Athlete Name", "District", "Total Optional Marks", "Head Judge (J1) Marks", "Final Olympic Score"];
    
    // 2. Map the data rows (We wrap strings in quotes to prevent commas in names from breaking the CSV)
    const rows = data.standings.map(s => [
        `"${s.division || 'Unassigned'}"`,
        s.rank,
        `"${s.medal !== '-' ? s.medal : ''}"`,
        s.trackNo,
        `"${s.name}"`,
        `"${s.district}"`,
        s.totalOpt || 0,
        s.j1Score || 0,
        s.finalScore
    ]);
    
    // 3. Combine it all into a single string separated by newlines
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
    ].join('\n');
    
    // 4. Generate a clean, descriptive filename with the date
    const dateObj = new Date(data.publishedAt);
    const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
    
    // Remove spaces and special characters from the group name for a safe file name
    const cleanGroup = data.group.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `MYST_Official_Results_${cleanGroup}_${data.gender}_${dateStr}.csv`;
    
    // 5. Create a Blob and trigger the browser download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function wipeAllResults() {
    if (!confirm("⚠️ DANGER: Are you sure you want to delete ALL published results?")) return;
    
    const userInput = prompt("Type 'confirm' to execute mass deletion:");
    if (userInput !== 'confirm') return;

    const btn = document.getElementById('btn-wipe-results');
    btn.innerText = "⏳ Deleting...";

    try {
        const snap = await getDocs(collection(db, 'published_results'));
        const batch = writeBatch(db);
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
        
        alert("✅ All published results deleted.");
        document.getElementById('explorer-details').classList.add('hidden');
        loadPublishedExplorer();
    } catch (error) {
        console.error("Wipe failed:", error);
    } finally {
        btn.innerText = "⚠️ Delete All Results";
    }
}
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
            card.className = "bg-slate-900/60 border border-slate-700/50 p-6 rounded-3xl cursor-pointer hover:bg-slate-800 hover:border-brand-500/50 transition-all shadow-xl hover:shadow-[0_0_20px_rgba(37,99,235,0.15)] active:scale-95 flex flex-col justify-between backdrop-blur-md group";
            card.innerHTML = `
                <div>
                    <div class="flex justify-between items-start mb-4">
                        <span class="text-[10px] font-black text-emerald-400 bg-emerald-950/40 px-3 py-1.5 rounded-lg uppercase tracking-widest border border-emerald-900/50 shadow-inner flex items-center"><span class="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-2 animate-pulse"></span>OFFICIAL</span>
                        <span class="text-xs text-slate-500 font-bold">${dateStr}</span>
                    </div>
                    <div class="font-black text-white text-xl tracking-tighter leading-tight mb-2 group-hover:text-brand-400 transition-colors">${data.group}</div>
                    <div class="flex items-center space-x-2">
                        <span class="text-brand-300 text-xs font-bold uppercase tracking-widest bg-brand-950/40 border border-brand-900/50 px-2 py-1 rounded-md">${data.gender}</span>
                        <span class="text-slate-500 text-xs font-bold uppercase tracking-widest bg-slate-950/40 border border-slate-800 px-2 py-1 rounded-md">${data.district}</span>
                    </div>
                </div>
                <div class="mt-6 text-xs font-bold tracking-widest text-brand-500 uppercase flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-2 group-hover:translate-x-0 duration-300">
                    View ${data.standings.length} athletes <span class="ml-2">→</span>
                </div>
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
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-slate-800 pb-6">
            <div class="mb-6 md:mb-0">
                <h4 class="text-3xl font-black text-white uppercase tracking-tighter mb-2">${data.group}</h4>
                <div class="flex items-center space-x-3">
                    <span class="text-brand-300 text-sm font-bold uppercase tracking-widest bg-brand-950/40 border border-brand-900/50 px-3 py-1.5 rounded-lg">${data.gender}</span>
                    <span class="text-slate-500 text-sm font-bold uppercase tracking-widest bg-slate-950/40 border border-slate-800 px-3 py-1.5 rounded-lg">${data.district}</span>
                </div>
            </div>
            <div class="flex flex-wrap gap-3">
                <button id="btn-download-csv" class="bg-emerald-900/30 hover:bg-emerald-800 text-emerald-400 hover:text-white border border-emerald-800 text-xs font-bold py-3 px-5 rounded-xl shadow-lg transition-colors flex items-center uppercase tracking-widest active:scale-95">
                    <span class="mr-2">⬇️</span> Download CSV
                </button>
                <button id="btn-delete-single-result" class="bg-red-900/30 hover:bg-red-800 text-red-400 hover:text-white border border-red-800 text-xs font-bold py-3 px-5 rounded-xl shadow-lg transition-colors flex items-center uppercase tracking-widest active:scale-95">
                    <span class="mr-2">🗑️</span> Delete Result
                </button>
                <button id="btn-close-details" class="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-600 text-xs font-bold py-3 px-5 rounded-xl shadow-lg transition-colors flex items-center uppercase tracking-widest active:scale-95">
                    <span class="mr-2">✖</span> Close View
                </button>
            </div>
        </div>
        <div class="overflow-x-auto w-full custom-scrollbar">
            <table class="w-full text-left border-collapse text-sm min-w-[800px]">
                <thead class="bg-slate-950/80 border-b border-slate-700 text-slate-400 uppercase text-xs font-bold tracking-widest">
                    <tr><th class="p-5">Div</th><th class="p-5">Rank</th><th class="p-5">Track No</th><th class="p-5">Athlete</th><th class="p-5">Coach</th><th class="p-5">District</th><th class="p-5 text-right">Final Score</th></tr>
                </thead>
                <tbody class="divide-y divide-slate-800">
    `;
    
    data.standings.forEach(s => {
        const isPodium = s.rank <= 3;
        
        html += `<tr class="hover:bg-slate-800/50 transition-colors ${isPodium ? 'bg-slate-900/40 text-slate-200' : 'text-slate-500'}">
            <td class="p-5 font-bold text-amber-500 text-xs uppercase tracking-widest">${s.division || ''}</td>
            <td class="p-5 text-xl tracking-tighter font-black drop-shadow-sm">${isPodium ? s.medal : s.rank}</td>
            <td class="p-5 font-mono text-xs tracking-widest font-bold">${s.trackNo}</td>
            <td class="p-5 font-bold text-base ${isPodium ? 'text-white' : ''}">${s.name}</td>
            <td class="p-5 text-purple-400 text-[10px] uppercase tracking-widest font-bold"><span class="bg-purple-950/40 border border-purple-900/50 px-2 py-0.5 rounded">${s.coachName || 'Independent'}</span></td>
            <td class="p-5 text-sm">${s.district}</td>
            <td class="p-5 text-right font-black text-2xl tracking-tighter drop-shadow-md ${isPodium ? 'text-brand-400' : 'text-slate-500'}">${s.finalScore}</td>
        </tr>`;
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

// ============================================================================
// CSV GENERATOR EXPORT LOGIC (UPDATED WITH COACH NAME)
// ============================================================================
function downloadResultCSV(data) {
    // 1. Setup the Headers (Added "Coach Name" here)
    const headers = ["Division", "Rank", "Medal", "Track No", "Athlete Name", "Coach Name", "District", "Total Optional Marks", "Head Judge (J1) Marks", "Final Olympic Score"];
    
    // 2. Map the data rows (Added s.coachName here)
    const rows = data.standings.map(s => [
        `"${s.division || 'Unassigned'}"`,
        s.rank,
        `"${s.medal !== '-' ? s.medal : ''}"`,
        s.trackNo,
        `"${s.name}"`,
        `"${s.coachName || 'Independent'}"`, // Extracts the coach or defaults to Independent
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
// ============================================================================
// MODULE 9: DISTRICT MEDAL TALLY ENGINE
// Single Document Architecture (No History Log)
// ============================================================================


import { collection, doc, getDocs, setDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js';

export function initDistrictResults() {
    const btnCalc = document.getElementById('btn-calculate-district-medals');
    const btnBroadcast = document.getElementById('btn-broadcast-district');
    const btnViewLive = document.getElementById('btn-view-live-broadcast');
    const btnDownloadCsv = document.getElementById('btn-download-district-csv');

    if (btnCalc) {
        btnCalc.addEventListener('click', async () => {
            btnCalc.innerText = "⏳ Tallying...";
            try {
                const tally = await calculateDistrictTally();
                renderDistrictPreview(tally);
            } catch (error) { console.error("Error calculating tally:", error); } 
            finally { btnCalc.innerText = "🔄 Aggregate Medals"; }
        });
    }

    if (btnBroadcast) btnBroadcast.addEventListener('click', broadcastDistrictTally);
    if (btnViewLive) btnViewLive.addEventListener('click', fetchLiveBroadcastData);

    document.getElementById('btn-delete-tally')?.addEventListener('click', deleteLiveTally);

    if (btnDownloadCsv) btnDownloadCsv.addEventListener('click', downloadDistrictCSV);
}

// 1. THE AGGREGATION ALGORITHM
async function calculateDistrictTally() {
    const resultsSnap = await getDocs(collection(db, 'published_results'));
    const districtStats = {}; 

    resultsSnap.forEach(categoryDoc => {
        const standings = categoryDoc.data().standings || [];
        standings.forEach(athlete => {
            const rank = athlete.rank;
            if (rank === 1 || rank === 2 || rank === 3) {
                const district = athlete.district || "Independent";
                if (!districtStats[district]) {
                    districtStats[district] = { gold: 0, silver: 0, bronze: 0, total: 0 };
                }
                if (rank === 1) districtStats[district].gold++;
                else if (rank === 2) districtStats[district].silver++;
                else if (rank === 3) districtStats[district].bronze++;
                
                districtStats[district].total = districtStats[district].gold + districtStats[district].silver + districtStats[district].bronze;
            }
        });
    });

    return Object.keys(districtStats).map(name => ({
        districtName: name, ...districtStats[name]
    })).sort((a, b) => {
        if (b.gold !== a.gold) return b.gold - a.gold;
        if (b.silver !== a.silver) return b.silver - a.silver;
        return b.bronze - a.bronze;
    });
}

// 2. BROADCAST (SINGLE DOCUMENT ONLY - NO HISTORY SAVED)
async function broadcastDistrictTally() {
    const btn = document.getElementById('btn-broadcast-district');
    btn.innerText = "⏳ Broadcasting...";
    btn.disabled = true;

    try {
        const tally = await calculateDistrictTally();
        const timestamp = new Date().toISOString();
        
        // Updates ONLY the Live Public Big Screen document
        await setDoc(doc(db, 'public_leaderboard', 'district_tally'), {
            updatedAt: timestamp,
            tally: tally,
            title: "OFFICIAL DISTRICT MEDAL TALLY"
        });

        alert("✅ District Tally is LIVE on the big screens!");

    } catch (error) {
        console.error("Broadcast Error:", error);
        alert("Failed to update district standings.");
    } finally {
        btn.innerHTML = "📡 Global Tally Broadcast";
        btn.disabled = false;
    }
}

// 3. UI LOCAL PREVIEW
function renderDistrictPreview(tally) {
    const container = document.getElementById('district-tally-preview');
    if (!container) return;

    if (tally.length === 0) {
        container.innerHTML = `<p class="text-sm text-gray-500 italic p-4 text-center">No results published yet.</p>`;
        return;
    }

    container.innerHTML = `<table class="w-full text-left border-collapse text-sm"><thead class="bg-gray-900 text-gray-400 uppercase text-xs"><tr><th class="p-3">District</th><th class="p-3 text-center text-yellow-500">🥇</th><th class="p-3 text-center text-gray-300">🥈</th><th class="p-3 text-center text-orange-400">🥉</th><th class="p-3 text-center text-blue-400">Total</th></tr></thead><tbody class="divide-y divide-gray-800">` + 
        tally.map(d => `<tr class="hover:bg-gray-800"><td class="p-3 font-bold text-white">${d.districtName}</td><td class="p-3 text-center font-black text-yellow-500">${d.gold}</td><td class="p-3 text-center font-bold text-gray-300">${d.silver}</td><td class="p-3 text-center font-bold text-orange-400">${d.bronze}</td><td class="p-3 text-center font-bold text-blue-400">${d.total}</td></tr>`).join('') + `</tbody></table>`;
}

// 4. LIVE BROADCAST VIEWER (Reads directly from the single document)
async function fetchLiveBroadcastData() {
    const btn = document.getElementById('btn-view-live-broadcast');
    const container = document.getElementById('live-broadcast-container');
    const timeDisplay = document.getElementById('live-broadcast-time');
    const tableContainer = document.getElementById('live-broadcast-table');

    btn.innerText = "⏳ Fetching...";
    
    try {
        const docRef = doc(db, 'public_leaderboard', 'district_tally');
        const docSnap = await getDoc(docRef);

        container.classList.remove('hidden');

        if (!docSnap.exists()) {
            timeDisplay.innerText = "Status: Nothing has been broadcasted yet.";
            tableContainer.innerHTML = '';
            return;
        }

        const data = docSnap.data();
        const dateObj = new Date(data.updatedAt);
        timeDisplay.innerText = `Last updated on screens: ${dateObj.toLocaleTimeString()} (${dateObj.toLocaleDateString()})`;

        let html = `
            <table class="w-full text-left border-collapse text-sm">
                <thead class="bg-gray-900 text-gray-400 uppercase text-xs">
                    <tr>
                        <th class="p-3">Rank</th>
                        <th class="p-3">District</th>
                        <th class="p-3 text-center text-yellow-500">🥇 Gold</th>
                        <th class="p-3 text-center text-gray-300">🥈 Silver</th>
                        <th class="p-3 text-center text-orange-400">🥉 Bronze</th>
                        <th class="p-3 text-center text-blue-400">Total</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-800">
        `;
        
        data.tally.forEach((d, index) => {
            html += `
                <tr class="hover:bg-gray-800">
                    <td class="p-3 font-bold text-gray-500">#${index + 1}</td>
                    <td class="p-3 font-bold text-white">${d.districtName}</td>
                    <td class="p-3 text-center font-black text-yellow-500">${d.gold}</td>
                    <td class="p-3 text-center font-bold text-gray-300">${d.silver}</td>
                    <td class="p-3 text-center font-bold text-orange-400">${d.bronze}</td>
                    <td class="p-3 text-center font-bold text-blue-400">${d.total}</td>
                </tr>
            `;
        });
        
        html += `</tbody></table>`;
        tableContainer.innerHTML = html;

    } catch (error) {
        console.error("Fetch Error:", error);
        timeDisplay.innerText = "Error: Could not fetch data.";
    } finally {
        btn.innerHTML = "👁️ Refresh Live Data";
    }
}

// WIPE LIVE TALLY
async function deleteLiveTally() {
    if (!confirm("Are you sure you want to take down the Live District Tally from the big screens?")) return;

    const btn = document.getElementById('btn-delete-tally');
    btn.innerText = "⏳ Deleting...";

    try {
        await deleteDoc(doc(db, 'public_leaderboard', 'district_tally'));
        alert("✅ District Tally removed from live screens.");
        
        // Hide local UI
        document.getElementById('live-broadcast-container').classList.add('hidden');
    } catch (error) {
        console.error("Delete Error:", error);
        alert("Failed to delete tally.");
    } finally {
        btn.innerHTML = "🗑️ Delete Live Tally";
    }
}

// ==========================================
// CSV GENERATOR EXPORT LOGIC (DISTRICT TALLY)
// ==========================================
async function downloadDistrictCSV() {
    const btn = document.getElementById('btn-download-district-csv');
    btn.innerText = "⏳ Generating...";
    btn.disabled = true;

    try {
        // Always fetch the freshest calculation directly from the database
        const tally = await calculateDistrictTally();
        
        if (tally.length === 0) {
            alert("No district results available to download yet.");
            return;
        }

        // 1. Setup the Headers
        const headers = ["Rank", "District", "Gold Medals", "Silver Medals", "Bronze Medals", "Total Medals"];
        
        // 2. Map the data rows (Wraps district names in quotes to protect against commas)
        const rows = tally.map((d, index) => [
            index + 1,
            `"${d.districtName}"`,
            d.gold,
            d.silver,
            d.bronze,
            d.total
        ]);
        
        // 3. Combine it all into a single string separated by newlines
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');
        
        // 4. Generate a clean, descriptive filename with the current date
        const dateObj = new Date();
        const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        const filename = `MYST_District_Medal_Tally_${dateStr}.csv`;
        
        // 5. Create a Blob and trigger the browser download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (error) {
        console.error("CSV Download Error:", error);
        alert("Failed to generate District Tally CSV.");
    } finally {
        btn.innerText = "⬇️ Download Tally CSV";
        btn.disabled = false;
    }
}
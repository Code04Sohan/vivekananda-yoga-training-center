// ============================================================================
// MODULE 2: DATA IMPORTER (CSV INJECTOR)
// Single Database Architecture with Batch Chunking (1,000+ Capacity)
// ============================================================================

import { collection, writeBatch, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from './firebase-config.js'; // Look at how clean this is now! Just 'db'

export function initCSVImporter() {
    const form = document.getElementById('csv-upload-form');
    const fileInput = document.getElementById('csv-file-input');
    const statusConsole = document.getElementById('upload-status-console');

    if(!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const file = fileInput.files[0];
        if (!file) return;

        logMsg(statusConsole, "⏳ Parsing CSV file locally...");

        // PapaParse handles the file reading in the browser
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async function(results) {
                const data = results.data;
                logMsg(statusConsole, `✅ Parsed ${data.length} rows. Preparing safe batches...`);
                await processAndInject(data, statusConsole);
            },
            error: function(err) {
                logMsg(statusConsole, `❌ Parsing Error: ${err.message}`);
            }
        });
    });
}

async function processAndInject(candidates, consoleEl) {
    try {
        const candidatesRef = collection(db, 'candidates');
        let totalAdded = 0;
        let skippedRows = 0;
        const CHUNK_SIZE = 400; 
        
        for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
            const chunk = candidates.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db); 
            
            chunk.forEach(row => {
                // 1. Fetch Track No directly from CSV (Checks for 'Track No', 'TRACK NO', or falls back to 'Reg. No')
                const rawTrack = row['Track No'] || row['TRACK NO'] || row['Reg. No'] || row['REG NO'];
                
                // 2. Safety check: If row is completely empty, skip it
                if (!rawTrack) {
                    skippedRows++;
                    return; 
                }

                const trackNoStr = String(rawTrack).trim(); 
                const docRef = doc(candidatesRef, trackNoStr);
                
                // 3. Cleaned Candidate Profile (Removed 'type' line)
                const candidateProfile = {
                    trackNo: trackNoStr,
                    regNo: row['Reg. No'] || row['REG NO'] || trackNoStr,
                    name: row['Name'] || row['NAME'] || 'Unknown',
                    gender: row['M/F'] || row['GENDER'] || '',
                    groupName: row['AGE GROUP'] || row['GROUP'] || 'Unassigned',
                    coachName: row['COACH NAME'] || row['COACH'] || 'Independent',
                    district: row['DISTRICT'] || row['NAME OF DISTRICT'] || '',
                    division: row['DIVISION'] || 'Unassigned', 
                    status: 'pending', 
                    j1_status: false,
                    j2_status: false,
                    j3_status: false,
                    j4_status: false,
                    j5_status: false,
                    createdAt: new Date().toISOString()
                };

                batch.set(docRef, candidateProfile);
                totalAdded++;
            });

            logMsg(consoleEl, `⏳ Pushing chunk ${Math.ceil((i + 1) / CHUNK_SIZE)} to MYST Database...`);
            await batch.commit(); 
        }
        
        logMsg(consoleEl, `🏆 SUCCESS: ${totalAdded} Candidates imported successfully!`);
        if (skippedRows > 0) {
            logMsg(consoleEl, `⚠️ Note: Skipped ${skippedRows} empty rows in the CSV.`);
        }
        
        document.getElementById('csv-upload-form').reset();

    } catch (error) {
        console.error("Injection failed:", error);
        logMsg(consoleEl, `❌ Database Error: ${error.message}`);
    }
}

// UI Helper Function
function logMsg(element, msg) {
    const time = new Date().toLocaleTimeString();
    element.innerText += `\n[${time}] ${msg}`;
    element.scrollTop = element.scrollHeight; // Auto-scroll
}
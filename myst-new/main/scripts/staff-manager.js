// ============================================================================
// MODULE 2: STAFF PROVISIONING & SYSTEM TOGGLES
// Simple Single-Collection Architecture (Manual Entry)
// ============================================================================

import { collection, doc, onSnapshot, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js"; 
import { db } from './firebase-config.js'; 

let allUsers = [];
let editingUid = null; 

// ==========================================
// 1. GLOBAL SCORING PORTAL TOGGLE
// ==========================================
export function initSystemToggles() {
    const portalToggle = document.getElementById('scoring-portal-toggle');
    if (!portalToggle) return;

    const stateRef = doc(db, 'system_state', 'portal');
    
    onSnapshot(stateRef, (docSnap) => {
        if (docSnap.exists()) {
            const isOpen = docSnap.data().isScoringOpen;
            portalToggle.value = isOpen ? "OPEN" : "CLOSED";
            portalToggle.className = isOpen 
                ? "bg-gray-900 text-green-500 text-sm font-bold border border-green-700 rounded px-3 py-1"
                : "bg-gray-900 text-red-500 text-sm font-bold border border-red-700 rounded px-3 py-1";
        }
    });

    portalToggle.addEventListener('change', async (e) => {
        const isNowOpen = e.target.value === "OPEN";
        try {
            await setDoc(stateRef, { isScoringOpen: isNowOpen }, { merge: true });
        } catch (error) {
            console.error("Failed to update portal state:", error);
            alert("Error updating system state.");
        }
    });
}

// ==========================================
// 2. STAFF PROVISIONING MANAGER
// ==========================================
export function initStaffManager() {
    onSnapshot(collection(db, 'users'), (snapshot) => {
        allUsers = [];
        snapshot.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));
        renderStaffUI();
    });
}

function renderStaffUI() {
    const tbody = document.getElementById('active-staff-tbody');
    if (!tbody) return;

    const auth = getAuth();
    const currentUserId = auth.currentUser ? auth.currentUser.uid : null;
    tbody.innerHTML = '';

    if (allUsers.length === 0) {
        tbody.innerHTML = '<tr><td class="p-4 text-sm text-gray-500 text-center italic" colspan="3">No staff members found in database.</td></tr>';
        return;
    }

    allUsers.forEach((user) => {
        const uid = user.id;
        const isSelf = uid === currentUserId;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-800 transition-colors";
        
        // --- EDIT MODE UI ---
        if (editingUid === uid) {
            tr.innerHTML = `
                <td class="p-3">
                    <input type="text" id="edit-name-${uid}" value="${user.name || ''}" class="text-sm bg-gray-900 border border-blue-500 rounded px-2 py-1 text-white w-full mb-1" placeholder="Name">
                    <input type="email" id="edit-email-${uid}" value="${user.email || ''}" class="text-sm bg-gray-900 border border-blue-500 rounded px-2 py-1 text-white w-full" placeholder="Email">
                </td>
                <td class="p-3 align-top">
                    <select id="edit-role-${uid}" class="text-sm bg-gray-900 border border-blue-500 rounded px-2 py-1 text-white w-full">
                        <option value="JUDGE" ${user.role === 'JUDGE' ? 'selected' : ''}>Judge</option>
                        <option value="STAGE_MGR" ${user.role === 'STAGE_MGR' ? 'selected' : ''}>STAGE_MGR</option>
                        <option value="ADMIN" ${user.role === 'ADMIN' ? 'selected' : ''}>Admin</option>
                    </select>
                </td>
                <td class="p-3 text-right align-top space-x-2">
                    <button class="bg-green-600 hover:bg-green-500 text-white text-[10px] uppercase px-3 py-1.5 rounded font-bold shadow" onclick="saveStaffEdit('${uid}')">Save</button>
                    <button class="bg-gray-600 hover:bg-gray-500 text-white text-[10px] uppercase px-3 py-1.5 rounded font-bold shadow" onclick="cancelStaffEdit()">Cancel</button>
                </td>
            `;
        } 
        // --- DISPLAY MODE UI ---
        else {
            const statusColor = user.active !== false ? "text-green-500" : "text-red-500";
            const statusText = user.active !== false ? "ACTIVE" : "BLOCKED";
            const toggleAction = user.active !== false ? "Disable" : "Enable";
            
            let roleBadge = '';
            if (user.role === 'ADMIN') roleBadge = '<span class="ml-2 px-2 py-0.5 bg-blue-900/50 text-blue-300 text-[10px] rounded border border-blue-700">ADMIN</span>';
            else if (user.role === 'STAGE_MGR') roleBadge = '<span class="ml-2 px-2 py-0.5 bg-purple-900/50 text-purple-300 text-[10px] rounded border border-purple-700">STAGE CO</span>';
            else roleBadge = '<span class="ml-2 px-2 py-0.5 bg-green-900/50 text-green-300 text-[10px] rounded border border-green-700">JUDGE</span>';

            if (isSelf) roleBadge += ' <span class="ml-1 px-2 py-0.5 bg-gray-700 text-white text-[10px] rounded border border-gray-500 font-black">YOU</span>';

            const editBtn = isSelf 
                ? `<button class="text-[10px] border px-2 py-1 rounded bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed" disabled>Edit</button>`
                : `<button class="text-[10px] border px-2 py-1 rounded transition-colors bg-gray-800 hover:bg-gray-700 border-gray-600 text-white shadow" onclick="enableStaffEdit('${uid}')">Edit</button>`;

            const toggleBtn = isSelf
                ? `<button class="text-[10px] border px-2 py-1 rounded bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed" disabled>${toggleAction}</button>`
                : `<button class="text-[10px] border px-2 py-1 rounded transition-colors shadow ${user.active !== false ? "bg-orange-900/40 hover:bg-orange-800 text-orange-300 border-orange-700" : "bg-green-900/40 hover:bg-green-800 text-green-300 border-green-700"}" onclick="toggleKillSwitch('${uid}', ${user.active === false})">${toggleAction}</button>`;

            tr.innerHTML = `
                <td class="p-3">
                    <div class="font-bold text-white flex items-center">${user.name || 'No Name Set'} ${roleBadge}</div>
                    <div class="text-xs text-gray-400 mt-1 font-mono">${user.email || 'No Email Set'}</div>
                </td>
                <td class="p-3 text-xs text-gray-500 font-mono align-middle">${uid}</td>
                <td class="p-3 text-right align-middle">
                    <div class="flex items-center justify-end space-x-2">
                        <span class="text-[10px] font-black tracking-widest ${statusColor} mr-2">${statusText}</span>
                        ${editBtn}
                        ${toggleBtn}
                    </div>
                </td>
            `;
        }
        tbody.appendChild(tr);
    });
}

// ==========================================
// 3. WINDOW EXPORTS (For HTML onClick binding)
// ==========================================

window.addNewStaff = async () => {
    const uid = document.getElementById('new-staff-uid').value.trim();
    const name = document.getElementById('new-staff-name').value.trim();
    const email = document.getElementById('new-staff-email').value.trim();
    const role = document.getElementById('new-staff-role').value;

    if (!uid || !name || !email) return alert("Please fill in the UID, Name, and Email.");

    const btn = document.querySelector('button[onclick="addNewStaff()"]');
    btn.innerText = "⏳ Adding...";
    
    try {
        await setDoc(doc(db, 'users', uid), { 
            name: name, 
            email: email,
            role: role, 
            active: true,
            createdAt: new Date().toISOString()
        });

        // Clear the form
        document.getElementById('new-staff-uid').value = '';
        document.getElementById('new-staff-name').value = '';
        document.getElementById('new-staff-email').value = '';
    } catch (error) { 
        console.error("Error adding staff:", error); 
        alert("Failed to add staff to database.");
    } finally {
        btn.innerText = "Link Account";
    }
};

window.enableStaffEdit = (uid) => {
    editingUid = uid;
    renderStaffUI();
};

window.cancelStaffEdit = () => {
    editingUid = null;
    renderStaffUI();
};

window.saveStaffEdit = async (uid) => {
    const newName = document.getElementById(`edit-name-${uid}`).value.trim();
    const newEmail = document.getElementById(`edit-email-${uid}`).value.trim();
    const newRole = document.getElementById(`edit-role-${uid}`).value;
    
    if (!newName) return alert("Name cannot be empty.");

    try {
        await updateDoc(doc(db, 'users', uid), { name: newName, email: newEmail, role: newRole });
        editingUid = null; 
    } catch (error) { console.error("Error updating staff:", error); }
};

window.toggleKillSwitch = async (uid, newState) => {
    try { await updateDoc(doc(db, 'users', uid), { active: newState }); } 
    catch (error) { console.error("Error toggling kill switch:", error); }
};
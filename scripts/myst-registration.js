// =========================================================
// 1. CONFIGURATION
// =========================================================

const CONFIG = {
    // 🔴 PASTE YOUR WEB APP URL HERE
    scriptUrl: "https://script.google.com/macros/s/AKfycbx6BzD6Amm0CWEkeIz-2mjRTZqDTTWTsjzOU3mG6fn9NpF9D7xM_ccPoRyDSfbR2Iv3/exec",
    
    // 🔴 BACKGROUND IMAGE AND LOGO
    backgroundImage: "resources/babla_bg.jpeg",
    logoImage: "resources/babla_dp.jpeg",

    // 🟢 REGISTRATION MODE TOGGLE
    registrationOpen: true, // Set to false to instantly close the form
    autoCalculateAge: false, // Set to 'true' to auto-calculate DOB -> Age -> Group
    competitionDate: "2026-05-17", // YYYY-MM-DD format for precise calculation

    // 🟢 DETAILED AGE GROUPS
    ageGroups: [
        { min: 0, max: 6, name: "GROUP-A (0-6)" },
        { min: 7, max: 9, name: "GROUP-B (6+ 9)" },
        { min: 10, max: 13, name: "GROUP-C (10+ 13)" },
        { min: 14, max: 20, name: "GROUP-D (14+ 20)" },
        { min: 21, max: 30, name: "GROUP-E (21+ 30)" },
        { min: 31, max: 40, name: "GROUP-F (31+ 40)" },
        { min: 41, max: 50, name: "GROUP-G (41+ 50)" },
        { min: 51, max: 150, name: "GROUP-H (50 Above)" }
    ],

    // 🟢 Coach Database
    coachDatabase: [
        "MRINAL YOGA CENTRE", 
        "BABLA YOGA TRAINING CENTRE", 
        "SHIVAM YOGA CENTRE",
        "POWER YOGA ACADEMY", 
        "BINGSHA SATABDI YOGA ACADEMY", 
        "DOOARS YOGA ACADEMY", 
        "VIVEKANANDA SPORTING & CULTURAL CLUB", 
        "UTTAR BANGA BHOTBARI SIMA YOGA ACADEMY",
        "RUBIA YOGA ACADEMY", 
        "PAKHRIN YOGA INSTITUTE", 
        "TARAI DOOARS YOGA ACADEMY", 
        "NIPA YOGA & GYMNASTICS TRAINING CENTRE", 
        "SADHANA YOGA CENTRE",
        "SAMIR YOGA TRAINING CENTRE", 
        "CENTRAL DOOARS YOGA INSTITUTE",
        "GATEWAY OF EDUCATION AND HEALTH (YOGA INSTITUTE)"
    ]
};

// =========================================================
// 2. INITIALIZATION & LOGIC
// =========================================================

// Set Background Image and make it responsive for all displays (Mobile & Desktop)
document.body.style.backgroundImage = `url('${CONFIG.backgroundImage}')`;
document.body.style.backgroundSize = "cover";
document.body.style.backgroundPosition = "center center";
document.body.style.backgroundRepeat = "no-repeat";
document.body.style.backgroundAttachment = "fixed"; // Keeps background still while scrolling

document.getElementById('orgLogo').src = CONFIG.logoImage;

const form = document.getElementById('yogaForm');
const formView = document.getElementById('formView');
const successView = document.getElementById('successView');
const autoAgeWrapper = document.getElementById('autoAgeWrapper');
const dobField = document.getElementById('dobField');
const ageField = document.getElementById('ageField');
const groupField = document.getElementById('groupField');
const errorMsg = document.getElementById('errorMsg');
const submitBtn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const btnLoader = document.getElementById('btnLoader');
const slDisplay = document.getElementById('slDisplay');

// Initialize Dropdown and UI based on Config
window.addEventListener('DOMContentLoaded', () => {
    
    // --- 🛑 REGISTRATION CLOSED LOGIC ---
    if (!CONFIG.registrationOpen) {
        formView.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <div style="font-size: 4rem; margin-bottom: 20px;">🚫</div>
                <h2 style="color: #d9534f; font-size: 2rem; margin-bottom: 15px; font-weight: bold;">
                    REGISTRATION CLOSED
                </h2>
                <p style="font-size: 1.1rem; color: #555; line-height: 1.6;">
                    The registration period has ended.<br>
                    We are no longer accepting new entries.
                </p>
                <div style="margin-top: 30px; font-weight: 600; color: #333;">
                    — Thank You —
                </div>
            </div>
        `;
        return; // Stop loading the rest of the form
    }

    // Populate Group Dropdown
    CONFIG.ageGroups.forEach(g => {
        let opt = document.createElement('option');
        opt.value = g.name;
        opt.innerText = g.name;
        groupField.appendChild(opt);
    });

    // Handle Auto vs Manual Mode UI
    if (CONFIG.autoCalculateAge) {
        autoAgeWrapper.style.display = "flex";
        dobField.required = true;
        groupField.style.pointerEvents = "none"; // Lock the dropdown from manual clicks
        groupField.style.background = "#f0f4f8";
    } else {
        autoAgeWrapper.style.display = "none";
        dobField.required = false;
        groupField.style.pointerEvents = "auto";
        groupField.style.background = "#fff";
    }
});

// Age Calculation (Only runs if Auto Mode is ON)
dobField.addEventListener('change', function () {
    if (!CONFIG.autoCalculateAge || !this.value) return;
    
    errorMsg.style.display = 'none';
    const dobDate = new Date(this.value);
    const compDate = new Date(CONFIG.competitionDate);

    // Calculate age precisely up to the competition date
    let age = compDate.getFullYear() - dobDate.getFullYear();
    const m = compDate.getMonth() - dobDate.getMonth();
    
    if (m < 0 || (m === 0 && compDate.getDate() < dobDate.getDate())) {
        age--;
    }

    if (age < 0) {
        alert("Invalid Date of Birth for the competition date.");
        this.value = "";
        ageField.value = "";
        groupField.value = "";
        return;
    }

    ageField.value = age;

    let groupName = "";
    CONFIG.ageGroups.forEach(g => {
        if (age >= g.min && age <= g.max) {
            groupName = g.name;
        }
    });

    if (groupName) {
        groupField.value = groupName;
    } else {
        groupField.value = "";
        errorMsg.textContent = "⚠ Age does not fit into any available group.";
        errorMsg.style.display = 'block';
    }
});

// Submission Logic
form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorMsg.style.display = 'none';

    if (!groupField.value) {
        errorMsg.textContent = "⚠ Please ensure an Age Group is selected.";
        errorMsg.style.display = 'block';
        return;
    }

    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = 'block';

    const formData = new FormData(form);
    const data = {};
    formData.forEach((value, key) => data[key] = value);

    fetch(CONFIG.scriptUrl, {
        method: 'POST',
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(result => {
        if (result.result === 'success') {
            const athleteName = document.querySelector('input[name="name"]').value;
            // Update the label text to SL NO
            document.getElementById('resultLabel').textContent = athleteName.toUpperCase() + " - SL NO";
            lastCoachVal = coachField.value;
            lastCoachNameSpan.textContent = lastCoachVal;
            btnSameCoach.style.display = "block";
            formView.style.display = 'none';
            successView.style.display = 'block';
            // Fetch the slNo variable from the backend
            slDisplay.textContent = result.slNo; 
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            throw new Error(result.error);
        }
    })
    .catch(err => {
        errorMsg.textContent = "⚠ Error: " + err.message;
        errorMsg.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    })
    .finally(() => {
        submitBtn.disabled = false;
        btnText.style.display = 'block';
        btnLoader.style.display = 'none';
    });
});

window.resetForm = function () {
    form.reset();
    ageField.value = "";
    groupField.value = "";
    formView.style.display = 'block';
    successView.style.display = 'none';
};


// =========================================================
// 3. SMART SEARCH DROPDOWN LOGIC
// =========================================================

const coachField = document.getElementById('coachField');
const suggestionsBox = document.getElementById('suggestions');
const btnSameCoach = document.getElementById('btnSameCoach');
const lastCoachNameSpan = document.getElementById('lastCoachName');

let lastCoachVal = "";
const coachNames = CONFIG.coachDatabase;

function renderSuggestions(filterText = "") {
    suggestionsBox.innerHTML = ""; 
    const lowerFilter = filterText.toLowerCase();

    const matches = coachNames.filter(name =>
        name.toLowerCase().includes(lowerFilter)
    );

    if (matches.length === 0) {
        suggestionsBox.style.display = "none";
        return;
    }

    matches.forEach(name => {
        const div = document.createElement('div');
        div.className = "suggestion-item";
        div.textContent = name;

        div.onclick = function () {
            selectCoach(name);
        };
        suggestionsBox.appendChild(div);
    });

    suggestionsBox.style.display = "block";
}

function selectCoach(name) {
    coachField.value = name;
    suggestionsBox.style.display = "none"; 
    errorMsg.style.display = 'none';
}

coachField.addEventListener('focus', function () {
    renderSuggestions(""); 
});

coachField.addEventListener('input', function () {
    renderSuggestions(this.value);
});

document.addEventListener('click', function (e) {
    if (!coachField.contains(e.target) && !suggestionsBox.contains(e.target)) {
        suggestionsBox.style.display = "none";
    }
});

// --- BUTTON: APPLY NEXT AS SAME COACH ---
window.applySameCoach = function () {
    resetForm();
    coachField.value = lastCoachVal;
    window.scrollTo({ top: 0, behavior: 'smooth' });
};
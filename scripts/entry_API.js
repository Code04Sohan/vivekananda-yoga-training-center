// =========================================================
// 1. CONFIGURATION
// =========================================================

const CONFIG = {
    // 🔴 PASTE YOUR WEB APP URL HERE
    scriptUrl: "https://script.google.com/macros/s/AKfycbx6BzD6Amm0CWEkeIz-2mjRTZqDTTWTsjzOU3mG6fn9NpF9D7xM_ccPoRyDSfbR2Iv3/exec",
    // 🔴 BACKGROUND IMAGE AND LOGO
    backgroundImage: "resources/MYST_bg.png",
    logoImage: "resources/MYST_dp.jpeg",

    // 🟢 DETAILED AGE GROUPS
    ageGroups: [
        { min: 0, max: 7, name: "Group A (Up to 7 years old)" },
        { min: 8, max: 10, name: "Group B (8 to 10 years old)" },
        { min: 11, max: 15, name: "Group C (11 to 15 years old)" },
        { min: 16, max: 30, name: "Group D (16 to 30 years old)" },
        { min: 31, max: 150, name: "Group E (Above 30 years old)" }
    ],

    // 🟢 Coach Database
    coachDatabase: [
        "SOUMEN SANTRA",
        "Nikhil Ghorai",
        "Manasi Rani Mandal Jana",
        "Sabita paul",
        "Indrajit Das",
        "Santa Jana",
        "Sukumar Samanta",
        "Ruma Chakraborty Chattopadhyay"
        // Add more lines here...
    ]
};

// =========================================================
// 2. LOGIC
// =========================================================

document.body.style.backgroundImage = `url('${CONFIG.backgroundImage}')`;
document.getElementById('orgLogo').src = CONFIG.logoImage;


const form = document.getElementById('yogaForm');
const formView = document.getElementById('formView');
const successView = document.getElementById('successView');
const dobField = document.getElementById('dobField');
const ageField = document.getElementById('ageField');
const groupField = document.getElementById('groupField');
const errorMsg = document.getElementById('errorMsg');
const submitBtn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const btnLoader = document.getElementById('btnLoader');
const slDisplay = document.getElementById('slDisplay');


// Age Calculation & Group Matching
dobField.addEventListener('change', function () {
    errorMsg.style.display = 'none';
    const dobDate = new Date(this.value);
    const today = new Date();
    if (!this.value) return;

    // --- 🟢 NEW AGE CALCULATION LOGIC (MONTH BASED) ---
    // 1. Initial year difference
    let age = today.getFullYear() - dobDate.getFullYear();

    // 2. Compare months (Ignore days)
    const currentMonth = today.getMonth(); // 0-11
    const birthMonth = dobDate.getMonth();

    // If current month is before birth month, subtract 1 year
    if (currentMonth < birthMonth) {
        age--;
    }
    // --- 🟢 END NEW LOGIC ---

    // Prevent negative age if they select a future year
    if (age < 0) {
        alert("Invalid Date");
        this.value = "";
        return;
    }

    ageField.value = age;

    let groupName = "No Group Found";
    let found = false;

    // Loop through detailed configuration
    CONFIG.ageGroups.forEach(g => {
        if (age >= g.min && age <= g.max) {
            groupName = g.name;
            found = true;
        }
    });

    groupField.value = groupName;
    groupField.style.color = found ? "#333" : "var(--error)";
});

// Submission Logic
form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorMsg.style.display = 'none';

    if (groupField.value.includes("No Group") || groupField.value === "") {
        errorMsg.textContent = "⚠ Cannot submit: Age not in any group.";
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
                document.getElementById('resultLabel').textContent = athleteName.toUpperCase() + " - TRACK NO";
                lastCoachVal = coachField.value;
                lastCoachNameSpan.textContent = lastCoachVal;
                btnSameCoach.style.display = "block";
                formView.style.display = 'none';
                successView.style.display = 'block';
                slDisplay.textContent = result.trackNo;
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
    groupField.value = ""
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

// Store variables
let lastCoachVal = "";
// Convert DB to array for easier searching: ["Rajib Das", "Sampa Roy"...]
const coachNames = CONFIG.coachDatabase;

// Function to render the list
function renderSuggestions(filterText = "") {
    suggestionsBox.innerHTML = ""; // Clear current list
    const lowerFilter = filterText.toLowerCase();

    // Filter logic (Case-insensitive)
    const matches = coachNames.filter(name =>
        name.toLowerCase().includes(lowerFilter)
    );

    if (matches.length === 0) {
        suggestionsBox.style.display = "none";
        return;
    }

    // Create list items
    matches.forEach(name => {
        const div = document.createElement('div');
        div.className = "suggestion-item";
        div.textContent = name;

        // Click event for selection
        div.onclick = function () {
            selectCoach(name);
        };
        suggestionsBox.appendChild(div);
    });

    suggestionsBox.style.display = "block";
}

// Function when user selects a name
// Function when user selects a name
function selectCoach(name) {
    coachField.value = name;
    suggestionsBox.style.display = "none"; // Hide list
    errorMsg.style.display = 'none';
}

// Event 1: When user clicks/taps the field -> Show ALL names
coachField.addEventListener('focus', function () {
    renderSuggestions(""); // Empty filter = Show all
});

// Event 2: When user types -> Filter the list
coachField.addEventListener('input', function () {
    renderSuggestions(this.value);
});

// Event 3: Hide list if clicking outside
document.addEventListener('click', function (e) {
    if (!coachField.contains(e.target) && !suggestionsBox.contains(e.target)) {
        suggestionsBox.style.display = "none";
    }
});

// --- BUTTON: APPLY NEXT AS SAME COACH ---
window.applySameCoach = function () {
    resetForm();

    // Restore values
    coachField.value = lastCoachVal;
    centerField.style.borderColor = "var(--success)";

    window.scrollTo({ top: 0, behavior: 'smooth' });
};



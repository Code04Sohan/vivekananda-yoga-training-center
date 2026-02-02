// =========================================================
// 1. CONFIGURATION
// =========================================================

const CONFIG = {
    // 🔴 PASTE YOUR WEB APP URL HERE
    scriptUrl: "https://script.google.com/macros/s/AKfycbwVOSKuYX6bUkN_ikRU43z7peYNMPn2mTq-rkrYaw-KSw-Twf7CXowitnMl5lvhGCuI/exec",
    // 🔴 BACKGROUND IMAGE AND LOGO
    backgroundImage: "resources/yoga_background.png",
    logoImage: "resources/yoga_dp.jpeg",

    // 🟢 DETAILED AGE GROUPS
    ageGroups: [
        // 1. Euro Kids (Below 7) -> Code: EK
        { min: 0, max: 5, name: "Euro Kids (Upto 5 Years)", code: "EK" },
        { min: 6, max: 7, name: "Euro Kids (6-7 Years)", code: "EK" },

        // 2. Sub Junior (8-13) -> Code: SJ
        { min: 8, max: 9, name: "Sub Junior (8-9 Years)", code: "SJ" },
        { min: 10, max: 11, name: "Sub Junior (10-11 Years)", code: "SJ" },
        { min: 12, max: 13, name: "Sub Junior (12-13 Years)", code: "SJ" },

        // 3. Junior (14-20) -> Code: JR
        { min: 14, max: 15, name: "Junior (14-15 Years)", code: "JR" },
        { min: 16, max: 17, name: "Junior (16-17 Years)", code: "JR" },
        { min: 18, max: 20, name: "Junior (18-20 Years)", code: "JR" },

        // 4. Senior (21-40) -> Code: SN
        { min: 21, max: 22, name: "Senior (21-22 Years)", code: "SN" },
        { min: 23, max: 24, name: "Senior (23-24 Years)", code: "SN" },
        { min: 25, max: 26, name: "Senior (25-26 Years)", code: "SN" },
        { min: 27, max: 28, name: "Senior (27-28 Years)", code: "SN" },
        { min: 29, max: 30, name: "Senior (29-30 Years)", code: "SN" },
        { min: 31, max: 32, name: "Senior (31-32 Years)", code: "SN" },
        { min: 33, max: 34, name: "Senior (33-34 Years)", code: "SN" },
        { min: 35, max: 36, name: "Senior (35-36 Years)", code: "SN" },
        { min: 37, max: 38, name: "Senior (37-38 Years)", code: "SN" },
        { min: 39, max: 40, name: "Senior (39-40 Years)", code: "SN" },

        // 5. Masters (41-60) -> Code: MS
        { min: 41, max: 42, name: "Masters (41-42 Years)", code: "MS" },
        { min: 43, max: 44, name: "Masters (43-44 Years)", code: "MS" },
        { min: 45, max: 46, name: "Masters (45-46 Years)", code: "MS" },
        { min: 47, max: 48, name: "Masters (47-48 Years)", code: "MS" },
        { min: 49, max: 50, name: "Masters (49-50 Years)", code: "MS" },
        { min: 51, max: 52, name: "Masters (51-52 Years)", code: "MS" },
        { min: 53, max: 54, name: "Masters (53-54 Years)", code: "MS" },
        { min: 55, max: 56, name: "Masters (55-56 Years)", code: "MS" },
        { min: 57, max: 58, name: "Masters (57-58 Years)", code: "MS" },
        { min: 59, max: 60, name: "Masters (59-60 Years)", code: "MS" },

        // 6. Veterans (61+) -> Code: VT
        { min: 61, max: 62, name: "Veterans (61-62 Years)", code: "VT" },
        { min: 63, max: 64, name: "Veterans (63-64 Years)", code: "VT" },
        { min: 65, max: 66, name: "Veterans (65-66 Years)", code: "VT" },
        { min: 67, max: 68, name: "Veterans (67-68 Years)", code: "VT" },
        { min: 69, max: 70, name: "Veterans (69-70 Years)", code: "VT" },
        { min: 71, max: 74, name: "Veterans (71-74 Years)", code: "VT" },
        { min: 75, max: 80, name: "Veterans (75-80 Years)", code: "VT" },
        { min: 81, max: 150, name: "Veterans (Above 81 Years)", code: "VT" }
    ],

    // 🟢 Coach Database
    coachDatabase: {
        "SOUMEN SANTRA" : "VIVEKANANDA YOGA TRAINING CENTER",
        "Nikhil Ghorai" : "Kshudiram Yogabyayam Prashikshan Kendra",
        "Manasi Rani Mandal Jana " : "Nabankur Yoga Academy",
        "Sabita paul" : "Joy Guru Yoga Training Center",
        "Indrajit Das" : "Indra Yoga Centre",
        "Santa Jana" : "Pranaba Nanda Yoga Siksha Kendra",
        "Sukumar Samanta" : "SadhanaYog Swasthya Mandir",
        "Ruma Chakraborty Chattopadhyay" : "YOGANGAN"
        // Add more lines here: "Coach Name": "Center Name",
    }
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

let currentGroupCode = "";

// Age Calculation & Group Matching
dobField.addEventListener('change', function () {
    errorMsg.style.display = 'none';
    const dobDate = new Date(this.value);
    const today = new Date();
    if (!this.value) return;

    // Age only calculate from 01-01-currentYear/-
    let age = today.getFullYear() - dobDate.getFullYear();

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
            currentGroupCode = g.code;
            found = true;
        }
    });

    if (!found) currentGroupCode = "";

    groupField.value = groupName;
    groupField.style.color = found ? "#333" : "var(--error)";
});

// Submission Logic
form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorMsg.style.display = 'none';

    if (groupField.value.includes("No Group") || currentGroupCode === "") {
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

    data.groupCode = currentGroupCode;

    fetch(CONFIG.scriptUrl, {
        method: 'POST',
        body: JSON.stringify(data)
    })
        .then(res => res.json())
        .then(result => {
            if (result.result === 'success') {
                lastCoachVal = coachField.value;
                lastCenterVal = centerField.value;
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
    groupField.value = "";
    currentGroupCode = "";
    formView.style.display = 'block';
    successView.style.display = 'none';
};


// =========================================================
// 3. SMART SEARCH DROPDOWN LOGIC
// =========================================================

const coachField = document.getElementById('coachField');
const suggestionsBox = document.getElementById('suggestions');
const centerField = document.getElementById('centerField');
const btnSameCoach = document.getElementById('btnSameCoach');
const lastCoachNameSpan = document.getElementById('lastCoachName');

// Store variables
let lastCoachVal = "";
let lastCenterVal = "";
// Convert DB to array for easier searching: ["Rajib Das", "Sampa Roy"...]
const coachNames = Object.keys(CONFIG.coachDatabase);

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
function selectCoach(name) {
    coachField.value = name;
    suggestionsBox.style.display = "none"; // Hide list

    // Auto-fill Center logic
    const mappedCenter = CONFIG.coachDatabase[name];
    if (mappedCenter) {
        centerField.value = mappedCenter;
        centerField.style.borderColor = "var(--success)";
        errorMsg.style.display = 'none';
    }
}

// Event 1: When user clicks/taps the field -> Show ALL names
coachField.addEventListener('focus', function () {
    renderSuggestions(""); // Empty filter = Show all
});

// Event 2: When user types -> Filter the list
coachField.addEventListener('input', function () {
    renderSuggestions(this.value);

    // Clear center if user deletes the name manually
    if (this.value === "") centerField.value = "";
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
    centerField.value = lastCenterVal;
    centerField.style.borderColor = "var(--success)";

    window.scrollTo({ top: 0, behavior: 'smooth' });
};

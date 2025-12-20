// =================================================================
// --- CONFIGURATION ---
// =================================================================

// CRITICAL: FINAL, WORKING GOOGLE APPS SCRIPT API ENDPOINT
const API_ENDPOINT = "https://script.google.com/macros/s/AKfycbz8_FVm0FQxvMMGL90noY1L8OKE0ys28dgc6XY5nrdXYsLEl79IvYbm_RmAOzcbVo7r/exec";

// NOTE: This URL must match the RENEWAL_FORM_URL_BASE in your Code.gs
const RENEWAL_FORM_BASE_URL = "https://docs.google.com/forms/d/e/1FAIpQLScOWO03l-RO84Lyp6vp3daNhc1zIDkKxY9sG-NMssloHBLgaw/viewform?usp=pp_url";


// =================================================================
// --- DOM ELEMENT REFERENCES ---
// =================================================================

// Note: These need to run after the HTML elements are loaded (which they do
// when the script is placed just before the closing </body> tag).
const studentIdInput = document.getElementById('studentId');
const submitButton = document.getElementById('submitButton');
const loadingMessage = document.getElementById('loadingMessage');
const failureMessage = document.getElementById('failureMessage');
const lookupForm = document.getElementById('lookupForm');
const manualButton = document.getElementById('manualButton');


// =================================================================
// --- EVENT LISTENERS & MAIN LOGIC ---
// =================================================================

// Set up the manual button action
manualButton.addEventListener('click', () => {
    window.location.href = RENEWAL_FORM_BASE_URL;
});

// Main form submission handler
lookupForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const studentId = studentIdInput.value.trim();

    // UI State: Loading
    submitButton.disabled = true;
    studentIdInput.disabled = true;
    failureMessage.style.display = 'none';
    loadingMessage.style.display = 'flex'; // Show the spinner

    // 1. Construct the API URL
    const apiUrlWithParam = `${API_ENDPOINT}?id=${encodeURIComponent(studentId)}`;

    // 2. Call the Google Apps Script API using fetch
    fetch(apiUrlWithParam)
        .then(response => {
            if (!response.ok) {
                // Handle HTTP errors (e.g., 404, 500)
                throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
            }
            return response.text(); // Get the response as plain text
        })
        .then(finalUrlText => {
            // UI State: Stop Loading
            loadingMessage.style.display = 'none';

            if (finalUrlText === "ID_NOT_FOUND") {
                // Use a slight delay before showing failure message 
                // to make the loading animation visible for a moment
                setTimeout(() => {
                    failureMessage.style.display = 'block';
                    studentIdInput.focus();
                }, 1000);
            } else if (finalUrlText.startsWith('http')) {
                // Success: Redirect the user instantly
                window.location.href = finalUrlText;
            } else {
                // Handle unexpected response
                alert("An unexpected error occurred. Please check the console for details.");
                console.error('API Response was unexpected:', finalUrlText);
            }
        })
        .catch(error => {
            // UI State: Crash/Network Error 
            loadingMessage.style.display = 'none';
            alert("A critical error occurred while contacting the server. Please try again. (If you are running this locally, please use the live GitHub Pages link instead.)");
            console.error('Fetch operation failed:', error);
        })
        .finally(() => {
            // Only re-enable if not redirecting (i.e., on failure or error)
            setTimeout(() => {
                submitButton.disabled = false;
                studentIdInput.disabled = false;
            }, 1000);
        });
});
// ============================================================================
// MYST ADMIN DASHBOARD INITIALIZER
// Single Database Architecture
// ============================================================================

import { initAuth } from './auth-service.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Core Authentication ONLY.
    // The auth-service will decide which modules to load after verifying the role.
    initAuth();
});

window.addEventListener('beforeunload', (e) => {
    e.preventDefault();
    e.returnValue = ''; 
});
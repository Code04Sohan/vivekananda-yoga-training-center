/**
 * Competition Results Page Scripts
 * Handles modal, animations, and micro-interactions
 */

// Toggle full-screen poster modal
function togglePosterModal(show) {
    const modal = document.getElementById('poster-modal');
    if (!modal) return;
    
    if (show) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.style.overflow = 'hidden';
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = '';
    }
}

// Close modal with Escape key
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        togglePosterModal(false);
    }
});

// Haptic Feedback for Mobile Navigation
function triggerHaptic() {
    if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(50);
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    // Current Year for Footer
    const currentYearEl = document.getElementById('current-year');
    if (currentYearEl) {
        currentYearEl.textContent = new Date().getFullYear();
    }

    // Zen Splash Screen dismiss logic
    const splash = document.getElementById('zen-splash');
    if (splash) {
        window.addEventListener('load', () => {
            setTimeout(() => {
                splash.style.opacity = '0';
                setTimeout(() => splash.remove(), 1000);
            }, 800);
        });
    }

    // Intersection Observer for fade-in animations
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: "0px 0px -40px 0px"
    });

    document.querySelectorAll('.animate-fade-in-up').forEach((el) => {
        observer.observe(el);
    });
});

// --- 1. Gallery Horizontal Scroll Logic ---
function scrollGallery(distance) {
    const track = document.getElementById('galleryTrack');
    track.scrollBy({
        left: distance,
        behavior: 'smooth'
    });
}

// --- 2. Lightbox & Swipe Logic ---
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const galleryItems = document.querySelectorAll('.gallery-item img'); // Get all images

let currentIndex = 0;

// Initialize click events for gallery images
document.querySelectorAll('.gallery-item').forEach((item, index) => {
    item.addEventListener('click', () => {
        openLightbox(index);
    });
});

// Function exposed to global scope for the Pamphlet onclick
function openLightbox(indexOrSrc) {
    // Check if argument is a string (URL) or number (Index)
    if (typeof indexOrSrc === 'string') {
        // It's a URL (from Pamphlet onclick)
        lightboxImg.src = indexOrSrc;
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
        // Hide navigation arrows for single image (pamphlet)
        document.querySelector('.prev-btn').style.display = 'none';
        document.querySelector('.next-btn').style.display = 'none';
    } else {
        // It's an index (from Gallery)
        currentIndex = indexOrSrc;
        const src = galleryItems[currentIndex].getAttribute('src');
        if (src) {
            lightboxImg.src = src;
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';
            // Show navigation arrows for gallery
            document.querySelector('.prev-btn').style.display = 'block';
            document.querySelector('.next-btn').style.display = 'block';
        }
    }
}

function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = 'auto'; // Restore scrolling
}

function changeImage(direction) {
    currentIndex += direction;

    // Loop logic
    if (currentIndex >= galleryItems.length) {
        currentIndex = 0;
    } else if (currentIndex < 0) {
        currentIndex = galleryItems.length - 1;
    }

    const src = galleryItems[currentIndex].getAttribute('src');
    // If image source is empty (placeholder), skip to next
    if (!src || src.trim() === "") {
        let safety = 0;
        while ((!src || src.trim() === "") && safety < galleryItems.length) {
            currentIndex += direction;
            if (currentIndex >= galleryItems.length) currentIndex = 0;
            else if (currentIndex < 0) currentIndex = galleryItems.length - 1;
            safety++;
        }
    }
    lightboxImg.src = galleryItems[currentIndex].src;
}

// --- 3. Keyboard Navigation Support ---
document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;

    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') changeImage(-1);
    if (e.key === 'ArrowRight') changeImage(1);
});

// --- 4. Touch Swipe Logic (Mobile) ---
let touchStartX = 0;
let touchEndX = 0;
const minSwipeDistance = 50;

lightbox.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

lightbox.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
}, { passive: true });

function handleSwipe() {
    const swipeDistance = touchEndX - touchStartX;

    if (Math.abs(swipeDistance) > minSwipeDistance) {
        if (swipeDistance > 0) {
            changeImage(-1);
        } else {
            changeImage(1);
        }
    }
}

// --- 5. Auto Scroll Logic ---
const track = document.getElementById('galleryTrack');
let autoScrollSpeed = 2.5;
let isPaused = false;

track.addEventListener('mouseenter', () => isPaused = true);
track.addEventListener('mouseleave', () => isPaused = false);
track.addEventListener('touchstart', () => isPaused = true);
track.addEventListener('touchend', () => setTimeout(() => isPaused = false, 2000));

function autoScrollGallery() {
    if (!isPaused) {
        track.scrollLeft += autoScrollSpeed;
        if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 1) {
            track.scrollLeft = 0;
        }
    }
    requestAnimationFrame(autoScrollGallery);
}

autoScrollGallery();
function toggleLocations() {
    const btn = document.getElementById('toggleLocBtn');
    const grid = document.querySelector('.loc-grid');

    // Check if we are expanding
    const isExpanding = btn.innerHTML.includes('Show All');

    if (isExpanding) {
        // Show all hidden rows
        const allRows = grid.querySelectorAll('.loc-row');
        // Start from index 5 because first 5 are always visible
        for (let i = 5; i < allRows.length; i++) {
            allRows[i].classList.remove('hidden');
            allRows[i].classList.add('was-hidden');
        }
        btn.innerHTML = 'Show Fewer <i class="fas fa-chevron-up"></i>';
    } else {
        // Hide them again
        const rowsToHide = grid.querySelectorAll('.loc-row.was-hidden');
        rowsToHide.forEach(row => {
            row.classList.add('hidden');
            row.classList.remove('was-hidden');
        });
        btn.innerHTML = 'Show All Locations <i class="fas fa-chevron-down"></i>';

        // Scroll back to locations title so user isn't lost
        document.querySelector('.locations-section').scrollIntoView({ behavior: 'smooth' });
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const yearSpan = document.getElementById('current-year');
        if (yearSpan) {
            yearSpan.textContent = new Date().getFullYear();
        }
    });

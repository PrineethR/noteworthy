// js/frutiger-aero.js
// Simplified interactions for the minimal serif UI

const triggerHaptic = () => {
    if (navigator.vibrate) {
        navigator.vibrate(10); // Very light haptic tap
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Keep only clean haptics for touch feedback
    const clickables = document.querySelectorAll('.btn, .profile-badge, .tag');
    clickables.forEach(el => {
        el.addEventListener('mousedown', triggerHaptic);
        el.addEventListener('touchstart', triggerHaptic, { passive: true });
    });
});

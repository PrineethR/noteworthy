// js/awwwards-ui.js
// AWWWARDS-winning UI enhancements: p5.js fluid background, GSAP motion, and Haptics.

// ==========================================
// 1. P5.js Ambient Background (Calm & Subtle)
// ==========================================
const sketch = (p) => {
    let time = 0;
    
    p.setup = () => {
        let canvas = p.createCanvas(p.windowWidth, p.windowHeight);
        canvas.parent('awwwards-bg-container');
        p.noStroke();
        // Apply a massive blur to eliminate any sharp lines, creating an ambient gradient feel
        p.drawingContext.filter = 'blur(140px)';
    };

    p.draw = () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        
        // Base calm background
        if (isDark) {
            p.background('#080b12'); // Deep charcoal blue
        } else {
            p.background('#faf9f5'); // Warm, calm off-white (writing environment)
        }

        let w = p.width;
        let h = p.height;
        
        // Very slow, subtle drifting coordinates
        let cx1 = w * 0.5 + p.cos(time * 0.3) * w * 0.2;
        let cy1 = h * 0.5 + p.sin(time * 0.2) * h * 0.2;
        
        let cx2 = w * 0.2 + p.sin(time * 0.2) * w * 0.3;
        let cy2 = h * 0.8 + p.cos(time * 0.3) * h * 0.3;

        let cx3 = w * 0.8 + p.cos(time * 0.4) * w * 0.1;
        let cy3 = h * 0.2 + p.sin(time * 0.25) * h * 0.2;

        if (isDark) {
            p.fill(0, 60, 150, 40);
            p.circle(cx1, cy1, w * 0.9);
            p.fill(20, 30, 80, 50);
            p.circle(cx2, cy2, w * 0.8);
            p.fill(0, 100, 200, 30);
            p.circle(cx3, cy3, w * 1.0);
        } else {
            // Very subtle, ethereal pastel glows for light mode
            p.fill(0, 102, 255, 12); 
            p.circle(cx1, cy1, w * 0.8);
            p.fill(150, 200, 255, 20); 
            p.circle(cx2, cy2, w * 0.7);
            p.fill(255, 220, 180, 15); 
            p.circle(cx3, cy3, w * 0.9);
        }
        
        time += 0.0015; // Extremely slow, meditative pace
    };

    p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight);
        p.drawingContext.filter = 'blur(140px)'; // Re-apply filter
    };
};

// Initialize p5
new p5(sketch);

// ==========================================
// 2. GSAP Interactions (Subtle & Refined)
// ==========================================

const triggerHaptic = () => {
    if (navigator.vibrate) {
        navigator.vibrate(10); // Very subtle tap
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.btn, .profile-card, .profile-combined');

    buttons.forEach(btn => {
        // Hover state (Very slight lift)
        btn.addEventListener('mouseenter', () => {
            gsap.to(btn, {
                y: -1.5,
                scale: 1.01,
                duration: 0.5,
                ease: 'power2.out'
            });
        });

        // Leave state (Gentle settle)
        btn.addEventListener('mouseleave', () => {
            gsap.to(btn, {
                y: 0,
                scale: 1,
                duration: 0.6,
                ease: 'power2.out'
            });
        });

        // Press state (Gentle press)
        btn.addEventListener('mousedown', () => {
            triggerHaptic();
            gsap.to(btn, {
                y: 1,
                scale: 0.98,
                duration: 0.15,
                ease: 'power2.out'
            });
        });

        btn.addEventListener('mouseup', () => {
            gsap.to(btn, {
                y: -1.5,
                scale: 1.01,
                duration: 0.4,
                ease: 'power2.out'
            });
        });
        
        btn.addEventListener('touchstart', () => {
            triggerHaptic();
            gsap.to(btn, { y: 1, scale: 0.98, duration: 0.15, ease: 'power2.out' });
        }, {passive: true});
        
        btn.addEventListener('touchend', () => {
            gsap.to(btn, { y: 0, scale: 1, duration: 0.5, ease: 'power2.out' });
        });
    });
});

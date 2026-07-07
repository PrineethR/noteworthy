---
name: awwwards-visual-design
description: Enforces premium, AWWWARDS-winning visual design aesthetics including flowy/grainy textures, skeumorphic buttons, and GSAP/p5.js animations. Use this whenever writing CSS or designing UI components.
---

# AWWWARDS Visual Design System

You are a cracked, AWWWARDS-winning frontend developer and designer. Whenever you are tasked with designing UI, writing CSS, or building interactions for this project, you MUST adhere to the following design system and principles.

## 1. Core Aesthetic: Flowy, Colorful, Grainy
- **Organic Shapes:** Favor fluid, organic, and wavy shapes over rigid geometry. Use SVG paths or CSS `border-radius` manipulation to achieve flowy containers.
- **Grain & Texture:** Incorporate subtle noise/grain overlays to give the interface a tactile, risograph-like feel. This can be achieved with SVG noise filters, CSS background blends, or a lightweight WebGL shader.
- **Vibrant Palettes:** Use bold, electric colors (like deep electric blue against an off-white/cream background). Ensure high contrast but harmonious pairings.

## 2. Interactive Elements: Modern Skeumorphism
- **Tactile Buttons:** Buttons should feel physical and "skeumorphic" in a modern, stylized way. 
  - Use rich, multi-stop gradients for surface lighting.
  - Apply subtle inner shadows (`box-shadow: inset ...`) and layered drop shadows to create physical depth (e.g., a raised default state, and a depressed/pressed active state).
  - Use bold colors that command attention.

## 3. Motion & Animation (GSAP & p5.js)
- **Fluid Animations:** Move beyond basic CSS transitions for complex choreography. Leverage your in-depth experience with **GSAP** for sequencing, spring physics, and scroll-triggered animations.
- **Generative & Canvas:** For complex, flowy backgrounds or interactive fluid simulations, utilize **p5.js** or custom WebGL **shaders**.
- **Micro-interactions:** Simple but amazing animations. Elements should react fluidly and organically to hover, click, and scroll states. 

## 4. Sensory Feedback
- **Haptics:** Where supported (e.g., via `navigator.vibrate()`), use subtle haptic feedback patterns for critical actions like button presses, modal openings, or satisfying interactions.
- **Sound:** Use low-latency, unobtrusive, and highly polished sound effects for UI interactions (clicks, toggles, success states) to enhance the tactile illusion.

## 5. Engineering & Usability
- **Responsive & Adaptive:** The design MUST scale flawlessly across all screen sizes. Use fluid typography (`clamp()`), modern CSS Grid/Flexbox, and container queries where appropriate.
- **Efficient & Performant:** Despite the heavy visual layer, prioritize performance. 
  - Prefer `transform` and `opacity` for animations.
  - Use `will-change` sparingly for complex animated properties.
  - Ensure shaders and canvas loops `requestAnimationFrame` pause when not in the viewport (using `IntersectionObserver`).

## Implementation Workflow
When asked to build or style a feature:
1. Establish the visual foundation (colors, noise textures, global typography).
2. Build the structural layout fully responsively.
3. Layer in the skeumorphic details (gradients, shadows, lighting).
4. Add the motion layer (GSAP/shaders).
5. Inject sensory feedback (haptics/audio).

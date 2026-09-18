/* ============================================================
   Noteworthy — doodle.js
   The hand, the doodles, and what makes them move.

   A doodle is plain geometry drawn through a hand that drifts off
   true and back. Every part of it knows how it moves — a flame
   flickers from its base, steam rises and thins, an eye blinks now
   and then — and what the doodle is of comes from the words it is
   drawn for. Nothing is keyframed: the words pick the picture, the
   date picks its details, and the picture animates itself.

   Days draws with it, and so does Capture.
   ============================================================ */

export const TAU = Math.PI * 2;
export const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ─── Seeded chance ───────────────────────────────────────────
// Everything is drawn from a seed, so a page is the same page every time
// you come back to it — a morning, not a slot machine.

export function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    // Mixed once more at the end: dates differ only in their last characters,
    // and without this neighbouring days came out in the same colour.
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

export function rngFrom(seed) {
    let a = typeof seed === 'number' ? seed : hash(String(seed));
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── Colour ──────────────────────────────────────────────────
// Flat, from one small box of paints. A page is one of them; the fills in a
// doodle are others, chosen so they never vanish into the page.

export const PALETTE = [
    { id: 'forest', bg: '#0f4a3a', ink: '#f1ead0' },
    { id: 'sky',    bg: '#86cbf7', ink: '#0e2a22' },
    { id: 'tomato', bg: '#df553f', ink: '#fff3e2' },
    { id: 'butter', bg: '#f3d267', ink: '#221c0e' },
    { id: 'plum',   bg: '#4a2b4e', ink: '#f4e4d2' },
    { id: 'sage',   bg: '#bccda6', ink: '#1a2617' },
    { id: 'night',  bg: '#1d2b4f', ink: '#ebe5d3' },
    { id: 'blush',  bg: '#f4b8c1', ink: '#2b1519' },
    { id: 'clay',   bg: '#b6623d', ink: '#fcefdf' },
    { id: 'lilac',  bg: '#c4b6ef', ink: '#1c1631' },
];

export const PAPER = {
    light: { bg: '#fbfaf5', ink: '#161616' },
    dark:  { bg: '#161513', ink: '#efe9dc' },
};

const PAINT = Object.fromEntries([...PALETTE.map(p => [p.id, p.bg]), ['paper', PAPER.light.bg]]);
export const paletteById = id => PALETTE.find(p => p.id === id);

function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
    const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** The ink that goes with a ground: its own, if it is one of ours. */
function inkOn(bg) {
    const p = PALETTE.find(x => x.bg === bg) || Object.values(PAPER).find(x => x.bg === bg);
    return p ? p.ink : luminance(bg) > 0.4 ? PAPER.light.ink : PAPER.dark.ink;
}

/**
 * First paint on the list that will show on this ground. A fill that has
 * lines drawn inside it — a clock's face, a page with writing on it — must
 * also stand apart from the ink, or those lines vanish into it; if nothing
 * on its list does, it goes unfilled and is a line drawing.
 */
function pickPaint(list, bg, holds = false) {
    bg = bg || PAPER.light.bg;
    const g = rgb(bg), ink = inkOn(bg);
    for (const id of list) {
        if (id === 'ink') return 'currentColor';
        const hex = PAINT[id];
        if (!hex) continue;
        const c = rgb(hex);
        if (Math.hypot(c[0] - g[0], c[1] - g[1], c[2] - g[2]) < 64) continue;
        if (holds && contrast(hex, ink) < 1.8) continue;
        return hex;
    }
    return null;
}

// ─── A hand ──────────────────────────────────────────────────

/** Catmull-Rom through the given points, sampled densely. */
export function thru(...pts) {
    if (pts.length < 3) return pts;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        for (let s = 0; s < 8; s++) {
            const t = s / 8, t2 = t * t, t3 = t2 * t;
            out.push([0, 1].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t
                + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
        }
    }
    out.push(pts[pts.length - 1]);
    return out;
}

export function arc(cx, cy, rx, ry, a0, a1) {
    const n = Math.max(10, Math.round(Math.abs(a1 - a0) / 7));
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
        pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return pts;
}

export function curve(fn, n = 48) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(fn(i / n));
    return pts;
}

/** Ray from a centre, between two radii. */
export function ray(cx, cy, deg, from, to) {
    const a = deg * Math.PI / 180;
    return [[cx + Math.cos(a) * from, cy + Math.sin(a) * from], [cx + Math.cos(a) * to, cy + Math.sin(a) * to]];
}

function resample(pts, step) {
    const out = [pts[0]];
    let need = step;
    for (let i = 1; i < pts.length; i++) {
        let [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        let len = Math.hypot(x1 - x0, y1 - y0);
        while (len >= need) {
            const t = need / len;
            x0 += (x1 - x0) * t; y0 += (y1 - y0) * t;
            out.push([x0, y0]);
            len -= need; need = step;
        }
        need -= len;
    }
    const last = pts[pts.length - 1], tail = out[out.length - 1];
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.25) out.push(last);
    return out;
}

/** n + 1 points along a line, evenly spaced by distance — where a pen is after each step. */
function evenly(pts, n) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const out = resample(pts, len / n);
    if (out.length > n + 1) out.length = n + 1;
    out[out.length - 1] = pts[pts.length - 1];
    return out;
}

function smooth(pts) {
    let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} `
            + `${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
    }
    return d;
}

/** Push each point off the line along its normal, by a slow sum of waves. */
function waver(p, rng, amp) {
    const n = p.length;
    const ph = [rng() * TAU, rng() * TAU, rng() * TAU];
    const fr = [0.5 + rng() * 0.8, 1.8 + rng() * 1.5, 4.5 + rng() * 3];
    return p.map((pt, i) => {
        const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        const t = i / Math.max(1, n - 1);
        const w = amp * (0.6 * Math.sin(t * fr[0] * TAU + ph[0])
            + 0.3 * Math.sin(t * fr[1] * TAU + ph[1])
            + 0.12 * Math.sin(t * fr[2] * TAU + ph[2]));
        return [pt[0] + nx * w, pt[1] + ny * w];
    });
}

/** A line as a hand draws it: off true, and back. */
export function hand(pts, rng, amp = 1.4, step = 4) {
    if (pts.length < 2) return '';
    return smooth(waver(resample(pts, step), rng, amp));
}

function extent(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** The same hand at any size: a star the size of a grain is not drawn with an elbow. */
function handFor(pts, rng, amp = 1.4) {
    const e = extent(pts);
    const size = Math.max(e.w, e.h, 1);
    return hand(pts, rng, Math.min(amp, size * 0.1), Math.min(4, Math.max(0.8, size / 6)));
}

// ─── Shapes the scenes are built from ────────────────────────

const ring = (cx, cy, rx, ry = rx) => arc(cx, cy, rx, ry, -90, 282);
const seg = (x0, y0, x1, y1) => [[x0, y0], [x1, y1]];
const mv = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
const between = (rng, a, b) => a + rng() * (b - a);

function rot(pts, deg, cx, cy) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}

const ground = (y = 142, x0 = 36, x1 = 204) =>
    thru([x0, y], [x0 + (x1 - x0) * 0.33, y - 1.5], [x0 + (x1 - x0) * 0.68, y + 1], [x1, y - 0.5]);

/** A cloud: scalloped above, nearly flat below. */
function lumpy(cx, cy, rx, ry, bumps = 3.5) {
    return curve(t => {
        const a = t * TAU * 1.03;
        const s = Math.sin(a);
        const k = s < 0 ? 1 + 0.2 * Math.abs(Math.sin(a * bumps)) : 1;
        return [cx + Math.cos(a) * rx * (s < 0 ? k : 1), cy + (s < 0 ? s * ry * k : s * ry * 0.32)];
    }, 110);
}

/** Scalloped all the way round: a treetop, a thought. */
function puff(cx, cy, rx, ry, bumps = 7) {
    return curve(t => {
        const a = t * TAU * 1.03;
        const k = 1 + 0.15 * Math.abs(Math.sin(a * bumps / 2));
        return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
    }, 120);
}

function heartPts(cx, cy, s) {
    return curve(t => {
        const a = 0.15 + t * (TAU + 0.3);
        const x = 16 * Math.sin(a) ** 3;
        const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
        return [cx + x * s, cy + y * s];
    }, 80);
}

/** A four-pointed glint. */
function glint(x, y, s) {
    return curve(t => {
        const a = t * TAU * 1.02 - Math.PI / 2;
        const r = s * (0.28 + 0.72 * Math.abs(Math.cos(a * 2)) ** 3);
        return [x + Math.cos(a) * r, y + Math.sin(a) * r];
    }, 40);
}

function zed(x, y, s) { return [[x, y], [x + s, y], [x, y + s], [x + s, y + s]]; }

function bird(x, y, s = 1) {
    return [
        thru([x - 12 * s, y - 1 * s], [x - 6 * s, y - 7 * s], [x, y]),
        thru([x, y], [x + 6 * s, y - 7 * s], [x + 12 * s, y - 1 * s]),
    ];
}

function wisp(x, y, h, k = 0) {
    return curve(t => [x + Math.sin(t * TAU * 0.9 + k) * 3.5, y - t * h], 16);
}

function leaf(x, y, s, deg) {
    return rot(curve(t => {
        const a = t * TAU * 1.02;
        return [x + Math.cos(a) * s, y + Math.sin(a) * s * 0.45 * (1 - 0.3 * Math.cos(a))];
    }, 24), deg, x, y);
}

// ─── Motion ──────────────────────────────────────────────────
// A part moves by one of a small set of verbs, each a function of time.
// The scene says which verb and roughly how much; the seed says exactly
// how much and when, so no two mornings' flames flicker alike.

const sway = (x, y, a, p) => ({ t: 'sway', x, y, a, p });
const bob = (a, p) => ({ t: 'bob', a, p });
const drift = (a, p) => ({ t: 'drift', a, p });
const pulse = (x, y, a, p) => ({ t: 'pulse', x, y, a, p });
const spin = (x, y, p, dir = 1) => ({ t: 'spin', x, y, p, dir });
const twinkle = (x, y, a = 0.3, p = 2.2) => ({ t: 'twinkle', x, y, a, p });
const rise = (x, y, d, p, ph, w = 3) => ({ t: 'rise', x, y, d, p, ph, w });
const fall = (d, dx, p, ph) => ({ t: 'fall', d, dx, p, ph });
const flicker = (x, y, a, p = 1) => ({ t: 'flicker', x, y, a, p });
const blink = (x, y, p = 4.5) => ({ t: 'blink', x, y, p });

const bump = (u, c, w) => (Math.abs(u - c) < w ? 0.5 * (1 + Math.cos(Math.PI * (u - c) / w)) : 0);
const ease = u => u * u * (3 - 2 * u);
const fade = u => (u < 0.15 ? u / 0.15 : u > 0.7 ? Math.max(0, (1 - u) / 0.3) : 1);
const at = (sx, sy, x, y) => `translate(${r1(x)} ${r1(y)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${r1(-x)} ${r1(-y)})`;

function cyc(m, t) { const u = t / m.p + (m.ph || 0); return u - Math.floor(u); }
function wav(m, t) { return Math.sin(TAU * (t / m.p + (m.ph || 0))); }

const MOVES = {
    sway: (m, t) => ({ tf: `rotate(${r1(m.a * wav(m, t))} ${m.x} ${m.y})` }),
    bob: (m, t) => ({ tf: `translate(0 ${r1(m.a * wav(m, t))})` }),
    drift: (m, t) => ({ tf: `translate(${r1(m.a * wav(m, t))} 0)` }),
    float: (m, t) => ({ tf: `translate(${r1(m.a * wav(m, t))} ${r1(m.a * 0.6 * Math.sin(TAU * (t / (m.p * 1.37) + (m.ph || 0))))})` }),
    spin: (m, t) => ({ tf: `rotate(${r1(360 * cyc(m, t) * (m.dir || 1))} ${m.x} ${m.y})` }),
    pulse: (m, t) => { const s = 1 + m.a * wav(m, t); return { tf: at(s, s, m.x, m.y) }; },
    beat: (m, t) => {
        const u = cyc(m, t);
        const s = 1 + m.a * (bump(u, 0.1, 0.09) + 0.6 * bump(u, 0.32, 0.09));
        return { tf: at(s, s, m.x, m.y) };
    },
    twinkle: (m, t) => {
        const w = Math.max(0, wav(m, t)) ** 3;
        const s = 1 - m.a * 0.4 + m.a * w;
        return { tf: at(s, s, m.x, m.y), op: 0.5 + 0.5 * w };
    },
    glow: (m, t) => ({ op: 0.55 + 0.45 * (0.5 + 0.5 * wav(m, t)) }),
    fall: (m, t) => {
        const u = cyc(m, t);
        return { tf: `translate(${r1((m.dx || 0) * u)} ${r1(m.d * u)})`, op: fade(u) };
    },
    rise: (m, t) => {
        const u = cyc(m, t);
        const s = 0.75 + 0.45 * u;
        return {
            tf: `translate(${r1((m.w || 0) * Math.sin(u * TAU))} ${r1(-m.d * u)}) ${at(s, s, m.x, m.y)}`,
            op: fade(u),
        };
    },
    flicker: (m, t) => {
        const k = t * TAU / m.p + (m.ph || 0) * 10;
        const n1 = (Math.sin(k * 1.7) + 0.6 * Math.sin(k * 2.9 + 1) + 0.3 * Math.sin(k * 5.3 + 2)) / 1.9;
        const n2 = (Math.sin(k * 2.3 + 3) + 0.6 * Math.sin(k * 3.7) + 0.3 * Math.sin(k * 6.1 + 1)) / 1.9;
        return { tf: at(1 + m.a * 0.35 * n1, 1 + m.a * n2, m.x, m.y) };
    },
    blink: (m, t) => {
        const u = cyc(m, t);
        const k = u < 0.06 ? Math.max(0.06, Math.abs(Math.cos(u / 0.06 * Math.PI))) : 1;
        return { tf: at(1, k, m.x, m.y) };
    },
    flap: (m, t) => ({ tf: at(1, 0.25 + 0.75 * Math.cos(TAU * cyc(m, t)), m.x, m.y) }),
    hop: (m, t) => {
        const h = Math.sin(Math.PI * cyc(m, t));
        const sq = h < 0.18 ? (0.18 - h) / 0.18 * (m.sq ?? 0.16) : 0;
        return { tf: `translate(0 ${r1(-m.a * h)}) ${at(1 + sq, 1 - sq, m.x, m.y)}` };
    },
    shadow: (m, t) => {
        const h = Math.sin(Math.PI * cyc(m, t));
        const s = 1 - 0.5 * h;
        return { tf: at(s, s, m.x, m.y), op: 1 - 0.5 * h };
    },
    appear: (m, t) => {
        const u = cyc(m, t), on = m.on ?? 0.6;
        return { op: u < 0.05 ? u / 0.05 : u < on ? 1 : u < on + 0.08 ? 1 - (u - on) / 0.08 : 0 };
    },
    draw: (m, t) => {
        const u = cyc(m, t), s = m.s || 0, d = m.dur ?? 0.3, on = m.on ?? 0.85;
        if (u < s) return { dash: 1, op: 1 };
        if (u < s + d) return { dash: 1 - ease((u - s) / d), op: 1 };
        if (u < on) return { dash: 0, op: 1 };
        return { dash: 0, op: Math.max(0, 1 - (u - on) / (1 - on) * 1.6) };
    },
    follow: (m, t) => {
        const u = cyc(m, t), s = m.s || 0, d = m.dur ?? 0.3;
        const k = u < s ? 0 : u < s + d ? ease((u - s) / d) : 1;
        const pts = m.pts;
        const f = k * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), r = f - i;
        return { tf: `translate(${r1(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r)} ${r1(pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r)})` };
    },
    orbit: (m, t) => {
        const a = TAU * cyc(m, t) * (m.dir || 1);
        return { tf: `translate(${r1(m.a * (Math.cos(a) - 1))} ${r1((m.b ?? m.a) * Math.sin(a))})` };
    },
    ring: (m, t) => {
        const u = cyc(m, t);
        const a = u < 0.16 ? m.a * Math.sin(t * 46) * (1 - u / 0.16) : 0;
        return { tf: `rotate(${r1(a)} ${m.x} ${m.y})` };
    },
};

function moveAt(ms, t) {
    let tf = '', op = 1, dash;
    for (const m of ms) {
        const f = MOVES[m.t];
        if (!f) continue;
        const r = f(m, t);
        if (r.tf) tf += `${r.tf} `;
        if (r.op !== undefined) op *= r.op;
        if (r.dash !== undefined) dash = r.dash;
    }
    return { tf: tf.trim(), op, dash };
}

/** The seed decides exactly how much, and when. */
function settle(m, rng) {
    if (!m) return null;
    const list = (Array.isArray(m) ? m : [m]).filter(Boolean);
    return list.map(x => {
        const y = { ...x };
        if (!y.lock) {
            if (y.p) y.p = r2(y.p * (0.85 + rng() * 0.3));
            if (y.a !== undefined) y.a = r2(y.a * (0.85 + rng() * 0.3));
            if (y.ph === undefined) y.ph = r2(rng());
        }
        delete y.lock;
        ['x', 'y', 'd', 'dx', 'w', 'b', 's', 'dur', 'on'].forEach(k => { if (typeof y[k] === 'number') y[k] = r1(y[k]); });
        return y;
    });
}

// ─── The scenes ──────────────────────────────────────────────
// A 240 × 180 box. A part is { s: strokes, f: fills, m: how it moves,
// k: parts that ride along with it, paint: a coloured stroke }.

const P = (s, o = {}) => ({ s, ...o });
const F = (pts, c) => ({ pts, c });
/** A fill with lines drawn inside it (see pickPaint). */
const H = (pts, c) => ({ pts, c, holds: true });
const kids = list => list.filter(Boolean);

const SCENES = {
    sun(rng) {
        const cx = between(rng, 98, 142), cy = between(rng, 64, 78), r = 24;
        const rays = [];
        for (let i = 0; i < 9; i++) rays.push(ray(cx, cy, i * 40 + rng() * 10, r + 9, r + 18 + rng() * 6));
        const disc = ring(cx, cy, r);
        const cx2 = cx < 120 ? 184 : 58;
        const cl = lumpy(cx2, 44, 22, 11, 2.5);
        return kids([
            P([ground(146)]),
            P([], { m: bob(3.5, 5), k: [
                P(rays, { m: spin(cx, cy, 34) }),
                P([disc], { f: F(disc, ['butter', 'tomato', 'paper']), m: pulse(cx, cy, 0.04, 3) }),
            ] }),
            rng() < 0.7 && P([cl], { f: F(cl, ['paper', 'sky', 'lilac']), m: drift(7, 9) }),
        ]);
    },

    sunrise(rng) {
        const cx = 120, cy = 130, r = 30;
        const disc = arc(cx, cy, r, r, 180, 360);
        const rays = [200, 228, 256, 284, 312, 340].map(a => ray(cx, cy, a + rng() * 6 - 3, r + 10, r + 21));
        return [
            P(rays, { m: pulse(cx, cy, 0.08, 2.6) }),
            P([disc], { f: F(disc, ['butter', 'tomato', 'blush']) }),
            P([thru([30, 130], [80, 129], [160, 131], [210, 129])]),
            P([glint(58, 70, 7)], { m: twinkle(58, 70, 0.4, 2.4) }),
            P([glint(186, 56, 5)], { m: twinkle(186, 56, 0.4, 3) }),
        ];
    },

    rain(rng) {
        const cx = between(rng, 106, 134), cy = 54;
        const cl = lumpy(cx, cy, 56, 24, 3.5);
        const n = 5 + Math.floor(rng() * 3);
        const drops = [];
        for (let i = 0; i < n; i++) {
            const x = cx - 42 + (84 * (i + 0.5)) / n + rng() * 6 - 3, y = 70 + rng() * 8;
            drops.push(P([seg(x, y, x - 2.5, y + 9)], { m: fall(58, -7, 1.1 + rng() * 0.5, rng()) }));
        }
        return [
            P([ground(146, 52, 188)]),
            P([arc(118, 146, 22, 3.5, 0, 372)], { m: pulse(118, 146, 0.1, 1.3) }),
            ...drops,
            P([cl], { f: F(cl, ['paper', 'sky', 'lilac']), m: drift(5, 6) }),
        ];
    },

    night(rng, { z = false } = {}) {
        const outer = thru([140, 48], [110, 55], [94, 84], [103, 116], [138, 128]);
        const inner = thru([138, 128], [121, 110], [117, 88], [123, 66], [140, 48]);
        const spots = [[178, 50], [192, 100], [62, 54], [56, 112], [166, 146], [84, 30], [196, 146]]
            .sort(() => rng() - 0.5).slice(0, z ? 3 : 5);
        const out = [P([outer, inner], { f: F([...outer, ...inner.slice(1)], ['butter', 'paper', 'blush']), m: sway(118, 88, 5, 5.5) })];
        spots.forEach(([x, y], i) => {
            const s = 3.5 + rng() * 3;
            out.push(P(i % 2 ? [glint(x, y, s + 1)] : [seg(x - s, y, x + s, y), seg(x, y - s, x, y + s)], { m: twinkle(x, y, 0.4, 1.8 + rng() * 1.6) }));
        });
        if (z) [6, 8, 11].forEach((s, i) => out.push(P([zed(150 + i * 7, 64 - i * 12, s)], { m: rise(155 + i * 7, 68 - i * 12, 24, 3.6, i / 3, 3) })));
        return out;
    },

    sleep(rng) { return SCENES.night(rng, { z: true }); },

    stars(rng) {
        const cx = 120, cy = 92;
        const star = [];
        for (let k = 0; k <= 10; k++) {
            const a = (-90 + k * 36) * Math.PI / 180, r = k % 2 ? 19 : 46;
            star.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        const spots = [[184, 46], [56, 132], [190, 132], [58, 50]].sort(() => rng() - 0.5).slice(0, 3);
        const trail = [[222, 22], [204, 32], [190, 40]];
        return [
            // A shooting star: one streak, then a long wait
            P([trail, glint(188, 41, 4)], { m: [
                { t: 'fall', d: 46, dx: -86, p: 2.2, ph: 0, lock: 1 },
                { t: 'appear', p: 6.6, ph: 0, on: 0.33, lock: 1 },
            ] }),
            P([star], { f: F(star, ['butter', 'paper', 'blush']), m: [sway(cx, cy, 8, 4.5), pulse(cx, cy, 0.05, 2.2)] }),
            ...spots.map(([x, y]) => P([glint(x, y, 5 + rng() * 3)], { m: twinkle(x, y, 0.45, 1.6 + rng() * 1.4) })),
        ];
    },

    cup(rng) {
        const body = thru([94, 84], [95, 112], [100, 131], [120, 137], [140, 131], [145, 112], [146, 84]);
        const rim = arc(120, 84, 26, 5.5, 0, 372);
        const front = arc(120, 84, 26, 5.5, 0, 180);
        const handle = thru([146, 96], [159, 96], [163, 108], [156, 120], [143, 122]);
        const saucer = thru([70, 141], [96, 146], [144, 146], [170, 141]);
        return [
            P([saucer]),
            P([body, rim, handle], { f: F([...body, ...front], ['clay', 'tomato', 'blush', 'butter']) }),
            ...[108, 120, 132].map((x, i) => P([wisp(x, 72, 24, i * 2)], { m: rise(x, 72, 12, 2.6, i / 3 + rng() * 0.1, 2) })),
        ];
    },

    glass(rng) {
        const surf = curve(t => [99 + 42 * t, 78 + Math.sin(t * TAU * 1.5) * 2], 24);
        const bubbles = [106, 116, 126, 134].map((x, i) => {
            const r = 2.2 + rng() * 1.6, y = 128 + rng() * 6;
            return P([ring(x, y, r)], { m: rise(x, y, 42, 2 + rng(), i / 4 + rng() * 0.2, 2) });
        });
        return [
            P([], { f: H([[98.5, 78], [141.5, 78], [137, 140], [103, 140]], ['sky', 'lilac', 'paper', 'night']) }),
            ...bubbles,
            P([surf], { m: drift(2.2, 2.2) }),
            P([seg(96, 48, 103, 140), seg(144, 48, 137, 140), thru([103, 140], [120, 142], [137, 140])]),
            P([seg(126, 34, 121, 118), seg(126, 34, 142, 20)], { m: sway(121, 118, 2, 3) }),
        ];
    },

    heart(rng) {
        const h = heartPts(120, 82, 2.8);
        return [
            P([h], { f: F(h, ['tomato', 'blush', 'paper']), m: { t: 'beat', x: 120, y: 90, a: 0.09, p: 1.3 } }),
            ...[[64, 128, 0.62], [178, 118, 0.5], [70, 60, 0.4]].map(([x, y, s], i) => {
                const hh = heartPts(x, y, s);
                return P([hh], { f: F(hh, ['blush', 'tomato', 'paper']), m: rise(x, y, 30, 3.2, i / 3, 4) });
            }),
        ];
    },

    sprout(rng) {
        const leafL = thru([120, 97], [106, 82], [86, 77], [95, 92], [120, 97]);
        const leafR = thru([121, 90], [134, 72], [157, 65], [150, 83], [121, 90]);
        const out = [
            P([ground(141, 48, 194)]),
            P([thru([121, 141], [119, 122], [122, 104], [120, 86])], { m: sway(121, 141, 5, 3.6), k: [
                P([leafL], { f: F(leafL, ['sage', 'forest', 'butter']), m: sway(120, 97, 6, 2.4) }),
                P([leafR], { f: F(leafR, ['sage', 'forest', 'butter']), m: sway(121, 90, 6, 2.8) }),
            ] }),
        ];
        if (rng() < 0.6) out.push(P([ring(60, 50, 11)], { f: F(ring(60, 50, 11), ['butter', 'tomato']), m: pulse(60, 50, 0.08, 2.4) }));
        else out.push(...[0, 1, 2].map(i => P([seg(168 + i * 8, 40, 166 + i * 8, 47)], { m: fall(40, -4, 1.4, i / 3) })));
        return out;
    },

    tree(rng) {
        const top = puff(121, 68, 50, 34, 7);
        const apples = rng() < 0.5 ? [[100, 66], [134, 56], [142, 80]].map(([x, y]) =>
            P([ring(x, y, 4)], { f: F(ring(x, y, 4), ['tomato', 'blush', 'butter']) })) : [];
        return [
            P([ground(142)]),
            P([thru([112, 142], [115, 122], [113, 98]), thru([130, 142], [127, 122], [129, 98]), thru([122, 114], [132, 106], [140, 98])]),
            P([top], { f: F(top, ['sage', 'forest', 'butter']), m: sway(121, 104, 2.5, 4), k: apples }),
            ...[[152, 92], [88, 100]].map(([x, y], i) => {
                const l = leaf(x, y, 5, 30 + i * 60);
                return P([l], { f: F(l, ['sage', 'butter', 'clay']), m: fall(46, i ? -12 : 14, 4 + rng(), i / 2 + rng() * 0.2) });
            }),
        ];
    },

    flower(rng) {
        const hx = 119, hy = 60, n = rng() < 0.5 ? 5 : 6;
        const petals = [];
        for (let i = 0; i < n; i++) {
            const deg = -90 + i * 360 / n, r = deg * Math.PI / 180;
            const ox = hx + Math.cos(r) * 13, oy = hy + Math.sin(r) * 13;
            petals.push(curve(t => {
                const th = t * Math.PI * 2.08;
                const x = Math.cos(th) * 13, y = Math.sin(th) * 7.5;
                return [ox + x * Math.cos(r) - y * Math.sin(r), oy + x * Math.sin(r) + y * Math.cos(r)];
            }, 30));
        }
        const eye = ring(hx, hy, 6);
        const lf = thru([119, 114], [104, 102], [95, 106], [106, 116], [119, 114]);
        const bx = hx + 40, by = hy;
        // A bee: a striped body and two wings, going round the flower
        const bee = [arc(bx, by, 7.5, 5, 0, 372), rot(ring(bx - 2, by - 8, 3.2, 4.4), -24, bx - 2, by - 8), rot(ring(bx + 3, by - 8, 3.2, 4.4), 24, bx + 3, by - 8)];
        return [
            P([ground(142)]),
            P([thru([120, 142], [117, 118], [122, 96], [119, 68]), lf], { f: F(lf, ['sage', 'forest']), m: sway(120, 142, 4, 3.4), k: [
                P(petals, { f: petals.map(p => F(p, ['blush', 'butter', 'lilac', 'paper'])), m: spin(hx, hy, 24) }),
                P([eye], { f: F(eye, ['butter', 'tomato']) }),
            ] }),
            P([bee[0], bee[1], bee[2], seg(bx - 2, by - 4.6, bx - 2, by + 4.6), seg(bx + 2.4, by - 4.4, bx + 2.4, by + 4.4), seg(bx + 7.5, by, bx + 10, by)],
                { f: [F(bee[0], ['butter', 'tomato']), F(bee[1], ['paper', 'sky']), F(bee[2], ['paper', 'sky'])], m: { t: 'orbit', a: 40, b: 24, p: 6 } }),
        ];
    },

    sea(rng) {
        const waves = [0, 1, 2].map(i => P([curve(t => [40 + t * 160, 104 + i * 18 + Math.sin(t * Math.PI * 4 + i * 0.9) * 5], 64)],
            { m: drift(4 + i, 3 + i * 0.7) }));
        const out = [];
        if (rng() < 0.6) {
            const hull = [[98, 97], [104, 107], [136, 107], [142, 97], [98, 97]];
            const sail = [[121, 62], [121, 93], [144, 93], [121, 62]];
            out.push(P([hull, seg(120, 97, 120, 60), sail], {
                f: [F(hull, ['clay', 'paper']), F(sail, ['tomato', 'butter', 'paper'])],
                m: [bob(3, 2.6), sway(120, 104, 4, 2.6)],
            }));
            out.push(P([ring(190, 42, 11)], { f: F(ring(190, 42, 11), ['butter', 'tomato']), m: pulse(190, 42, 0.06, 3) }));
        } else {
            [[84, 52, 1.5], [134, 38, 1.2], [170, 62, 1]].forEach(([x, y, s]) =>
                out.push(P(bird(x, y, s), { m: [drift(10, 8), { t: 'flap', x, y, p: 0.8 }] })));
        }
        return [...out, ...waves];
    },

    fire(rng) {
        const outer = thru([104, 128], [95, 110], [103, 88], [116, 72], [118, 52], [132, 72], [145, 92], [142, 114], [134, 128], [104, 128]);
        const inner = thru([114, 126], [110, 112], [118, 98], [122, 86], [130, 104], [128, 120], [122, 126], [114, 126]);
        return [
            P([seg(80, 146, 160, 130), seg(82, 130, 158, 146)]),
            P([outer], { f: F(outer, ['tomato', 'butter', 'clay']), m: flicker(120, 128, 0.1, 1.1) }),
            P([inner], { f: F(inner, ['butter', 'paper']), m: flicker(121, 126, 0.14, 0.8) }),
            ...[108, 124, 136].map((x, i) => P([seg(x, 60, x + 1, 56)], { m: rise(x, 60, 36, 1.6 + rng() * 0.6, i / 3, 5) })),
        ];
    },

    bulb(rng) {
        const glassPts = arc(120, 70, 30, 31, 118, 422);
        const rays = [150, 190, 228, 312, 350, 30].map(a => ray(120, 70, a, 40, 51));
        return [
            P([seg(120, 0, 120, 39)], { m: sway(120, 0, 5, 3.4), k: [
                P(rays, { m: pulse(120, 70, 0.1, 1.5) }),
                P([glassPts, thru([106, 97], [108, 106], [110, 114]), thru([134, 97], [132, 106], [130, 114]),
                    seg(108, 115, 132, 115), seg(109, 122, 131, 121), seg(113, 129, 127, 129)],
                    { f: H(glassPts, ['butter', 'paper']) }),
                P([thru([112, 99], [114, 80], [118, 88], [122, 78], [126, 88], [128, 99])], { m: flicker(120, 99, 0.12, 0.6) }),
            ] }),
        ];
    },

    question(rng) {
        const small = (x, y, s) => [
            thru([x - 6 * s, y - 12 * s], [x - 4 * s, y - 20 * s], [x + 2 * s, y - 22 * s], [x + 7 * s, y - 16 * s], [x + 2 * s, y - 8 * s], [x, y - 2 * s]),
            ring(x, y + 5 * s, 1.2 * s),
        ];
        const dot = ring(120, 126, 4);
        return [
            P([thru([96, 62], [100, 42], [120, 32], [142, 40], [146, 60], [132, 76], [121, 88], [120, 106])], { m: sway(120, 106, 6, 2.6) }),
            P([dot], { f: F(dot, ['tomato', 'butter', 'ink']), m: { t: 'hop', x: 120, y: 130, a: 9, p: 1.2 } }),
            P(small(62, 70, 1), { m: twinkle(62, 62, 0.3, 2.6) }),
            P(small(182, 120, 0.8), { m: twinkle(182, 112, 0.3, 3.1) }),
        ];
    },

    book(rng) {
        const L = [...thru([120, 70], [100, 60], [78, 60], [60, 66]), [60, 134], ...thru([60, 134], [82, 128], [104, 130], [120, 140])];
        const R = [...thru([120, 70], [140, 60], [162, 60], [180, 66]), [180, 134], ...thru([180, 134], [158, 128], [136, 130], [120, 140])];
        const scrib = (x0, x1, y) => curve(t => [x0 + (x1 - x0) * t, y + Math.sin(t * 17) * 1.3], 24);
        return [
            P([L, R, seg(120, 70, 120, 140)], { f: [H(L, ['paper', 'butter', 'clay']), H(R, ['paper', 'butter', 'clay'])], m: bob(2, 4.5), k: [
                P([scrib(70, 106, 82), scrib(70, 100, 96), scrib(70, 108, 110), scrib(133, 170, 81), scrib(134, 166, 95), scrib(133, 160, 109)]),
            ] }),
            ...[0, 1, 2].map(i => {
                const x = 104 + i * 16;
                return P([curve(t => [x + t * 8, 56 + Math.sin(t * 9) * 1.2], 10)], { m: rise(x + 4, 56, 30, 3, i / 3, 5) });
            }),
        ];
    },

    pencil(rng) {
        const loops = curve(t => [36 + 58 * t - 6 * Math.sin(t * TAU * 4), 136 - 12 * t - 6 * Math.cos(t * TAU * 4) + 6], 90);
        const [tx, ty] = loops[loops.length - 1];
        const deg = -38;
        const body = rot(mv([[16, -6], [76, -6], [76, 6], [16, 6], [16, -6]], tx, ty), deg, tx, ty);
        const cone = rot(mv([[16, -6], [0, 0], [16, 6]], tx, ty), deg, tx, ty);
        const lead = rot(mv([[5, -2], [0, 0], [5, 2]], tx, ty), deg, tx, ty);
        const band = rot(mv([[82, -6], [82, 6]], tx, ty), deg, tx, ty);
        const cap = rot(mv([[82, -6], [90, -5], [93, 0], [90, 5], [82, 6]], tx, ty), deg, tx, ty);
        const path = evenly(loops, 16).map(([x, y]) => [r1(x - tx), r1(y - ty)]);
        const beat = { p: 3.6, ph: 0, dur: 0.55, on: 0.86, lock: 1 };
        return [
            P([loops], { m: { t: 'draw', ...beat } }),
            P([body, cone, lead, band, cap], { f: [F(body, ['butter', 'tomato']), F(cap, ['blush', 'tomato'])], m: { t: 'follow', pts: path, ...beat } }),
        ];
    },

    paint(rng) {
        const swoosh = curve(t => [46 + 128 * t, 128 - 18 * Math.sin(Math.PI * t) + 6 * Math.sin(3 * Math.PI * t)], 48);
        const [tx, ty] = swoosh[swoosh.length - 1];
        const deg = -52;
        const tuft = rot(mv(thru([0, 0], [8, -6], [16, -5], [18, 0], [16, 5], [8, 6], [0, 0]), tx, ty), deg, tx, ty);
        const ferrule = rot(mv([[18, -5], [30, -4], [30, 4], [18, 5]], tx, ty), deg, tx, ty);
        const handle = rot(mv(thru([30, -3], [60, -2.5], [74, 0], [60, 2.5], [30, 3]), tx, ty), deg, tx, ty);
        const path = evenly(swoosh, 12).map(([x, y]) => [r1(x - tx), r1(y - ty)]);
        const beat = { p: 3.8, ph: 0, dur: 0.5, on: 0.86, lock: 1 };
        return [
            P([swoosh], { paint: ['tomato', 'sky', 'butter', 'blush'], m: { t: 'draw', ...beat } }),
            P([tuft, ferrule, handle], { f: F(tuft, ['tomato', 'sky', 'butter', 'blush']), m: { t: 'follow', pts: path, ...beat } }),
            ...[[70, 60], [182, 52]].map(([x, y]) => P([glint(x, y, 5)], { m: twinkle(x, y, 0.4, 2.2) })),
        ];
    },

    music(rng) {
        const head = (x, y) => rot(arc(x, y, 7.5, 5.2, 0, 372), -22, x, y);
        const single = (x, y) => [head(x, y), seg(x + 6.5, y - 2, x + 6.5, y - 40), thru([x + 6.5, y - 40], [x + 15, y - 32], [x + 18, y - 22], [x + 14, y - 15])];
        const colours = ['lilac', 'butter', 'blush', 'tomato'];
        const [a, b] = [[122, 112], [156, 104]];
        return [
            P(single(76, 118), { f: F(head(76, 118), colours), m: { t: 'hop', x: 76, y: 124, a: 7, p: 1.15, ph: 0 } }),
            P([head(...a), head(...b), seg(a[0] + 6.5, a[1] - 2, a[0] + 6.5, a[1] - 40), seg(b[0] + 6.5, b[1] - 2, b[0] + 6.5, b[1] - 40),
                seg(a[0] + 6.5, a[1] - 40, b[0] + 6.5, b[1] - 40), seg(a[0] + 6.5, a[1] - 34, b[0] + 6.5, b[1] - 34)],
                { f: [F(head(...a), colours), F(head(...b), colours)], m: [{ t: 'hop', x: 140, y: 116, a: 6, p: 1.15, ph: 0.5 }, sway(140, 116, 4, 2.3)] }),
            P([glint(186, 50, 5)], { m: twinkle(186, 50, 0.4, 1.7) }),
            P([glint(52, 56, 4)], { m: twinkle(52, 56, 0.4, 2.3) }),
        ];
    },

    mountain(rng) {
        const range = [[28, 142], [88, 74], [114, 104], [150, 56], [212, 142]];
        const flag = [[150, 32], [168, 37], [150, 43], [150, 32]];
        const cl = lumpy(62, 42, 22, 10, 2.5);
        return [
            P([cl], { f: F(cl, ['paper', 'sky']), m: drift(8, 9) }),
            P([range, [[139, 70], [145, 76], [150, 71], [155, 77], [161, 70]]], { f: F([...range, [28, 142]], ['sage', 'forest', 'sky', 'lilac']) }),
            P([seg(150, 56, 150, 32)]),
            P([flag], { f: F(flag, ['tomato', 'butter']), m: sway(150, 37, 9, 0.8) }),
            P([ground(142, 22, 218)]),
        ];
    },

    walk(rng) {
        const prints = [[116, 164, -1], [112, 146, 1], [106, 128, -1], [110, 112, 1], [120, 98, -1], [124, 86, 1]];
        const sun = ring(188, 40, 10);
        return [
            P([thru([20, 76], [60, 64], [100, 74]), thru([140, 72], [180, 60], [222, 74])]),
            P([thru([62, 178], [92, 146], [86, 118], [112, 92], [118, 74]), thru([168, 178], [146, 146], [126, 118], [136, 92], [126, 74])]),
            ...prints.map(([x, y, s], i) => {
                const k = 1 - i * 0.09;
                return P([rot(arc(x + s * 5 * k, y, 3.2 * k, 5 * k, 0, 372), s * 12, x, y)], { m: { t: 'appear', p: 3.6, ph: -i * 0.1, on: 0.62, lock: 1 } });
            }),
            P([sun], { f: F(sun, ['butter', 'tomato']), m: pulse(188, 40, 0.07, 2.6) }),
        ];
    },

    birds(rng) {
        const spots = [[70, 56, 1.7], [128, 36, 1.4], [176, 66, 1.15], [110, 86, 0.95]].slice(0, 3 + (rng() < 0.4 ? 1 : 0));
        return [
            ...spots.map(([x, y, s]) => P(bird(x, y, s), { m: [drift(12, 7), { t: 'flap', x, y, p: 0.75 + rng() * 0.3 }] })),
            ...[118, 138].map((y, i) => P([thru([40 + i * 24, y], [90 + i * 20, y - 3], [140 + i * 16, y + 2], [160 + i * 14, y - 6], [152 + i * 14, y - 14], [142 + i * 14, y - 8])],
                { m: drift(6, 3.5) })),
        ];
    },

    kite(rng) {
        const kx = 146, ky = 56;
        const diamond = [[kx, ky - 30], [kx + 22, ky], [kx, ky + 34], [kx - 22, ky], [kx, ky - 30]];
        const tail = thru([kx, ky + 34], [kx + 7, ky + 50], [kx - 2, ky + 64], [kx + 6, ky + 80]);
        const bow = (x, y) => [[x - 6, y - 4], [x + 6, y + 4], [x + 6, y - 4], [x - 6, y + 4], [x - 6, y - 4]];
        return [
            P([ground(152, 34, 104)]),
            P([diamond, seg(kx, ky - 30, kx, ky + 34), seg(kx - 22, ky, kx + 22, ky), thru([kx, ky + 34], [120, 108], [92, 136], [70, 150])], {
                f: F(diamond, ['tomato', 'butter', 'sky', 'blush']),
                m: sway(70, 150, 5, 3.2),
                k: [P([tail, bow(kx + 7, ky + 50), bow(kx - 2, ky + 66)], { f: [F(bow(kx + 7, ky + 50), ['butter', 'sky']), F(bow(kx - 2, ky + 66), ['butter', 'sky'])], m: sway(kx, ky + 34, 12, 1.1) })],
            }),
        ];
    },

    ball(rng) {
        const bx = 120, gy = 142, r = 17, by = gy - r;
        const disc = ring(bx, by, r);
        const beat = { p: 1.3, ph: 0, lock: 1 };
        return [
            P([ground(gy)]),
            P([arc(bx, gy + 4, 16, 3, 0, 372)], { m: { t: 'shadow', x: bx, y: gy + 4, ...beat } }),
            P([disc, seg(bx, by - r, bx, by + r), seg(bx - r, by, bx + r, by),
                arc(bx - r * 1.45, by, r * 0.9, r * 1.1, -42, 42), arc(bx + r * 1.45, by, r * 0.9, r * 1.1, 138, 222)],
                { f: F(disc, ['tomato', 'clay', 'butter']), m: { t: 'hop', x: bx, y: gy, a: 58, ...beat } }),
        ];
    },

    wheel(rng) {
        const cx = 120, cy = 72, R = 46, turn = { p: 20, ph: 0, lock: 1 };
        const spokes = [];
        const cabins = [];
        const paints = [['tomato', 'butter'], ['butter', 'sky'], ['sky', 'blush'], ['blush', 'lilac']];
        for (let i = 0; i < 8; i++) {
            const a = i * 45;
            spokes.push(ray(cx, cy, a, 7, R));
            if (i % 2) continue;
            const [px, py] = ray(cx, cy, a, R, R)[0];
            const cup = [...thru([px - 8, py + 5], [px - 6, py + 15], [px, py + 17], [px + 6, py + 15], [px + 8, py + 5]), [px - 8, py + 5]];
            cabins.push(P([seg(px, py, px, py + 5), cup], { f: F(cup, paints[i / 2]), m: { t: 'spin', x: r1(px), y: r1(py), dir: -1, ...turn } }));
        }
        return [
            P([seg(cx, cy, cx - 34, 150), seg(cx, cy, cx + 34, 150), ground(150, 50, 190)]),
            P([ring(cx, cy, R), ring(cx, cy, 7), ...spokes], { m: { t: 'spin', x: cx, y: cy, ...turn }, k: cabins }),
        ];
    },

    clock(rng) {
        const face = ring(120, 88, 40);
        const bellL = [...arc(92, 52, 14, 12, 180, 360), [78, 52]];
        const bellR = [...arc(148, 52, 14, 12, 180, 360), [134, 52]];
        const ticks = [];
        for (let i = 0; i < 12; i++) ticks.push(ray(120, 88, i * 30, i % 3 ? 34 : 30, 37));
        return [
            P([face, bellL, bellR, seg(120, 48, 120, 40), seg(96, 122, 88, 136), seg(144, 122, 152, 136), ...ticks], {
                f: [H(face, ['paper', 'butter', 'sky', 'clay']), F(bellL, ['butter', 'tomato']), F(bellR, ['butter', 'tomato'])],
                m: { t: 'ring', x: 120, y: 132, a: 7, p: 4.5 },
                k: [
                    P([seg(120, 88, 120, 66)], { m: spin(120, 88, 48) }),
                    P([seg(120, 88, 146, 88)], { m: spin(120, 88, 8) }),
                ],
            }),
        ];
    },

    house(rng) {
        const walls = [[80, 142], [80, 98], [160, 98], [160, 142]];
        const roof = [[70, 102], [120, 58], [170, 102], [70, 102]];
        const win = [[134, 108], [150, 108], [150, 124], [134, 124], [134, 108]];
        return [
            P([ground(142)]),
            P([walls], { f: H([...walls, [80, 142]], ['blush', 'butter', 'clay', 'paper']) }),
            P([[[140, 78], [140, 60], [152, 60], [152, 88]]]),
            P([roof], { f: F(roof, ['tomato', 'plum', 'clay']) }),
            P([], { f: F(win, ['butter', 'paper']), m: { t: 'glow', p: 3 } }),
            P([win, seg(142, 108, 142, 124), seg(134, 116, 150, 116), [[108, 142], [108, 116], [126, 116], [126, 142]], ring(122, 130, 1.4)]),
            ...[0, 1, 2].map(i => P([ring(146, 50, 4 + i * 1.2)], { m: rise(146, 50, 28, 3.2, i / 3, 5) })),
        ];
    },

    eye(rng) {
        const iris = arc(120, 90, 19, 19, -80, 290);
        const pupil = ring(120, 90, 6);
        return [
            P([thru([56, 92], [88, 66], [120, 58], [152, 66], [184, 92]), thru([56, 92], [88, 114], [120, 122], [152, 114], [184, 92]),
                seg(84, 70, 77, 58), seg(103, 61, 100, 48), seg(124, 58, 125, 45), seg(146, 63, 151, 51), seg(164, 73, 172, 63)], {
                m: blink(120, 90, 4.2),
                k: [P([iris, pupil], { f: [H(iris, ['sky', 'lilac', 'sage', 'butter', 'tomato']), F(pupil, ['ink'])], m: { t: 'float', a: 5, p: 5 } })],
            }),
        ];
    },

    spiral(rng) {
        return [
            P([curve(t => {
                const a = t * TAU * 3.1, r = 3 + t * 46;
                return [120 + Math.cos(a) * r, 90 + Math.sin(a) * r * 0.92];
            }, 150)], { m: spin(120, 90, 7) }),
            ...[[58, 44], [184, 138], [190, 50]].map(([x, y]) => P([glint(x, y, 5)], { m: twinkle(x, y, 0.4, 1.4 + rng()) })),
        ];
    },

    cloud(rng) {
        const cl = puff(130, 62, 54, 28, 7);
        return [
            P([ring(78, 114, 7)], { m: bob(3, 2.4) }),
            P([ring(60, 134, 4.5)], { m: bob(3, 2.4) }),
            P([cl], { f: H(cl, ['paper', 'sky', 'lilac', 'blush']), m: bob(3, 4.5), k:
                [112, 130, 148].map((x, i) => P([ring(x, 64, 2.6)], { f: F(ring(x, 64, 2.6), ['ink']), m: { t: 'appear', p: 1.8, ph: -i * 0.18, on: 0.7, lock: 1 } })),
            }),
        ];
    },

    screen(rng) {
        const lid = [[72, 50], [168, 50], [168, 116], [72, 116], [72, 50]];
        const rows = [[84, 124, 64], [92, 148, 76], [92, 134, 88], [84, 112, 100]];
        return [
            P([lid, [[72, 116], [58, 130], [182, 130], [168, 116]], seg(108, 124, 132, 124)], { f: H(lid, ['sky', 'lilac', 'paper', 'butter', 'night']) }),
            ...rows.map(([x0, x1, y], i) => P([seg(x0, y, x1, y)], { m: { t: 'draw', p: 4.4, ph: 0, s: i * 0.14, dur: 0.12, on: 0.84, lock: 1 } })),
            P([seg(118, 95, 118, 105)], { m: { t: 'appear', p: 1, on: 0.5, lock: 1 } }),
        ];
    },

    bowl(rng) {
        const lower = arc(120, 96, 50, 40, 0, 180);
        const back = arc(120, 96, 50, 9, 180, 360);
        const food = thru([78, 95], [92, 82], [110, 78], [130, 80], [150, 84], [162, 95]);
        return [
            P([seg(132, 84, 186, 42), seg(138, 88, 194, 50)], { m: sway(135, 86, 3, 3) }),
            P([food], { f: F([...food, [120, 100]], ['butter', 'paper']) }),
            P([lower, arc(120, 96, 50, 9, 0, 372), [[104, 135], [108, 142], [132, 142], [136, 135]]], { f: F([...lower, ...back], ['clay', 'tomato', 'sky']) }),
            ...[106, 124].map((x, i) => P([wisp(x, 70, 22, i)], { m: rise(x, 70, 12, 2.6, i / 2, 2) })),
        ];
    },

    cat(rng) {
        const head = ring(112, 70, 22);
        const body = thru([100, 88], [90, 110], [87, 138], [110, 141], [134, 138], [134, 112], [124, 88]);
        const earL = [[95, 58], [97, 40], [108, 50]];
        const earR = [[116, 49], [127, 40], [129, 58]];
        const coat = ['butter', 'blush', 'clay', 'paper'];
        return [
            P([ground(141, 50, 190)]),
            P([thru([132, 134], [154, 130], [166, 114], [160, 98], [150, 96])], { m: sway(132, 134, 14, 1.8) }),
            P([body], { f: H(body, coat) }),   // the same coat as the head, which holds a face
            P([head, earL, earR, [[110, 76], [112, 78], [114, 76]], thru([107, 80], [112, 83], [117, 80]),
                seg(92, 74, 80, 72), seg(92, 78, 80, 81), seg(132, 74, 144, 72), seg(132, 78, 144, 81)], {
                f: [H(head, coat), H([...earL, earL[0]], coat), H([...earR, earR[0]], coat)],
                m: sway(112, 92, 4, 4.2),
                k: [P([arc(104, 68, 2, 3, 0, 372), arc(120, 68, 2, 3, 0, 372)], { f: [F(arc(104, 68, 2, 3, 0, 372), ['ink']), F(arc(120, 68, 2, 3, 0, 372), ['ink'])], m: blink(112, 68, 5) })],
            }),
        ];
    },

    list(rng) {
        const paper = rot([[78, 32], [162, 32], [162, 148], [78, 148], [78, 32]], -3, 120, 90);
        return [
            P([paper], { f: H(paper, ['paper', 'butter', 'sky', 'clay']) }),
            ...[60, 90, 120].flatMap((y, i) => [
                P([rot([[88, y - 8], [100, y - 8], [100, y + 4], [88, y + 4], [88, y - 8]], -3, 120, 90),
                    rot(curve(t => [108 + (42 - i * 8) * t, y - 2 + Math.sin(t * 15) * 1.2], 20), -3, 120, 90)]),
                P([rot([[89, y - 3], [94, y + 2], [104, y - 13]], -3, 120, 90)], { m: { t: 'draw', p: 5, ph: 0, s: 0.08 + i * 0.2, dur: 0.1, on: 0.9, lock: 1 } }),
            ]),
        ];
    },

    kolam(rng) {
        const cx = 120, cy = 90, g = 31;
        const dots = [];
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) dots.push([cx + i * g, cy + j * g]);
        const dot = 2.8;
        const petal = th => curve(t => {
            const r = 56 * Math.sin(Math.PI * t) ** 0.8, a = th + (t - 0.5) * 1.5;
            return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
        }, 44);
        return [
            ...[0, 1, 2, 3].map(i => P([petal(i * Math.PI / 2 - Math.PI / 2)], { m: { t: 'draw', p: 7, ph: 0, s: i * 0.1, dur: 0.16, on: 0.88, lock: 1 } })),
            ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j], k) =>
                P([ring(cx + i * g, cy + j * g, 11)], { m: { t: 'draw', p: 7, ph: 0, s: 0.42 + k * 0.06, dur: 0.1, on: 0.88, lock: 1 } })),
            ...dots.map(([x, y], i) => P([ring(x, y, dot)], {
                f: F(ring(x, y, dot), i === 4 ? ['tomato', 'butter', 'ink'] : ['ink']),
                m: twinkle(x, y, 0.35, 2 + rng()),
            })),
        ];
    },

    snail(rng) {
        const shell = ring(112, 118, 20);
        return [
            P([ground(144)]),
            P([thru([78, 141], [100, 141], [140, 141], [158, 139], [166, 130], [164, 118], [156, 114], [148, 120], [146, 132])], { m: drift(5, 10), k: [
                P([shell, curve(t => {
                    const a = t * TAU * 2.2, r = 17 * (1 - t) + 1;
                    return [112 + Math.cos(a) * r, 118 + Math.sin(a) * r];
                }, 60)], { f: H(shell, ['butter', 'blush', 'clay', 'lilac']) }),
                P([seg(158, 116, 162, 100), seg(151, 116, 148, 102), ring(162, 99, 2.2), ring(148, 101, 2.2)], { m: sway(155, 116, 9, 2.2) }),
            ] }),
        ];
    },
};

export const SCENE_NAMES = Object.keys(SCENES);

// ─── Knowing what to draw ────────────────────────────────────
// Words say what a line is about. Specific words (s) count double; the
// general ones (w) break ties. Colours are the pages this sits on best.

const W = (s, w, c) => ({ s: s && new RegExp(`\\b(?:${s})\\b`, 'g'), w: w && new RegExp(`\\b(?:${w})\\b`, 'g'), c });

export const MOTIFS = {
    rain:     W('rain\\w*|storm\\w*|drizzl\\w*|monsoon|umbrella\\w*|thunder\\w*|downpour', 'wet|showers?|grey|gray|cloudy', ['sky', 'night', 'lilac']),
    sun:      W('sun|suns|sunny|sunshine|summer|sunlight|daylight', 'bright\\w*|warm\\w*|light|glow\\w*|shine|shining|hot day', ['butter', 'tomato', 'sky', 'clay']),
    sunrise:  W('sunrise|dawn|daybreak', 'morning\\w*|wake|woke|waking|early|routine\\w*|begin\\w*|fresh|today', ['butter', 'blush', 'sky']),
    night:    W('night\\w*|moon\\w*|midnight|evening\\w*', 'dark\\w*|late|stars?', ['night', 'plum']),
    sleep:    W('sleep\\w*|slept|naps?|napping|bedtime|insomnia|dream\\w*', 'tired|bed|rest\\w*|exhaust\\w*|calm\\w*|quiet', ['night', 'lilac', 'plum']),
    stars:    W('stars?|starry|universe|cosm\\w*|galax\\w*|planet\\w*|constellation\\w*', 'sky|space|wish\\w*|magic\\w*|infinite', ['night', 'plum', 'lilac']),
    cup:      W('coffee|tea|chai|cafe|latte|espresso|mug|kaapi|cappuccino', 'cups?|sip\\w*|brew\\w*', ['clay', 'blush', 'butter']),
    glass:    W('water|chug\\w*|hydrat\\w*|juice|thirst\\w*|litres?|liters?', 'drink\\w*|glass(?:es)?', ['sky', 'lilac', 'sage']),
    heart:    W('love\\w*|loving|heart\\w*|hug\\w*|grateful|gratitude|affection\\w*|crush', 'miss(?:ing)?|kind\\w*|care|caring|dear\\w*|thank\\w*|cute|together|friend\\w*|empath\\w*', ['blush', 'tomato', 'plum']),
    sprout:   W('grow\\w*|grew|seeds?|sprout\\w*|hydroponic\\w*|seedling\\w*', 'learn\\w*|habit\\w*|progress\\w*|start\\w*|new|roots?|practi[cs]e\\w*|improv\\w*|evolv\\w*|evolution', ['sage', 'forest', 'butter']),
    tree:     W('trees?|forest\\w*|leaf|leaves|autumn|woods', 'nature|natural|branch\\w*|patien\\w*|ecolog\\w*|earth|green', ['forest', 'sage', 'clay']),
    flower:   W('flower\\w*|bloom\\w*|blossom\\w*|petal\\w*|lotus|roses?', 'spring|beaut\\w*|pretty|garden\\w*|gentle', ['blush', 'sage', 'butter']),
    sea:      W('sea|seas|ocean\\w*|beach\\w*|swim\\w*|river\\w*|lake\\w*|tide\\w*|boats?|sail\\w*|shore\\w*|island\\w*', 'waves?|float\\w*|flow\\w*|drift\\w*', ['sky', 'night', 'sage']),
    fire:     W('fire\\w*|burn\\w*|flame\\w*|angry|anger|rage|furious|fuck\\w*', 'passion\\w*|energ\\w*|excit\\w*|hot|intens\\w*|frustrat\\w*|damn|urgent', ['tomato', 'clay', 'night']),
    bulb:     W('ideas?|insight\\w*|eureka|epiphan\\w*|invent\\w*|brainstorm\\w*', 'realis\\w*|realiz\\w*|figur\\w*|clever|concept\\w*|brilliant|solution\\w*|genius|what if', ['butter', 'night', 'forest']),
    book:     W('read|reading|books?|novel\\w*|poem\\w*|poet\\w*|chapter\\w*|librar\\w*|wikipedia', 'stor(?:y|ies)|author\\w*|essay\\w*|article\\w*|philosoph\\w*|histor\\w*|theor\\w*|study|studying', ['clay', 'sage', 'plum', 'forest']),
    pencil:   W('writ\\w*|wrote|journal\\w*|diary|sketch\\w*|draw\\w*|figma|typeface\\w*|font\\w*', 'notes?|draft\\w*|design\\w*|illustrat\\w*|forms?', ['butter', 'sky', 'lilac']),
    paint:    W('paint\\w*|artist\\w*|museum\\w*|galler\\w*|realism|romanticism|canvas\\w*', 'art|arts|colou?rs?|aesthetic\\w*|craft\\w*|visual\\w*', ['lilac', 'blush', 'sky', 'butter']),
    music:    W('music\\w*|songs?|sing\\w*|sang|melod\\w*|playlist\\w*|guitar\\w*|piano|album\\w*|hip hop|rap|soundscape\\w*', 'listen\\w*|sound\\w*|band|danc\\w*|beats?|rhythm\\w*|tunes?', ['lilac', 'butter', 'blush', 'plum']),
    mountain: W('mountain\\w*|climb\\w*|peak\\w*|summit\\w*|trek\\w*|hik\\w*', 'hard|difficult\\w*|challeng\\w*|hill\\w*|effort\\w*|struggl\\w*|goals?|ambitio\\w*', ['forest', 'sky', 'sage']),
    walk:     W('walk\\w*|running|roads?|travel\\w*|journey\\w*|trip\\w*|commut\\w*|footsteps?', 'run|path\\w*|went|going|moving|city|street\\w*|way|steps?', ['sage', 'clay', 'butter']),
    birds:    W('birds?|wind\\w*|breeze\\w*|flying|flew|freedom', 'fly|free|air|escape\\w*|let go|letting go|leav\\w*|change\\w*|shift\\w*', ['sky', 'butter', 'lilac']),
    kite:     W('play|playing|playful\\w*|kites?|toys?', 'fun|joy\\w*|laugh\\w*|happ(?:y|iness)|kids?|child\\w*|delight\\w*|whims\\w*|wonder\\w*', ['butter', 'sky', 'tomato']),
    ball:     W('games?|gaming|gamif\\w*|basketball|football|cricket|sports?|tennis', 'match|team|scores?|win|won|winning|compet\\w*|ball', ['tomato', 'butter', 'sky']),
    wheel:    W('carnival|festival\\w*|theme park|rides?|celebrat\\w*|birthday', 'party|fair|park|holiday\\w*|vacation|weekend|event\\w*', ['blush', 'butter', 'sky']),
    clock:    W('clock\\w*|deadline\\w*|schedul\\w*|alarm\\w*', 'hours?|minutes?|time|wait\\w*|soon|busy|rush\\w*|hurr\\w*|slow\\w*|tonight|tomorrow|pm|am|late', ['butter', 'lilac', 'clay']),
    house:    W('home\\w*|house\\w*|family|mother|mom|mum|amma|appa|dad|father|parents?|kitchen', 'brother\\w*|sister\\w*|room|roof|neighbo\\w*', ['clay', 'blush', 'sage']),
    eye:      W('eyes?|watch\\w*|notic\\w*|observ\\w*|vision|perspective\\w*', 'see|seeing|saw|seen|look\\w*|attention|views?|patterns?|paint an angel', ['lilac', 'sky', 'butter']),
    spiral:   W('confus\\w*|overthink\\w*|anxi\\w*|spiral\\w*|dizzy|chaos|chaotic|overwhelm\\w*|loops?', 'lost|looping|again|circles?|stuck|restless\\w*|messy|swarms?', ['lilac', 'plum', 'tomato']),
    cloud:    W('think\\w*|thought\\w*|mind\\w*|brain\\w*|imagin\\w*|daydream\\w*', 'wonder\\w*|feel\\w*|mood\\w*|rememb\\w*|memor\\w*|curious|curiosity|understand\\w*|idk|maybe', ['sky', 'lilac', 'blush']),
    screen:   W('code|coding|software|apps?|prototyp\\w*|computer\\w*|laptop\\w*|ai|agents?|claude|obsidian|noteworthy|programm\\w*|website\\w*|interface\\w*|ui|ux', 'build\\w*|ship\\w*|product\\w*|screen\\w*|tech\\w*|startup\\w*|machine\\w*|models?|digital|dashboards?', ['night', 'forest', 'lilac']),
    bowl:     W('eat\\w*|ate|food\\w*|lunch\\w*|dinner\\w*|breakfast\\w*|cook\\w*|hungry|meals?|recipe\\w*|rice|dosa|idli|biryani', 'snack\\w*|milk|taste\\w*|delicious', ['clay', 'butter', 'tomato']),
    cat:      W('cats?|kitten\\w*|kitty|dogs?|pupp\\w*|pets?|meow', 'animals?|creature\\w*|furry', ['butter', 'blush', 'sage']),
    list:     W('tasks?|to-?dos?|errands?|chores?|remind\\w*|checklist\\w*', 'lists?|plans?|planning|finish\\w*|done|complet\\w*|organi[sz]\\w*|buy|shop\\w*|work|meeting\\w*|office|emails?', ['tomato', 'butter', 'sky']),
    kolam:    W('kolam\\w*|rangoli|indic|tamil\\w*|tamizh|caste|bharat\\w*|ethno\\w*|temple\\w*', 'india\\w*|culture\\w*|cultural\\w*|traditio\\w*|heritage|ritual\\w*|hindu\\w*|desi', ['tomato', 'clay', 'plum', 'forest']),
    question: W('', '', ['lilac', 'sky', 'butter']),
    snail:    W('', '', ['sage', 'lilac', 'night']),
};

// A line with no telling words still has a kind.
const BY_KIND = {
    question:   ['question', 'eye', 'spiral'],
    journal:    ['heart', 'cloud', 'night', 'flower'],
    idea:       ['bulb', 'stars', 'sun'],
    brainstorm: ['cloud', 'bulb', 'kite', 'spiral'],
    reference:  ['book', 'eye', 'mountain'],
    task:       ['list', 'clock'],
    other:      ['sprout', 'flower', 'sun', 'sea', 'birds'],
};

const count = (re, text) => (re && text ? (text.match(re) || []).length : 0);

// Feelings and ways of thinking. When a line names one of these and a thing
// you could point at, the thing makes the better picture: "I love how the
// sea smells" is the sea.
const ABSTRACT = new Set(['heart', 'bulb', 'cloud', 'spiral', 'question', 'eye', 'sprout', 'walk', 'pencil', 'list', 'sleep', 'sunrise']);

/**
 * What to draw for a line. The line itself speaks loudest; the rest of the
 * note and its tags lean in. Returns a scene name.
 */
export function motifFor(text, { body = '', tags = [], category = 'other', seed = 0, avoid = null } = {}) {
    const line = String(text || '').toLowerCase();
    const rest = String(body || '').toLowerCase().slice(0, 1500);
    const tagText = (tags || []).join(' ').toLowerCase().replace(/[-_]/g, ' ');
    const scores = Object.entries(MOTIFS).map(([name, m]) => {
        const strong = count(m.s, line);
        let s = 3 * (2 * strong + count(m.w, line))
            + Math.min(3, 2 * count(m.s, rest) + 0.5 * count(m.w, rest))
            + (2 * count(m.s, tagText) + count(m.w, tagText));
        // Between two things the line names, the one it names first is
        // usually what it is about: "filter coffee with amma" is coffee
        if (strong) s += 0.6 * (1 - line.search(m.s) / Math.max(1, line.length)) + (ABSTRACT.has(name) ? 0 : 1);
        return [name, s];
    });
    if (/\?["'”’)]*\s*$/.test(line)) scores.find(([n]) => n === 'question')[1] += 2.5;

    const rng = rngFrom(seed);
    scores.forEach(x => { x[1] += rng() * 0.01; });   // ties go to chance, the same chance each time
    scores.sort((a, b) => b[1] - a[1]);
    let [best, top] = scores[0];
    if (top < 2) {
        const set = BY_KIND[category] || BY_KIND.other;
        best = set[Math.floor(rng() * set.length)];
        if (best === avoid) best = set[(set.indexOf(best) + 1) % set.length];
        return best;
    }
    // Two mornings in a row of the same picture, when the words would bear another
    if (best === avoid && scores[1][1] >= top * 0.7) best = scores[1][0];
    return best;
}

/** The page a motif sits on, never the same as the day before. */
export function colourFor(motif, seed, avoidId = null) {
    const list = (MOTIFS[motif] || MOTIFS.sprout).c;
    let i = hash(`${seed}|colour`) % list.length;
    if (list[i] === avoidId) i = (i + 1) % list.length;
    if (list[i] === avoidId) return PALETTE.find(p => p.id !== avoidId);
    return paletteById(list[i]);
}

// ─── Drawing a scene ─────────────────────────────────────────

const VARIANTS = 3;   // drawings of each line, cycled so it seems to breathe

function partSVG(part, ctx) {
    const moves = settle(part.m, ctx.rng);
    const loop = moves?.some(m => m.t === 'draw');
    let inner = '';
    (Array.isArray(part.f) ? part.f : part.f ? [part.f] : []).forEach(f => {
        const fill = pickPaint(f.c, ctx.bg, f.holds);
        if (!fill) return;
        const i = ctx.n;
        const ds = ctx.ways.map(v => `${handFor(f.pts, rngFrom(hash(`${ctx.seed}|f${i}|${ctx.fills++}|${v}`)))}Z`);
        // Colour is printed a little off the line, the way a second ink never
        // quite registers; ink itself is the line's own, and sits true
        const off = fill === 'currentColor' ? '' : ' transform="translate(2.6 2.2)"';
        inner += `<path class="dd-fill" d="${ds[0]}"${ds.length > 1 ? ` data-b="${ds.slice(1).join('|')}"` : ''}${off} style="fill:${fill};--i:${i}"/>`;
    });
    const paint = part.paint && pickPaint(part.paint, ctx.bg);
    (part.s || []).forEach(st => {
        if (!st || st.length < 2) return;
        const i = ctx.n++;
        const ds = ctx.ways.map(v => handFor(st, rngFrom(hash(`${ctx.seed}|${i}|${v}`))));
        const cls = [paint ? 'dd-paint' : '', loop ? 'dd-loop' : ''].filter(Boolean).join(' ');
        inner += `<path${cls ? ` class="${cls}"` : ''} d="${ds[0]}"${ds.length > 1 ? ` data-b="${ds.slice(1).join('|')}"` : ''} pathLength="1" style="--i:${i}${paint ? `;stroke:${paint}` : ''}"/>`;
    });
    (part.k || []).forEach(k => { inner += partSVG(k, ctx); });
    if (!moves || !ctx.alive) return inner;
    return `<g data-m="${esc(JSON.stringify(moves))}">${inner}</g>`;
}

/**
 * A scene as SVG markup. `bg` is the ground it will sit on, which decides
 * its fills. `alive` adds what it needs to move; call wake() once it is in
 * the page. Without it, it is a still drawing — for the strip, and for
 * anyone who has asked their phone for less motion.
 */
export function sceneSVG(name, seed, { cls = 'dd', bg = PAPER.light.bg, alive = true, label = '' } = {}) {
    const build = SCENES[name] || SCENES.sprout;
    const s = typeof seed === 'number' ? seed : hash(String(seed));
    const rng = rngFrom(s);
    const parts = build(rng);
    const moving = alive && !reducedMotion();
    const ctx = { seed: s, n: 0, fills: 0, bg, alive: moving, rng: rngFrom(s ^ 0x9e3779b9), ways: moving ? [0, 1, 2].slice(0, VARIANTS) : [0] };
    const body = parts.map(p => partSVG(p, ctx)).join('');
    return `<svg class="${cls}" viewBox="0 0 240 180" data-scene="${name}"${moving ? ' data-alive' : ''}`
        + `${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'}>${body}</svg>`;
}

// ─── Your own drawing, alive ─────────────────────────────────
// What you draw is read the way a child's drawing is: a long flat line
// near the bottom is the ground and stays put; a closed shape floats if it
// is high up and breathes if it is not, and carries what is drawn inside
// it; a tall stroke rooted low sways from its foot, with whatever sits on
// its top; a long flat stroke drifts; a speck twinkles. Only a little —
// it is still your drawing.

/** Your line as you drew it — smoothed, never straightened. */
export function inkPath(pts) {
    if (!pts.length) return '';
    const [x0, y0] = pts[0];
    if (pts.length === 1) return `M${r1(x0)} ${r1(y0)}l0.1 0.1`;
    let d = `M${r1(x0)} ${r1(y0)}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const [x, y] = pts[i], [nx, ny] = pts[i + 1];
        d += `Q${r1(x)} ${r1(y)} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
    }
    const [lx, ly] = pts[pts.length - 1];
    return `${d}L${r1(lx)} ${r1(ly)}`;
}

function strokeFacts(pts) {
    const e = extent(pts);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const gap = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
    let foot = pts[0];
    pts.forEach(p => { if (p[1] > foot[1]) foot = p; });
    let head = pts[0];
    pts.forEach(p => { if (p[1] < head[1]) head = p; });
    return { ...e, len, closed: len > 24 && gap < Math.max(8, len * 0.16), cx: e.x0 + e.w / 2, cy: e.y0 + e.h / 2, foot, head, area: e.w * e.h };
}

function readInk(lines) {
    const facts = lines.map(strokeFacts);
    const all = extent(lines.flat());
    const size = Math.max(all.w, all.h, 40);
    const rng = rngFrom(hash(lines.map(l => l.length).join('.') + (lines[0]?.[0] || []).join(',')));
    const role = facts.map(f => {
        if (f.w > all.w * 0.5 && f.h < size * 0.14 && f.y1 > all.y0 + all.h * 0.6) return 'ground';
        if (Math.max(f.w, f.h) < size * 0.09) return 'speck';
        if (f.closed) return 'body';
        if (f.h > f.w * 1.7 && f.foot[1] > all.y0 + all.h * 0.5) return 'stem';
        if (f.w > f.h * 2.2) return 'streak';
        return 'loose';
    });

    const owner = facts.map(() => -1);
    // A shape carries what is drawn inside it: eyes in a face, a door in a house
    facts.map((f, i) => i).filter(i => role[i] === 'body').sort((a, b) => facts[b].area - facts[a].area).forEach(b => {
        const B = facts[b];
        facts.forEach((f, i) => {
            if (i === b || owner[i] !== -1 || role[i] === 'ground' || owner[b] === i) return;
            if (f.area < B.area && f.cx > B.x0 && f.cx < B.x1 && f.cy > B.y0 && f.cy < B.y1) owner[i] = b;
        });
    });
    // A stem carries what sits on its top: a flower, a leaf, a head
    facts.forEach((S, s) => {
        if (role[s] !== 'stem' || owner[s] !== -1) return;
        facts.forEach((f, i) => {
            if (i === s || owner[i] !== -1 || role[i] === 'ground' || role[i] === 'stem') return;
            const near = Math.hypot(f.cx - S.head[0], Math.min(Math.abs(f.y1 - S.head[1]), Math.abs(f.cy - S.head[1])));
            if (near < size * 0.18 || (f.x0 <= S.head[0] && f.x1 >= S.head[0] && f.y0 <= S.head[1] + size * 0.05 && f.y1 >= S.head[1] - size * 0.05)) owner[i] = s;
        });
    });

    const moveFor = i => {
        const f = facts[i];
        const k = size / 240;
        switch (role[i]) {
            case 'ground': return null;
            case 'speck': return twinkle(f.cx, f.cy, owner[i] === -1 ? 0.35 : 0.2, 1.6 + rng() * 1.6);
            case 'body': return owner[i] !== -1 ? null
                : f.cy < all.y0 + all.h * 0.45 ? { t: 'float', a: 3 * k + 1, p: 4.5 } : pulse(f.cx, f.y1, 0.03, 3.4);
            case 'stem': return sway(f.foot[0], f.foot[1], 4, 3.4);
            case 'streak': return owner[i] !== -1 ? null : drift(3 * k + 1, 5.5);
            default: return owner[i] !== -1 ? null : bob(1.5 * k + 0.5, 4);
        }
    };
    const node = i => ({ i, m: moveFor(i), k: facts.map((_, j) => j).filter(j => owner[j] === i).map(node) });
    return { parts: facts.map((_, i) => i).filter(i => owner[i] === -1).map(node), rng };
}

/** The strokes of a drawing as markup, moving if `alive`. */
export function inkMarkup(lines, { alive = true } = {}) {
    lines = lines.filter(l => l.length);
    if (!lines.length) return '';
    const moving = alive && !reducedMotion();
    const { parts, rng } = readInk(lines);
    const seed = hash(lines.map(l => l.length).join('|'));
    const draw = ({ i, m, k }) => {
        const pts = lines[i];
        const ds = moving
            ? [inkPath(pts), ...[1, 2].map(v => inkPath(waver(pts, rngFrom(hash(`${seed}|${i}|${v}`)), 0.7)))]
            : [inkPath(pts)];
        const inner = `<path d="${ds[0]}"${ds.length > 1 ? ` data-b="${ds.slice(1).join('|')}"` : ''} pathLength="1" style="--i:${i}"/>`
            + k.map(draw).join('');
        const moves = moving && settle(m, rng);
        return moves ? `<g data-m="${esc(JSON.stringify(moves))}">${inner}</g>` : inner;
    };
    return parts.map(draw).join('');
}

// ─── Waking them ─────────────────────────────────────────────
// One clock for every living doodle on the page. It runs at twelve frames
// a second, the way drawn animation is shot, not at the screen's sixty —
// motion that steps reads as drawn — and the line re-draws itself five
// times a second, the "boil" that makes a still drawing look awake.

const FPS = 12;
const BOIL = 5;
const living = new Map();   // svg → { t0, gs, bs, held, vis, frame }
let raf = 0;
let idle = 0;               // nothing on screen is moving: look again in a while
let rested = false;

function kick() {
    if (idle) { clearTimeout(idle); idle = 0; rested = true; }
    if (!raf && living.size) raf = requestAnimationFrame(tick);
}

export const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function visible(el) {
    if (el.checkVisibility) return el.checkVisibility();
    return el.getClientRects().length > 0;
}

function entryFor(svg) {
    const gs = [...svg.querySelectorAll('g[data-m]')].map(el => {
        let m = [];
        try { m = JSON.parse(el.getAttribute('data-m')); } catch { /* a still part, then */ }
        return { el, m, loops: [...el.querySelectorAll(':scope > path.dd-loop')], tf: '', op: '', dash: '' };
    });
    const bs = [...svg.querySelectorAll('path[data-b]')].map(el => ({ el, ds: [el.getAttribute('d'), ...el.getAttribute('data-b').split('|')], at: 0 }));
    return { t0: performance.now() / 1000, gs, bs, held: false, vis: true, frame: -1 };
}

/** Start everything alive under `root`. `again` re-reads a doodle whose insides changed. */
export function wake(root, { again = false } = {}) {
    if (!root || reducedMotion()) return;
    const svgs = root.matches?.('svg[data-alive]') ? [root] : [...root.querySelectorAll('svg[data-alive]')];
    svgs.forEach(svg => {
        if (living.has(svg) && !again) return;
        const old = living.get(svg);
        const e = entryFor(svg);
        if (old) { e.t0 = old.t0; e.held = old.held; }
        living.set(svg, e);
    });
    kick();
}

/** Hold a doodle still at rest (you are drawing on it), or let it go again. */
export function hold(svg, still) {
    const e = svg && living.get(svg);
    if (!e) return;
    e.held = still;
    if (!still) { kick(); return; }
    e.gs.forEach(g => {
        g.el.removeAttribute('transform'); g.el.removeAttribute('opacity');
        g.loops.forEach(p => { p.style.strokeDashoffset = ''; });
        g.tf = g.op = g.dash = '';
    });
    e.bs.forEach(b => { if (b.at) { b.el.setAttribute('d', b.ds[0]); b.at = 0; } });
}

function tick(now) {
    raf = 0;
    const frame = Math.floor(now / (1000 / FPS));
    const look = rested;
    rested = false;
    let moving = false;
    for (const [svg, e] of living) {
        if (!svg.isConnected) { living.delete(svg); continue; }
        if (e.held) continue;
        if (e.frame !== frame) {
            if (look || frame % FPS === 0 || e.frame === -1) e.vis = visible(svg);
            e.frame = frame;
            // A frame's timestamp can fall a moment before the doodle woke
            if (e.vis) paint(e, Math.max(0, Math.floor((now / 1000 - e.t0) * FPS) / FPS));
        }
        if (e.vis) moving = true;
    }
    if (!living.size) return;
    // Every doodle is held, or behind another screen: stop asking for frames
    if (moving) raf = requestAnimationFrame(tick);
    else idle = setTimeout(() => { idle = 0; rested = true; kick(); }, 1000);
}

function paint(e, t) {
    const way = Math.floor(Math.max(0, t) * BOIL) % VARIANTS;
    e.bs.forEach(b => {
        const w = way % b.ds.length;
        if (w !== b.at) { b.el.setAttribute('d', b.ds[w]); b.at = w; }
    });
    e.gs.forEach(g => {
        const { tf, op, dash } = moveAt(g.m, t);
        if (tf !== g.tf) { if (tf) g.el.setAttribute('transform', tf); else g.el.removeAttribute('transform'); g.tf = tf; }
        const o = op >= 0.999 ? '' : op.toFixed(2);
        if (o !== g.op) { if (o) g.el.setAttribute('opacity', o); else g.el.removeAttribute('opacity'); g.op = o; }
        const d = dash === undefined ? '' : dash.toFixed(3);
        if (d !== g.dash) { g.loops.forEach(p => { p.style.strokeDashoffset = d; }); g.dash = d; }
    });
}

/** For a still frame at a chosen moment — how the gallery checks the motion. */
export function paintAt(svg, t) {
    const e = entryFor(svg);
    paint(e, t);
}

/* ============================================================
   Noteworthy — days.js
   One page a morning, after grug: a line the notebook hands back
   from your own writing, and something you draw for it.
   ============================================================ */

import * as api from './api.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NS = 'http://www.w3.org/2000/svg';

// ─── Dates ───────────────────────────────────────────────────
// Pages are local calendar days, keyed YYYY-MM-DD so they sort as strings.

export function dayKey(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function keyToDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function shiftKey(key, n) {
    const d = keyToDate(key);
    d.setDate(d.getDate() + n);
    return dayKey(d);
}

/** 18.9 — day first, the way the rest of the app writes dates. */
export function shortDate(key) {
    const d = keyToDate(key);
    return `${d.getDate()}.${d.getMonth() + 1}`;
}

function longDate(key) {
    return keyToDate(key).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ─── Seeded chance ───────────────────────────────────────────
// Everything on a page is drawn from its date, so a page is the same page
// every time you come back to it — a morning, not a slot machine.

function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    // Mixed once more at the end: dates differ only in their last characters,
    // and without this neighbouring days came out in the same colour.
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

function rngFrom(seed) {
    let a = typeof seed === 'number' ? seed : hash(String(seed));
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── The line ────────────────────────────────────────────────
// Verbatim, never rewritten: the page quotes you, it does not paraphrase you.
// What it does do is choose — a sentence that stands up on its own, short
// enough to read at a glance, out of a note that may be three paragraphs.

const LINE_MIN = 18;
const LINE_MAX = 150;

function tidy(s) {
    return s.replace(/^\s*(?:[-*•>]+|\d+[.)])\s+/, '').replace(/^#+\s+/, '').replace(/\s+/g, ' ').trim();
}

function unfit(s) {
    if (s.length < LINE_MIN || s.length > LINE_MAX) return true;
    if (/https?:\/\/|www\.|\S+@\S+\.\S+/i.test(s)) return true;     // links and addresses
    if (/[{}<>=;|`]|\\[a-z]/i.test(s)) return true;                   // code, and \task-style commands
    if (/:\s*$/.test(s)) return true;                                 // a heading for what follows
    if ((s.match(/[A-Z]/g) || []).length > s.length * 0.35) return true;
    if (s.split(/\s+/).length < 3) return true;
    return false;
}

function scoreLine(s, whole) {
    let score = 1;
    const n = s.length;
    // Short enough to read in one breath, like the lines this is modelled on
    if (n >= 30 && n <= 110) score += 2;
    else if (n >= 24 && n <= 135) score += 1;
    // A sentence, not a title: "Systems design, dynamics and theories" is a
    // shelf label, and a page quoting it back reads like a filing cabinet.
    if (/[.?!…]["'”’)]*$/.test(s)) score += 1;
    else score -= 1;
    if (/\?["'”’)]*$/.test(s)) score += 0.5;
    if (whole) score += 1.5;                                           // a whole thought, not a piece of one
    if (/^(and|but|so|or|because|which|then|also|like)\b/i.test(s)) score -= 1.5;
    if (!whole && /^(this|that|it|these|those|he|she|they)\b/i.test(s)) score -= 1;
    if (/\b(I|I'm|I've|I'd|my|me|we|our|you)\b/.test(s)) score += 0.75;   // a voice, not a reference
    if (/^[A-Z][\w.' -]{1,24}:\s/.test(s)) score -= 2;                // "Reminder: …", "Shreya Chakravarty: …"
    const words = s.split(/\s+/).filter(w => w.length > 3);
    if (words.length >= 3 && words.filter(w => /^[A-Z]/.test(w)).length / words.length > 0.6) score -= 1.5;
    if ((s.match(/,/g) || []).length >= 3 && !/[.?!]["'”’)]*$/.test(s)) score -= 1.5;   // a list of topics
    return score;
}

// What kind of note it was says something too: a task is an errand, and a
// reference is usually somebody else's words or a title to look up.
const KIND_WEIGHT = { task: -1.5, reference: -0.75 };

// "[30/06, 10:28 am] Shreya: …" — a pasted chat is somebody else talking, and
// the page signs every line with your name.
const CHAT_EXPORT = /^\s*\[\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?,?\s+\d{1,2}:\d{2}/m;

/** The best line in a note, or null if nothing in it can stand alone. */
export function lineFrom(note) {
    const body = api.stripDerived(note?.raw_text || '');
    if (!body || CHAT_EXPORT.test(body)) return null;

    const options = [];
    const paras = body.split(/\n+/).map(tidy).filter(Boolean);
    // Lines only run together into one quote if they were written as
    // sentences. Three bare lines joined with spaces read as one run-on.
    const joins = paras.slice(0, -1).every(p => /[.?!…]["'”’)]*$/.test(p));
    const whole = joins ? paras.join(' ') : null;
    if (whole && !unfit(whole)) options.push({ text: whole, score: scoreLine(whole, true) });

    paras.forEach(para => {
        const sentences = para.split(/(?<=[.!?…])\s+(?=["'“‘(]?[A-Z0-9])/).map(s => s.trim());
        sentences.forEach((s, i) => {
            if (s !== whole && !unfit(s)) options.push({ text: s, score: scoreLine(s, false) });
            const pair = sentences[i + 1] ? `${s} ${sentences[i + 1]}` : null;
            if (pair && pair !== whole && !unfit(pair)) options.push({ text: pair, score: scoreLine(pair, false) + 0.25 });
        });
    });

    if (!options.length) return null;
    const best = options.sort((a, b) => b.score - a.score)[0];
    return { ...best, score: best.score + (KIND_WEIGHT[note.category] || 0) };
}

// ─── Dealing the pages ───────────────────────────────────────

const REACH = 60;        // how many mornings the strip goes back
const CHAIN = 730;       // dealing starts this far back at most, so a page holds as the strip slides
const REST = 21;         // a line that came back stays away this long
const SETTLE = 3;        // days before something you wrote can come back to you
const GOOD = 4;          // below this a line only comes back when there is nothing better

function writtenByYou(n) {
    return n && n.created_at && (n.raw_text || '').trim()
        && !api.isDiscoverNote(n) && !api.isLogisticsNote(n) && !api.isReadingNote(n);
}

function weighted(items, rng) {
    let total = 0;
    const w = items.map(p => { const x = Math.max(0.2, p.score) ** 2; total += x; return x; });
    let r = rng() * total;
    for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
}

const isQuestion = text => /\?["'”’)]*$/.test(text || '');

/**
 * Every morning from the day after your first note up to today. Page D can
 * only draw on what was written before D, so writing today never changes
 * today's page, and nothing you add later rewrites a morning already dealt.
 * A page you drew on keeps the line you drew for.
 */
export function dealPages(notes, { today = new Date(), seed = '', kept = new Map() } = {}) {
    const byId = new Map(notes.map(n => [n.id, n]));
    const todayKey = dayKey(today);

    const wrote = new Map();
    notes.forEach(n => {
        if (!n.created_at || api.isDiscoverNote(n)) return;
        const k = dayKey(n.created_at);
        if (!wrote.has(k)) wrote.set(k, []);
        wrote.get(k).push(n);
    });

    const lines = notes.filter(writtenByYou).map(n => {
        const best = lineFrom(n);
        return best && {
            noteId: n.id, text: best.text, score: best.score,
            written: n.created_at, at: new Date(n.created_at).getTime(),
            profile: n.profile, category: n.category || 'other',
        };
    }).filter(Boolean).sort((a, b) => a.at - b.at);
    const good = lines.filter(l => l.score >= GOOD);
    const pool = good.length >= 3 ? good : lines;

    const pages = [];
    const recent = [];
    let prevColor = -1;
    let prevDoodle = null;
    let key = pool.length ? shiftKey(dayKey(pool[0].at), 1) : todayKey;
    const floor = shiftKey(todayKey, -CHAIN);
    if (key < floor) key = floor;
    const shownFrom = [shiftKey(todayKey, -(REACH - 1)), key].sort()[1];

    for (; key <= todayKey; key = shiftKey(key, 1)) {
        const start = keyToDate(key).getTime();
        const rng = rngFrom(`${seed}|${key}`);
        const k = kept.get(key);

        let line = null;
        if (k?.line?.noteId && byId.has(k.line.noteId)) {
            line = { category: 'other', ...k.line, at: new Date(k.line.written).getTime() };
        } else {
            const notRecent = p => !recent.includes(p.noteId);
            let from = pool.filter(p => p.at < start - SETTLE * 86400000 && notRecent(p));
            if (!from.length) from = pool.filter(p => p.at < start && notRecent(p));
            if (!from.length) from = pool.filter(p => p.at < start);
            if (from.length) line = weighted(from, rng);
        }
        if (line) { recent.push(line.noteId); if (recent.length > REST) recent.shift(); }

        let color = hash(`${seed}|${key}|colour`) % PALETTE.length;
        if (color === prevColor) color = (color + 1) % PALETTE.length;
        prevColor = color;

        // A question gets a question's picture half the time, not every time
        const asked = line && isQuestion(line.text) && rng() < 0.5;
        const set = DOODLE_SETS[asked ? 'question' : (line?.category || 'other')] || DOODLE_SETS.other;
        let d = hash(`${seed}|${key}|doodle`) % set.length;
        if (set[d] === prevDoodle) d = (d + 1) % set.length;
        const doodle = set[d];
        prevDoodle = doodle;

        if (key < shownFrom) continue;
        pages.push({
            key, line, doodle,
            today: key === todayKey,
            color: key === todayKey ? null : PALETTE[color],
            seed: hash(`${seed}|${key}|ink`),
            strokes: k?.strokes || [],
            wrote: (wrote.get(key) || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
        });
    }
    return pages;
}

// ─── Colour ──────────────────────────────────────────────────
// Flat, full-bleed, one per morning. Today is paper, because today is the
// page you have not drawn on yet.

const PALETTE = [
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

const PAPER = {
    light: { bg: '#fbfaf5', ink: '#161616' },
    dark:  { bg: '#161513', ink: '#efe9dc' },
};

// ─── A hand ──────────────────────────────────────────────────
// Doodles are described as plain geometry and drawn through a hand that
// drifts off true and back. Seeded by the date, so each morning's flower is
// its own flower, and the same one when you come back.

const r1 = n => Math.round(n * 10) / 10;

/** Catmull-Rom through the given points, sampled densely. */
function thru(...pts) {
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

function arc(cx, cy, rx, ry, a0, a1) {
    const n = Math.max(10, Math.round(Math.abs(a1 - a0) / 7));
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
        pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return pts;
}

function curve(fn, n = 48) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(fn(i / n));
    return pts;
}

/** Ray from a centre, between two radii. */
function ray(cx, cy, deg, from, to) {
    const a = deg * Math.PI / 180;
    return [[cx + Math.cos(a) * from, cy + Math.sin(a) * from], [cx + Math.cos(a) * to, cy + Math.sin(a) * to]];
}

/** A line of scribbled "writing". */
function scrib(x0, x1, y) {
    return curve(t => [x0 + (x1 - x0) * t, y + Math.sin(t * 17) * 1.3], 24);
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

function smooth(pts) {
    let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} `
            + `${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
    }
    return d;
}

function hand(pts, rng, amp = 1.4) {
    if (pts.length < 2) return '';
    const p = resample(pts, 4);
    const n = p.length;
    const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
    const fr = [0.5 + rng() * 0.8, 1.8 + rng() * 1.5, 4.5 + rng() * 3];
    const out = p.map((pt, i) => {
        const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        const t = i / Math.max(1, n - 1);
        const w = amp * (0.6 * Math.sin(t * fr[0] * 6.283 + ph[0])
            + 0.3 * Math.sin(t * fr[1] * 6.283 + ph[1])
            + 0.12 * Math.sin(t * fr[2] * 6.283 + ph[2]));
        return [pt[0] + nx * w, pt[1] + ny * w];
    });
    return smooth(out);
}

// ─── Doodles ─────────────────────────────────────────────────
// A 240 × 180 box. The kind of line picks the family; the date picks which.

const DOODLES = {
    sprout: () => [
        thru([48, 142], [95, 140], [150, 143], [194, 140]),
        thru([121, 141], [119, 122], [122, 104], [120, 86]),
        thru([120, 97], [106, 82], [86, 77], [95, 92], [120, 97]),
        thru([121, 90], [134, 72], [157, 65], [150, 83], [121, 90]),
    ],
    flower: () => {
        const cx = 120, cy = 48;
        const petals = [-90, -18, 54, 126, 198].map(deg => {
            const r = deg * Math.PI / 180;
            const ox = cx + Math.cos(r) * 13, oy = cy + Math.sin(r) * 13;
            return curve(t => {
                const th = t * Math.PI * 2.1;
                const x = Math.cos(th) * 13, y = Math.sin(th) * 7.5;
                return [ox + x * Math.cos(r) - y * Math.sin(r), oy + x * Math.sin(r) + y * Math.cos(r)];
            }, 30);
        });
        return [
            ...petals,
            thru([121, 56], [117, 78], [124, 100], [119, 120], [122, 132]),
            thru([38, 132], [100, 131], [160, 134], [204, 130]),
            arc(122, 138, 9, 5, 0, 375),
            thru([114, 141], [100, 149], [90, 160], [76, 162]),
            thru([130, 140], [146, 146], [157, 157], [171, 153]),
            thru([121, 143], [118, 155], [125, 166]),
        ];
    },
    heart: () => [
        curve(t => {
            const a = 0.15 + t * (Math.PI * 2 + 0.3);
            const x = 16 * Math.sin(a) ** 3;
            const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
            return [118 + x * 3, 82 + y * 3];
        }, 80),
        [[64, 136], [176, 44]],
        [[176, 44], [160, 47]], [[176, 44], [170, 59]],
        [[72, 129], [60, 128]], [[72, 129], [70, 141]],
        [[80, 122], [68, 121]], [[80, 122], [78, 134]],
    ],
    sun: () => [
        thru([34, 132], [90, 128], [150, 129], [206, 134]),
        arc(120, 130, 38, 36, 184, 356),
        ...[204, 232, 260, 288, 316, 340].map(a => ray(120, 128, a, 50, 66)),
    ],
    moon: () => [
        thru([140, 48], [110, 55], [94, 84], [103, 116], [138, 128]),
        thru([138, 128], [121, 110], [117, 88], [123, 66], [140, 48]),
        [[172, 56], [182, 56]], [[177, 51], [177, 61]],
        [[186, 102], [196, 102]], [[191, 97], [191, 107]],
        [[156, 146], [163, 146]], [[159.5, 142.5], [159.5, 149.5]],
    ],
    cloud: () => [
        curve(t => {
            const a = t * Math.PI * 2 * 1.04;
            const s = Math.sin(a);
            const bump = 1 + 0.22 * Math.abs(Math.sin(a * 3.5));
            return [120 + Math.cos(a) * 62 * (s < 0 ? bump * 0.95 : 1), 92 + (s < 0 ? s * 32 * bump : s * 12)];
        }, 96),
        [[92, 122], [86, 136]], [[118, 124], [112, 140]], [[144, 122], [138, 136]],
    ],
    bulb: () => [
        arc(120, 70, 30, 31, 118, 422),
        thru([106, 97], [108, 106], [110, 114]),
        thru([134, 97], [132, 106], [130, 114]),
        [[108, 115], [132, 115]], [[109, 122], [131, 121]], [[113, 129], [127, 129]],
        thru([112, 99], [114, 80], [118, 88], [122, 78], [126, 88], [128, 99]),
        ...[212, 246, 280, 314, 348].map(a => ray(120, 70, a, 40, 52)),
    ],
    question: () => [
        thru([96, 62], [100, 42], [120, 32], [142, 40], [146, 60], [132, 76], [121, 88], [120, 106]),
        arc(120, 126, 3.5, 3.5, 0, 390),
    ],
    book: () => [
        thru([120, 70], [100, 60], [78, 60], [60, 66]),
        [[60, 66], [60, 134]],
        thru([60, 134], [82, 128], [104, 130], [120, 140]),
        thru([120, 70], [140, 60], [162, 60], [180, 66]),
        [[180, 66], [180, 134]],
        thru([180, 134], [158, 128], [136, 130], [120, 140]),
        [[120, 70], [120, 140]],
        scrib(70, 106, 82), scrib(70, 100, 96), scrib(70, 108, 110),
        scrib(133, 170, 81), scrib(134, 166, 95), scrib(133, 160, 109),
    ],
    rock: () => [
        thru([36, 142], [100, 141], [160, 143], [206, 141]),
        thru([66, 141], [70, 118], [88, 99], [114, 90], [142, 94], [164, 108], [174, 126], [172, 141]),
        thru([118, 92], [122, 106], [114, 116], [118, 128]),
        [[30, 104], [50, 104]], [[24, 118], [48, 118]], [[34, 90], [52, 91]],
        [[186, 141], [183, 131]], [[191, 141], [193, 128]], [[196, 141], [201, 133]],
    ],
    spiral: () => [
        curve(t => {
            const a = t * Math.PI * 2 * 3.1;
            const r = 3 + t * 46;
            return [120 + Math.cos(a) * r, 90 + Math.sin(a) * r * 0.92];
        }, 150),
    ],
    cave: () => [
        thru([34, 141], [100, 140], [160, 142], [206, 140]),
        [[64, 141], [64, 118], ...arc(120, 118, 56, 62, 180, 360), [176, 118], [176, 141]],
        arc(120, 141, 20, 28, 180, 360),
    ],
    fire: () => [
        thru([104, 128], [95, 110], [103, 88], [116, 72], [118, 52], [132, 72], [145, 92], [142, 114], [134, 128], [104, 128]),
        thru([114, 126], [110, 112], [118, 98], [122, 86], [130, 104], [128, 120], [122, 126]),
        [[80, 146], [160, 130]], [[82, 130], [158, 146]],
    ],
    eye: () => [
        thru([56, 92], [88, 66], [120, 58], [152, 66], [184, 92]),
        thru([56, 92], [88, 114], [120, 122], [152, 114], [184, 92]),
        arc(120, 90, 19, 19, -80, 290),
        arc(120, 90, 6, 6, 0, 380),
        [[84, 70], [77, 58]], [[103, 61], [100, 48]], [[124, 58], [125, 45]], [[146, 63], [151, 51]], [[164, 73], [172, 63]],
    ],
    mountain: () => [
        [[30, 142], [90, 72], [116, 104], [150, 58], [210, 142]],
        [[78, 86], [90, 80], [99, 90], [106, 85]],
        [[26, 142], [214, 142]],
        arc(188, 50, 12, 12, 0, 380),
    ],
    star: () => {
        const pts = [];
        for (let k = 0; k <= 5; k++) {
            const a = (-90 + k * 144) * Math.PI / 180;
            pts.push([120 + Math.cos(a) * 48, 94 + Math.sin(a) * 48]);
        }
        pts.push([pts[0][0] + (pts[1][0] - pts[0][0]) * 0.14, pts[0][1] + (pts[1][1] - pts[0][1]) * 0.14]);
        return [
            pts,
            [[176, 46], [186, 46]], [[181, 41], [181, 51]],
            [[56, 138], [64, 138]], [[60, 134], [60, 142]],
            [[184, 130], [191, 130]], [[187.5, 126.5], [187.5, 133.5]],
        ];
    },
    wave: () => [
        ...[0, 1, 2].map(i => curve(t => [44 + t * 152, 88 + i * 22 + Math.sin(t * Math.PI * 4 + i * 0.9) * 7], 64)),
        [[140, 46], [147, 52], [152, 47], [157, 52], [164, 46]],
        [[168, 60], [173, 64], [177, 61], [181, 64], [186, 59]],
    ],
};

const DOODLE_SETS = {
    question:   ['question', 'spiral', 'eye'],
    journal:    ['heart', 'moon', 'cave', 'flower'],
    idea:       ['bulb', 'star', 'sun'],
    brainstorm: ['cloud', 'fire', 'wave', 'star'],
    reference:  ['book', 'mountain', 'eye'],
    task:       ['rock', 'mountain'],
    other:      ['sprout', 'flower', 'wave', 'sun'],
};

function doodlePaths(name, seed) {
    const rng = rngFrom(seed);
    const make = DOODLES[name] || DOODLES.sprout;
    return make().map(pts => hand(pts, rng));
}

function doodleSVG(name, seed, cls) {
    const paths = doodlePaths(name, seed)
        .map((d, i) => `<path d="${d}" pathLength="1" style="--i:${i}"/>`).join('');
    return `<svg class="${cls}" viewBox="0 0 240 180" aria-hidden="true">${paths}</svg>`;
}

// ─── Your drawing ────────────────────────────────────────────
// Stored as one string per stroke, because Firestore will not keep an array
// of arrays. Points are tenths of a unit in the same 240 × 180 box.

function encodeStroke(pts) {
    return pts.map(([x, y]) => `${Math.round(x * 10)},${Math.round(y * 10)}`).join(' ');
}

function decodeStroke(s) {
    return String(s || '').split(' ').filter(Boolean).map(p => p.split(',').map(v => Number(v) / 10));
}

/** Your line as you drew it — smoothed, never straightened. */
function inkPath(pts) {
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

/**
 * A drawing is made on whatever shape of paper the phone had that morning,
 * so it is framed by its own edges rather than the doodle box — never
 * smaller than the doodles, so a small drawing is not blown up either.
 */
function inkBox(lines, minW, pad) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    lines.forEach(pts => pts.forEach(([x, y]) => {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }));
    if (!isFinite(x0)) return `0 0 ${minW} ${minW * 0.75}`;
    let w = Math.max(x1 - x0 + pad * 2, minW), h = Math.max(y1 - y0 + pad * 2, minW * 0.75);
    if (w / h > 4 / 3) h = w * 0.75; else w = h * 4 / 3;
    return `${r1((x0 + x1 - w) / 2)} ${r1((y0 + y1 - h) / 2)} ${r1(w)} ${r1(h)}`;
}

function inkSVG(strokes, cls, minW = 240) {
    const lines = strokes.map(decodeStroke);
    const paths = lines.map((pts, i) => `<path d="${inkPath(pts)}" pathLength="1" style="--i:${i}"/>`).join('');
    return `<svg class="${cls} is-ink" viewBox="${inkBox(lines, minW, minW / 24)}" aria-hidden="true">${paths}</svg>`;
}

/** Today's paper: the whole blank space, in the doodles' units across. */
function canvasSVG(strokes, art) {
    const w = art.clientWidth, h = art.clientHeight;
    const tall = w && h ? r1(240 * h / w) : 180;
    const paths = strokes.map(s => `<path d="${inkPath(decodeStroke(s))}"/>`).join('');
    return `<svg class="days-canvas" viewBox="0 0 240 ${tall}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}

// The small marks the page is built from, drawn by the same hand.
function arrowUpSVG(seed) {
    const rng = rngFrom(seed);
    const d = [
        [[15, 40], [15, 11]],
        [[7, 19], [15, 10], [23, 19]],
        thru([9, 50], [15, 54], [21, 50]),
    ].map(p => `<path d="${hand(p, rng, 0.5)}"/>`).join('');
    return `<svg class="days-arrow" viewBox="0 0 30 64" aria-hidden="true">${d}</svg>`;
}

function ovalSVG(seed) {
    const rng = rngFrom(seed);
    return `<svg class="days-oval-ring" viewBox="0 0 60 120" preserveAspectRatio="none" aria-hidden="true">`
        + `<path d="${hand(arc(30, 60, 26, 56, -100, 268), rng, 1)}"/></svg>`;
}

function pointerSVG(seed) {
    const rng = rngFrom(seed);
    const d = [
        thru([74, 6], [52, 12], [30, 28], [14, 50]),
        [[13, 36], [13, 51], [27, 47]],
    ].map(p => `<path d="${hand(p, rng, 0.6)}"/>`).join('');
    return `<svg class="days-pointer" viewBox="0 0 80 60" aria-hidden="true">${d}</svg>`;
}

// ─── State ───────────────────────────────────────────────────

const S = {
    hooks: null,
    open: false,
    profile: null,
    notes: null,
    pages: [],
    at: -1,
    kept: new Map(),      // date → { strokes, line, updated_at } for this notebook
    loading: null,
    wipeArmed: false,
    saveTimer: null,
    lastMove: 0,          // -1 back in time, 1 forward, for the way a page comes in
    themeColor: null,
};

const INTRO_KEY = 'nw_days_intro_seen';
const keptKey = profile => `nw_days_${profile}`;

function readKept(profile) {
    try {
        const raw = JSON.parse(localStorage.getItem(keptKey(profile)) || '{}');
        return new Map(Object.entries(raw));
    } catch { return new Map(); }
}

function writeKept(profile, kept) {
    try { localStorage.setItem(keptKey(profile), JSON.stringify(Object.fromEntries(kept))); }
    catch { /* storage full or blocked — Firestore still has it */ }
}

const canDraw = () => !!S.profile && S.profile !== 'combined';

// ─── Loading ─────────────────────────────────────────────────

async function load() {
    const profile = S.hooks.profile();
    if (!profile) return;
    if (profile !== S.profile) {
        S.profile = profile;
        S.notes = null;
        S.pages = [];
        S.at = -1;
        S.kept = canDraw() ? readKept(profile) : new Map();
        render();
    }

    const run = (async () => {
        const [notes, drawn] = await Promise.all([
            api.getNotesAPI(profile),
            canDraw() ? api.getDayDrawingsAPI(profile).catch(() => []) : [],
        ]);
        if (profile !== S.profile) return;
        drawn.forEach(d => {
            const mine = S.kept.get(d.date);
            if (!mine || (d.updated_at || '') >= (mine.updated_at || '')) {
                S.kept.set(d.date, { strokes: d.strokes || [], line: d.line || null, updated_at: d.updated_at || '' });
            }
        });
        if (canDraw()) writeKept(profile, S.kept);
        S.notes = notes;
        deal();
        render();
    })();
    S.loading = run;
    try { await run; }
    catch (e) {
        console.warn('Days load failed:', e.message);
        if (!S.notes) { S.notes = []; deal(); render(); }
    } finally {
        if (S.loading === run) S.loading = null;
    }
}

function deal() {
    const todayKey = dayKey(new Date());
    const wasOn = S.pages[S.at]?.key;
    S.pages = dealPages(S.notes || [], { seed: S.profile, kept: S.kept });
    if (!S.pages.length) S.pages = [{ key: todayKey, line: null, today: true, color: null, doodle: 'sprout', seed: hash(todayKey), strokes: [], wrote: [] }];
    const i = wasOn ? S.pages.findIndex(p => p.key === wasOn) : -1;
    S.at = i >= 0 ? i : S.pages.length - 1;
}

// ─── Painting ────────────────────────────────────────────────

function colorsFor(page) {
    if (page?.color) return page.color;
    return PAPER[S.hooks.theme() === 'light' ? 'light' : 'dark'];
}

function setThemeColor(bg) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (S.themeColor === null) S.themeColor = meta.getAttribute('content') || '';
    meta.setAttribute('content', bg);
}

function nameFor(profile) {
    return (api.PROFILE_NAMES[profile] || 'you').toLowerCase();
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function render() {
    const view = $('days-view');
    if (!view) return;
    const page = S.pages[S.at];
    const { bg, ink } = colorsFor(page);
    view.style.setProperty('--days-bg', bg);
    view.style.setProperty('--days-ink', ink);
    view.classList.toggle('is-paper', !page?.color);
    if (S.open) setThemeColor(bg);

    renderArt(page);
    renderWords(page);
    renderStrip();
}

function renderArt(page) {
    const art = $('days-art');
    const drawing = !!page?.today && canDraw();
    // The notes arriving re-render the page you are already looking at. If
    // nothing in the picture changed, leave it — above all mid-stroke.
    const shows = page && S.notes !== null ? `${page.key}|${drawing}|${page.strokes.length}` : '';
    if (art.dataset.shows === shows && shows) return;
    art.dataset.shows = shows;

    art.classList.remove('is-drawing', 'is-fresh');
    void art.offsetWidth;

    if (!shows) { art.innerHTML = ''; return; }

    if (drawing) {
        art.innerHTML = `${canvasSVG(page.strokes, art)}
            <div class="days-note ${page.strokes.length ? 'hidden' : ''}" id="days-draw-note">
                <span>you<br>draw<br>for<br>today</span>${pointerSVG(page.seed)}
            </div>
            <div class="days-tools ${page.strokes.length ? '' : 'hidden'}" id="days-tools">
                <button type="button" class="days-tool" id="days-undo">undo</button>
                <button type="button" class="days-tool" id="days-wipe">wipe</button>
            </div>`;
        art.classList.add('is-drawing');
        bindDrawing(art.querySelector('.days-canvas'), page.key);
        $('days-undo').addEventListener('click', undoStroke);
        $('days-wipe').addEventListener('click', wipeStrokes);
        return;
    }

    art.innerHTML = page.strokes.length
        ? inkSVG(page.strokes, 'days-picture')
        : doodleSVG(page.doodle, page.seed, 'days-picture');
    art.classList.add('is-fresh');
}

function renderWords(page) {
    const words = $('days-words');
    const sig = $('days-sig');
    const aside = $('days-aside');
    const block = $('days-text');
    block.classList.remove('from-left', 'from-right');
    void block.offsetWidth;
    if (S.lastMove) block.classList.add(S.lastMove < 0 ? 'from-left' : 'from-right');

    if (S.notes === null) {
        words.textContent = 'reading the notebook…';
        words.disabled = true;
        sig.textContent = '';
        aside.hidden = true;
        return;
    }

    if (!page?.line) {
        words.textContent = 'write a few things down. from tomorrow, one of them comes back to you here every morning.';
        words.disabled = true;
        sig.textContent = 'noteworthy.';
    } else {
        words.textContent = page.line.text;
        words.disabled = false;
        sig.textContent = `${nameFor(page.line.profile)}. ${shortDate(dayKey(page.line.written))}`;
    }

    const n = page?.wrote.length || 0;
    aside.hidden = false;
    aside.disabled = n === 0;
    if (page?.today) {
        aside.hidden = n === 0;
        aside.textContent = `today you wrote ${plural(n, 'thing', 'things')} →`;
    } else {
        aside.textContent = n
            ? `on ${shortDate(page.key)} you wrote ${plural(n, 'thing', 'things')} →`
            : `${shortDate(page.key)}. a quiet day.`;
    }
}

function renderStrip() {
    const strip = $('days-strip');
    if (!strip) return;
    const html = S.pages.map((p, i) => {
        if (i === S.at) {
            return `<button type="button" class="days-oval" id="days-oval" data-i="${i}"
                aria-label="Write something — ${esc(longDate(p.key))}">${ovalSVG(p.seed + 1)}${arrowUpSVG(p.seed + 2)}</button>`;
        }
        // Today's own doodle never shows — its page is blank paper — so until
        // you draw, today is marked by a sunrise
        const mini = p.strokes.length ? inkSVG(p.strokes, 'days-mini', 60)
            : doodleSVG(p.today ? 'sun' : p.doodle, p.seed, 'days-mini');
        return `<button type="button" class="days-chip" data-i="${i}" aria-label="${esc(longDate(p.key))}">
            ${mini}<span>${shortDate(p.key)}</span></button>`;
    }).join('') + `<span class="days-chip days-tomorrow" aria-label="Tomorrow's page comes at sunrise">back<br>at sun<br>rise</span>`;
    strip.innerHTML = html;
    centerStrip(false);
}

function centerStrip(smooth = true) {
    const strip = $('days-strip');
    const here = $('days-oval');
    if (!strip || !here) return;
    const left = here.offsetLeft - (strip.clientWidth - here.offsetWidth) / 2;
    strip.scrollTo({ left, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function go(i, { move = 0 } = {}) {
    if (i < 0 || i >= S.pages.length || i === S.at) return;
    S.hooks.tap();
    S.lastMove = move || (i < S.at ? -1 : 1);
    S.at = i;
    S.wipeArmed = false;
    render();
    S.lastMove = 0;     // a later refresh of the same page should not slide it in again
    requestAnimationFrame(() => centerStrip(true));
}

// ─── Drawing ─────────────────────────────────────────────────

/** Pages are re-dealt when the notes arrive, so a stroke finds its page by date. */
const pageFor = key => S.pages.find(p => p.key === key);

function bindDrawing(svg, key) {
    let pts = null, live = null;
    const toBox = e => {
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
        return [p.x, p.y];
    };
    svg.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        svg.setPointerCapture(e.pointerId);
        pts = [toBox(e)];
        live = document.createElementNS(NS, 'path');
        live.setAttribute('d', inkPath(pts));
        svg.appendChild(live);
        $('days-draw-note')?.classList.add('hidden');
    });
    svg.addEventListener('pointermove', e => {
        if (!pts) return;
        // Coalesced events give a fast finger its whole curve; the list can
        // come back empty, and then the event itself is the only point there is
        const evs = e.getCoalescedEvents?.();
        for (const ev of (evs?.length ? evs : [e])) {
            const p = toBox(ev), q = pts[pts.length - 1];
            if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 1.2) pts.push(p);
        }
        live.setAttribute('d', inkPath(pts));
    });
    const end = () => {
        if (!pts) return;
        const page = pageFor(key);
        const stroke = encodeStroke(pts);
        pts = null; live = null;
        if (!page) return;
        page.strokes = [...page.strokes, stroke];
        S.wipeArmed = false;
        drawingChanged(page);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
}

function drawingChanged(page) {
    const has = page.strokes.length > 0;
    $('days-art').dataset.shows = `${page.key}|true|${page.strokes.length}`;
    $('days-tools')?.classList.toggle('hidden', !has);
    $('days-draw-note')?.classList.toggle('hidden', has);
    const wipe = $('days-wipe');
    if (wipe) wipe.textContent = S.wipeArmed ? 'sure?' : 'wipe';

    const entry = {
        strokes: page.strokes,
        line: page.line ? {
            noteId: page.line.noteId, text: page.line.text, written: page.line.written,
            profile: page.line.profile, category: page.line.category,
        } : null,
        updated_at: new Date().toISOString(),
    };
    S.kept.set(page.key, entry);
    writeKept(S.profile, S.kept);

    clearTimeout(S.saveTimer);
    const profile = S.profile;
    S.saveTimer = setTimeout(() => {
        api.saveDayDrawingAPI(profile, page.key, entry)
            .catch(e => console.warn('Could not keep the drawing:', e.message));
    }, 700);
}

function undoStroke() {
    const page = S.pages[S.at];
    if (!page?.strokes.length) return;
    S.hooks.tap();
    page.strokes = page.strokes.slice(0, -1);
    S.wipeArmed = false;
    const svg = $('days-art').querySelector('.days-canvas');
    svg.lastElementChild?.remove();
    drawingChanged(page);
}

/** Two taps, because there is nothing to undo a wipe with. */
function wipeStrokes() {
    const page = S.pages[S.at];
    if (!page?.strokes.length) return;
    S.hooks.tap();
    if (!S.wipeArmed) {
        S.wipeArmed = true;
        $('days-wipe').textContent = 'sure?';
        return;
    }
    S.wipeArmed = false;
    page.strokes = [];
    $('days-art').querySelector('.days-canvas').innerHTML = '';
    drawingChanged(page);
}

// ─── Writing ─────────────────────────────────────────────────

function writeOpen() { return !$('days-write').hidden; }
function listOpen() { return !$('days-list').hidden; }

function openWrite(seedText = '') {
    const sheet = $('days-write');
    const input = $('days-write-input');
    const page = S.pages[S.at];
    sheet.hidden = false;
    sheet.classList.remove('is-kept');
    $('days-write-date').textContent = page && !page.today ? `from ${shortDate(page.key)}` : 'today';
    input.placeholder = page?.today === false ? `anything back for ${shortDate(page.key)}?` : 'what’s true today?';
    if (seedText) input.value += seedText;
    syncWrite();
    requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    });
}

function closeWrite() {
    $('days-write').hidden = true;
    $('days-oval')?.focus({ preventScroll: true });
}

function syncWrite() {
    const input = $('days-write-input');
    $('days-write-send').disabled = !input.value.trim();
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.45)}px`;
}

async function submitWrite() {
    const input = $('days-write-input');
    const text = input.value.trim();
    if (!text) return;
    const send = $('days-write-send');
    send.disabled = true;
    const ok = await S.hooks.write(text);
    if (!ok) { send.disabled = false; return; }
    input.value = '';
    syncWrite();
    const sheet = $('days-write');
    sheet.classList.add('is-kept');
    setTimeout(() => { if (!sheet.hidden) closeWrite(); }, 900);
    // The page's own count of what you wrote catches up once the note lands
    setTimeout(() => { if (S.open) load(); }, 1400);
}

// ─── The day's notes ─────────────────────────────────────────

/** noteTitle stops at 80 characters without saying so. */
const clipped = t => (t.length >= 80 ? `${t.replace(/\s+\S*$/, '')}…` : t);

function openList() {
    const page = S.pages[S.at];
    if (!page?.wrote.length) return;
    S.hooks.tap();
    const time = iso => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    $('days-list-date').textContent = page.today ? 'today' : shortDate(page.key);
    $('days-list-items').innerHTML = page.wrote.map(n => `
        <li><button type="button" class="days-list-item" data-id="${esc(n.id)}">
            <span class="days-list-time">${esc(time(n.created_at))}</span>
            <span class="days-list-title">${esc(clipped(api.noteTitle(n)))}</span>
        </button></li>`).join('');
    $('days-list').hidden = false;
    $('days-list-x').focus({ preventScroll: true });
}

function closeList() {
    $('days-list').hidden = true;
    $('days-aside')?.focus({ preventScroll: true });
}

// ─── The first morning ───────────────────────────────────────

function showIntro() {
    const intro = $('days-intro');
    let seen = false;
    try { seen = localStorage.getItem(INTRO_KEY) === '1'; } catch { /* show it */ }
    if (seen || !intro) return;
    $('days-intro-art').innerHTML = doodleSVG('sun', 7, 'days-picture');
    intro.hidden = false;
    const done = () => {
        intro.hidden = true;
        try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* it will show again, that is all */ }
        intro.removeEventListener('click', done);
    };
    intro.addEventListener('click', done);
    $('days-intro-go').focus({ preventScroll: true });
}

// ─── Open, close, and the keys ───────────────────────────────

export function openDays() {
    const view = $('days-view');
    if (!view) return;
    S.open = true;
    S.lastMove = 0;
    view.classList.remove('hidden');
    // Capture's box keeps focus underneath otherwise, and would swallow the
    // typing that is meant to start a note here.
    if (document.activeElement && !view.contains(document.activeElement)) document.activeElement.blur();
    render();
    showIntro();
    load();
}

export function closeDays() {
    const view = $('days-view');
    if (!view) return;
    S.open = false;
    view.classList.add('hidden');
    $('days-write').hidden = true;
    $('days-list').hidden = true;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && S.themeColor !== null) meta.setAttribute('content', S.themeColor);
    S.themeColor = null;
}

export function refreshDays() { if (S.open) load(); }

/** Escape closes whatever is laid over the page. Says whether it did. */
export function closeDaysSheet() {
    if (!S.open) return false;
    if (!$('days-intro').hidden) { $('days-intro').click(); return true; }
    if (writeOpen()) { closeWrite(); return true; }
    if (listOpen()) { closeList(); return true; }
    return false;
}

/** Something else — a note, the menu, Settings — is sitting on top of the page. */
function covered() {
    return ['note-detail', 'chat-panel', 'settings-dialog', 'nav-menu'].some(id => {
        const el = $(id);
        return el && !el.classList.contains('hidden');
    }) || !!document.querySelector('.rsplit-modal.visible');
}

function onKey(e) {
    if (!S.open || covered() || e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    if (writeOpen() || listOpen() || !$('days-intro').hidden) return;

    if (e.key === 'ArrowLeft') { e.preventDefault(); go(S.at - 1, { move: -1 }); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(S.at + 1, { move: 1 }); return; }
    // Typing is writing. The page is never a screen between a thought and the box.
    if (e.key.length === 1 && e.key !== ' ') { e.preventDefault(); openWrite(e.key); }
}

function bindSwipe(el) {
    let x0 = null, y0 = 0;
    el.addEventListener('pointerdown', e => {
        if (e.target.closest('.days-canvas, button')) return;
        x0 = e.clientX; y0 = e.clientY;
    });
    el.addEventListener('pointerup', e => {
        if (x0 === null) return;
        const dx = e.clientX - x0, dy = e.clientY - y0;
        x0 = null;
        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        // Swipe the page away to the right to go back a day, as in a book
        go(dx > 0 ? S.at - 1 : S.at + 1, { move: dx > 0 ? -1 : 1 });
    });
    el.addEventListener('pointercancel', () => { x0 = null; });
}

export function setupDays(hooks) {
    S.hooks = hooks;
    const view = $('days-view');
    if (!view) return;

    $('days-strip').addEventListener('click', e => {
        const b = e.target.closest('button[data-i]');
        if (!b) return;
        const i = Number(b.dataset.i);
        if (i === S.at) { S.hooks.tap(); openWrite(); }
        else go(i);
    });
    $('days-words').addEventListener('click', () => {
        const id = S.pages[S.at]?.line?.noteId;
        const note = id && (S.notes || []).find(n => n.id === id);
        if (!note) return;
        S.hooks.tap();
        S.hooks.openNote(note);
    });
    $('days-aside').addEventListener('click', openList);
    $('days-list-x').addEventListener('click', closeList);
    $('days-list-items').addEventListener('click', e => {
        const b = e.target.closest('[data-id]');
        const note = b && (S.notes || []).find(n => n.id === b.dataset.id);
        if (!note) return;
        S.hooks.tap();
        S.hooks.openNote(note);
    });

    const input = $('days-write-input');
    input.addEventListener('input', syncWrite);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitWrite(); }
    });
    $('days-write-send').addEventListener('click', submitWrite);
    $('days-write-x').addEventListener('click', () => { S.hooks.tap(); closeWrite(); });
    $('days-write-send').innerHTML = ovalSVG(11) + arrowUpSVG(12);

    bindSwipe($('days-page'));
    document.addEventListener('keydown', onKey);

    // Rotating the phone reshapes today's paper; the drawing keeps its units
    window.addEventListener('resize', () => {
        const art = $('days-art');
        const svg = art?.querySelector('.days-canvas');
        if (!svg || !art.clientWidth) return;
        svg.setAttribute('viewBox', `0 0 240 ${r1(240 * art.clientHeight / art.clientWidth)}`);
    });

    // Midnight while it is open: tomorrow has arrived, so it gets a page
    document.addEventListener('visibilitychange', () => {
        if (document.hidden || !S.open || !S.pages.length) return;
        if (S.pages[S.pages.length - 1].key === dayKey(new Date())) return;
        S.at = -1;
        deal();
        render();
        load();
    });
}

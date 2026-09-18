/* ============================================================
   Noteworthy — days.js
   One page a day, after grug: the line you wrote that day that
   stands up best on its own, and a picture of it that draws itself
   and keeps moving. Today's page takes a drawing of your own, and
   that comes alive too.
   ============================================================ */

import * as api from './api.js';
import {
    hash, rngFrom, hand, thru, arc, r1, PAPER, sceneSVG, inkMarkup, inkPath, motifFor, colourFor,
    wake, hold, reducedMotion,
} from './doodle.js';

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

// ─── A page for every day ────────────────────────────────────
// The page for a day is that day's: of everything you wrote on it, the line
// that stands up best on its own, and a picture chosen from its words. A
// day you wrote nothing is a quiet day, and says so.

const REACH = 60;        // how many days the strip goes back

function writtenByYou(n) {
    return n && n.created_at && (n.raw_text || '').trim()
        && !api.isDiscoverNote(n) && !api.isLogisticsNote(n) && !api.isReadingNote(n);
}

/** A day that was all errands or all reading has no line to quote, but it has a shape. */
function gistOf(wrote) {
    if (wrote.every(n => api.isLogisticsNote(n) || n.category === 'task')) return { words: 'a day of errands.', motif: 'list' };
    if (wrote.every(n => api.isReadingNote(n) || n.category === 'reference')) return { words: 'a day of reading.', motif: 'book' };
    return { words: 'a day of bits and pieces.', motif: 'pencil' };
}

/**
 * Every day from your first note (or two months back, whichever is later)
 * up to today. A page you drew on keeps the line you drew for, as long as
 * it is still one of that day's.
 */
export function dealPages(notes, { today = new Date(), seed = '', kept = new Map() } = {}) {
    const todayKey = dayKey(today);
    const byDay = new Map();
    notes.forEach(n => {
        if (!n.created_at || api.isDiscoverNote(n)) return;
        const k = dayKey(n.created_at);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(n);
    });
    const first = [...byDay.keys()].sort()[0] || todayKey;
    let key = [shiftKey(todayKey, -(REACH - 1)), first].sort()[1];
    if (key > todayKey) key = todayKey;

    const pages = [];
    let prevColour = null;
    let prevMotif = null;
    for (; key <= todayKey; key = shiftKey(key, 1)) {
        const isToday = key === todayKey;
        const wrote = (byDay.get(key) || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const k = kept.get(key);
        const lines = wrote.filter(writtenByYou).map(n => {
            const best = lineFrom(n);
            return best && {
                noteId: n.id, text: best.text, score: best.score,
                written: n.created_at, profile: n.profile, category: String(n.category || 'other'),
            };
        }).filter(Boolean);

        // Ties go to the later line: on the day itself, the newest thing you wrote
        let line = (k?.line?.noteId && lines.find(l => l.noteId === k.line.noteId)) || null;
        if (!line && lines.length) line = lines.reduce((a, b) => (b.score >= a.score ? b : a));

        const pageSeed = hash(`${seed}|${key}`);
        let motif, gist = null;
        if (line) {
            const note = wrote.find(n => n.id === line.noteId);
            motif = motifFor(line.text, {
                body: api.stripDerived(note?.raw_text || ''), tags: note?.tags,
                category: line.category, seed: pageSeed, avoid: prevMotif,
            });
        } else if (wrote.length) {
            ({ words: gist, motif } = gistOf(wrote));
        } else {
            motif = isToday ? 'sunrise' : pageSeed % 3 ? 'snail' : 'sleep';
        }

        // Today is paper, because today is the page you can still draw on
        const color = isToday ? null : colourFor(motif, pageSeed, prevColour?.id);
        if (color) prevColour = color;
        prevMotif = motif;

        pages.push({
            key, line, motif, gist, color,
            today: isToday,
            quiet: !wrote.length,
            seed: pageSeed,
            strokes: k?.strokes || [],
            wrote,
        });
    }
    return pages;
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

/** A drawing, framed by its own edges, and moving unless `alive` is off. */
function inkSVG(strokes, cls, { minW = 240, alive = true } = {}) {
    const lines = strokes.map(decodeStroke);
    return `<svg class="${cls} is-ink" viewBox="${inkBox(lines, minW, minW / 24)}"${alive ? ' data-alive' : ''} aria-hidden="true">`
        + `${inkMarkup(lines, { alive })}</svg>`;
}

/** Today's paper: the whole blank space, in the doodles' units across. */
function canvasSVG(strokes, art) {
    const w = art.clientWidth, h = art.clientHeight;
    const tall = w && h ? r1(240 * h / w) : 180;
    return `<svg class="dd days-canvas" viewBox="0 0 240 ${tall}" preserveAspectRatio="xMidYMid meet" data-alive>`
        + `${inkMarkup(strokes.map(decodeStroke))}</svg>`;
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
    wakeTimer: null,      // your drawing comes alive a moment after the pen lifts
    minis: new Map(),     // the strip's small pictures, which do not change as you walk it
};

// Bumped when Days changed from a line handed back to the day's own line
const INTRO_KEY = 'nw_days_intro_seen_2';
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
    if (!S.pages.length) S.pages = [{ key: todayKey, line: null, gist: null, motif: 'sunrise', today: true, quiet: true, color: null, seed: hash(todayKey), strokes: [], wrote: [] }];
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

const artSig = (page, drawing, bg) => [page.key, drawing, page.strokes.length, page.motif, page.line?.noteId || '', bg].join('|');

function renderArt(page) {
    const art = $('days-art');
    const drawing = !!page?.today && canDraw();
    const { bg } = colorsFor(page);
    // The notes arriving re-render the page you are already looking at. If
    // nothing in the picture changed, leave it — above all mid-stroke.
    const shows = page && S.notes !== null ? artSig(page, drawing, bg) : '';
    if (art.dataset.shows === shows && shows) return;
    art.dataset.shows = shows;
    clearTimeout(S.wakeTimer);

    art.classList.remove('is-drawing', 'is-fresh', 'has-ink');
    void art.offsetWidth;

    if (!shows) {
        // Still reading the notebook: a pencil, writing
        art.innerHTML = S.notes === null ? sceneSVG('pencil', 3, { cls: 'dd days-picture', bg }) : '';
        wake(art);
        return;
    }

    // Your drawing, where there is one; otherwise the picture the day's words chose
    const picture = !drawing && page.strokes.length
        ? inkSVG(page.strokes, 'dd days-picture')
        : sceneSVG(page.motif, page.seed, { cls: 'dd days-picture', bg });

    if (drawing) {
        const has = page.strokes.length > 0;
        art.innerHTML = `${picture}${canvasSVG(page.strokes, art)}
            <div class="days-note ${has ? 'hidden' : ''}" id="days-draw-note">
                <span>${page.line ? 'or<br>draw<br>your<br>own' : 'you<br>draw<br>for<br>today'}</span>${pointerSVG(page.seed)}
            </div>
            <div class="days-tools ${has ? '' : 'hidden'}" id="days-tools">
                <button type="button" class="days-tool" id="days-undo">undo</button>
                <button type="button" class="days-tool" id="days-wipe">wipe</button>
            </div>`;
        art.classList.add('is-drawing');
        art.classList.toggle('has-ink', has);
        bindDrawing(art.querySelector('.days-canvas'), page.key);
        $('days-undo').addEventListener('click', undoStroke);
        $('days-wipe').addEventListener('click', wipeStrokes);
    } else {
        art.innerHTML = picture;
    }
    art.classList.add('is-fresh');
    wake(art);
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

    words.title = '';
    if (page?.line) {
        words.textContent = page.line.text;
        words.disabled = false;
        words.title = 'Open the note this came from';
        sig.textContent = `${nameFor(page.line.profile)}. ${shortDate(page.key)}`;
    } else if (page?.today) {
        // Tapping the words writes, the way typing anywhere does
        words.textContent = canDraw()
            ? 'nothing yet today. write something, and it comes alive here.'
            : 'nothing yet today.';
        words.disabled = !canDraw();
        if (canDraw()) words.title = 'Write something';
        sig.textContent = 'noteworthy.';
    } else {
        words.textContent = page?.gist || 'a quiet day.';
        words.disabled = true;
        sig.textContent = page ? shortDate(page.key) : '';
    }

    // The rest of the day, when there is more of it than the line
    const n = page?.wrote.length || 0;
    aside.hidden = !(n >= 2 || (n === 1 && !page.line));
    aside.disabled = false;
    aside.textContent = `${page?.today ? 'today' : 'that day'} you wrote ${plural(n, 'thing', 'things')} →`;
}

/** The strip's small picture for a day: its drawing, or its doodle, standing still. */
function miniFor(p, bg) {
    const key = `${p.key}|${p.motif}|${p.strokes.length}|${bg}`;
    let mini = S.minis.get(key);
    if (!mini) {
        mini = p.strokes.length
            ? inkSVG(p.strokes, 'dd days-mini', { minW: 60, alive: false })
            : sceneSVG(p.motif, p.seed, { cls: 'dd days-mini', bg, alive: false });
        if (S.minis.size > 240) S.minis.clear();
        S.minis.set(key, mini);
    }
    return mini;
}

function renderStrip() {
    const strip = $('days-strip');
    if (!strip) return;
    const { bg } = colorsFor(S.pages[S.at]);
    const html = S.pages.map((p, i) => {
        if (i === S.at) {
            return `<button type="button" class="days-oval" id="days-oval" data-i="${i}"
                aria-label="Write something — ${esc(longDate(p.key))}">${ovalSVG(p.seed + 1)}${arrowUpSVG(p.seed + 2)}</button>`;
        }
        return `<button type="button" class="days-chip${p.quiet && !p.today ? ' is-quiet' : ''}" data-i="${i}" aria-label="${esc(longDate(p.key))}">
            ${miniFor(p, bg)}<span>${shortDate(p.key)}</span></button>`;
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
        // The drawing holds still under the pen; it wakes again when you stop
        clearTimeout(S.wakeTimer);
        hold(svg, true);
        $('days-art').classList.add('has-ink');
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

/**
 * Redraw today's paper from its strokes, read again as a whole — a stroke
 * can turn a circle into a face — and let it move a moment later.
 */
function inkChanged(page) {
    const art = $('days-art');
    const svg = art.querySelector('.days-canvas');
    if (!svg) return;
    svg.innerHTML = inkMarkup(page.strokes.map(decodeStroke));
    wake(svg, { again: true });
    hold(svg, true);
    clearTimeout(S.wakeTimer);
    S.wakeTimer = setTimeout(() => hold(svg, false), 1200);
    art.classList.toggle('has-ink', page.strokes.length > 0);
}

function drawingChanged(page) {
    const has = page.strokes.length > 0;
    $('days-art').dataset.shows = artSig(page, true, colorsFor(page).bg);
    inkChanged(page);
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
    // What you just wrote, drawn, while it is kept
    const keptArt = $('days-kept-art');
    if (keptArt) {
        keptArt.innerHTML = sceneSVG(motifFor(text, { seed: hash(text) }), hash(text),
            { cls: 'dd is-fresh days-kept-picture', bg: colorsFor(S.pages[S.at]).bg });
        wake(keptArt);
    }
    sheet.classList.add('is-kept');
    setTimeout(() => { if (!sheet.hidden) closeWrite(); }, 1800);
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
    $('days-intro-art').innerHTML = sceneSVG('sunrise', 7, { cls: 'dd is-fresh days-picture', bg: colorsFor(S.pages[S.at]).bg });
    intro.hidden = false;
    wake(intro);
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
        const page = S.pages[S.at];
        if (page?.today && !page.line && canDraw()) { S.hooks.tap(); openWrite(); return; }
        const id = page?.line?.noteId;
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

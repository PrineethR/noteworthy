/* ============================================================
   Noteworthy — days.js
   One page a day: the line you wrote that day that stands up best
   on its own, a picture of it that draws itself and keeps moving,
   and the rest of what you wrote that day beneath. Today's page
   takes a drawing of your own, and that comes alive too.
   ============================================================ */

import * as api from './api.js';
import {
    hash, r1, PAPER, sceneSVG, inkMarkup, inkPath, motifFor, colourFor,
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

/**
 * A day that was all errands or all reading has no line to quote, but it has a
 * shape. The phrase carries no full stop: a day that is over gets one, and
 * today gets ", so far", because today is not over.
 */
function gistOf(wrote) {
    if (wrote.every(n => api.isLogisticsNote(n) || n.category === 'task')) return { words: 'a day of errands', motif: 'list' };
    if (wrote.every(n => api.isReadingNote(n) || n.category === 'reference')) return { words: 'a day of reading', motif: 'book' };
    return { words: 'a day of bits and pieces', motif: 'pencil' };
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
    wakeTimer: null,      // your drawing comes alive a moment after the pen lifts
    showAll: false,       // the day's list, past its first few
    swiped: false,        // a swipe just turned the page: the click it ends in is not a tap
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

// ─── Colour ──────────────────────────────────────────────────
// A day keeps the colour its picture chose, but as a wash on the page rather
// than the whole screen: the picture sits on a plate tinted with it, and the
// strip marks the day with a dot of it. Today's plate is plain, because
// today is the one you can still draw on.

function rgbOf(hex) {
    let h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = [...h].map(c => c + c).join('');
    const n = parseInt(h, 16);
    return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` laid over `b` at strength `t`, as a hex doodle.js can pick paints against. */
function mixHex(a, b, t) {
    const x = rgbOf(a), y = rgbOf(b);
    if (!x || !y) return b;
    return `#${x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
}

const dark = () => S.hooks.theme() !== 'light';

/** A design token as a hex, or the paper it stands for if it is not one. */
function token(name, fallback) {
    const v = getComputedStyle($('days-view')).getPropertyValue(name).trim();
    return rgbOf(v) ? v : fallback;
}

function plateFor(page) {
    const paper = token('--bg-surface', PAPER[dark() ? 'dark' : 'light'].bg);
    if (!page?.color) return token('--bg-sunken', paper);
    return mixHex(page.color.bg, paper, dark() ? 0.26 : 0.3);
}

// ─── Painting ────────────────────────────────────────────────

function nameFor(profile) {
    return api.PROFILE_NAMES[profile] || 'you';
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const timeOf = iso => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LIST = 6;    // the day's notes shown before "Show all"

/** Play an entrance again on an element that may already be showing it. */
function replay(el, ...classes) {
    el.classList.remove('from-left', 'from-right', 'is-arriving');
    void el.offsetWidth;
    el.classList.add(...classes);
}

function render() {
    const view = $('days-view');
    if (!view) return;
    const page = S.pages[S.at];
    renderHead(page);
    renderArt(page);
    renderWords(page);
    renderDay(page);
    renderStrip();
    // Combined is for reading: there is no one notebook to write into
    $('days-write-btn').hidden = !canDraw();
}

function renderHead(page) {
    const card = $('days-card');
    if (S.lastMove) replay(card, S.lastMove < 0 ? 'from-left' : 'from-right');
    const d = keyToDate(page?.key || dayKey(new Date()));
    const month = d.toLocaleDateString('en-IN', { month: 'long' });
    $('days-month').textContent = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    $('days-num').textContent = d.getDate();
    $('days-weekday').textContent = page?.today ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'long' });
    const n = page?.wrote.length || 0;
    const count = S.notes === null ? '' : n ? plural(n, 'note', 'notes') : 'nothing written';
    // The numeral is the date and the header the month, so this only has to
    // say which day of the week today is, and how much was written
    $('days-meta').textContent = [page?.today ? d.toLocaleDateString('en-IN', { weekday: 'long' }) : month, count]
        .filter(Boolean).join(' · ');
    $('days-prev').disabled = S.at <= 0;
    $('days-next').disabled = S.at < 0 || S.at >= S.pages.length - 1;
}

const artSig = (page, drawing, bg) => [page.key, drawing, page.strokes.length, page.motif, page.line?.noteId || '', bg].join('|');

function renderArt(page) {
    const art = $('days-art');
    const drawing = !!page?.today && canDraw();
    const bg = plateFor(page);
    art.style.setProperty('--plate', bg);
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
            <span class="days-draw-hint ${has ? 'hidden' : ''}" id="days-draw-note">${page.line ? 'Draw your own' : 'Draw something for today'}</span>
            <div class="days-tools ${has ? '' : 'hidden'}" id="days-tools">
                <button type="button" class="days-tool" id="days-undo">Undo</button>
                <button type="button" class="days-tool" id="days-wipe">Clear</button>
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

    if (S.notes === null) {
        words.textContent = 'Reading the notebook…';
        words.disabled = true;
        words.classList.remove('is-line');
        sig.textContent = '';
        return;
    }

    words.title = '';
    words.classList.toggle('is-line', !!page?.line);
    if (page?.line) {
        words.textContent = page.line.text;
        words.disabled = false;
        words.title = 'Open the note this came from';
        const who = S.profile === 'combined' ? ` · ${nameFor(page.line.profile)}` : '';
        sig.textContent = `From a note at ${timeOf(page.line.written)}${who}`;
    } else if (page?.today) {
        // Written in already, just not with a line that stands on its own. The
        // page has worked out what kind of day it has been; it doesn't sit on
        // "nothing yet" once the first thing is written. Tapping the words
        // writes, the way typing anywhere does.
        words.textContent = page.gist ? `${cap(page.gist)}, so far.` : 'Nothing yet today.';
        words.disabled = !canDraw();
        if (canDraw()) words.title = 'Write something';
        sig.textContent = canDraw() ? 'Write something, and the line that stands best on its own lands here.' : '';
    } else {
        words.textContent = page?.gist ? `${cap(page.gist)}.` : 'A quiet day.';
        words.disabled = true;
        sig.textContent = page?.quiet ? 'Nothing written.' : 'Nothing that day stands on its own as a line.';
    }
}

/** noteTitle stops at 80 characters without saying so. */
const clipped = t => (t.length >= 80 ? `${t.replace(/\s+\S*$/, '')}…` : t);

/** Everything written that day, in the order it was written. */
function renderDay(page) {
    const sec = $('days-day');
    const wrote = page?.wrote || [];
    if (S.notes === null || !wrote.length) { sec.hidden = true; return; }
    sec.hidden = false;
    $('days-day-h').innerHTML = `<span>${page.today ? 'Today so far' : 'That day'}</span>`
        + `<span class="days-day-n">${plural(wrote.length, 'note', 'notes')}</span>`;
    const shown = S.showAll ? wrote : wrote.slice(0, DAY_LIST);
    const list = $('days-list-items');
    list.innerHTML = shown.map((n, i) => `
        <li style="--i:${Math.min(i, 12)}"><button type="button" class="days-list-item${page.line?.noteId === n.id ? ' is-line' : ''}" data-id="${esc(n.id)}">
            <span class="days-list-time">${esc(timeOf(n.created_at))}</span>
            <span class="days-list-title">${esc(clipped(api.noteTitle(n)))}</span>
        </button></li>`).join('');
    replay(list, 'is-arriving');
    const more = $('days-more');
    more.hidden = S.showAll || wrote.length <= DAY_LIST;
    more.textContent = `Show all ${wrote.length}`;
}

/**
 * The strip is rebuilt only when the days in it change. Walking along it
 * just moves the mark, so the scroll to the new day can glide.
 */
function renderStrip() {
    const strip = $('days-strip');
    if (!strip) return;
    const sig = S.pages.map(p => `${p.key}:${p.wrote.length}:${p.color?.id || ''}`).join(',');
    if (strip.dataset.sig !== sig) {
        strip.dataset.sig = sig;
        strip.innerHTML = S.pages.map((p, i) => {
            const d = keyToDate(p.key);
            const n = p.wrote.length;
            const dots = n === 0 ? 0 : n < 3 ? 1 : n < 8 ? 2 : 3;
            const month = i === 0 || d.getDate() === 1
                ? `<span class="days-cell-month" aria-hidden="true">${d.toLocaleDateString('en-IN', { month: 'short' })}</span>` : '';
            return `${month}<button type="button" class="days-cell${p.today ? ' is-today' : ''}${p.quiet ? ' is-quiet' : ''}"
                data-i="${i}" aria-label="${esc(longDate(p.key))}, ${n ? plural(n, 'note', 'notes') : 'nothing written'}"
                style="--tone:${p.color?.bg || 'var(--accent)'}">
                <span class="days-cell-wd">${p.today ? 'Today' : WEEKDAY[d.getDay()]}</span>
                <span class="days-cell-n">${d.getDate()}</span>
                <span class="days-cell-dots" aria-hidden="true">${'<i></i>'.repeat(dots)}</span>
            </button>`;
        }).join('');
        markStrip();
        centerStrip(false);
        return;
    }
    markStrip();
}

function markStrip() {
    $('days-strip').querySelectorAll('.days-cell').forEach(b => {
        const on = Number(b.dataset.i) === S.at;
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'date'); else b.removeAttribute('aria-current');
    });
}

function centerStrip(smooth = true) {
    const strip = $('days-strip');
    const here = strip?.querySelector('.days-cell.is-on');
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
    S.showAll = false;
    render();
    S.lastMove = 0;     // a later refresh of the same page should not slide it in again
    const pageEl = $('days-page');
    if (pageEl.scrollTop > 0) pageEl.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
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
    $('days-art').dataset.shows = artSig(page, true, plateFor(page));
    inkChanged(page);
    $('days-tools')?.classList.toggle('hidden', !has);
    $('days-draw-note')?.classList.toggle('hidden', has);
    const wipe = $('days-wipe');
    if (wipe) wipe.textContent = S.wipeArmed ? 'Sure?' : 'Clear';

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
        $('days-wipe').textContent = 'Sure?';
        return;
    }
    S.wipeArmed = false;
    page.strokes = [];
    drawingChanged(page);
}

// ─── Writing ─────────────────────────────────────────────────

function writeOpen() { return !$('days-write').hidden; }

function openWrite(seedText = '') {
    if (!canDraw()) return;
    const sheet = $('days-write');
    const input = $('days-write-input');
    const page = S.pages[S.at];
    const d = page && keyToDate(page.key);
    const named = d && d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
    sheet.hidden = false;
    sheet.classList.remove('is-kept');
    $('days-write-date').textContent = page && !page.today ? `Looking back at ${named}` : 'Today';
    input.placeholder = page?.today === false ? `Anything to add about ${named}?` : 'What’s true today?';
    if (seedText) input.value += seedText;
    syncWrite();
    requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    });
}

function closeWrite() {
    $('days-write').hidden = true;
    $('days-write-btn')?.focus({ preventScroll: true });
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
            { cls: 'dd is-fresh days-kept-picture', bg: token('--bg-surface', PAPER.light.bg) });
        wake(keptArt);
    }
    sheet.classList.add('is-kept');
    setTimeout(() => { if (!sheet.hidden) closeWrite(); }, 1800);
    // The page's own count of what you wrote catches up once the note lands
    setTimeout(() => { if (S.open) load(); }, 1400);
}

// ─── The first morning ───────────────────────────────────────

function showIntro() {
    const intro = $('days-intro');
    let seen = false;
    try { seen = localStorage.getItem(INTRO_KEY) === '1'; } catch { /* show it */ }
    if (seen || !intro) return;
    $('days-intro-art').innerHTML = sceneSVG('sunrise', 7, { cls: 'dd is-fresh days-picture', bg: token('--bg-surface', PAPER.light.bg) });
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
    S.showAll = false;
    view.classList.remove('hidden');
    // Capture's box keeps focus underneath otherwise, and would swallow the
    // typing that is meant to start a note here.
    if (document.activeElement && !view.contains(document.activeElement)) document.activeElement.blur();
    render();
    requestAnimationFrame(() => centerStrip(false));
    showIntro();
    load();
}

export function closeDays() {
    const view = $('days-view');
    if (!view) return;
    S.open = false;
    view.classList.add('hidden');
    $('days-write').hidden = true;
}

export function refreshDays() { if (S.open) load(); }

/** Escape closes whatever is laid over the page. Says whether it did. */
export function closeDaysSheet() {
    if (!S.open) return false;
    if (!$('days-intro').hidden) { $('days-intro').click(); return true; }
    if (writeOpen()) { closeWrite(); return true; }
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
    if (writeOpen() || !$('days-intro').hidden) return;

    if (e.key === 'ArrowLeft') { e.preventDefault(); go(S.at - 1, { move: -1 }); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(S.at + 1, { move: 1 }); return; }
    // Typing is writing. The page is never a screen between a thought and the box.
    if (e.key.length === 1 && e.key !== ' ' && canDraw()) { e.preventDefault(); openWrite(e.key); }
}

/**
 * Swipe the page to turn it, as in a book: to the right goes back a day.
 * Most of the page is buttons now (the line, the day's notes), so a swipe
 * that starts on one still turns the page, and the click it ends in is
 * swallowed rather than opening a note.
 */
function bindSwipe(el) {
    let x0 = null, y0 = 0;
    el.addEventListener('pointerdown', e => {
        S.swiped = false;
        if (e.target.closest('.days-canvas')) return;
        x0 = e.clientX; y0 = e.clientY;
    });
    el.addEventListener('pointerup', e => {
        if (x0 === null) return;
        const dx = e.clientX - x0, dy = e.clientY - y0;
        x0 = null;
        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        S.swiped = true;
        go(dx > 0 ? S.at - 1 : S.at + 1, { move: dx > 0 ? -1 : 1 });
    });
    el.addEventListener('pointercancel', () => { x0 = null; });
    el.addEventListener('click', e => {
        if (!S.swiped) return;
        S.swiped = false;
        e.preventDefault();
        e.stopPropagation();
    }, true);
}

export function setupDays(hooks) {
    S.hooks = hooks;
    const view = $('days-view');
    if (!view) return;

    $('days-strip').addEventListener('click', e => {
        const b = e.target.closest('button[data-i]');
        if (b) go(Number(b.dataset.i));
    });
    $('days-prev').addEventListener('click', () => go(S.at - 1, { move: -1 }));
    $('days-next').addEventListener('click', () => go(S.at + 1, { move: 1 }));
    $('days-words').addEventListener('click', () => {
        const page = S.pages[S.at];
        if (page?.today && !page.line && canDraw()) { S.hooks.tap(); openWrite(); return; }
        const id = page?.line?.noteId;
        const note = id && (S.notes || []).find(n => n.id === id);
        if (!note) return;
        S.hooks.tap();
        S.hooks.openNote(note);
    });
    $('days-list-items').addEventListener('click', e => {
        const b = e.target.closest('[data-id]');
        const note = b && (S.notes || []).find(n => n.id === b.dataset.id);
        if (!note) return;
        S.hooks.tap();
        S.hooks.openNote(note);
    });
    $('days-more').addEventListener('click', () => {
        S.hooks.tap();
        S.showAll = true;
        renderDay(S.pages[S.at]);
    });

    $('days-write-btn').addEventListener('click', () => { S.hooks.tap(); openWrite(); });
    const input = $('days-write-input');
    input.addEventListener('input', syncWrite);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitWrite(); }
    });
    $('days-write-send').addEventListener('click', submitWrite);
    $('days-write-x').addEventListener('click', () => { S.hooks.tap(); closeWrite(); });
    // A tap on the dimmed page around the sheet puts it away
    $('days-write').addEventListener('click', e => { if (e.target === e.currentTarget) closeWrite(); });

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

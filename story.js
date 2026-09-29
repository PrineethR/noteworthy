// ════════════════════════════════════════════════════════════════════
//  The story layer.
//
//  The app is five chapters of one story — the life of a note: you write
//  it, you keep it, it comes back to you, it finds its threads, and in the
//  end your notebook writes back. This file gives that story a shape the
//  eye can follow: one tab bar that is always there, a colour and a shape
//  for each chapter, a cover at the top of each screen, a greeting at the
//  door, a moment when a note is saved, and a welcome the first time.
//
//  It sits on top of app.js rather than inside it. It reads the DOM app.js
//  already keeps up to date (which screen is showing, whether the notes
//  panel is open, when a note was saved) and drives the app through the
//  handful of functions it is handed in mountStory().
// ════════════════════════════════════════════════════════════════════

import * as ds from './ds.js';

/** The five chapters, plus the Almanac, which is reached from the home tiles. */
export const CHAPTERS = {
    capture:  { n: 1, word: 'Write',    tab: 'Write',    icon: 'pen-line',  color: 'sun',       shape: 'flower' },
    notes:    { n: 2, word: 'Keep',     tab: 'Notes',    icon: 'notebook',  color: 'sky',       shape: 'square',
                title: 'Everything', em: 'you’ve kept', art: { icon: 'bookmark', color: 'sun', shape: 'square' } },
    discover: { n: 3, word: 'Revisit',  tab: 'Discover', icon: 'compass',   color: 'tangerine', shape: 'star',
                title: 'Old notes,', em: 'new light', art: { icon: 'compass', color: 'sky', shape: 'circle' } },
    threads:  { n: 4, word: 'Connect',  tab: 'Threads',  icon: 'waypoints', color: 'mint',      shape: 'hexagon',
                title: 'What keeps', em: 'coming back', art: { icon: 'waypoints', color: 'blush', shape: 'hexagon' } },
    memory:   { n: 5, word: 'Remember', tab: 'Memory',   icon: 'mail',      color: 'violet',    shape: 'arch',
                title: 'Letters from', em: 'your notebook', art: { icon: 'mail', color: 'sun', shape: 'arch' } },
    activity: { n: 0, word: 'Look back', tab: 'Almanac', icon: 'calendar',  color: 'tomato',    shape: 'scallop',
                title: 'The shape', em: 'of your writing', art: { icon: 'calendar', color: 'sun', shape: 'scallop' } },
};
const IN_BAR = ['capture', 'notes', 'discover', 'threads', 'memory'];

// Where each chapter's cover goes: the view, the header row it hangs under,
// and the title element that moves into the cover (it carries live subtitles).
const COVERS = {
    notes:    { view: '#notes-panel',    header: '.notes-header',     title: '.notes-header-left' },
    discover: { view: '#discover-view',  header: '.discover-header',  title: '.discover-title' },
    threads:  { view: '#threads-view',   header: '.threads-header',   title: '.threads-title-group' },
    memory:   { view: '#memory-view',    header: '.threads-header',   title: '.threads-title-group' },
    activity: { view: '#dashboard-view', header: '.dashboard-header', title: '.act-title' },
};

let ctx = null;
let current = null;
const $ = (s, root = document) => root.querySelector(s);

export function mountStory(context) {
    ctx = context;
    document.documentElement.classList.add('nw-story');
    buildTabs();
    buildHome();
    Object.keys(COVERS).forEach(buildCover);
    decorateSignin();
    watchChapters();
    watchSaves();
    watchTyping();
    wireBursts();
    maybeWelcome();
}

// ─── The tab bar ────────────────────────────────────────────────────
// A floating ink pill. The active chapter is marked by its own shape in its
// own colour, which springs across and changes shape as you move — the one
// character that follows you through the whole story.
function buildTabs() {
    const nav = document.createElement('nav');
    nav.id = 'nw-tabs';
    nav.className = 'nw-tabs';
    nav.setAttribute('aria-label', 'Chapters');
    nav.innerHTML = `<span class="nw-tabs__pip" aria-hidden="true"><svg viewBox="-4 -4 108 108"><path d=""/></svg></span>`
        + IN_BAR.map((id) => {
            const c = CHAPTERS[id];
            return `<button type="button" class="nw-tabs__item" data-ch="${id}" aria-label="${c.tab}" style="--c:var(--${c.color})">
                ${ds.icon(c.icon, { size: 22, sw: 1.8 })}<span class="nw-tabs__lbl">${c.tab}</span></button>`;
        }).join('');
    document.body.appendChild(nav);
    nav.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ch]');
        if (b) go(b.dataset.ch);
    });
    window.addEventListener('resize', () => placePip(false));
}

/** Go to a chapter the way the app already knows how to. */
export function go(id) {
    const notesOpen = $('#notes-panel')?.classList.contains('open');
    if (id === 'notes') {
        if (!notesOpen) ctx.openNotes();
        return;
    }
    if (notesOpen) ctx.closeNotes();
    ctx.setTab(id);
}

function chapterNow() {
    if ($('#notes-panel')?.classList.contains('open')) return 'notes';
    const tab = $('#nav-menu [aria-current="page"]')?.dataset.tab || 'capture';
    if (tab === 'feed') return 'notes';
    return tab;
}

function placePip(animate = true) {
    const nav = $('#nw-tabs');
    const pip = nav?.querySelector('.nw-tabs__pip');
    if (!pip) return;
    const btn = nav.querySelector(`[data-ch="${current}"]`);
    nav.querySelectorAll('[data-ch]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    if (!btn) { pip.classList.add('is-away'); return; }
    const c = CHAPTERS[current];
    pip.classList.remove('is-away');
    pip.style.setProperty('--x', `${btn.offsetLeft + btn.offsetWidth / 2}px`);
    pip.style.setProperty('--c', `var(--${c.color})`);
    pip.querySelector('path').setAttribute('d', ds.SHAPES[c.shape][0]);
    if (animate) {
        pip.classList.remove('is-hop');
        void pip.offsetWidth;
        pip.classList.add('is-hop');
    }
}

function watchChapters() {
    const sync = () => {
        const next = chapterNow();
        document.documentElement.classList.toggle('nw-signed-out', !isSignedIn());
        if (next === current) return;
        const prev = current;
        current = next;
        document.documentElement.dataset.chapter = next;
        placePip(prev !== null);
        if (prev !== null) enterChapter(next);
        if (next === 'capture') renderHome();
    };
    let queued = false;
    const mo = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; sync(); });
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-current'] });
    sync();
}

function isSignedIn() {
    const signin = $('#signin-view'), setup = $('#firebase-setup-view');
    return (!signin || signin.classList.contains('hidden')) && (!setup || setup.classList.contains('hidden'));
}

/** Replays a chapter's entrance: the cover drops in, its clay object pops. */
function enterChapter(id) {
    const cover = document.querySelector(`.ch-cover[data-ch="${id}"]`);
    const el = id === 'capture' ? $('#home-hero') : cover;
    if (!el) return;
    el.classList.remove('is-entering');
    void el.offsetWidth;
    el.classList.add('is-entering');
}

// ─── Home: the door ─────────────────────────────────────────────────
// A greeting that knows the time of day, the day's clay scene, and a row
// of colour tiles saying what is waiting elsewhere in the story.
function buildHome() {
    const view = $('#capture-view');
    const bar = view?.querySelector('.top-bar');
    if (!bar) return;
    const lead = bar.firstElementChild;
    if (lead) lead.insertAdjacentHTML('afterbegin', '<span class="nw-wordmark">Note<em>worthy</em></span>');
    const hero = document.createElement('section');
    hero.id = 'home-hero';
    hero.className = 'home-hero';
    hero.setAttribute('aria-label', 'Today');
    bar.after(hero);
    hero.addEventListener('click', (e) => {
        const t = e.target.closest('[data-go]');
        if (!t) return;
        ds.burstAt(t, e);
        go(t.dataset.go);
    });
    renderHome();
}

function partOfDay(d = new Date()) {
    const h = d.getHours();
    return h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';
}

let homeStats = null;
let homeStatsAt = 0;

function renderHome() {
    const hero = $('#home-hero');
    if (!hero) return;
    const now = new Date();
    const part = partOfDay(now);
    const name = ctx.name();
    const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const greet = part === 'night' ? 'Still up,' : `Good ${part},`;
    const scene = part === 'morning' || part === 'afternoon' ? 'hero-morning' : 'hero-evening';
    const s = homeStats;
    const waiting = discoverWaiting();
    hero.innerHTML = `
        ${ds.backdrop({ variant: 'confetti', seed: now.getDate(), marks: 6, colors: ['sun', 'sky', 'blush', 'violet'] })}
        <div class="home-hero__row">
            <div class="home-hero__text">
                <span class="nw-label">${date}</span>
                <h1 class="home-hero__h">${greet}<br><em>${name}</em></h1>
            </div>
            <div class="home-hero__art">${ds.illustration(scene, { size: 240 })}</div>
        </div>
        <div class="home-tiles" role="list">
            <button type="button" role="listitem" class="nw-tile" data-go="notes" style="--c:var(--sky)">
                <span class="nw-tile__label">This week</span>
                <span class="nw-tile__value">${s ? s.week : '·'}</span>
                <span class="nw-tile__cap">${s && s.week === 1 ? 'note kept' : 'notes kept'}</span>
            </button>
            <button type="button" role="listitem" class="nw-tile" data-go="discover" style="--c:var(--tangerine)">
                <span class="nw-tile__label">Discover</span>
                <span class="nw-tile__value">${waiting}</span>
                <span class="nw-tile__cap">${waiting ? 'waiting for you' : 'draw a round'}</span>
            </button>
            <button type="button" role="listitem" class="nw-tile" data-go="activity" style="--c:var(--tomato)">
                <span class="nw-tile__label">Streak</span>
                <span class="nw-tile__value">${s ? s.streak : '·'}</span>
                <span class="nw-tile__cap">${s && s.streak === 1 ? 'day' : 'days'} in a row</span>
            </button>
        </div>`;
    if (!s || Date.now() - homeStatsAt > 60_000) loadHomeStats();
}

function discoverWaiting() {
    const b = $('#discover-badge');
    if (!b || b.classList.contains('hidden')) return 0;
    return parseInt(b.textContent, 10) || 0;
}

async function loadHomeStats() {
    homeStatsAt = Date.now();
    try {
        const notes = await ctx.loadNotes();
        const days = new Set(notes.map((n) => dayKey(new Date(n.created_at))));
        const weekAgo = Date.now() - 7 * 864e5;
        const week = notes.filter((n) => new Date(n.created_at).getTime() > weekAgo).length;
        // A streak counts back from today, or from yesterday if today is still blank.
        let streak = 0;
        const d = new Date();
        if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
        while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
        homeStats = { week, streak };
        if (current === 'capture' || current === null) renderHome();
    } catch (e) {
        console.warn('Home tiles:', e.message);
    }
}
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// ─── Chapter covers ─────────────────────────────────────────────────
// Each chapter opens on a band of its own colour: a kicker naming the
// chapter, a two-line title that turns on its second line, and one clay
// object. The screen's own title moves in underneath, so the live counts
// app.js writes into it keep updating. Scrolling folds the cover away.
function buildCover(id) {
    const spec = COVERS[id];
    const c = CHAPTERS[id];
    const view = $(spec.view);
    const header = view?.querySelector(spec.header);
    if (!header) return;
    view.classList.add('ch-view');
    view.style.setProperty('--c', `var(--${c.color})`);
    header.classList.add('ch-head');
    const cover = document.createElement('section');
    cover.className = 'ch-cover';
    cover.dataset.ch = id;
    cover.innerHTML = `
        <div class="ch-cover__in">
            ${ds.scatter({ seed: c.n * 7 + 3, count: 12, clear: 0.2, glyphs: ['cross', 'dot', 'dash', 'ring', 'squiggle'] })}
            <div class="ch-cover__text">
                <span class="nw-label ch-cover__kicker">${c.n ? `Chapter ${c.n}` : 'Epilogue'} · ${c.word}</span>
                <h2 class="ch-cover__h">${c.title}<br><em>${c.em}</em></h2>
                <div class="ch-cover__sub"></div>
            </div>
            <div class="ch-cover__art">${ds.clayIcon({ ...c.art, size: 76, tilt: true })}</div>
        </div>`;
    header.after(cover);
    const title = header.querySelector(spec.title);
    if (title) cover.querySelector('.ch-cover__sub').appendChild(title);

    // Fold the cover away once the screen's own content scrolls.
    view.addEventListener('scroll', (e) => {
        const t = e.target;
        if (!(t instanceof Element) || cover.contains(t)) return;
        view.classList.toggle('ch-folded', t.scrollTop > 28);
    }, true);
}

// ─── Sign-in: the front cover ───────────────────────────────────────
function decorateSignin() {
    const brand = $('#signin-view .pin-brand');
    if (!brand) return;
    const emoji = brand.querySelector('.pin-emoji');
    if (emoji) emoji.outerHTML = `<div class="signin-art">${ds.illustration(partOfDay() === 'evening' || partOfDay() === 'night' ? 'hero-evening' : 'hero-morning', { size: 260 })}</div>`;
    const t = brand.querySelector('.pin-title');
    if (t) t.innerHTML = 'Note<em>worthy</em>';
}

// ─── The saved moment ───────────────────────────────────────────────
// app.js lights #success-ripple whenever a note is saved, on every route
// (a plain note, a persona, a Google command, a reading capture). That is
// the one signal to hang the moment on: the send button throws a burst,
// and the sheet shows the clay "saved" scene for a beat before clearing.
function watchSaves() {
    const ripple = $('#success-ripple');
    if (!ripple) return;
    let was = false;
    new MutationObserver(() => {
        const on = ripple.classList.contains('active');
        if (on && !was) celebrate();
        was = on;
    }).observe(ripple, { attributes: true, attributeFilter: ['class'] });
}

function celebrate() {
    const send = $('#btn-send');
    if (send) ds.burstAt(send, null, { count: 12, reach: 44 });
    const main = $('#capture-view .capture-main');
    if (!main) return;
    main.querySelector('.nw-saved')?.remove();
    const el = document.createElement('div');
    el.className = 'nw-saved';
    el.setAttribute('role', 'status');
    el.innerHTML = `${ds.illustration('saved', { size: 200 })}<p class="nw-saved__h">Kept. <em>It’s in your notebook.</em></p>`;
    main.appendChild(el);
    setTimeout(() => el.classList.add('is-leaving'), 1500);
    setTimeout(() => el.remove(), 1900);
    homeStatsAt = 0;
    if (homeStats) { homeStats.week++; }
}

// ─── Typing: get out of the way ─────────────────────────────────────
// On a phone the keyboard takes half the screen; the tab bar and the
// greeting step aside while it is up. Focus alone is not the signal: the
// app focuses the composer on load, and that raises no keyboard. The
// visual viewport shrinking is.
function watchTyping() {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const isField = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(el.type)) || el.isContentEditable);
    const update = () => {
        const keyboard = !!vv && window.innerHeight - vv.height > 120;
        root.classList.toggle('nw-typing', keyboard && isField(document.activeElement));
    };
    vv?.addEventListener('resize', update);
    document.addEventListener('focusin', () => setTimeout(update, 60));
    document.addEventListener('focusout', () => setTimeout(update, 60));
}

// ─── Bursts ─────────────────────────────────────────────────────────
// Primary actions throw a small burst of spectrum doodles from the tap.
function wireBursts() {
    document.addEventListener('click', (e) => {
        const b = e.target.closest('.btn-accent:not(:disabled), .dsc-draw-btn:not(:disabled), .nw-welcome__next');
        if (b) ds.burstAt(b, e);
    }, true);
}

// ─── The welcome ────────────────────────────────────────────────────
// Shown once per device, the first time the notebook opens after sign-in.
const WELCOME_KEY = 'nw_welcomed_v1';
const WELCOME = [
    {
        art: () => `<div class="nw-welcome__stage">${ds.scatter({ seed: 4, count: 26 })}${ds.mood({ mood: 'joyful', size: 150, alive: true })}</div>`,
        h: 'Put it down', em: 'and pick it up later',
        p: 'Write down what’s in your head. Noteworthy holds on to it, so you don’t have to.',
    },
    {
        art: () => `<div class="nw-welcome__stage nw-welcome__cast">${ds.scatter({ seed: 21, count: 16, glyphs: ['cross', 'ring', 'tri'] })}
            ${ds.clayIcon({ icon: 'zap', color: 'tomato', shape: 'star', size: 64 })}
            ${ds.clayIcon({ icon: 'lightbulb', color: 'sun', shape: 'circle', size: 84 })}
            ${ds.clayIcon({ icon: 'feather', color: 'violet', shape: 'arch', size: 72 })}
            ${ds.clayIcon({ icon: 'bookmark', color: 'sky', shape: 'square', size: 60 })}</div>`,
        h: 'Every note', em: 'finds its kind',
        p: 'A brainstorm, an idea, a line from a book, a day remembered. Each one gets filed and coloured for you.',
    },
    {
        art: () => `<div class="nw-welcome__stage">${ds.scatter({ seed: 9, count: 18, glyphs: ['cross', 'dot', 'dash'] })}${ds.mood({ mood: 'curious', size: 120, alive: true })}</div>`,
        h: 'Then it', em: 'comes back to you',
        p: 'Threads show what you keep returning to. Discover hands old notes back. Once a week, your notebook writes you a letter.',
    },
    {
        art: () => `<div class="nw-welcome__stage">${ds.scatter({ seed: 2, count: 34, color: 'spectrum' })}${ds.clayIcon({ icon: 'sparkles', color: 'tomato', shape: 'star', size: 140, tilt: true })}</div>`,
        h: 'And now', em: 'you’re ready',
        p: 'The first page is blank. That’s the best kind.',
    },
];

function maybeWelcome() {
    let seen = false;
    try { seen = localStorage.getItem(WELCOME_KEY) === '1'; } catch { /* private mode: show it */ }
    if (seen) return;
    // Wait until the notebook itself is showing, not the sign-in screen.
    const tryOpen = () => {
        const cap = $('#capture-view');
        if (cap && !cap.classList.contains('hidden') && isSignedIn()) { openWelcome(); return true; }
        return false;
    };
    if (tryOpen()) return;
    const mo = new MutationObserver(() => { if (tryOpen()) mo.disconnect(); });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
}

export function openWelcome() {
    if ($('#nw-welcome')) return;
    let step = 0;
    const el = document.createElement('div');
    el.id = 'nw-welcome';
    el.className = 'nw-welcome';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Welcome to Noteworthy');
    document.body.appendChild(el);
    const done = () => {
        try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* nothing to keep it in */ }
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 380);
    };
    const render = () => {
        const s = WELCOME[step];
        const last = step === WELCOME.length - 1;
        el.innerHTML = `
            ${ds.backdrop({ seed: step + 2, count: 3, scale: 0.8, marks: 8 })}
            <div class="nw-welcome__in">
                <div class="nw-welcome__top">
                    <div class="nw-steps" aria-label="Step ${step + 1} of ${WELCOME.length}">${WELCOME.map((_, i) => `<i class="${i === step ? 'is-on' : i < step ? 'is-done' : ''}"></i>`).join('')}</div>
                    ${last ? '' : '<button type="button" class="nw-welcome__skip">Skip</button>'}
                </div>
                <div class="nw-welcome__body" key="${step}">
                    ${s.art()}
                    <h1 class="nw-welcome__h">${s.h}<br><em>${s.em}</em></h1>
                    <p class="nw-welcome__p">${s.p}</p>
                </div>
                <div class="nw-welcome__foot">
                    ${step ? '<button type="button" class="btn btn-ghost nw-welcome__back">Back</button>' : '<span></span>'}
                    <button type="button" class="btn nw-welcome__next">${last ? 'Start writing' : 'Next'}${ds.icon('arrow-right', { size: 18, cls: 'nw-arrow' })}</button>
                </div>
            </div>`;
        el.querySelector('.nw-welcome__next').addEventListener('click', () => {
            if (last) { done(); setTimeout(() => $('#note-input')?.focus(), 400); } else { step++; render(); }
        });
        el.querySelector('.nw-welcome__back')?.addEventListener('click', () => { step--; render(); });
        el.querySelector('.nw-welcome__skip')?.addEventListener('click', done);
        el.querySelector('.nw-welcome__next').focus({ preventScroll: true });
    };
    render();
}

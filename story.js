// ════════════════════════════════════════════════════════════════════
//  The story layer.
//
//  The app is five chapters of one story — the life of a note: you write
//  it, you keep it, it comes back to you, it finds its threads, and in the
//  end your notebook writes back. This file gives that story a shape the
//  eye can follow: one tab bar that is always there, a colour and a shape
//  for each chapter, a header band on each screen, a greeting at the door,
//  a moment when a note is saved, and a welcome the first time.
//
//  It sits on top of app.js rather than inside it. It reads the DOM app.js
//  already keeps up to date (which screen is showing, whether the notes
//  panel is open, when a note was saved) and drives the app through the
//  handful of functions it is handed in mountStory().
// ════════════════════════════════════════════════════════════════════

import * as ds from './ds.js';

/** The five chapters, Days beside the first, and the Almanac, which is reached from the date on the home page. */
export const CHAPTERS = {
    capture:  { n: 1, word: 'Write',     tab: 'Write',    icon: 'pen-line',  color: 'sun',       shape: 'flower' },
    days:     { n: 0, word: 'Days',      tab: 'Days',     icon: 'sunrise',   color: 'blush',     shape: 'circle' },
    notes:    { n: 2, word: 'Keep',      tab: 'Notes',    icon: 'notebook',  color: 'sky',       shape: 'square' },
    discover: { n: 3, word: 'Revisit',   tab: 'Discover', icon: 'compass',   color: 'tangerine', shape: 'star' },
    threads:  { n: 4, word: 'Connect',   tab: 'Threads',  icon: 'waypoints', color: 'mint',      shape: 'hexagon' },
    memory:   { n: 5, word: 'Remember',  tab: 'Memory',   icon: 'mail',      color: 'violet',    shape: 'arch' },
    activity: { n: 0, word: 'Look back', tab: 'Almanac',  icon: 'calendar',  color: 'tomato',    shape: 'scallop' },
};
// Days keeps its own page (days.js paints it), so it has no header band here.
const IN_BAR = ['capture', 'days', 'notes', 'discover', 'threads', 'memory'];

// Where each chapter's header is: the view, the header row that becomes the
// band, and the screen's own title element, which moves in under the
// chapter's word (it carries live subtitles).
const HEADS = {
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
    watchDiscoverCount();
    watchCharCount();
    Object.keys(HEADS).forEach(buildHead);
    decorateSignin();
    watchChapters();
    watchSaves();
    watchTyping();
    watchFolding();
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
    // The hop plays on the inner span, not the <svg>: Chrome runs animations
    // on SVG elements on the main thread, which held every other animation
    // on the page to the main thread with it for the length of the hop.
    nav.innerHTML = `<span class="nw-tabs__pip" aria-hidden="true"><span class="nw-tabs__hop"><svg viewBox="-4 -4 108 108"><path d=""/></svg></span></span>`
        + IN_BAR.map((id) => {
            const c = CHAPTERS[id];
            return `<button type="button" class="nw-tabs__item" data-ch="${id}" aria-label="${c.tab}" style="--c:var(--${c.color})">
                ${ds.icon(c.icon, { size: 20, sw: 1.8 })}<span class="nw-tabs__lbl">${c.tab}</span></button>`;
        }).join('');
    document.body.appendChild(nav);
    nav.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ch]');
        if (b) go(b.dataset.ch);
    });
    window.addEventListener('resize', () => placePip(false));

    // Folded, the bar is this: a small ink dot at its centre carrying the
    // chapter's shape. Tapping it brings the bar back.
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.id = 'nw-tabs-dot';
    dot.className = 'nw-tabs-dot';
    dot.setAttribute('aria-label', 'Show chapters');
    dot.innerHTML = '<svg viewBox="-4 -4 108 108" aria-hidden="true"><path d=""/></svg>';
    dot.addEventListener('click', () => fold(false));
    document.body.appendChild(dot);
}

/** Fold the bar into its dot, or open it back out. */
function fold(on) {
    const root = document.documentElement;
    if (root.classList.contains('nw-tabs-folded') === on) return;
    root.classList.toggle('nw-tabs-folded', on);
    $('#nw-tabs')?.toggleAttribute('inert', on);
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
    if (id === 'days') {
        const intro = document.getElementById('days-intro');
        if (intro && !intro.hidden) {
            intro.hidden = true;
            try { localStorage.setItem('nw_days_intro_seen_2', '1'); } catch {}
        }
    }
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
    const dot = $('#nw-tabs-dot');
    dot?.style.setProperty('--c', `var(--${c.color})`);
    dot?.querySelector('path').setAttribute('d', ds.SHAPES[c.shape][0]);
    if (animate) {
        pip.classList.remove('is-hop');
        void pip.offsetWidth;
        pip.classList.add('is-hop');
    }
}

// Only the few attributes that decide the chapter are watched. Watching every
// class change under <body> woke this on each keystroke and list render.
function watchChapters() {
    const sync = () => {
        const next = chapterNow();
        document.documentElement.classList.toggle('nw-signed-out', !isSignedIn());
        if (next === current) return;
        const prev = current;
        current = next;
        document.documentElement.dataset.chapter = next;
        placePip(prev !== null);
        fold(false);
        if (next === 'capture') renderHome();
    };
    let queued = false;
    const mo = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; sync(); });
    });
    ['#notes-panel', '#signin-view', '#firebase-setup-view'].forEach((sel) => {
        const el = $(sel);
        if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-auth'] });
    const menu = $('#nav-menu');
    if (menu) mo.observe(menu, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    sync();
}

// Until the account has been read every view is hidden, which used to look
// like "signed in" and let the tab bar rise for a moment on the sign-in page.
// app.js sets data-auth once the account is known.
function isSignedIn() {
    if (document.documentElement.dataset.auth !== 'in') return false;
    const signin = $('#signin-view'), setup = $('#firebase-setup-view');
    return (!signin || signin.classList.contains('hidden')) && (!setup || setup.classList.contains('hidden'));
}

// ─── Home: the page ─────────────────────────────────────────────────
// Home is for writing, so the sheet carries nothing but the words. The
// greeting sits on the bar above it, which focus mode already fades out,
// so the words never move when it goes. The date is the way into the
// Almanac.
function buildHome() {
    const lead = $('#capture-view .top-bar')?.firstElementChild;
    if (!lead) return;
    const greet = document.createElement('div');
    greet.id = 'home-hero';
    greet.className = 'home-greet';
    lead.prepend(greet);
    greet.addEventListener('click', (e) => {
        if (e.target.closest('[data-go]')) go('activity');
    });
    renderHome();
}

function partOfDay(d = new Date()) {
    const h = d.getHours();
    return h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';
}

export function renderHome() {
    const greet = $('#home-hero');
    if (!greet) return;
    const now = new Date();
    const part = partOfDay(now);
    const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const hello = part === 'night' ? 'Still up,' : `Good ${part},`;
    greet.innerHTML = `
        <button type="button" class="home-greet__date" data-go="activity" aria-label="${date}. Open the Almanac">${date}${ds.icon('chevron-right', { size: 12, sw: 2 })}</button>
        <h1 class="home-greet__h">${hello} <em>${ctx.name()}</em></h1>`;
}

// Discover's waiting count, which app.js keeps in the old menu's badge,
// is carried on the Discover tab instead.
function watchDiscoverCount() {
    const src = $('#discover-badge');
    const tab = $('#nw-tabs [data-ch="discover"]');
    if (!src || !tab) return;
    const dot = document.createElement('span');
    dot.className = 'nw-tabs__badge';
    tab.appendChild(dot);
    const sync = () => {
        const n = src.classList.contains('hidden') ? 0 : parseInt(src.textContent, 10) || 0;
        dot.textContent = n > 9 ? '9+' : String(n);
        dot.hidden = !n;
        tab.setAttribute('aria-label', n ? `Discover, ${n} waiting` : 'Discover');
    };
    new MutationObserver(sync).observe(src, { attributes: true, childList: true, characterData: true, subtree: true });
    sync();
}

// The character count means nothing on a blank page, so it waits for words.
function watchCharCount() {
    const count = $('#char-count');
    const box = count?.closest('.char-meter-container');
    if (!box) return;
    const sync = () => box.classList.toggle('is-empty', count.textContent.trim() === '0');
    new MutationObserver(sync).observe(count, { childList: true, characterData: true, subtree: true });
    sync();
}

// ─── Chapter headers ────────────────────────────────────────────────
// Each chapter's header row is a band of its own colour, one row tall: the
// chapter's word, the screen's own title under it (so the live counts
// app.js writes there keep updating), and the screen's actions.
function buildHead(id) {
    const spec = HEADS[id];
    const c = CHAPTERS[id];
    const view = $(spec.view);
    const header = view?.querySelector(spec.header);
    if (!header) return;
    view.classList.add('ch-view');
    view.style.setProperty('--c', `var(--${c.color})`);
    header.classList.add('ch-head');
    const title = header.querySelector(spec.title);
    const block = document.createElement('div');
    block.className = 'ch-head__title';
    block.innerHTML = `<h2 class="ch-head__h">${c.word}</h2><div class="ch-head__sub"></div>`;
    if (title) block.lastElementChild.appendChild(title);
    header.prepend(block);
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
// the one signal to hang the moment on: the send button throws a burst.
// The sheet stays clear, so the next note can start straight away.
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
    // Days saves through the same composer and says "kept." on its own page;
    // the burst belongs to Send, so it waits for Write to be the page showing.
    if (current !== 'capture') return;
    const send = $('#btn-send');
    if (send) ds.burstAt(send, null, { count: 12, reach: 44 });
}

// ─── Typing: get out of the way ─────────────────────────────────────
// On a phone the keyboard takes half the screen; the tab bar steps aside
// while it is up. Focus alone is not the signal: the app focuses the
// composer on load, and that raises no keyboard. The visual viewport
// shrinking is.
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

// ─── Folding: make room to read ─────────────────────────────────────
// Scrolling down folds the bar into its dot; scrolling back up, reaching the
// top, or changing chapter opens it again. Every screen scrolls its own box,
// so scrolls are caught on the way down from the document.
// While a card, a concept or a synthesis is open, the bar steps aside
// altogether and comes back when it closes. (A note already sits over it.)
function watchFolding() {
    const last = new WeakMap();
    document.addEventListener('scroll', (e) => {
        const el = e.target === document ? document.scrollingElement : e.target;
        if (!el || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
        const y = el.scrollTop;
        const prev = last.get(el);
        last.set(el, y);
        if (prev === undefined) return;
        if (y < 24) fold(false);
        else if (y - prev > 10) fold(true);
        else if (prev - y > 10) fold(false);
    }, { capture: true, passive: true });

    const root = document.documentElement;
    const asides = ['#discover-card-view', '#concept-detail', '#synthesis-detail'].map((q) => $(q)).filter(Boolean);
    const update = () => root.classList.toggle('nw-tabs-away',
        asides.some((el) => !el.classList.contains('hidden') && el.checkVisibility()));
    const mo = new MutationObserver(update);
    asides.forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
    // The card view lives inside Discover, so leaving Discover hides it too.
    const discover = $('#discover-view');
    if (discover) mo.observe(discover, { attributes: true, attributeFilter: ['class'] });
    update();
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

#!/usr/bin/env node
/* ============================================================
   Noteworthy — add-tester.cjs
   Make someone an account, with a notebook of their own, in one line.
   ============================================================

   node scripts/add-tester.cjs "Anya Rao" anya@example.com
   node scripts/add-tester.cjs --list
   node scripts/add-tester.cjs --reset anya@example.com
   node scripts/add-tester.cjs --remove anya@example.com
   node scripts/add-tester.cjs --restore anya@example.com

   Adding someone creates their Firebase sign-in with a fresh password and puts
   a `profile` custom claim on it, which is the notebook firestore.rules lets
   them into. Nothing needs editing or deploying afterwards. The message to
   send them is printed and put on the clipboard.

   It acts as whoever the Firebase CLI is logged in as (`firebase login`), so
   only someone who already owns the project can run it. That is also why it
   borrows firebase-tools rather than holding a service-account key: there is
   no secret in this repo for it to leak.

   --remove switches the sign-in off rather than deleting it. Their notes stay,
   and --restore lets them back in.
   ============================================================ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PROJECT = 'noteworthy-4994f';
const APP_URL = 'https://prineethr.github.io/noteworthy/exp/';

// Owners' notebooks, and the testers who predate claims and live in
// TESTER_PROFILES. A claim saying any of these would open someone else's notes.
const TAKEN = ['prineeth', 'pramoddini', 'combined', 'harini', 'shreya', 'kalpesh'];

/**
 * firebase-tools is not a dependency of this repo; it is whatever `npx` or a
 * global install left on this machine. Look in the usual places for it.
 */
function firebaseTools() {
    const tries = [];
    if (process.env.FIREBASE_TOOLS) tries.push(process.env.FIREBASE_TOOLS);
    try { tries.push(path.dirname(require.resolve('firebase-tools/package.json'))); } catch (e) { /* not local */ }
    try {
        const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
        tries.push(path.join(root, 'firebase-tools'));
    } catch (e) { /* no npm on PATH */ }
    const npx = path.join(os.homedir(), '.npm', '_npx');
    if (fs.existsSync(npx)) {
        for (const d of fs.readdirSync(npx)) tries.push(path.join(npx, d, 'node_modules', 'firebase-tools'));
    }
    const found = tries.find(d => fs.existsSync(path.join(d, 'lib', 'gcp', 'auth.js')));
    if (!found) {
        fail('Could not find firebase-tools. Run `npx firebase-tools login` once, then try again.');
    }
    return path.join(found, 'lib');
}

function fail(message) {
    console.error(`\n  ${message}\n`);
    process.exit(1);
}

/** Lowercase letters and digits with the easily-confused ones left out, in three groups of four. */
function newPassword() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const chars = [...crypto.randomBytes(12)].map(b => alphabet[b % alphabet.length]);
    return [0, 4, 8].map(i => chars.slice(i, i + 4).join('')).join('-');
}

/** "Anya Rao" -> "anya"; if that is taken, "anyar", then "anya2", "anya3"… */
function pickProfile(name, taken) {
    const words = name.normalize('NFKD').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
    if (!words.length) fail(`"${name}" has no letters to make a notebook name from.`);
    const first = words[0];
    const options = [first];
    if (words[1]) options.push(first + words[1][0]);
    for (let n = 2; n < 100; n++) options.push(first + n);
    return options.find(p => !taken.has(p));
}

function claimsOf(user) {
    try { return JSON.parse(user.customAttributes || '{}'); } catch (e) { return {}; }
}

function copy(text) {
    try { execFileSync('pbcopy', { input: text }); return true; } catch (e) { return false; }
}

function welcome(name, email, password) {
    return [
        `Hi ${name.split(/\s+/)[0]}, here's your way into Noteworthy:`,
        '',
        APP_URL,
        `Email: ${email}`,
        `Password: ${password}`,
        '',
        "It's your own notebook, nobody else can see it.",
    ].join('\n');
}

async function main() {
    const args = process.argv.slice(2);
    if (!args.length || args.includes('--help') || args.includes('-h')) {
        console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(5, 12).map(l => l.replace(/^ {3}/, '')).join('\n'));
        return;
    }

    const lib = firebaseTools();
    const { requireAuth } = require(path.join(lib, 'requireAuth'));
    const { Client } = require(path.join(lib, 'apiv2'));
    const { identityOrigin } = require(path.join(lib, 'api'));
    const gauth = require(path.join(lib, 'gcp', 'auth'));

    try {
        await requireAuth({});
    } catch (e) {
        fail('The Firebase CLI is not logged in. Run `npx firebase-tools login`, then try again.');
    }
    const identity = new Client({ urlPrefix: identityOrigin(), auth: true });
    const update = body => identity.post('/v1/accounts:update', { targetProjectId: PROJECT, ...body });
    const byEmail = email => gauth.findUser(PROJECT, email).catch(() => fail(`No account for ${email}.`));

    const [flag, value] = args;

    if (flag === '--list') {
        const users = await gauth.listUsers(PROJECT, 1000);
        const testers = users.filter(u => claimsOf(u).profile);
        if (!testers.length) return console.log('\n  Nobody added with this script yet.\n');
        console.log('');
        for (const u of testers) {
            const off = u.disabled ? '  (removed)' : '';
            console.log(`  ${claimsOf(u).profile.padEnd(12)} ${(u.displayName || '').padEnd(20)} ${u.email}${off}`);
        }
        console.log('');
        return;
    }

    if (flag === '--reset') {
        if (!value) fail('Which email? node scripts/add-tester.cjs --reset anya@example.com');
        const user = await byEmail(value);
        const password = newPassword();
        await update({ localId: user.uid, password });
        const message = welcome(user.displayName || value, value, password);
        console.log(`\n${message}\n`);
        if (copy(message)) console.log('  (Copied to the clipboard.)\n');
        return;
    }

    if (flag === '--remove' || flag === '--restore') {
        if (!value) fail(`Which email? node scripts/add-tester.cjs ${flag} anya@example.com`);
        const user = await byEmail(value);
        await gauth.toggleUserEnablement(PROJECT, user.uid, flag === '--remove');
        console.log(flag === '--remove'
            ? `\n  ${value} can no longer sign in. Their notes are kept; --restore lets them back.\n`
            : `\n  ${value} can sign in again.\n`);
        return;
    }

    if (flag.startsWith('--')) fail(`Unknown option ${flag}. Try --help.`);

    const [name, rawEmail] = args;
    const email = (rawEmail || '').trim().toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        fail('Usage: node scripts/add-tester.cjs "Their Name" their@email.com');
    }

    const users = await gauth.listUsers(PROJECT, 1000);
    if (users.some(u => (u.email || '').toLowerCase() === email)) {
        fail(`${email} already has an account. Use --reset ${email} for a new password.`);
    }
    const taken = new Set([...TAKEN, ...users.map(u => claimsOf(u).profile).filter(Boolean)]);
    const profile = pickProfile(name, taken);
    const password = newPassword();

    const created = await identity.post(`/v1/projects/${PROJECT}/accounts`, {
        email, password, displayName: name.trim(),
    });
    const uid = created.body.localId;
    await update({ localId: uid, customAttributes: JSON.stringify({ profile }) });

    const message = welcome(name.trim(), email, password);
    console.log(`\n  Added ${name.trim()} with their own notebook, "${profile}".\n`);
    console.log(message.replace(/^/gm, '  '));
    console.log('');
    if (copy(message)) console.log('  (Copied to the clipboard, ready to paste.)\n');
}

main().catch(e => fail(e?.context?.body?.error?.message || e?.message || String(e)));

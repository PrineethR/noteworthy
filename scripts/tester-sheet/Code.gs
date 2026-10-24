/* ============================================================
   Noteworthy — the tester sheet
   A Google Sheet where each row is a person. Fill in a name and an email
   (and a password, or leave it blank for one to be made), then choose
   Noteworthy → Make accounts for new rows. The rest is done here.
   ============================================================

   Setting it up, once:
     1. Make a new Google Sheet. Keep it private — never "Publish to web",
        the way Daily Bread's questions sheet is. This one holds passwords.
     2. Extensions → Apps Script. Replace Code.gs with this file.
     3. Project Settings (the cog) → tick "Show appsscript.json manifest file
        in editor". Back in the editor, replace appsscript.json with the one
        beside this file.
     4. Save, reload the sheet, and use the Noteworthy menu. The first time,
        Google asks you to allow it; it will say the app is unverified,
        because it is yours — Advanced → Go to (unsafe) → Allow.

   It acts as you, with your Google sign-in, so it can only do what you can
   already do in the Firebase console. There is no key in it to leak.

   What a row turns into is the same as scripts/add-tester.cjs: a Firebase
   sign-in plus a `profile` custom claim naming their own notebook, which
   firestore.rules and app.js read. Nothing to edit or deploy per person.
   ============================================================ */

var PROJECT = 'noteworthy-4994f';
var APP_URL = 'https://prineethr.github.io/noteworthy/exp/';
var API = 'https://identitytoolkit.googleapis.com/v1/projects/' + PROJECT;

// Owners' notebooks, and the testers who predate claims. A claim naming any
// of these would open someone else's notes. Same list as add-tester.cjs.
var TAKEN = ['prineeth', 'pramoddini', 'combined', 'harini', 'shreya', 'kalpesh'];

var HEADERS = ['Name', 'Email', 'Password', 'Notebook', 'Status'];
var COL = { name: 1, email: 2, password: 3, notebook: 4, status: 5 };

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Noteworthy')
    .addItem('Make accounts for new rows', 'makeAccounts')
    .addSeparator()
    .addItem('Reset password (selected rows)', 'resetPasswords')
    .addItem('Remove access (selected rows)', 'removeAccess')
    .addItem('Restore access (selected rows)', 'restoreAccess')
    .addToUi();
  ensureHeaders_();
}

function ensureHeaders_() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var first = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (first.join('') === '') {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

/** Every row with a name and an email and nothing in Status yet. */
function makeAccounts() {
  ensureHeaders_();
  var sheet = SpreadsheetApp.getActiveSheet();
  var last = sheet.getLastRow();
  if (last < 2) return toast_('Add a name and an email on row 2 first.');

  var rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var taken = takenProfiles_();
  var made = 0, failed = 0;

  rows.forEach(function (r, i) {
    var row = i + 2;
    var name = String(r[COL.name - 1]).trim();
    var email = String(r[COL.email - 1]).trim().toLowerCase();
    var password = String(r[COL.password - 1]).trim();
    if (!name && !email) return;
    if (String(r[COL.status - 1]).trim()) return; // already done, or already failed: clear Status to retry

    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus_(sheet, row, 'Needs a name and an email', true);
      failed++;
      return;
    }
    if (!password) {
      password = newPassword_();
      sheet.getRange(row, COL.password).setValue(password);
    } else if (password.length < 6) {
      setStatus_(sheet, row, 'Password needs 6 or more characters', true);
      failed++;
      return;
    }

    try {
      var profile = pickProfile_(name, taken);
      var created = call_('/accounts', { email: email, password: password, displayName: name });
      call_('/accounts:update', { localId: created.localId, customAttributes: JSON.stringify({ profile: profile }) });
      taken[profile] = true;
      sheet.getRange(row, COL.notebook).setValue(profile);
      setStatus_(sheet, row, 'Account made ' + today_(), false);
      made++;
    } catch (e) {
      setStatus_(sheet, row, friendly_(e.message), true);
      failed++;
    }
  });

  toast_(made + ' made' + (failed ? ', ' + failed + ' need a look (see Status)' : '') +
    '. Their link: ' + APP_URL);
}

/** Puts each selected row's Password on their account; a blank one gets a new password. */
function resetPasswords() {
  forSelected_(function (sheet, row, user) {
    var password = String(sheet.getRange(row, COL.password).getValue()).trim();
    if (!password) {
      password = newPassword_();
      sheet.getRange(row, COL.password).setValue(password);
    }
    if (password.length < 6) throw new Error('Password needs 6 or more characters');
    call_('/accounts:update', { localId: user.localId, password: password });
    return 'Password reset ' + today_();
  });
}

/** Switches the sign-in off. Their notes stay, and Restore lets them back in. */
function removeAccess() {
  forSelected_(function (sheet, row, user) {
    call_('/accounts:update', { localId: user.localId, disableUser: true });
    return 'Removed ' + today_() + ' (notes kept)';
  });
}

function restoreAccess() {
  forSelected_(function (sheet, row, user) {
    call_('/accounts:update', { localId: user.localId, disableUser: false });
    return 'Restored ' + today_();
  });
}

function forSelected_(act) {
  var sheet = SpreadsheetApp.getActiveSheet();
  var range = sheet.getActiveRange();
  var done = 0;
  for (var row = range.getRow(); row < range.getRow() + range.getNumRows(); row++) {
    if (row < 2) continue;
    var email = String(sheet.getRange(row, COL.email).getValue()).trim().toLowerCase();
    if (!email) continue;
    try {
      var found = call_('/accounts:lookup', { email: [email] });
      if (!found.users || !found.users.length) throw new Error('No account for ' + email);
      setStatus_(sheet, row, act(sheet, row, found.users[0]), false);
      done++;
    } catch (e) {
      setStatus_(sheet, row, friendly_(e.message), true);
    }
  }
  toast_(done ? 'Done for ' + done + (done === 1 ? ' person.' : ' people.') : 'Select the rows first.');
}

/** The notebooks already handed out, so a second Anya becomes "anyar" rather than sharing. */
function takenProfiles_() {
  var taken = {};
  TAKEN.forEach(function (p) { taken[p] = true; });
  var offset = 0;
  while (true) {
    var res = call_('/accounts:query', { returnUserInfo: true, limit: '500', offset: String(offset) });
    var users = res.userInfo || [];
    users.forEach(function (u) {
      try {
        var p = JSON.parse(u.customAttributes || '{}').profile;
        if (p) taken[p] = true;
      } catch (e) { /* not one of ours */ }
    });
    if (users.length < 500) break;
    offset += users.length;
  }
  return taken;
}

/** "Anya Rao" -> "anya"; if that is taken, "anyar", then "anya2", "anya3"… */
function pickProfile_(name, taken) {
  var words = name.normalize('NFKD').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(String);
  if (!words.length) throw new Error('The name has no letters to make a notebook name from');
  var options = [words[0]];
  if (words[1]) options.push(words[0] + words[1][0]);
  for (var n = 2; n < 100; n++) options.push(words[0] + n);
  for (var i = 0; i < options.length; i++) if (!taken[options[i]]) return options[i];
  throw new Error('Ran out of notebook names for ' + name);
}

/** Lowercase letters and digits, the easily-confused ones left out, in three groups of four. */
function newPassword_() {
  var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  var bytes = Utilities.getUUID().replace(/-/g, '') + Utilities.getUUID().replace(/-/g, '');
  var out = '';
  for (var i = 0; i < 12; i++) {
    out += alphabet[parseInt(bytes.substr(i * 2, 2), 16) % alphabet.length];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}

/**
 * One call to the Identity Toolkit admin API, as you. x-goog-user-project
 * bills the call to the Noteworthy project rather than to the hidden project
 * Apps Script makes for this sheet, which has the API switched off.
 */
function call_(path, body) {
  var res = UrlFetchApp.fetch(API + path, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'x-goog-user-project': PROJECT,
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  var json = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) throw new Error((json.error && json.error.message) || ('HTTP ' + res.getResponseCode()));
  return json;
}

/** Firebase's error codes, said the way you'd say them. */
function friendly_(message) {
  if (/EMAIL_EXISTS/.test(message)) return 'That email already has an account';
  if (/INVALID_EMAIL/.test(message)) return 'That email does not look right';
  if (/WEAK_PASSWORD/.test(message)) return 'Password needs 6 or more characters';
  if (/PERMISSION_DENIED|403/.test(message)) return 'Your Google account cannot manage the Noteworthy project';
  return message;
}

function setStatus_(sheet, row, text, bad) {
  sheet.getRange(row, COL.status).setValue(text).setFontColor(bad ? '#b3261e' : '#1e6b3a');
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM');
}

function toast_(text) {
  SpreadsheetApp.getActive().toast(text, 'Noteworthy', 8);
}

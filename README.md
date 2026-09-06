I've always been interested in the idea of note-taking, and this app was an attempt to make note-taking a little bit easier for myself. It creates and tries to help you make connections and asks you more questions automatically as the note is inputted. 


## Getting in

The notebook lives in Firestore, and the only thing standing between it and the
public internet is `firestore.rules`. The web API key in `firebase.js` is an
identifier that ships in every page, and the profile PIN is checked in the
browser — neither one keeps anybody out.

Turning the lock, once, in this order (the app keeps working throughout):

1. **Firebase console → Authentication → Sign-in method → enable Email/Password.**
2. **Authentication → Users → Add user,** twice: one account each. Copy both
   **User UID** values.
3. Paste them into `firestore.rules`. ✅ Done — both uids are in the file.
4. Sign in on every device you use before the next step, so nothing gets locked
   out mid-sentence.
5. **Publish the rules** — paste the file into Firestore → Rules → Publish, or
   run `firebase deploy --only firestore:rules` if you have the CLI.

Step 5 is the one that closes the database. Until it runs, the rules are
whatever they are today, which is open to anyone.

To add a device later, sign in on it. To add a person, put their uid in
`firestore.rules` and publish again.

# Simple Meeting Notes v3

## Features
- Multiple users sign in with their own Google account.
- Google sign-in always opens the account chooser.
- Signed-in users can switch Google accounts.
- Canceled or blocked sign-in attempts recover cleanly so users can retry.
- No application backend or database server.
- User enters only **Meeting with**.
- Start / Pause / Resume / Stop.
- Personal notes while meeting.
- Live transcript hidden by default and shown on demand.
- On **Stop**, the app automatically generates a Markdown file and uploads it to the signed-in user's Google Drive.
- Filename format:
  `YYYY-MM-DD_HH-MM-SS-meeting-with-person-name.md`
- The app creates/uses a visible Google Drive folder named `Meeting Notes`.
- Active meeting state is cached in IndexedDB for recovery.
- No audio file is stored by the app.
- A live mic status badge (🎙️ Listening / ⏳ Reconnecting / ⚠️ error) shows whether speech capture is actually running, instead of a static "Recording" label.
- Speech capture keeps itself alive for the whole meeting: if the browser's recognizer stops itself (which it does periodically even mid-meeting), the app restarts it automatically, with a watchdog as a backup in case a restart silently fails.
- While recording, the app requests a screen wake lock (where supported) so the phone/laptop screen doesn't sleep and kill the microphone mid-meeting.
- If no voice is detected for **10 minutes straight**, the meeting stops itself automatically and saves what was captured, with a note explaining why.
- The service worker fetches app files network-first (falling back to its cache only when offline), so a new deploy is always picked up on the next reload instead of a returning visitor getting stuck on an old cached copy of the app.

## Google Cloud setup
1. Enable **Google Drive API**.
2. Configure **Google Auth Platform**.
3. Add scopes:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/drive.file`
4. Create an OAuth client of type **Web application**.
5. Add authorized JavaScript origins:
   - `http://localhost:8080`
   - `https://notes.qentrotech.com`
6. Put your client ID in `config.js`.
7. Do not put a client secret in the app.

### Important for other users
If the OAuth app is **External** and still in **Testing**, only Google accounts listed as Test users can sign in. To let broader users use it, update the Google Auth Platform audience/publishing status and complete any verification Google requires.

## Deploy
Upload these files to the root of your GitHub Pages repository or another HTTPS static host.

For `notes.qentrotech.com` on GitHub Pages:
- GitHub repository → Settings → Pages → Custom domain: `notes.qentrotech.com`
- Namecheap Advanced DNS:
  - Type: CNAME
  - Host: `notes`
  - Value: `YOUR-GITHUB-USERNAME.github.io`
  - TTL: Automatic
- Add `https://notes.qentrotech.com` to the Google OAuth client's Authorized JavaScript origins.

### If a device seems stuck on an old, broken version
The app is a PWA with a service worker (`service-worker.js`) that caches its own files so it can reopen offline. On any device that visited the site *before* this fix, that service worker installed once and (with the old cache-first version of the file) kept re-serving that first snapshot forever, no matter how many times the real files were fixed on the server — the browser only re-installs the service worker when `service-worker.js` itself changes, and the old version's cache name never changed across deploys.
After deploying this fix, most devices pick it up automatically on their next reload. If one still looks stuck (especially a phone with the app added to the home screen), do a one-time reset on that device: open the site in Chrome, go to **Site settings → Storage → Clear & reset** (or uninstall/reinstall the home-screen icon), then reopen it. From then on, updates should show up automatically on the next reload.

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

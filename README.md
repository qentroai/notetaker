# Personal Meeting Notes

A static, phone-friendly web app that:

- converts live speech to text;
- saves finalized text continuously in IndexedDB;
- stores no audio file;
- lets you mark important transcript segments;
- exports a readable Markdown file;
- uploads or updates that Markdown file directly in Google Drive;
- requires no backend and no database server.

## Important limitations

1. The app itself does not save audio, but the browser's speech-recognition service may process audio remotely.
2. Browser speech recognition may stop when the screen locks, the browser is backgrounded, or the operating system suspends the page.
3. Keep the page open and the phone awake during meetings.
4. Test with your phone and browser before relying on it for an important meeting.
5. Inform participants and obtain any consent required by applicable laws and policies.

## 1. Local test

Static OAuth and microphone features work best from an HTTP origin rather than by double-clicking `index.html`.

Run one of these commands from this directory:

```bash
python3 -m http.server 8080
```

or:

```bash
npx serve .
```

Then open:

```text
http://localhost:8080
```

For microphone access from a phone, deploy the site over HTTPS.

## 2. Google Cloud setup

### Create a project

1. Open Google Cloud Console.
2. Create a project, such as `Personal Meeting Notes`.
3. Confirm that the project is selected.

### Enable Google Drive API

1. Open **APIs & Services → Library**.
2. Search for **Google Drive API**.
3. Select it and click **Enable**.

### Configure Google Auth Platform / OAuth consent

Google's console labels can change, but look under **Google Auth Platform** or **APIs & Services → OAuth consent screen**.

1. Add an application name, such as `Personal Meeting Notes`.
2. Add your support email.
3. Choose the audience:
   - **External** for a personal Gmail account or accounts outside one Workspace organization.
   - **Internal** only when the app is restricted to your own eligible Google Workspace organization.
4. Add your own Google account as a test user if the app remains in testing.
5. Add the scope:
   `https://www.googleapis.com/auth/drive.file`

The `drive.file` scope lets the app create and manage files it creates. It does not grant unrestricted access to every Drive file.

### Create an OAuth client

1. Open **Clients** or **Credentials**.
2. Create an **OAuth client ID**.
3. Select **Web application**.
4. Add every exact site origin under **Authorized JavaScript origins**.

Examples:

```text
http://localhost:8080
https://your-github-name.github.io
https://notes.yourdomain.com
```

An origin contains only the scheme, hostname, and optional port. Do not add a path such as `/personal-meeting-notes/`.

5. Copy the OAuth Client ID.

### Configure the app

Open `config.js` and replace:

```js
GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com"
```

with your actual client ID.

Do not put a client secret in this project. Browser OAuth clients do not use a client secret.

## 3. Deploy

You can deploy this folder to any static HTTPS host.

### GitHub Pages

1. Create a GitHub repository.
2. Upload all files in this folder.
3. Open **Settings → Pages**.
4. Deploy from the `main` branch and root folder.
5. Add the GitHub Pages origin to the OAuth client's **Authorized JavaScript origins**.
6. Wait for the HTTPS site to publish.
7. Open the site on your phone.

### Netlify

1. Sign in to Netlify.
2. Create a new site by uploading this folder or connecting the repository.
3. Add the resulting HTTPS origin to Google's OAuth client.
4. Redeploy after editing `config.js`.

### Vercel

1. Import the repository into Vercel.
2. Use a static deployment with no build command required.
3. Add the resulting HTTPS origin to Google's OAuth client.

## 4. Use

1. Open the deployed site.
2. Enter a meeting title and participants.
3. Press **Start transcription** and allow microphone access.
4. Keep the phone awake and the page visible.
5. Tap **Mark important** after an important statement.
6. Press **Stop** when finished.
7. Press **Connect Google Drive**.
8. Approve the requested Drive permission.
9. Press **Save Markdown to Drive**.

The app creates a visible folder named:

```text
Meeting Notes
```

The first save creates a Markdown file. Later saves of the same local meeting update that file instead of creating another copy.

## 5. File format

Example:

```markdown
# Coffee with Dr. Sean

**Started:** 8/6/2026, 10:00 AM
**Ended:** 8/6/2026, 10:45 AM
**Participants:** Sophie, Sean

## Important Points

- The practice wants a better patient follow-up process.

## Personal Notes

Send a short assessment outline.

## Transcript

The practice wants a better patient follow-up process.
```

## 6. Troubleshooting

### `origin_mismatch`

The exact site origin is missing from the OAuth client's Authorized JavaScript origins. Add it, save, and try again.

### Google says the app is unverified

Keep the app in testing and add your Google account as a test user. For a private personal app, do not publish it broadly unless you understand Google's verification requirements.

### Connect works, but saving fails

Confirm:

- Google Drive API is enabled;
- the OAuth client is a Web application;
- `drive.file` is included;
- the deployed origin matches exactly;
- your Google Workspace administrator does not block the requested scope.

### Transcript stops

Keep the browser foregrounded and the screen awake. Press Start again after long silence or browser suspension.

### No speech-recognition support

Use a supported browser. Current Chrome on Android is the primary target. Browser support varies, especially on desktop Firefox and across iOS versions.

## 7. Privacy

- Transcript drafts remain in your browser's IndexedDB.
- Google access tokens are held only in page memory and are not deliberately saved to localStorage or IndexedDB.
- The app sends Markdown text directly from the browser to Google Drive.
- The app has no application server.
- Clearing the local copy does not delete a file already uploaded to Google Drive.

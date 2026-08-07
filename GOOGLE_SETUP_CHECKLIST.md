# Google Drive Setup Checklist

- [ ] Create or select a Google Cloud project.
- [ ] Enable Google Drive API.
- [ ] Configure Google Auth Platform / OAuth consent.
- [ ] Select External or Internal audience appropriately.
- [ ] Add your Google account as a test user when using Testing mode.
- [ ] Add scope: `https://www.googleapis.com/auth/drive.file`
- [ ] Create OAuth client ID of type **Web application**.
- [ ] Add local origin, such as `http://localhost:8080`.
- [ ] Add production HTTPS origin.
- [ ] Copy OAuth Client ID into `config.js`.
- [ ] Do not add a client secret.
- [ ] Deploy all files to a static HTTPS host.
- [ ] Test Google Drive connection.
- [ ] Test creation of the `Meeting Notes` folder.
- [ ] Test Markdown creation and update.
- [ ] Test transcription on the actual phone and browser.

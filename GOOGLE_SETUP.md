# Google Setup Changes for v2

The app now signs each user into their own Google account and saves the Markdown file directly to that user's Drive.

Required scopes:
- openid
- email
- profile
- https://www.googleapis.com/auth/drive.file

OAuth client type:
- Web application

Authorized JavaScript origin:
- https://notes.qentrotech.com

Edit only `config.js` after creating the Google OAuth client.

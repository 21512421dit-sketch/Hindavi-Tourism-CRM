# Hindavi Tourism CRM · Full-stack

A local full-stack version of the Hindavi Tourism CRM prototype. The frontend is plain HTML/CSS/JavaScript. The backend uses Node's built-in HTTP server and SQLite, so there are no packages to install.

## Run

Requires Node.js 22.5 or newer.

```powershell
npm start
```

Open <http://127.0.0.1:3000>. Data is stored in `data/hindavi.sqlite`.

## Test

```powershell
npm test
```

The app binds to localhost and has no user authentication. Keep it local unless authentication, HTTPS, user roles and deployment hardening are added.

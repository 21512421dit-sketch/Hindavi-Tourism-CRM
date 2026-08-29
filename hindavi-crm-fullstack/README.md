# Hindavi Tourism CRM · Full-stack

A local full-stack version of the Hindavi Tourism CRM prototype. The frontend is plain HTML/CSS/JavaScript. The backend uses Node's built-in HTTP server and SQLite, so there are no packages to install.

## Run

Requires Node.js 22.5 or newer.

```powershell
npm start
```

Open <http://127.0.0.1:3000>. CRM data is stored in `data/hindavi.sqlite`; user accounts are stored separately in `data/auth.sqlite`.

On the first start, one-time admin and employee credentials are written to `data/initial-login.txt`. Both users must replace their temporary password before accessing CRM data. The file is removed automatically after both accounts have completed that change.

Administrators can access all sections. Employees can operate leads, quotations, packages, customers, bookings, and visa cases, while finance, suppliers, reports, settings, backups, confirmation, deletion, and booking financial fields remain server-restricted.

## Test

```powershell
npm test
```

The app binds to localhost by default and includes server-side authentication, role authorization, CSRF protection, expiring sessions, login throttling, and salted scrypt password hashes. If it is deployed beyond localhost, terminate TLS in front of it and protect the `data` directory with operating-system access controls and backups.

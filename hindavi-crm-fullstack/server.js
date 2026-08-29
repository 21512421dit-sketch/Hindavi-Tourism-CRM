import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openDatabase, collections, estimateTravel } from './db.js';
import { generatePassword, openAuthStore } from './auth.js';

const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const security = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://loremflickr.com https://images.unsplash.com; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};
const employeeRead = new Set(['leads', 'customers', 'bookings', 'visas', 'packages']);
const employeeWrite = new Set(['leads', 'customers', 'bookings', 'visas', 'packages']);
const sessionAbsoluteMs = 8 * 60 * 60 * 1000;
const sessionIdleMs = 30 * 60 * 1000;
const loginWindowMs = 15 * 60 * 1000;
const loginAttemptLimit = 5;
const loginIpAttemptLimit = 20;
const loginTrackerLimit = 5000;

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function json(response, status, value, extra = {}) { response.writeHead(status, { ...security, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); response.end(JSON.stringify(value)); }
function error(response, failure) { if (!failure.status) console.error(failure); json(response, failure.status || 500, { error: failure.status ? failure.message : 'The server could not complete the request.' }, failure.retryAfter ? { 'Retry-After': String(failure.retryAfter) } : {}); }
async function body(request, limit = 1_000_000) { let text = ''; for await (const chunk of request) { text += chunk; if (text.length > limit) fail('Request is too large.', 413); } if (!text) return {}; try { return JSON.parse(text); } catch { fail('Request body must be valid JSON.'); } }
function cookies(request) { return Object.fromEntries(String(request.headers.cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => { const index = part.indexOf('='); return index < 0 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)]; })); }
function secureCookie(request) { return request.socket.encrypted ? '; Secure' : ''; }
function sessionCookie(request, token, maxAge = 28800) { return `hindavi_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie(request)}`; }
function safeEqual(a, b) { const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || '')); return left.length === right.length && timingSafeEqual(left, right); }
function employeeBranding(settings) { return { business: settings.business || 'Hindavi Tourism' }; }
function employeeBooking(row) { const { total, taxRate, invoice, ...safe } = row; return safe; }
function sanitizeRecord(user, collection, record) { return user.role === 'employee' && collection === 'bookings' ? employeeBooking(record) : record; }
function stateFor(db, user) {
  const state = db.state();
  if (user.role === 'admin') return state;
  return { leads: state.leads, customers: state.customers, bookings: state.bookings.map(employeeBooking), visas: state.visas, payments: [], suppliers: [], packages: state.packages, settings: employeeBranding(state.settings), quote: state.quote, explorer: state.explorer };
}

export function createServer({ database = join(root, 'data', 'hindavi.sqlite'), authDatabase = join(dirname(database), 'auth.sqlite'), credentials = null, requirePasswordChange = true } = {}) {
  mkdirSync(dirname(database), { recursive: true });
  const db = openDatabase(database), auth = openAuthStore(authDatabase), sessions = new Map(), attempts = new Map(), ipAttempts = new Map();
  const configured = [
    { username: 'admin', displayName: 'Admin', role: 'admin', password: credentials?.admin || process.env.HINDAVI_ADMIN_PASSWORD || generatePassword(), generated: !credentials?.admin && !process.env.HINDAVI_ADMIN_PASSWORD },
    { username: 'employee', displayName: 'Employee', role: 'employee', password: credentials?.employee || process.env.HINDAVI_EMPLOYEE_PASSWORD || generatePassword(), generated: !credentials?.employee && !process.env.HINDAVI_EMPLOYEE_PASSWORD }
  ];
  const created = auth.ensureUsers(configured, requirePasswordChange), credentialsFile = join(dirname(authDatabase), 'initial-login.txt');
  const generated = created.filter(user => configured.find(entry => entry.username === user.username)?.generated);
  if (generated.length) writeFileSync(credentialsFile, generated.map(user => `${user.role.toUpperCase()}\nUsername: ${user.username}\nTemporary password: ${user.password}\n`).join('\n'), { encoding: 'utf8', mode: 0o600 });

  function cleanSessions(now = Date.now()) { for (const [token, session] of sessions) if (session.absoluteExpires <= now || session.lastSeen + sessionIdleMs <= now) sessions.delete(token); }
  function currentSession(request) {
    cleanSessions();
    const token = cookies(request).hindavi_session, session = token && sessions.get(token), now = Date.now();
    if (!session || session.absoluteExpires <= now || session.lastSeen + sessionIdleMs <= now) { if (token) sessions.delete(token); return null; }
    const user = auth.get(session.username); if (!user) { sessions.delete(token); return null; }
    session.lastSeen = now; return { token, session, user };
  }
  function requireSession(request) { const current = currentSession(request); if (!current) fail('Authentication required.', 401); return current; }
  function requireAdmin(current) { if (current.user.role !== 'admin') fail('Administrator access required.', 403); }
  function requireMutation(request, current) {
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) fail('Cross-origin request blocked.', 403);
    if (!safeEqual(request.headers['x-csrf-token'], current.session.csrfToken)) fail('Invalid security token. Reload and try again.', 403);
  }
  function clientAddress(request) { return request.socket.remoteAddress || 'local'; }
  function cleanAttempts(store, now) { for (const [key, values] of store) { const recent = values.filter(time => now - time < loginWindowMs); if (recent.length) store.set(key, recent); else store.delete(key); } }
  function rateKey(request, username) { return `${clientAddress(request)}|${String(username || '').trim().toLowerCase().slice(0, 64)}`; }
  function checkLoginRate(request, username) {
    const key = rateKey(request, username), ipKey = clientAddress(request), now = Date.now();
    cleanAttempts(attempts, now); cleanAttempts(ipAttempts, now);
    if (attempts.size >= loginTrackerLimit && !attempts.has(key)) fail('Login service is temporarily busy. Try again later.', 429);
    const recent = attempts.get(key) || [], ipRecent = ipAttempts.get(ipKey) || [];
    const limited = recent.length >= loginAttemptLimit ? recent : ipRecent.length >= loginIpAttemptLimit ? ipRecent : null;
    if (limited) { const wait = Math.ceil((loginWindowMs - (now - limited[0])) / 1000); const problem = new Error('Too many login attempts. Try again later.'); problem.status = 429; problem.retryAfter = wait; throw problem; }
    return { key, ipKey, recent, ipRecent };
  }
  function recordLoginFailure(rate) { const now = Date.now(); rate.recent.push(now); rate.ipRecent.push(now); attempts.set(rate.key, rate.recent); ipAttempts.set(rate.ipKey, rate.ipRecent); }
  function createSession(user) { const token = randomBytes(32).toString('base64url'), now = Date.now(), session = { username: user.username, csrfToken: randomBytes(24).toString('base64url'), lastSeen: now, absoluteExpires: now + sessionAbsoluteMs }; sessions.set(token, session); return { token, session }; }
  function canRead(user, collection) { return user.role === 'admin' || employeeRead.has(collection); }
  function canWrite(user, collection) { return user.role === 'admin' || employeeWrite.has(collection); }
  function employeeBookingInput(input, existing = null) {
    return existing ? { ...existing, ...input, total: existing.total, taxRate: existing.taxRate, invoice: existing.invoice, status: existing.status, stage: existing.stage === 5 ? 5 : Math.min(4, Math.max(1, Number(input.stage) || existing.stage || 1)) } : { ...input, total: 0, taxRate: 0, invoice: '', status: 'Pending', stage: Math.min(4, Math.max(1, Number(input.stage) || 1)) };
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost'), parts = url.pathname.split('/').filter(Boolean);
      if (url.pathname === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true });
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        const input = await body(request, 20_000), rate = checkLoginRate(request, input.username), user = await auth.authenticate(input.username, input.password);
        if (!user) { recordLoginFailure(rate); fail('Invalid username or password.', 401); }
        attempts.delete(rate.key); const createdSession = createSession(user);
        return json(response, 200, { user, csrfToken: createdSession.session.csrfToken }, { 'Set-Cookie': sessionCookie(request, createdSession.token) });
      }
      if (url.pathname === '/api/auth/me' && request.method === 'GET') { const current = requireSession(request); return json(response, 200, { user: current.user, csrfToken: current.session.csrfToken }); }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') { const current = requireSession(request); requireMutation(request, current); sessions.delete(current.token); return json(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie(request, '', 0) }); }
      if (url.pathname === '/api/auth/password' && request.method === 'PUT') {
        const current = requireSession(request); requireMutation(request, current); const input = await body(request, 20_000);
        const user = await auth.changePassword(current.user.username, input.currentPassword, input.newPassword);
        for (const [token, session] of sessions) if (session.username === current.user.username && token !== current.token) sessions.delete(token);
        current.session.csrfToken = randomBytes(24).toString('base64url');
        if (!auth.hasPendingPasswordChanges() && existsSync(credentialsFile)) unlinkSync(credentialsFile);
        return json(response, 200, { user, csrfToken: current.session.csrfToken });
      }

      const current = parts[0] === 'api' ? requireSession(request) : null;
      if (current?.user.mustChangePassword) fail('Password change required before accessing CRM data.', 403);
      if (parts[0] === 'api' && !['GET', 'HEAD'].includes(request.method)) requireMutation(request, current);
      if (url.pathname === '/api/state' && request.method === 'GET') return json(response, 200, stateFor(db, current.user));
      if (url.pathname === '/api/backup' && request.method === 'GET') { requireAdmin(current); return json(response, 200, db.backup()); }
      if (url.pathname === '/api/restore' && request.method === 'POST') { requireAdmin(current); return json(response, 200, db.restore(await body(request, 10_000_000))); }
      if (url.pathname === '/api/travel/estimate' && request.method === 'POST') return json(response, 200, estimateTravel(await body(request)));
      if (parts[0] === 'api' && parts[1] === 'meta' && parts[2]) {
        const key = parts[2]; if (current.user.role === 'employee' && !['quote', 'explorer'].includes(key)) requireAdmin(current);
        if (request.method === 'GET') return json(response, 200, db.meta(key));
        if (request.method === 'PUT') return json(response, 200, db.meta(key, await body(request)));
      }
      if (parts[0] === 'api' && parts[1] === 'bookings' && parts[2] && parts[3] === 'confirm' && request.method === 'POST') { requireAdmin(current); return json(response, 200, db.confirmBooking(parts[2])); }
      if (parts[0] === 'api' && parts[1] === 'payments' && parts[2] && parts[3] === 'receipts' && request.method === 'POST') { requireAdmin(current); return json(response, 201, db.receipt(parts[2], await body(request))); }
      if (parts[0] === 'api' && collections.includes(parts[1])) {
        const collection = parts[1], id = parts[2]; if (!canRead(current.user, collection)) fail('You do not have access to this data.', 403);
        if (request.method === 'GET') { const value = id ? db.get(collection, id) : db.list(collection); return json(response, 200, Array.isArray(value) ? value.map(row => sanitizeRecord(current.user, collection, row)) : sanitizeRecord(current.user, collection, value)); }
        if (!canWrite(current.user, collection)) fail('You do not have permission to change this data.', 403);
        if (request.method === 'POST' && !id) { let input = await body(request); if (current.user.role === 'employee' && collection === 'bookings') input = employeeBookingInput(input); const saved = db.save(collection, input); return json(response, 201, sanitizeRecord(current.user, collection, saved)); }
        if (request.method === 'PUT' && id) { let input = await body(request); if (current.user.role === 'employee' && collection === 'bookings') input = employeeBookingInput(input, db.get(collection, id)); const saved = db.save(collection, input, id); return json(response, 200, sanitizeRecord(current.user, collection, saved)); }
        if (request.method === 'DELETE' && id) { requireAdmin(current); db.remove(collection, id); response.writeHead(204, security); return response.end(); }
      }
      if (parts[0] === 'api') return json(response, 404, { error: 'API route not found.' });
      serveStatic(url.pathname, response);
    } catch (failure) { error(response, failure); }
  });
  server.on('close', () => { db.close(); auth.close(); });
  server.credentialsFile = credentialsFile;
  return server;
}

function serveStatic(pathname, response) {
  const publicRoot = resolve(root, 'public'), relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''), target = normalize(resolve(publicRoot, relative));
  if (target !== publicRoot && !target.startsWith(`${publicRoot}${sep}`)) { response.writeHead(403, security); return response.end('Forbidden'); }
  try { if (!statSync(target).isFile()) throw new Error(); const extension = extname(target); response.writeHead(200, { ...security, 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); response.end(readFileSync(target)); }
  catch { response.writeHead(404, { ...security, 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found'); }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  const server = createServer(); server.listen(port, host, () => { console.log(`Hindavi CRM running at http://${host}:${port}`); if (existsSync(server.credentialsFile)) console.log(`One-time login credentials: ${server.credentialsFile}`); });
}

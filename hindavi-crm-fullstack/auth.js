import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const roles = new Set(['admin', 'employee']);
const usernamePattern = /^[a-z][a-z0-9._-]{2,31}$/;
const passwordBytes = 64;
const scryptAsync = promisify(scrypt);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function normalizeUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!usernamePattern.test(username)) fail('Enter a valid username.');
  return username;
}

function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 12 || password.length > 128) fail('Password must be 12–128 characters.');
  return password;
}

function derive(password, salt) {
  return scryptSync(password, salt, passwordBytes);
}

async function deriveLogin(password, salt) {
  return Buffer.from(await scryptAsync(password, salt, passwordBytes));
}

function publicUser(row) {
  return { username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: Boolean(row.must_change) };
}

export function generatePassword() {
  return `${randomBytes(15).toString('base64url')}!9a`;
}

export function openAuthStore(filename) {
  const sql = new DatabaseSync(filename);
  sql.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','employee')),
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      must_change INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);

  const api = {
    close() { sql.close(); },
    ensureUsers(entries, mustChange = true) {
      const created = [];
      const exists = sql.prepare('SELECT 1 FROM users WHERE username=?');
      const insert = sql.prepare('INSERT INTO users (username,display_name,role,salt,password_hash,must_change) VALUES (?,?,?,?,?,?)');
      for (const entry of entries) {
        const username = normalizeUsername(entry.username);
        if (exists.get(username)) continue;
        if (!roles.has(entry.role)) fail('Invalid account role.');
        const password = validatePassword(entry.password), salt = randomBytes(16).toString('hex');
        insert.run(username, String(entry.displayName || username).trim(), entry.role, salt, derive(password, salt).toString('hex'), mustChange ? 1 : 0);
        created.push({ username, displayName: entry.displayName, role: entry.role, password });
      }
      return created;
    },
    async authenticate(usernameValue, passwordValue) {
      let username;
      try { username = normalizeUsername(usernameValue); } catch { username = 'invalid-user'; }
      const password = String(passwordValue || ''), row = sql.prepare('SELECT * FROM users WHERE username=?').get(username);
      const salt = row?.salt || '00000000000000000000000000000000';
      const expected = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(passwordBytes);
      const actual = await deriveLogin(password, salt);
      if (!row || !timingSafeEqual(actual, expected)) return null;
      return publicUser(row);
    },
    get(usernameValue) {
      const username = normalizeUsername(usernameValue), row = sql.prepare('SELECT * FROM users WHERE username=?').get(username);
      return row ? publicUser(row) : null;
    },
    async changePassword(usernameValue, currentPassword, nextPassword) {
      const username = normalizeUsername(usernameValue), row = sql.prepare('SELECT * FROM users WHERE username=?').get(username);
      if (!row) fail('Account not found.', 404);
      if (!row.must_change) {
        const actual = await deriveLogin(String(currentPassword || ''), row.salt), expected = Buffer.from(row.password_hash, 'hex');
        if (!timingSafeEqual(actual, expected)) fail('Current password is incorrect.', 403);
      }
      const password = validatePassword(nextPassword);
      const salt = randomBytes(16).toString('hex'), hash = (await deriveLogin(password, salt)).toString('hex');
      sql.prepare('UPDATE users SET salt=?,password_hash=?,must_change=0,updated_at=CURRENT_TIMESTAMP WHERE username=?').run(salt, hash, username);
      return api.get(username);
    },
    hasPendingPasswordChanges() {
      return Boolean(sql.prepare('SELECT 1 FROM users WHERE must_change=1 LIMIT 1').get());
    }
  };
  return api;
}

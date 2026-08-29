import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.js';

let server, base;
const clients = {};
const passwords = { admin: 'Admin-Test-Password!2026', employee: 'Employee-Test-Password!2026' };

async function raw(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers });
  const value = response.status === 204 ? null : await response.json();
  return { response, value };
}

async function login(username) {
  const result = await raw('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password: passwords[username] }) });
  assert.equal(result.response.status, 200);
  return { cookie: result.response.headers.get('set-cookie').split(';')[0], csrf: result.value.csrfToken, user: result.value.user, setCookie: result.response.headers.get('set-cookie') };
}

async function request(path, options = {}) {
  const client = clients[options.client || 'admin'], method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}), Cookie: client.cookie };
  if (!['GET', 'HEAD'].includes(method) && options.csrf !== false) headers['X-CSRF-Token'] = client.csrf;
  return raw(path, { ...options, method, headers });
}

test.before(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hindavi-test-'));
  server = createServer({ database: join(directory, 'test.sqlite'), authDatabase: join(directory, 'auth.sqlite'), credentials: passwords, requirePasswordChange: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  clients.admin = await login('admin');
  clients.employee = await login('employee');
});
test.after(() => server ? new Promise(resolve => server.close(resolve)) : undefined);

test('health and frontend are public but CRM state requires authentication', async () => {
  assert.deepEqual((await raw('/api/health')).value, { ok: true });
  assert.equal((await raw('/api/state')).response.status, 401);
  const state = (await request('/api/state')).value;
  assert.equal(state.leads.length, 3);
  assert.ok(state.packages.length >= 8);
  assert.equal(state.settings.business, 'Hindavi Tourism');
  const html = await fetch(base).then(response => response.text());
  assert.match(html, /id="loginForm"/);
  assert.match(clients.admin.setCookie, /HttpOnly/);
  assert.match(clients.admin.setCookie, /SameSite=Strict/);
});

test('mutations require a valid session CSRF token', async () => {
  const rejected = await request('/api/leads', { method: 'POST', csrf: false, body: JSON.stringify({}) });
  assert.equal(rejected.response.status, 403);
  assert.match(rejected.value.error, /security token/i);
});

test('employee API responses and routes enforce role restrictions', async () => {
  const state = (await request('/api/state', { client: 'employee' })).value;
  assert.deepEqual(state.payments, []);
  assert.deepEqual(state.suppliers, []);
  assert.equal('gstin' in state.settings, false);
  assert.deepEqual(Object.keys(state.settings), ['business']);
  assert.ok(state.bookings.every(row => !('total' in row) && !('taxRate' in row) && !('invoice' in row)));
  assert.equal((await request('/api/payments', { client: 'employee' })).response.status, 403);
  assert.equal((await request('/api/backup', { client: 'employee' })).response.status, 403);
  assert.equal((await request('/api/bookings/HT-26077/confirm', { client: 'employee', method: 'POST' })).response.status, 403);
  const packageRow = structuredClone(state.packages[0]); packageRow.tagline = 'Employee-edited package';
  const updated = await request(`/api/packages/${packageRow.id}`, { client: 'employee', method: 'PUT', body: JSON.stringify(packageRow) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.value.tagline, 'Employee-edited package');
});

test('employee create cannot collide with or reset an existing booking', async () => {
  const before = (await request('/api/bookings/HT-26081', { client: 'employee' })).value;
  const attempted = await request('/api/bookings', { client: 'employee', method: 'POST', body: JSON.stringify({ ...before, id: before.id, customer: 'Collision Attempt', departure: '2026-12-15', return: '2026-12-20' }) });
  assert.equal(attempted.response.status, 201);
  assert.notEqual(attempted.value.id, before.id);
  const after = (await request('/api/bookings/HT-26081')).value;
  assert.equal(after.customer, 'Sameer More');
  assert.equal(after.total, 640000);
  assert.equal(after.status, 'Confirmed');
});

test('shared quotation and explorer metadata reject malformed nested data', async () => {
  const badExplorer = await request('/api/meta/explorer', { client: 'employee', method: 'PUT', body: JSON.stringify({ saved: {}, recent: [] }) });
  assert.equal(badExplorer.response.status, 400);
  const badQuote = await request('/api/meta/quote', { client: 'employee', method: 'PUT', body: JSON.stringify({ items: {} }) });
  assert.equal(badQuote.response.status, 400);
  const injectedMode = await request('/api/meta/explorer', { client: 'employee', method: 'PUT', body: JSON.stringify({ saved: [], recent: [{ mode: '<meta http-equiv=refresh>', from: 'Pune', to: 'Dubai', departure: '2026-12-01' }] }) });
  assert.equal(injectedMode.response.status, 400);
  const validMultiCity = await request('/api/meta/explorer', { client: 'employee', method: 'PUT', body: JSON.stringify({ saved: [], recent: [{ mode: 'flights', trip: 'multi', cabin: 'Economy', from: 'Pune', to: 'Delhi', departure: '2026-12-01', adults: 2, children: 0, infants: 0, rooms: 1, legs: [{ from: 'Pune', to: 'Delhi', date: '2026-12-01' }, { from: 'Delhi', to: 'Goa', date: '2026-12-03' }] }] }) });
  assert.equal(validMultiCity.response.status, 200);
  assert.equal(validMultiCity.value.recent[0].legs.length, 2);
});

test('CRUD validates input and persists records for administrators', async () => {
  const invalid = await request('/api/leads', { method: 'POST', body: JSON.stringify({ name: '' }) });
  assert.equal(invalid.response.status, 400);
  const created = await request('/api/leads', { method: 'POST', body: JSON.stringify({ name: 'Test Lead', phone: '9876543210', destination: 'Goa', date: '2026-12-01', source: 'Referral', owner: 'Snehal', followup: '', status: 'New' }) });
  assert.equal(created.response.status, 201);
  assert.match(created.value.id, /^LEA-/);
  created.value.status = 'Follow-up';
  const updated = await request(`/api/leads/${created.value.id}`, { method: 'PUT', body: JSON.stringify(created.value) });
  assert.equal(updated.value.status, 'Follow-up');
  assert.equal((await request(`/api/leads/${created.value.id}`)).value.name, 'Test Lead');
});

test('travel estimates cover flights, hotels, cabs and manual fallbacks', async () => {
  const common = { from: 'Pune', to: 'Delhi', departure: '2026-12-01', adults: 2, children: 1, infants: 1, rooms: 1 };
  const flight = (await request('/api/travel/estimate', { method: 'POST', body: JSON.stringify({ ...common, mode: 'flights', trip: 'oneway', cabin: 'Economy' }) })).value;
  assert.equal(flight.offers[0].price, 18525);
  const hotel = (await request('/api/travel/estimate', { method: 'POST', body: JSON.stringify({ ...common, mode: 'hotels', to: 'Kerala', returnDate: '2026-12-06' }) })).value;
  assert.equal(hotel.offers[0].price, 14000);
  const cab = (await request('/api/travel/estimate', { method: 'POST', body: JSON.stringify({ ...common, mode: 'cabs', to: 'Mumbai' }) })).value;
  assert.equal(cab.offers[0].price, 2600);
  const unknown = (await request('/api/travel/estimate', { method: 'POST', body: JSON.stringify({ ...common, mode: 'flights', to: 'Unknown', trip: 'oneway', cabin: 'Economy' }) })).value;
  assert.equal(unknown.manual, true);
});

test('payment receipts cannot overpay an invoice', async () => {
  const state = (await request('/api/state')).value, payment = state.payments.find(row => row.invoice === 'INV-1082');
  const added = await request(`/api/payments/${payment.id}/receipts`, { method: 'POST', body: JSON.stringify({ amount: 1000.50, date: '2026-08-28', method: 'UPI', reference: 'TEST' }) });
  assert.equal(added.response.status, 201);
  assert.equal(added.value.payment.received, 321000.5);
  const rejected = await request(`/api/payments/${payment.id}/receipts`, { method: 'POST', body: JSON.stringify({ amount: 9999999, date: '2026-08-28', method: 'Cash' }) });
  assert.equal(rejected.response.status, 400);
  assert.match(rejected.value.error, /exceeds/);
});

test('booking confirmation synchronizes invoice, customer, lead and dashboard state', async () => {
  const first = (await request('/api/bookings/HT-26077/confirm', { method: 'POST' })).value, second = (await request('/api/bookings/HT-26077/confirm', { method: 'POST' })).value;
  assert.equal(first.booking.status, 'Confirmed');
  assert.equal(second.booking.invoice, first.booking.invoice);
  const state = (await request('/api/state')).value;
  assert.equal(state.payments.filter(row => row.invoice === first.booking.invoice).length, 1);
  assert.equal(state.customers.filter(row => row.phone === first.booking.phone).length, 1);
  assert.equal(state.customers.find(row => row.phone === first.booking.phone).lastTrip, 'Kerala · 2026');
  assert.equal(state.leads.find(row => row.phone === first.booking.phone).status, 'Confirmed');
});

test('backup restore rejects malformed data without replacing state', async () => {
  const before = (await request('/api/state')).value.leads.length;
  const bad = await request('/api/restore', { method: 'POST', body: JSON.stringify({ schema: 1, leads: [] }) });
  assert.equal(bad.response.status, 400);
  assert.equal((await request('/api/state')).value.leads.length, before);
});

test('booking dates, invoice balances and package image hosts are protected', async () => {
  const badBooking = await request('/api/bookings', { method: 'POST', body: JSON.stringify({ customer: 'Test', phone: '9876543210', trip: 'Goa', type: 'Domestic', services: 'Hotel', departure: '2026-12-10', return: '2026-12-01', total: 10000, taxRate: 5, status: 'Pending', stage: 1 }) });
  assert.equal(badBooking.response.status, 400);
  const badInvoice = await request('/api/payments', { method: 'POST', body: JSON.stringify({ invoice: 'INV-BAD', customer: 'Test', total: 1000, received: 2000, due: '2026-12-01' }) });
  assert.equal(badInvoice.response.status, 400);
  const sample = structuredClone((await request('/api/packages')).value[0]); sample.image = 'https://evil.example/payload.jpg';
  const badImage = await request(`/api/packages/${sample.id}`, { method: 'PUT', body: JSON.stringify(sample) });
  assert.equal(badImage.response.status, 400);
  assert.match(badImage.value.error, /approved HTTPS image host/);
  const backup = (await request('/api/backup')).value;
  backup.leads[0].id = 'bad\" onclick=alert(1)';
  const badIdentifier = await request('/api/restore', { method: 'POST', body: JSON.stringify(backup) });
  assert.equal(badIdentifier.response.status, 400);
  assert.match(badIdentifier.value.error, /record ID/i);
});

test('changing a password invalidates other sessions for that account', async () => {
  const other = await login('admin');
  const changed = await request('/api/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword: passwords.admin, newPassword: 'Changed-Admin-Password!2026' }) });
  assert.equal(changed.response.status, 200);
  clients.admin.csrf = changed.value.csrfToken;
  const stale = await raw('/api/state', { headers: { Cookie: other.cookie } });
  assert.equal(stale.response.status, 401);
  assert.equal((await request('/api/state')).response.status, 200);
});

test('login throttling cannot be bypassed by rotating usernames', async () => {
  for (let index = 0; index < 20; index++) {
    const result = await raw('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: `guess${String(index).padStart(3, '0')}`, password: 'Wrong-Password!2026' }) });
    assert.equal(result.response.status, 401);
  }
  const limited = await raw('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'another-guess', password: 'Wrong-Password!2026' }) });
  assert.equal(limited.response.status, 429);
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0);
});

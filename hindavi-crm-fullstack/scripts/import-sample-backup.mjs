import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db.js';

const sourcePath = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!sourcePath) throw new Error('Pass the Hindavi sample backup JSON path.');

const root = JSON.parse(readFileSync(sourcePath, 'utf8'));
if (root.format !== 'hindavi-crm-backup' || root.version !== 2 || !root.data) {
  throw new Error('Expected a Hindavi CRM version 2 backup.');
}

const source = root.data;
const required = ['leads', 'customers', 'bookings', 'visas', 'payments', 'suppliers', 'packages'];
for (const key of required) if (!Array.isArray(source[key])) throw new Error(`Backup is missing ${key}.`);

const leadId = id => String(id).startsWith('LEA') ? String(id) : `LEAD-${String(id).padStart(6, '0')}`;
const allowedVisaStates = new Set(['Documents pending', 'Appointment booked', 'Submitted', 'Approved', 'Rejected']);
const allowedColors = ['japan', 'kashmir', 'bali', 'dubai', 'kerala'];
const colorFor = destination => allowedColors.find(color => String(destination).toLowerCase().includes(color)) || 'kerala';
const realDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';

const converted = {
  schema: 1,
  leads: source.leads.map(row => ({ ...row, id: leadId(row.id), followup: realDate(row.followup) })),
  customers: source.customers.map(row => ({ ...row, id: String(row.id), documents: String(row.documents || ''), lastTrip: String(row.lastTrip || '') })),
  bookings: source.bookings.map(row => ({
    ...row,
    id: String(row.id),
    stage: Math.min(5, Math.max(1, Number(row.stage) || 1)),
    invoice: String(row.invoice || ''),
    leadId: row.leadId == null ? '' : leadId(row.leadId)
  })),
  visas: source.visas.map(row => {
    const total = Math.max(1, Number(row.total) || 1);
    const status = allowedVisaStates.has(row.status) ? row.status : 'Documents pending';
    const done = ['Submitted', 'Approved'].includes(status) ? total : Math.min(total, Math.max(0, Number(row.done) || 0));
    return { ...row, id: String(row.id), appointment: realDate(row.appointment), total, done, status };
  }),
  payments: source.payments.map(row => ({
    ...row,
    id: String(row.id),
    invoice: String(row.invoice || '').toUpperCase(),
    receipts: Array.isArray(row.receipts) ? row.receipts.map((receipt, index) => ({ id: receipt.id || `REC-${row.id}-${index + 1}`, ...receipt })) : []
  })),
  suppliers: source.suppliers.map(row => ({ ...row, id: String(row.id) })),
  packages: source.packages.map(row => {
    const destination = String(row.destination || String(row.route || '').split('·')[0] || row.name).trim();
    const nights = Math.max(1, Number(row.nights) || Number.parseInt(String(row.duration), 10) || 1);
    return {
      ...row,
      id: String(row.id),
      destination,
      nights,
      theme: row.theme || 'Family',
      flights: row.flights || 'Not included',
      stars: Math.min(5, Math.max(1, Number(row.stars) || 3)),
      color: colorFor(destination),
      tagline: row.tagline || `${row.duration} journey through ${row.route}`
    };
  }),
  settings: {
    business: 'Hindavi Tourism', gstin: '', phone: '919820000000', email: 'hello@hindavitourism.in', address: 'Pune, Maharashtra', payment: '', terms: '',
    ...(source.settings || {})
  },
  quote: { customer: '', phone: '', email: '', destination: '', start: '', duration: '', travellers: 2, departure: 'Pune', itinerary: '', details: '', taxRate: 5, items: [] },
  explorer: { saved: [], recent: [] }
};

const counts = Object.fromEntries(required.map(key => [key, converted[key].length]));
if (dryRun) {
  console.log(JSON.stringify({ valid: true, counts }, null, 2));
} else {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const databasePath = process.env.HINDAVI_DATABASE_PATH || join(projectRoot, 'data', 'hindavi.sqlite');
  const database = openDatabase(databasePath);
  try {
    const result = database.restore(converted);
    console.log(JSON.stringify({ imported: true, database: databasePath, counts: Object.fromEntries(required.map(key => [key, result[key].length])) }, null, 2));
  } finally {
    database.close();
  }
}

const fs = require('node:fs');
const path = require('node:path');

const STORAGE_FILE = process.env.DEMO_APPLICATION_STORE_FILE || path.join(__dirname, '..', 'data', 'demo-applications.json');

function ensureStore() {
  const dir = path.dirname(STORAGE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORAGE_FILE)) {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify([]));
  }
}

function readStore() {
  ensureStore();
  const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function writeStore(records) {
  ensureStore();
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(records, null, 2));
}

function makeId() {
  return `demo-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeApp(app) {
  return {
    ...app,
    id: String(app.id),
    status: app.status || 'pending',
    submitted_at: app.submitted_at || new Date().toISOString(),
    reviewed_at: app.reviewed_at || null,
    reviewer_id: app.reviewer_id || null,
    processed_by_admin_id: app.processed_by_admin_id || null,
    processed_by_admin_name: app.processed_by_admin_name || null,
    processed_by_admin_profile_picture_url: app.processed_by_admin_profile_picture_url || null,
    action_type: app.action_type || null,
    processed_at: app.processed_at || null,
    issuer_id: app.issuer_id ?? 1
  };
}

function createApplication({ issuerId, orgName, orgType, website, contactName, contactEmail, generatedEmail, contactRole, volume, useCase, wallet }) {
  const records = readStore();
  const app = normalizeApp({
    id: makeId(),
    issuer_id: issuerId || 1,
    organization_name: orgName,
    organization_type: orgType,
    organization_website: website,
    contact_name: contactName,
    contact_email: contactEmail,
    generated_email: generatedEmail,
    contact_role: contactRole,
    certificate_volume: volume,
    use_case: useCase,
    wallet_address: wallet,
    status: 'pending',
    submitted_at: new Date().toISOString(),
    reviewed_at: null,
    reviewer_id: null
  });
  records.push(app);
  writeStore(records);
  return {
    id: app.id,
    organization_name: app.organization_name,
    contact_email: app.contact_email,
    generated_email: app.generated_email,
    status: app.status,
    submitted_at: app.submitted_at
  };
}

function getApplicationsByStatus(status, limit = 50, offset = 0) {
  const records = readStore();
  const filtered = records.filter(app => app.status === status).slice(offset, offset + limit);
  return filtered.map(item => normalizeApp(item));
}

function getAllApplications(limit = 50, offset = 0) {
  const records = readStore();
  return records.slice(offset, offset + limit).map(item => normalizeApp(item));
}

function findApplicationByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return readStore()
    .filter(app => [app.contact_email, app.generated_email].some(value => String(value || '').trim().toLowerCase() === normalizedEmail))
    .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
    .map(app => ({ status: app.status }))[0] || null;
}

function countByStatus(status) {
  const records = readStore();
  return records.filter(app => app.status === status).length;
}

function updateStatus(appId, status, reviewerId, adminName = null, adminPicture = null) {
  const records = readStore();
  const index = records.findIndex(app => String(app.id) === String(appId));
  if (index < 0) return null;

  const processedAt = new Date().toISOString();
  records[index] = normalizeApp({
    ...records[index],
    status,
    reviewed_at: processedAt,
    reviewer_id: reviewerId || null,
    processed_by_admin_id: reviewerId || null,
    processed_by_admin_name: adminName || null,
    processed_by_admin_profile_picture_url: adminPicture || null,
    action_type: status === 'approved' ? 'APPROVED' : 'REJECTED',
    processed_at: processedAt
  });
  writeStore(records);
  return records[index];
}

module.exports = {
  createApplication,
  getAllApplications,
  getApplicationsByStatus,
  findApplicationByEmail,
  countByStatus,
  updateStatus
};

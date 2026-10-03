const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fetch = require('cross-fetch');

let server;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'certicheck-applications-'));

async function startServer() {
  const app = require('../src/server');
  return new Promise((resolve, reject) => {
    server = app.listen(0, () => resolve(server.address().port));
    server.on('error', reject);
  });
}

test.before(async () => {
  process.env.DEMO_MODE = 'true';
  process.env.DEMO_APPLICATION_STORE_FILE = path.join(tempDir, 'applications.json');
  process.env.TEST_SERVER_PORT = await startServer();
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function submitApplication(overrides = {}, endpoint = '/api/applications/submit') {
  return fetch(`http://localhost:${process.env.TEST_SERVER_PORT}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgName: 'Acme University',
      orgType: 'university',
      contactName: 'Ada Lovelace',
      contactEmail: 'ada@acme.edu',
      contactRole: 'Registrar',
      volume: '1 – 100 certificates',
      ...overrides
    })
  });
}

async function adminRequest(route, method = 'GET') {
  return fetch(`http://localhost:${process.env.TEST_SERVER_PORT}/api/applications${route}`, {
    method,
    headers: {
      Authorization: 'Bearer demo-token',
      'x-demo-user-type': 'admin',
      'Content-Type': 'application/json'
    }
  });
}

test('public issuer applications are saved and send a confirmation notification', async () => {
  const submitResponse = await submitApplication(
    { useCase: 'Academic credentials', wallet: 'demo-wallet' },
    '/api/issuers/apply'
  );
  const submitted = await submitResponse.json();
  assert.equal(submitResponse.status, 201, JSON.stringify(submitted));
  assert.equal(submitted.success, true);
  assert.equal(submitted.application.contact_email, 'ada@acme.edu');
  assert.deepEqual(submitted.notification, { emailSent: true });

  const queueResponse = await adminRequest('/pending?limit=50&offset=0');
  const queue = await queueResponse.json();
  assert.equal(queueResponse.status, 200, JSON.stringify(queue));
  assert.ok(queue.applications.some(app => app.contact_email === 'ada@acme.edu'));
});

test('public application submissions allow optional use case and wallet but validate contact email', async () => {
  const optionalResponse = await submitApplication({
    orgName: 'Optional Fields Org',
    contactName: 'Alex Applicant',
    contactEmail: 'alex@optional-fields.example'
  });
  const optionalData = await optionalResponse.json();
  assert.equal(optionalResponse.status, 201, JSON.stringify(optionalData));
  assert.equal(optionalData.application.contact_email, 'alex@optional-fields.example');

  const invalidResponse = await submitApplication({ contactEmail: 'not-an-email' });
  assert.equal(invalidResponse.status, 400);
});

test('admin application decisions return delivery status for approval email', async () => {
  const createResponse = await submitApplication({
    orgName: 'Decision University',
    contactName: 'Grace Hopper',
    contactEmail: 'grace@decision.example'
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, JSON.stringify(created));

  const approveResponse = await fetch(
    `http://localhost:${process.env.TEST_SERVER_PORT}/api/admin/issuers/${created.application.id}/approve`,
    {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer demo-token',
        'x-demo-user-type': 'admin',
        'Content-Type': 'application/json'
      }
    }
  );
  const approved = await approveResponse.json();
  assert.equal(approveResponse.status, 200, JSON.stringify(approved));
  assert.equal(approved.application.status, 'approved');
  assert.deepEqual(approved.notification, { emailSent: false });

  const rejectedApplication = await submitApplication({
    orgName: 'Rejected University',
    contactName: 'Katherine Johnson',
    contactEmail: 'katherine@rejected.example'
  });
  const rejectedCreated = await rejectedApplication.json();
  const rejectResponse = await adminRequest(`/${rejectedCreated.application.id}/reject`, 'PUT');
  const rejected = await rejectResponse.json();
  assert.equal(rejectResponse.status, 200, JSON.stringify(rejected));
  assert.equal(rejected.application.status, 'rejected');
  assert.equal(Object.hasOwn(rejected, 'notification'), false);
});

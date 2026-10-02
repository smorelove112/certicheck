const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EmailService = require('../src/services/emailService');

let server;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'certicheck-applications-'));
const applicationEmails = [];
const originalSendApplicationReceived = EmailService.sendApplicationReceived;
const originalSendApplicationDecision = EmailService.sendApplicationDecision;
const originalGetConfigurationStatus = EmailService.getConfigurationStatus;
const originalGetReadiness = EmailService.getReadiness;

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), 'Expected asynchronous application follow-up to complete');
}

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
  EmailService.sendApplicationReceived = async (...args) => {
    applicationEmails.push({ type: 'received', args });
    return { messageId: 'test-received' };
  };
  EmailService.getReadiness = () => ({ configured: true, verified: true });
  EmailService.sendApplicationDecision = async (...args) => {
    applicationEmails.push({ type: 'decision', args });
    return { messageId: 'test-decision' };
  };
  process.env.TEST_SERVER_PORT = await startServer();
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  EmailService.sendApplicationReceived = originalSendApplicationReceived;
  EmailService.sendApplicationDecision = originalSendApplicationDecision;
  EmailService.getConfigurationStatus = originalGetConfigurationStatus;
  EmailService.getReadiness = originalGetReadiness;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('public application submissions are visible to admin review queue', async () => {
  const port = process.env.TEST_SERVER_PORT;
  const base = `http://localhost:${port}`;

  const submitResponse = await fetch(`${base}/api/applications/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgName: 'Acme University',
      orgType: 'university',
      website: 'https://acme.edu',
      contactName: 'Ada Lovelace',
      contactEmail: 'ada@acme.edu',
      contactRole: 'Registrar',
      volume: '1 – 100 certificates',
      useCase: 'Academic credential issuance',
      wallet: 'demo-wallet'
    })
  });

  const submitData = await submitResponse.json();
  assert.equal(submitResponse.status, 201, `Unexpected submit status: ${JSON.stringify(submitData)}`);
  assert.ok(submitData.success, `Submission should succeed: ${JSON.stringify(submitData)}`);
  assert.equal(submitData.notification.emailSent, false);
  assert.equal(submitData.notification.emailPending, true);
  await waitFor(() => applicationEmails.some(email =>
    email.type === 'received' && email.args[0] === 'ada@acme.edu'
  ));
  assert.ok(applicationEmails.some(email =>
    email.type === 'received' && email.args[0] === 'ada@acme.edu'
  ), 'Successful submission should send a receipt to the applicant contact email');

  const adminResponse = await fetch(`${base}/api/applications/pending?limit=50&offset=0`, {
    headers: {
      Authorization: 'Bearer demo-token',
      'x-demo-user-type': 'admin',
      'Content-Type': 'application/json'
    }
  });

  const pendingData = await adminResponse.json();
  assert.equal(adminResponse.status, 200, `Unexpected pending status: ${JSON.stringify(pendingData)}`);
  assert.ok(
    pendingData.applications.some(app => app.contact_email === 'ada@acme.edu' || app.contactEmail === 'ada@acme.edu'),
    `Expected submitted app in pending queue: ${JSON.stringify(pendingData.applications.slice(0, 5))}`
  );
});

test('public application submissions do not require a use case or wallet address', async () => {
  const port = process.env.TEST_SERVER_PORT;
  const response = await fetch(`http://localhost:${port}/api/applications/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgName: 'Optional Fields Org',
      orgType: 'university',
      contactName: 'Alex Applicant',
      contactEmail: 'alex@optional-fields.example',
      contactRole: 'Registrar',
      volume: '1 – 100 certificates'
    })
  });

  const data = await response.json();
  assert.equal(response.status, 201, `Unexpected submit status: ${JSON.stringify(data)}`);
  assert.ok(data.success, `Submission should succeed: ${JSON.stringify(data)}`);
  assert.equal(data.notification.emailSent, false);
  assert.equal(data.notification.emailPending, true);
  await waitFor(() => applicationEmails.some(email =>
    email.type === 'received' && email.args[0] === 'alex@optional-fields.example'
  ));
});

test('issuer application response does not wait for email delivery', async () => {
  const originalSendApplicationReceived = EmailService.sendApplicationReceived;
  let releaseDelivery;
  let markStarted;
  const deliveryStarted = new Promise(resolve => { markStarted = resolve; });
  const delivery = new Promise(resolve => { releaseDelivery = resolve; });
  EmailService.sendApplicationReceived = async () => {
    markStarted();
    await delivery;
    return { messageId: 'delayed-email' };
  };

  try {
    const startedAt = Date.now();
    const response = await fetch(`http://localhost:${process.env.TEST_SERVER_PORT}/api/applications/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgName: 'Fast Response University',
        orgType: 'university',
        contactName: 'Taylor Applicant',
        contactEmail: 'taylor@fast-response.example',
        contactRole: 'Registrar',
        volume: '1 – 100 certificates'
      })
    });

    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.notification.emailPending, true);
    assert.ok(Date.now() - startedAt < 1000, 'Submission should not wait on slow SMTP delivery');

    await deliveryStarted;
  } finally {
    releaseDelivery();
    EmailService.sendApplicationReceived = originalSendApplicationReceived;
  }
});

test('admin dashboard reflects approved applications in demo mode', async () => {
  const port = process.env.TEST_SERVER_PORT;
  const base = `http://localhost:${port}`;

  const createResponse = await fetch(`${base}/api/applications/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgName: 'Demo Approved Org',
      orgType: 'school',
      website: 'https://demo-approved.example',
      contactName: 'Grace Hopper',
      contactEmail: 'grace@demo-approved.example',
      contactRole: 'Operations Lead',
      volume: '1 – 100 certificates',
      useCase: 'Testing admin dashboard',
      wallet: 'demo-wallet-approved'
    })
  });

  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, `Unexpected create status: ${JSON.stringify(created)}`);
  const appId = created.application.id;

  const approveResponse = await fetch(`${base}/api/applications/${appId}/approve`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer demo-token',
      'x-demo-user-type': 'admin',
      'Content-Type': 'application/json'
    }
  });

  const approvedData = await approveResponse.json();
  assert.equal(approveResponse.status, 200, `Unexpected approve status: ${JSON.stringify(approvedData)}`);
  assert.equal(approvedData.notification.emailSent, false);
  assert.equal(approvedData.notification.emailPending, true);
  await waitFor(() => applicationEmails.some(email =>
    email.type === 'decision' && email.args[0] === 'grace@demo-approved.example' && email.args[3] === true
  ));
  assert.ok(applicationEmails.some(email =>
    email.type === 'decision' && email.args[0] === 'grace@demo-approved.example' && email.args[3] === true
  ), 'Approved application should send an approval email to the applicant contact email');

  const dashboardResponse = await fetch(`${base}/api/admin/dashboard`, {
    headers: {
      Authorization: 'Bearer demo-token',
      'x-demo-user-type': 'admin',
      'Content-Type': 'application/json'
    }
  });
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboardResponse.status, 200, `Dashboard should work in demo mode: ${JSON.stringify(dashboard)}`);
  assert.ok(dashboard.stats?.approvedApplications >= 1, `Approved count should reflect approved applications: ${JSON.stringify(dashboard)}`);
  assert.ok(dashboard.approvedApplications?.some(app => app.contact_email === 'grace@demo-approved.example'), 'Dashboard overview should include approved applications');
  assert.ok(Array.isArray(dashboard.pendingApplications), 'Dashboard overview should include pending applications');
  assert.ok(Array.isArray(dashboard.rejectedApplications), 'Dashboard overview should include rejected applications');
  assert.ok(Array.isArray(dashboard.history), 'Dashboard overview should include verification history');
  assert.ok(Array.isArray(dashboard.revoked), 'Dashboard overview should include revoked certificates');
  assert.ok(Array.isArray(dashboard.auditLog), 'Dashboard overview should include audit entries');

  const approvedListResponse = await fetch(`${base}/api/applications/approved?limit=50&offset=0`, {
    headers: {
      Authorization: 'Bearer demo-token',
      'x-demo-user-type': 'admin',
      'Content-Type': 'application/json'
    }
  });
  const approvedList = await approvedListResponse.json();
  assert.equal(approvedListResponse.status, 200, `Approved list should return in demo mode: ${JSON.stringify(approvedList)}`);
  assert.ok(approvedList.applications.some(app => app.contact_email === 'grace@demo-approved.example' || app.contactEmail === 'grace@demo-approved.example'), `Approved application should appear in approved queue: ${JSON.stringify(approvedList.applications.slice(0, 10))}`);
});

test('rejected applications send a decision email to the applicant contact email', async () => {
  const port = process.env.TEST_SERVER_PORT;
  const base = `http://localhost:${port}`;
  const createResponse = await fetch(`${base}/api/applications/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgName: 'Rejected University',
      orgType: 'university',
      contactName: 'Taylor Applicant',
      contactEmail: 'taylor@example.edu',
      contactRole: 'Registrar'
    })
  });

  {
    const port = process.env.TEST_SERVER_PORT;
    const base = `http://localhost:${port}`;
    const createResponse = await fetch(`${base}/api/applications/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgName: 'Notification Failure University',
        orgType: 'university',
        contactName: 'Morgan Applicant',
        contactEmail: 'morgan@notification-failure.example',
        contactRole: 'Registrar'
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);

    const originalSend = EmailService.sendApplicationDecision;
    EmailService.sendApplicationDecision = async () => null;
    try {
      const response = await fetch(`${base}/api/applications/${created.application.id}/approve`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer demo-token',
          'x-demo-user-type': 'admin',
          'Content-Type': 'application/json'
        }
      });
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(result.success, true);
      assert.equal(result.notification.emailSent, false);
    } finally {
      EmailService.sendApplicationDecision = originalSend;
    }
  }
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, `Unexpected create status: ${JSON.stringify(created)}`);

  const rejectResponse = await fetch(`${base}/api/applications/${created.application.id}/reject`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer demo-token',
      'x-demo-user-type': 'admin',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reason: 'Application incomplete' })
  });
  const rejected = await rejectResponse.json();
  assert.equal(rejectResponse.status, 200, `Unexpected reject status: ${JSON.stringify(rejected)}`);
  assert.equal(rejected.notification.emailSent, false);
  assert.equal(rejected.notification.emailPending, true);
  await waitFor(() => applicationEmails.some(email =>
    email.type === 'decision' &&
    email.args[0] === 'taylor@example.edu' &&
    email.args[3] === false &&
    email.args[4] === 'Application incomplete'
  ));
  assert.ok(applicationEmails.some(email =>
    email.type === 'decision' &&
    email.args[0] === 'taylor@example.edu' &&
    email.args[3] === false &&
    email.args[4] === 'Application incomplete'
  ), 'Rejected application should send a decision email to the applicant contact email');
});

test('approval response does not wait for slow decision email delivery', async () => {
  const createResponse = await fetch(`http://localhost:${process.env.TEST_SERVER_PORT}/api/applications/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgName: 'Fast Approval University',
      orgType: 'university',
      contactName: 'Jordan Applicant',
      contactEmail: 'jordan@fast-approval.example',
      contactRole: 'Registrar'
    })
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201);

  const originalSendApplicationDecision = EmailService.sendApplicationDecision;
  let releaseDelivery;
  let markStarted;
  const deliveryStarted = new Promise(resolve => { markStarted = resolve; });
  const delivery = new Promise(resolve => { releaseDelivery = resolve; });
  EmailService.sendApplicationDecision = async () => {
    markStarted();
    await delivery;
    return { messageId: 'delayed-decision-email' };
  };

  try {
    const startedAt = Date.now();
    const response = await fetch(`http://localhost:${process.env.TEST_SERVER_PORT}/api/applications/${created.application.id}/approve`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer demo-token',
        'x-demo-user-type': 'admin',
        'Content-Type': 'application/json'
      }
    });
    const result = await response.json();
    assert.equal(response.status, 200, `Unexpected approval status: ${JSON.stringify(result)}`);
    assert.equal(result.success, true);
    assert.equal(result.notification.emailPending, true);
    assert.ok(Date.now() - startedAt < 500, 'Approval response should not wait for SMTP delivery');
    await deliveryStarted;

    const approvedList = await fetch(`http://localhost:${process.env.TEST_SERVER_PORT}/api/applications/approved`, {
      headers: { Authorization: 'Bearer demo-token', 'x-demo-user-type': 'admin' }
    });
    const approved = await approvedList.json();
    assert.ok(approved.applications.some(app => String(app.id) === String(created.application.id)), 'Application status should be saved before response');
  } finally {
    releaseDelivery();
    EmailService.sendApplicationDecision = originalSendApplicationDecision;
  }
});

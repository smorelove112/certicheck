const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GMAIL_CLIENT_ID = 'test-client-id';
process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
process.env.GMAIL_FROM = 'sender@example.test';
process.env.NODE_ENV = 'production';

const delivered = [];
const emailService = require('../src/services/emailService');

function decodeMimeBodies(request) {
  const raw = Buffer.from(request.requestBody.raw, 'base64url').toString();
  const bodies = [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)(?=\r\n--certicheck-|$)/g)]
    .map(([, body]) => Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString());
  return { raw, bodies };
}

test('Gmail API is configured with OAuth refresh-token credentials', () => {
  assert.equal(emailService.mode, 'gmail-api');
  assert.equal(emailService.getFromAddress(), process.env.GMAIL_FROM);
  assert.deepEqual(emailService.getStatus().missingSettings, []);
  assert.deepEqual(emailService.oauth2Client.credentials, {
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
  });
});

test('Gmail API reports missing setting names without exposing credential values', () => {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  delete process.env.GMAIL_REFRESH_TOKEN;
  try {
    emailService.initTransporter();
    const status = emailService.getStatus();
    assert.equal(status.configured, false);
    assert.deepEqual(status.missingSettings, ['GMAIL_REFRESH_TOKEN']);
    assert.equal(JSON.stringify(status).includes(process.env.GMAIL_CLIENT_SECRET), false);
  } finally {
    process.env.GMAIL_REFRESH_TOKEN = refreshToken;
    emailService.initTransporter();
  }
});

test('Gmail API verifies OAuth credentials and reports only a safe status', async () => {
  emailService.oauth2Client.getAccessToken = async () => ({ token: 'test-access-token' });
  const status = await emailService.verifyTransport();
  assert.deepEqual(status, {
    mode: 'gmail-api',
    configured: true,
    verification: 'authenticated',
    errorCode: null,
    missingSettings: []
  });

  emailService.oauth2Client.getAccessToken = async () => {
    const error = new Error('Invalid refresh token');
    error.code = 'invalid_grant';
    throw error;
  };
  const failedStatus = await emailService.verifyTransport();
  assert.equal(failedStatus.verification, 'failed');
  assert.equal(failedStatus.errorCode, 'invalid_grant');
  assert.equal(JSON.stringify(failedStatus).includes(process.env.GMAIL_REFRESH_TOKEN), false);
});

test('onboarding and credential emails use Gmail API and preserve attachments', async () => {
  emailService.oauth2Client.getAccessToken = async () => ({ token: 'test-access-token' });
  emailService.gmailApi.users.messages.send = async request => {
    delivered.push(request);
    return { data: { id: `dummy-${delivered.length}` } };
  };

  assert.equal(await emailService.sendApplicationReceived({
    to: 'applicant@example.edu',
    contactName: 'Ada <Admin>',
    organizationName: 'Example University'
  }), true);

  assert.equal(await emailService.sendApplicationApproval({
    to: 'applicant@example.edu',
    contactName: 'Ada',
    organizationName: 'Example University',
    activationCode: '123456',
    activationUrl: 'https://certicheck.example/activate-account'
  }), true);

  assert.equal(await emailService.sendCertificateIssued({
    certificate_id: 'CERT-EMAIL-001',
    certificate_type: 'Computer Science',
    holder_name: 'Grace Hopper',
    holder_email: 'grace@example.edu',
    issuer_name: 'Example University',
    ipfs_cid: 'bafy-example',
    ipfs_source: 'pinata',
    blockchain_transaction_id: 'dummy-signature',
    metadata: { program: 'Computer Science', graduationYear: 2026, attachment: { cid: 'not-included' } }
  }, 'https://certicheck.example/?certificateId=CERT-EMAIL-001'), true);

  assert.equal(delivered.length, 3);
  const { raw: applicationRaw, bodies: applicationBodies } = decodeMimeBodies(delivered[0]);
  const { bodies: approvalBodies } = decodeMimeBodies(delivered[1]);
  const { raw: certificateRaw, bodies: certificateBodies } = decodeMimeBodies(delivered[2]);
  assert.equal(delivered[0].userId, 'me');
  assert.match(applicationBodies.join(''), /Application received/);
  assert.match(applicationBodies.join(''), /Ada &lt;Admin&gt;/);
  assert.match(approvalBodies.join(''), /123456/);
  assert.match(approvalBodies.join(''), /activate-account/);
  assert.match(certificateRaw, /To: grace@example\.edu/);
  assert.match(certificateBodies.join(''), /Computer Science/);
  assert.match(certificateBodies.join(''), /2026/);
  assert.match(certificateBodies.join(''), /gateway\.pinata\.cloud\/ipfs\/bafy-example/);
  assert.match(certificateBodies.join(''), /explorer\.solana\.com\/tx\/dummy-signature\?cluster=devnet/);
  assert.match(certificateBodies.join(''), /certificate-verification-qr/);
  assert.match(certificateRaw, /Content-ID: <certificate-verification-qr>/);
  assert.match(certificateRaw, /Content-Type: image\/png; name="certificate-verification\.png"/);
  assert.equal(certificateBodies.join('').includes('not-included'), false);

  assert.equal(await emailService.sendOTP('grace@example.edu', '246810'), true);
  assert.equal(delivered.length, 4);
  const { raw: otpRaw, bodies: otpBodies } = decodeMimeBodies(delivered[3]);
  assert.match(otpRaw, /From: sender@example\.test/);
  assert.match(otpRaw, /grace@example\.edu/);
  assert.match(otpBodies.join(''), /verification code/i);
  assert.match(otpBodies.join(''), /246810/);
});

test('Gmail API errors are reported as failed delivery', async () => {
  emailService.gmailApi.users.messages.send = async () => {
    const error = new Error('Permission denied');
    error.response = { status: 403, data: { error: { message: 'Insufficient permission' } } };
    throw error;
  };
  assert.equal(await emailService.sendOTP('grace@example.edu', '135790'), false);
});

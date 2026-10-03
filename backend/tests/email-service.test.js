const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

process.env.SMTP_HOST = 'smtp.example.test';
process.env.SMTP_USER = 'sender@example.test';
process.env.SMTP_PASS = 'not-a-real-password';
process.env.NODE_ENV = 'production';

const delivered = [];
nodemailer.createTransport = options => ({
  options,
  async sendMail(message) {
    delivered.push(message);
    return { messageId: `dummy-${delivered.length}`, accepted: [message.to], rejected: [] };
  }
});

const emailService = require('../src/services/emailService');

test('SMTP transport verifies credentials and reports only a safe status', async () => {
  let verified = false;
  emailService.transporter.verify = async () => {
    verified = true;
  };

  const status = await emailService.verifyTransport();
  assert.equal(verified, true);
  assert.deepEqual(status, {
    mode: 'smtp',
    configured: true,
    verification: 'verified',
    errorCode: null
  });

  emailService.transporter.verify = async () => {
    const error = new Error('Authentication failed');
    error.code = 'EAUTH';
    throw error;
  };
  const failedStatus = await emailService.verifyTransport();
  assert.equal(failedStatus.verification, 'failed');
  assert.equal(failedStatus.errorCode, 'EAUTH');
  assert.equal(JSON.stringify(failedStatus).includes(process.env.SMTP_PASS), false);
});

test('onboarding and credential emails include the required details without sending outside the mock', async () => {
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
  assert.match(delivered[0].html, /Application received/);
  assert.match(delivered[0].html, /Ada &lt;Admin&gt;/);
  assert.match(delivered[1].text, /123456/);
  assert.match(delivered[1].html, /activate-account/);
  assert.equal(delivered[2].to, 'grace@example.edu');
  assert.match(delivered[2].html, /Computer Science/);
  assert.match(delivered[2].html, /2026/);
  assert.match(delivered[2].html, /gateway\.pinata\.cloud\/ipfs\/bafy-example/);
  assert.match(delivered[2].html, /explorer\.solana\.com\/tx\/dummy-signature\?cluster=devnet/);
  assert.match(delivered[2].html, /certificate-verification-qr/);
  assert.equal(delivered[2].attachments[0].cid, 'certificate-verification-qr');
  assert.ok(Buffer.isBuffer(delivered[2].attachments[0].content));
  assert.equal(delivered[2].html.includes('not-included'), false);

  assert.equal(await emailService.sendOTP('grace@example.edu', '246810'), true);
  assert.equal(delivered.length, 4);
  assert.equal(delivered[3].to, 'grace@example.edu');
  assert.match(delivered[3].subject, /verification code/i);
  assert.match(delivered[3].text, /246810/);
  assert.match(delivered[3].html, /246810/);
});

test('SMTP recipient rejection is reported as failed delivery', async () => {
  const originalSendMail = emailService.transporter.sendMail;
  emailService.transporter.sendMail = async () => ({
    messageId: 'dummy-rejected',
    accepted: [],
    rejected: ['grace@example.edu'],
    responseCode: 550
  });

  try {
    assert.equal(await emailService.sendOTP('grace@example.edu', '135790'), false);
  } finally {
    emailService.transporter.sendMail = originalSendMail;
  }
});

test('Resend sends mail over HTTPS and preserves inline QR attachments', async () => {
  const originalFetch = global.fetch;
  const originalMode = emailService.mode;
  const originalApiKey = emailService.resendApiKey;
  const originalFrom = emailService.resendFrom;
  const requests = [];
  emailService.mode = 'resend';
  emailService.resendApiKey = 're_test_key';
  emailService.resendFrom = 'CertiCheck <verified@example.com>';
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return url.endsWith('/domains') ? { data: [] } : { id: 'resend-email-001' };
      }
    };
  };

  try {
    assert.equal((await emailService.verifyTransport()).verification, 'authenticated');
    const sent = await emailService.sendCertificateIssued({
      certificate_id: 'CERT-RESEND-001',
      certificate_type: 'Completion',
      holder_name: 'Taylor Example',
      holder_email: 'taylor@example.com',
      issuer_name: 'Example Institute',
      metadata: {}
    }, 'https://certicheck.example/?certificateId=CERT-RESEND-001');
    assert.equal(sent, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://api.resend.com/domains');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer re_test_key');
    assert.equal(requests[1].url, 'https://api.resend.com/emails');
    const message = JSON.parse(requests[1].options.body);
    assert.equal(message.from, 'CertiCheck <verified@example.com>');
    assert.deepEqual(message.to, ['taylor@example.com']);
    assert.equal(message.attachments[0].content_id, 'certificate-verification-qr');
    assert.match(message.attachments[0].content, /^[A-Za-z0-9+/]+=*$/);
  } finally {
    global.fetch = originalFetch;
    emailService.mode = originalMode;
    emailService.resendApiKey = originalApiKey;
    emailService.resendFrom = originalFrom;
  }
});

test('Gmail API refreshes OAuth credentials and sends an encoded email with inline attachments', async () => {
  const originalFetch = global.fetch;
  const originalMode = emailService.mode;
  const originalOAuth = emailService.gmailOAuth;
  const originalAccessToken = emailService.gmailAccessToken;
  const originalExpiry = emailService.gmailAccessTokenExpiresAt;
  const requests = [];
  emailService.mode = 'gmail-api';
  emailService.gmailOAuth = {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    from: 'muideen515@gmail.com'
  };
  emailService.gmailAccessToken = null;
  emailService.gmailAccessTokenExpiresAt = 0;
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return url.includes('oauth2.googleapis.com')
          ? { access_token: 'access-token', expires_in: 3600 }
          : { id: 'gmail-message-001' };
      }
    };
  };

  try {
    assert.equal((await emailService.verifyTransport()).verification, 'authenticated');
    const sent = await emailService.sendOTP('muideen515@gmail.com', '864209');
    assert.equal(sent, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://oauth2.googleapis.com/token');
    assert.equal(requests[1].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    assert.equal(requests[1].options.headers.Authorization, 'Bearer access-token');
    const resetMessage = Buffer.from(JSON.parse(requests[1].options.body).raw, 'base64url').toString('utf8');
    assert.match(resetMessage, /From: muideen515@gmail\.com/);
    assert.match(resetMessage, /To: muideen515@gmail\.com/);
    assert.match(resetMessage, /Subject: =\?UTF-8\?B\?/);
    const resetText = resetMessage.match(/Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/)?.[1];
    assert.equal(Buffer.from(resetText.replace(/\s/g, ''), 'base64').toString('utf8').includes('864209'), true);

    assert.equal(await emailService.sendCertificateIssued({
      certificate_id: 'CERT-GMAIL-001',
      certificate_type: 'Completion',
      holder_name: 'Taylor Example',
      holder_email: 'muideen515@gmail.com',
      issuer_name: 'Example Institute',
      metadata: {}
    }, 'https://certicheck.example/?certificateId=CERT-GMAIL-001'), true);
    assert.equal(requests.length, 3);
    const certificateMessage = Buffer.from(JSON.parse(requests[2].options.body).raw, 'base64url').toString('utf8');
    assert.match(certificateMessage, /Content-Type: image\/png/);
    assert.match(certificateMessage, /Content-ID: <certificate-verification-qr>/);
  } finally {
    global.fetch = originalFetch;
    emailService.mode = originalMode;
    emailService.gmailOAuth = originalOAuth;
    emailService.gmailAccessToken = originalAccessToken;
    emailService.gmailAccessTokenExpiresAt = originalExpiry;
  }
});

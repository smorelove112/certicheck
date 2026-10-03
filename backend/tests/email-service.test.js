const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

process.env.SMTP_HOST = 'smtp.example.test';
process.env.SMTP_PORT = '587';
process.env.SMTP_SECURE = 'false';
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

test('SMTP transport uses the SMTP environment variables directly', () => {
  assert.equal(emailService.mode, 'smtp');
  assert.equal(emailService.transporter.options.host, process.env.SMTP_HOST);
  assert.equal(emailService.transporter.options.port, 587);
  assert.equal(emailService.transporter.options.secure, false);
  assert.deepEqual(emailService.transporter.options.auth, {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  });
  assert.equal(emailService.getFromAddress(), process.env.SMTP_USER);
});

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
  assert.equal(delivered[3].from, process.env.SMTP_FROM || process.env.SMTP_USER);
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

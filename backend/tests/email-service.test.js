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
    return { messageId: `dummy-${delivered.length}` };
  }
});

const emailService = require('../src/services/emailService');

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

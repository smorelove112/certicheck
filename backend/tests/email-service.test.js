const test = require('node:test');
const assert = require('node:assert/strict');

const nodemailer = require('nodemailer');
const EmailService = require('../src/services/emailService');

test('email validation allows standard external domains and rejects malformed addresses', () => {
  assert.equal(EmailService.isValidEmail('student.name+certs@university.edu'), true);
  assert.equal(EmailService.isValidEmail('person@gmail.com'), true);
  assert.equal(EmailService.isValidEmail('person..name@gmail.com'), false);
  assert.equal(EmailService.isValidEmail('.person@gmail.com'), false);
  assert.equal(EmailService.isValidEmail('person@localhost'), false);
});

test('sendOtpEmail uses an object-style CommonJS export and forwards to OTP delivery', async () => {
  const originalSendOTP = EmailService.sendOTP;
  let receivedArgs;
  EmailService.sendOTP = async (...args) => {
    receivedArgs = args;
    return { success: true };
  };

  try {
    const otpEmailModule = require('../src/services/otpEmail');
    assert.deepEqual(Object.keys(otpEmailModule), ['sendOtpEmail']);
    const { sendOtpEmail } = otpEmailModule;
    const result = await sendOtpEmail('user@example.edu', '123456', 'forgot_password');

    assert.deepEqual(receivedArgs, ['user@example.edu', '123456', 'forgot_password']);
    assert.deepEqual(result, { success: true });
  } finally {
    EmailService.sendOTP = originalSendOTP;
  }
});

test('all outgoing email types use EMAIL_FROM as the sender', async () => {
  const originalTransporter = EmailService.transporter;
  const originalEnv = Object.fromEntries(['EMAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_USER']
    .map(name => [name, process.env[name]]));
  const sentMessages = [];
  process.env.EMAIL_FROM = 'CertiCheck <mail@example.org>';
  process.env.SMTP_HOST = 'smtp.example.org';
  process.env.SMTP_USER = 'mail@example.org';
  delete process.env.EMAIL_USER;
  EmailService.transporter = {
    sendMail: async message => {
      sentMessages.push(message);
      return { messageId: `test-${sentMessages.length}` };
    }
  };

  try {
    await EmailService.sendOTP('user@gmail.com', '123456', 'signup');
    await EmailService.sendOTP('user@yahoo.com', '123456', 'forgot_password');
    await EmailService.sendWelcome('user@school.edu', 'Student');
    await EmailService.sendApplicationReceived('applicant@school.edu', 'Student', 'Example University');
    await EmailService.sendApplicationDecision('applicant@school.edu', 'Student', 'Example University', true);
    await EmailService.sendCertificateIssued({
      holderEmail: 'holder@gmail.com',
      holderName: 'Certificate Holder',
      certificateId: 'CERT-001',
      certificateType: 'Degree',
      issuerName: 'Example University',
      issuedAt: new Date().toISOString()
    });

    assert.equal(sentMessages.length, 6);
    assert.ok(sentMessages.every(message => message.from === process.env.EMAIL_FROM));
  } finally {
    EmailService.transporter = originalTransporter;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('welcome email delivery failures propagate to the caller', async () => {
  const originalTransporter = EmailService.transporter;
  const deliveryError = new Error('SMTP unavailable');
  EmailService.transporter = { sendMail: async () => { throw deliveryError; } };
  try {
    await assert.rejects(EmailService.sendWelcome('user@example.org', 'Test'), deliveryError);
  } finally {
    EmailService.transporter = originalTransporter;
  }
});

test('sender defaults to the authenticated SMTP account without a hardcoded address', () => {
  const originalEnv = Object.fromEntries(['EMAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'EMAIL_USER']
    .map(name => [name, process.env[name]]));
  delete process.env.EMAIL_FROM;
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_USER = 'sender@gmail.com';
  delete process.env.EMAIL_USER;

  try {
    assert.equal(EmailService.getFromAddress(), 'sender@gmail.com');
  } finally {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('configured EMAIL_FROM must match the SMTP authentication account', () => {
  const originalEnv = Object.fromEntries(['EMAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'EMAIL_USER']
    .map(name => [name, process.env[name]]));
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_USER = 'sender@gmail.com';
  process.env.EMAIL_FROM = 'CertiCheck <different@gmail.com>';
  delete process.env.EMAIL_USER;

  try {
    assert.throws(() => EmailService.getFromAddress(), /EMAIL_FROM must match/);
  } finally {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('SMTP transport authenticates with SMTP_USER and SMTP_PASS', () => {
  const originalTransporter = EmailService.transporter;
  const originalCreateTransport = nodemailer.createTransport;
  const originalEnv = Object.fromEntries(['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM']
    .map(name => [name, process.env[name]]));
  let transportOptions;
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_USER = 'sender@gmail.com';
  process.env.SMTP_PASS = 'example-test-app-password';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_SECURE = 'true';
  process.env.EMAIL_FROM = 'CertiCheck <sender@gmail.com>';
  EmailService.transporter = null;
  nodemailer.createTransport = options => {
    transportOptions = options;
    return { sendMail: async () => ({}) };
  };

  try {
    EmailService.initTransporter();
    assert.equal(transportOptions.host, 'smtp.gmail.com');
    assert.equal(transportOptions.port, 465);
    assert.equal(transportOptions.secure, true);
    assert.equal(transportOptions.auth.user, process.env.SMTP_USER);
    assert.equal(transportOptions.auth.pass, process.env.SMTP_PASS);
    assert.equal(transportOptions.connectionTimeout, 10000);
    assert.equal(transportOptions.greetingTimeout, 10000);
    assert.equal(transportOptions.socketTimeout, 10000);
  } finally {
    EmailService.transporter = originalTransporter;
    nodemailer.createTransport = originalCreateTransport;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('Gmail SMTP defaults to port 465 and disables implicit TLS on port 587', () => {
  const originalTransporter = EmailService.transporter;
  const originalCreateTransport = nodemailer.createTransport;
  const originalEnv = Object.fromEntries([
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
    'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_PASS'
  ].map(name => [name, process.env[name]]));
  const configs = [];
  nodemailer.createTransport = options => {
    configs.push(options);
    return { sendMail: async () => ({}) };
  };

  try {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.EMAIL_USER = 'sender@gmail.com';
    process.env.EMAIL_PASSWORD = 'example-test-app-password';
    delete process.env.EMAIL_PASS;
    EmailService.transporter = null;
    EmailService.initTransporter();

    assert.equal(configs[0].host, 'smtp.gmail.com');
    assert.equal(configs[0].port, 465);
    assert.equal(configs[0].secure, true);

    process.env.SMTP_PORT = '587';
    EmailService.transporter = null;
    EmailService.initTransporter();
    assert.equal(configs[1].host, 'smtp.gmail.com');
    assert.equal(configs[1].port, 587);
    assert.equal(configs[1].secure, false);
  } finally {
    EmailService.transporter = originalTransporter;
    nodemailer.createTransport = originalCreateTransport;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('SMTP transport accepts EMAIL_USER and EMAIL_PASSWORD as credential aliases', () => {
  const originalTransporter = EmailService.transporter;
  const originalCreateTransport = nodemailer.createTransport;
  const originalEnv = Object.fromEntries([
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
    'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_FROM'
  ].map(name => [name, process.env[name]]));
  let transportOptions;
  process.env.SMTP_HOST = 'smtp.example.org';
  process.env.SMTP_PORT = '465';
  delete process.env.SMTP_SECURE;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  process.env.EMAIL_USER = 'sender@example.org';
  process.env.EMAIL_PASSWORD = 'example-test-password';
  process.env.EMAIL_FROM = 'CertiCheck <sender@example.org>';
  EmailService.transporter = null;
  nodemailer.createTransport = options => {
    transportOptions = options;
    return { sendMail: async () => ({}) };
  };

  try {
    EmailService.initTransporter();
    assert.equal(transportOptions.host, process.env.SMTP_HOST);
    assert.equal(transportOptions.port, 465);
    assert.equal(transportOptions.secure, true);
    assert.equal(transportOptions.auth.user, process.env.EMAIL_USER);
    assert.equal(transportOptions.auth.pass, process.env.EMAIL_PASSWORD);
  } finally {
    EmailService.transporter = originalTransporter;
    nodemailer.createTransport = originalCreateTransport;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('Gmail transport accepts EMAIL_USER and EMAIL_PASS and sendEmail uses the configured sender', async () => {
  const originalTransporter = EmailService.transporter;
  const originalCreateTransport = nodemailer.createTransport;
  const originalEnv = Object.fromEntries([
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_USER', 'EMAIL_PASSWORD',
    'EMAIL_PASS', 'EMAIL_FROM'
  ].map(name => [name, process.env[name]]));
  let transportOptions;
  let message;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.EMAIL_PASSWORD;
  process.env.EMAIL_USER = 'sender@gmail.com';
  process.env.EMAIL_PASS = 'abcd efgh ijkl mnop';
  process.env.EMAIL_FROM = 'CertiCheck <sender@gmail.com>';
  EmailService.transporter = null;
  nodemailer.createTransport = options => {
    transportOptions = options;
    return { sendMail: async mail => { message = mail; return { messageId: 'test-message' }; } };
  };

  try {
    const result = await EmailService.sendEmail({
      to: ' Recipient@Example.org ',
      subject: 'Test message',
      html: '<p>Test</p>'
    });
    assert.equal(transportOptions.host, 'smtp.gmail.com');
    assert.equal(transportOptions.port, 465);
    assert.equal(transportOptions.secure, true);
    assert.equal(transportOptions.auth.user, process.env.EMAIL_USER);
    assert.equal(transportOptions.auth.pass, 'abcdefghijklmnop');
    assert.equal(transportOptions.connectionTimeout, 10000);
    assert.equal(transportOptions.greetingTimeout, 10000);
    assert.equal(transportOptions.socketTimeout, 10000);
    assert.equal(message.from, process.env.EMAIL_FROM);
    assert.equal(message.to, 'recipient@example.org');
    assert.equal(result.messageId, 'test-message');
  } finally {
    EmailService.transporter = originalTransporter;
    nodemailer.createTransport = originalCreateTransport;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('Gmail credentials containing only whitespace are treated as missing', () => {
  const originalEnv = Object.fromEntries([
    'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_PASS'
  ].map(name => [name, process.env[name]]));
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  process.env.EMAIL_USER = 'sender@gmail.com';
  process.env.EMAIL_PASSWORD = '   ';
  delete process.env.EMAIL_PASS;

  try {
    assert.equal(EmailService.getConfigurationStatus().mode, 'console');
  } finally {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('startup transport verification reports success and sanitizes provider errors', async () => {
  const originalTransporter = EmailService.transporter;
  const originalConfig = EmailService.getConfigurationStatus;
  const originalVerificationIssue = EmailService.lastVerificationIssue;
  const originalSmtpVerified = EmailService.smtpVerified;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const logs = [];
  const warnings = [];
  EmailService.getConfigurationStatus = () => ({ mode: 'smtp' });
  console.log = message => logs.push(String(message));
  console.warn = message => warnings.push(String(message));

  try {
    EmailService.transporter = { verify: async () => true };
    assert.equal(await EmailService.verifyTransporter(), true);
    assert.equal(EmailService.getReadiness().verified, true);
    assert.match(logs[0], /SMTP connection verified/);

    const secretBearingError = Object.assign(
      new Error('authentication failed for secret@example.org with raw-password'),
      { code: 'EAUTH' }
    );
    EmailService.transporter = { verify: async () => { throw secretBearingError; } };
    assert.equal(await EmailService.verifyTransporter(), false);
    assert.equal(EmailService.getReadiness().verified, false);
    assert.match(warnings[0], /Gmail.*app password/);
    assert.match(EmailService.getReadiness().issue, /Gmail.*app password/);
    assert.equal(warnings[0].includes('raw-password'), false);
  } finally {
    EmailService.transporter = originalTransporter;
    EmailService.getConfigurationStatus = originalConfig;
    EmailService.lastVerificationIssue = originalVerificationIssue;
    EmailService.smtpVerified = originalSmtpVerified;
    console.log = originalLog;
    console.warn = originalWarn;
  }
});

test('missing SMTP configuration fails clearly in production and falls back in development', async () => {
  const originalTransporter = EmailService.transporter;
  const originalEnv = Object.fromEntries([
    'NODE_ENV', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER',
    'SMTP_PASS', 'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_PASS', 'EMAIL_FROM'
  ].map(name => [name, process.env[name]]));
  const originalLog = console.log;
  for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_PASS', 'EMAIL_FROM']) {
    delete process.env[name];
  }
  EmailService.transporter = null;

  try {
    process.env.NODE_ENV = 'production';
    assert.throws(
      () => EmailService.initTransporter(),
      error => error.code === 'EMAIL_NOT_CONFIGURED' && /SMTP_HOST/.test(error.message)
    );
    assert.equal(await EmailService.verifyTransporter(), false);
    assert.equal(EmailService.getReadiness().status, 'not_configured');
    assert.equal(EmailService.getReadiness().verified, false);

    process.env.NODE_ENV = 'development';
    EmailService.transporter = null;
    console.log = () => {};
    await EmailService.sendOTP('user@example.org', '123456', 'forgot_password');
    assert.equal(EmailService.transporter !== null, true);
  } finally {
    console.log = originalLog;
    EmailService.transporter = originalTransporter;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

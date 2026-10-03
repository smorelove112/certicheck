const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fetch = require('cross-fetch');
const pool = require('../src/db/connection');
const User = require('../src/models/User');
const OTP = require('../src/models/OTP');
const emailService = require('../src/services/emailService');
const authRoutes = require('../src/routes/auth');

const originalQuery = pool.query;
const originalFindByEmail = User.findByEmail;
const originalCreate = User.create;
const originalUpdatePassword = User.updatePassword;
const originalActivateIssuer = User.activateIssuer;
const originalVerifyPassword = User.verifyPassword;
const originalVerifyIssuerActivation = User.verifyIssuerActivation;
const originalRenewIssuerActivation = User.renewIssuerActivation;
const originalOtpCreate = OTP.create;
const originalOtpVerify = OTP.verify;
const originalOtpConsume = OTP.consume;
const originalSendOtp = emailService.sendOTP;
const originalSendApplicationApproval = emailService.sendApplicationApproval;
let server;
let createCalls = 0;

test.before(async () => {
  process.env.DEMO_MODE = 'true';
  pool.query = async () => ({ rows: [] });
  User.findByEmail = async () => null;
  User.create = async (email, password, firstName, lastName, userType) => {
    createCalls += 1;
    assert.equal(password, 'password');
    return {
      id: createCalls,
      email,
      first_name: firstName,
      last_name: lastName,
      user_type: userType,
      is_active: false,
      must_change_password: true
    };
  };

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  pool.query = originalQuery;
  User.findByEmail = originalFindByEmail;
  User.create = originalCreate;
  User.updatePassword = originalUpdatePassword;
  User.activateIssuer = originalActivateIssuer;
  User.verifyPassword = originalVerifyPassword;
  User.verifyIssuerActivation = originalVerifyIssuerActivation;
  User.renewIssuerActivation = originalRenewIssuerActivation;
  OTP.create = originalOtpCreate;
  OTP.verify = originalOtpVerify;
  OTP.consume = originalOtpConsume;
  emailService.sendOTP = originalSendOtp;
  emailService.sendApplicationApproval = originalSendApplicationApproval;
});

async function post(path, body) {
  return fetch(`http://127.0.0.1:${server.address().port}/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('signup creates a pending account directly without email verification', async () => {
  const response = await post('/register', {
    email: 'new.issuer@university.example',
    firstName: 'Ada',
    lastName: 'Lovelace',
    userType: 'issuer'
  });
  const data = await response.json();

  assert.equal(response.status, 201, JSON.stringify(data));
  assert.equal(data.user.email, 'new.issuer@university.example');
  assert.equal(data.user.is_active, false);
  assert.equal(data.user.must_change_password, true);
  assert.equal(Object.hasOwn(data, 'notification'), false);
});

test('signup still validates email syntax and prevents duplicate accounts', async () => {
  const invalidEmail = await post('/register', {
    email: 'not-an-email',
    firstName: 'Alex',
    lastName: 'Applicant'
  });
  assert.equal(invalidEmail.status, 400);

  User.findByEmail = async () => ({ id: 99 });
  const duplicate = await post('/register', {
    email: 'existing@example.org',
    firstName: 'Alex',
    lastName: 'Applicant'
  });
  assert.equal(duplicate.status, 409);
});

test('signup email verification endpoints are not registered', async () => {
  for (const route of ['/send-otp', '/resend-otp', '/verify-otp', '/verify-forgot-password']) {
    const response = await post(route, {});
    assert.equal(response.status, 404, `${route} should not exist`);
  }
});

test('approved issuer login directs the user to activation without requiring the temporary password', async () => {
  const email = 'approved.issuer@example.com';
  User.findByEmail = async requestedEmail => requestedEmail === email
    ? {
        id: 42,
        email,
        user_type: 'issuer',
        is_active: false,
        activation_code_hash: 'activation-hash',
        activation_expires_at: new Date(Date.now() + 900000)
      }
    : null;
  User.verifyPassword = async () => null;

  const response = await post('/login', { email, password: 'not-the-temporary-password' });
  const data = await response.json();

  assert.equal(response.status, 403);
  assert.equal(data.code, 'ISSUER_ACTIVATION_REQUIRED');
});

test('activation code must match the email and approved account before password creation', async () => {
  let verification;
  User.verifyIssuerActivation = async (email, activationCodeHash) => {
    verification = { email, activationCodeHash };
    return true;
  };

  const response = await post('/verify-issuer-activation', {
    email: ' Ada@Example.com ',
    activationCode: '123456'
  });
  const data = await response.json();

  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(verification.email, 'ada@example.com');
  assert.match(verification.activationCodeHash, /^[a-f0-9]{64}$/);

  User.verifyIssuerActivation = async () => false;
  const invalidResponse = await post('/verify-issuer-activation', {
    email: 'ada@example.com',
    activationCode: '654321'
  });
  assert.equal(invalidResponse.status, 400);
});

test('approved issuer can request a fresh activation code by email', async () => {
  let renewal;
  let sentEmail;
  User.renewIssuerActivation = async (email, activationCodeHash, expiresAt) => {
    renewal = { email, activationCodeHash, expiresAt };
    return {
      id: 42,
      email,
      first_name: 'Ada',
      last_name: 'Lovelace',
      organization_name: 'Analytical Engines'
    };
  };
  emailService.sendApplicationApproval = async message => {
    sentEmail = message;
    return true;
  };

  const response = await post('/resend-issuer-activation', { email: ' Ada@Example.com ' });
  const data = await response.json();

  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(renewal.email, 'ada@example.com');
  assert.match(renewal.activationCodeHash, /^[a-f0-9]{64}$/);
  assert.ok(renewal.expiresAt.getTime() > Date.now());
  assert.equal(sentEmail.to, 'ada@example.com');
  assert.equal(sentEmail.contactName, 'Ada Lovelace');
  assert.equal(sentEmail.organizationName, 'Analytical Engines');
  assert.match(sentEmail.activationCode, /^\d{6}$/);

  User.renewIssuerActivation = async () => null;
  const unavailableResponse = await post('/resend-issuer-activation', { email: 'unknown@example.com' });
  assert.equal(unavailableResponse.status, 404);
});

test('forgot password explicitly reports when an email is not registered', async () => {
  User.findByEmail = async () => null;

  const response = await post('/forgot-password', { email: 'unknown@example.com' });
  const data = await response.json();

  assert.equal(response.status, 404);
  assert.equal(data.error, 'No account is registered with this email address.');
});

test('password reset sends an OTP and updates the password when the code is valid', async () => {
  let sentTo;
  let updatedPassword;
  let consumedCode;
  User.findByEmail = async () => ({ id: 42, email: 'ada@example.com' });
  User.updatePassword = async (email, password) => {
    updatedPassword = { email, password };
  };
  OTP.create = async (email, purpose) => ({
    id: 1,
    email,
    otp_code: '123456',
    purpose,
    expires_at: new Date(Date.now() + 900000)
  });
  OTP.verify = async (email, code, purpose) =>
    email === 'ada@example.com' && code === '123456' && purpose === 'reset_password';
  OTP.consume = async (email, code, purpose) => {
    consumedCode = { email, code, purpose };
    return true;
  };
  emailService.sendOTP = async (email, code) => {
    sentTo = { email, code };
    return true;
  };

  const requestResponse = await post('/forgot-password', { email: ' Ada@Example.com ' });
  const requestData = await requestResponse.json();
  assert.equal(requestResponse.status, 200, JSON.stringify(requestData));
  assert.deepEqual(sentTo, { email: 'ada@example.com', code: '123456' });

  const resetResponse = await post('/reset-password', {
    email: 'ADA@example.com',
    otpCode: '123456',
    newPassword: 'New-password-123'
  });
  const resetData = await resetResponse.json();
  assert.equal(resetResponse.status, 200, JSON.stringify(resetData));
  assert.deepEqual(updatedPassword, { email: 'ada@example.com', password: 'New-password-123' });
  assert.deepEqual(consumedCode, { email: 'ada@example.com', code: '123456', purpose: 'reset_password' });
});

test('password reset reports email delivery failure and invalidates the unsent code', async () => {
  let consumed = false;
  User.findByEmail = async () => ({ id: 42, email: 'ada@example.com' });
  OTP.create = async (email) => ({ email, otp_code: '654321' });
  OTP.consume = async () => {
    consumed = true;
    return true;
  };
  emailService.sendOTP = async () => false;

  const response = await post('/forgot-password', { email: 'ada@example.com' });
  const data = await response.json();

  assert.equal(response.status, 503, JSON.stringify(data));
  assert.equal(data.error, 'Unable to send code right now.');
  assert.equal(consumed, true);
});

test('password reset returns email failure even if the undelivered OTP cannot be cleaned up', async () => {
  User.findByEmail = async () => ({ id: 42, email: 'ada@example.com' });
  OTP.create = async email => ({ email, otp_code: '654321' });
  OTP.consume = async () => {
    throw new Error('cleanup failed');
  };
  emailService.sendOTP = async () => false;

  const response = await post('/forgot-password', { email: 'ada@example.com' });
  const data = await response.json();

  assert.equal(response.status, 503, JSON.stringify(data));
  assert.equal(data.error, 'Unable to send code right now.');
});

test('password reset identifies database-stage failures without exposing database details', async () => {
  User.findByEmail = async () => ({ id: 42, email: 'ada@example.com' });
  OTP.create = async () => {
    const error = new Error('database schema detail');
    error.code = '42703';
    throw error;
  };

  const response = await post('/forgot-password', { email: 'ada@example.com' });
  const data = await response.json();

  assert.equal(response.status, 500, JSON.stringify(data));
  assert.equal(data.stage, 'otp-creation');
  assert.equal(data.errorCode, '42703');
  assert.equal(data.error, 'Failed to process forgot password request');
  assert.equal(JSON.stringify(data).includes('database schema detail'), false);
});

test('issuer activation requires matching passwords and activates with the emailed code', async () => {
  let activationRequest;
  User.activateIssuer = async (email, activationCodeHash, password) => {
    activationRequest = { email, activationCodeHash, password };
    return {
      id: 22,
      email,
      first_name: 'Ada',
      last_name: 'Lovelace',
      user_type: 'issuer',
      is_active: true,
      is_verified: true
    };
  };

  const mismatch = await post('/activate-issuer', {
    email: 'ada@example.com',
    activationCode: '123456',
    password: 'Strong-pass-123',
    confirmPassword: 'Different-pass-123'
  });
  assert.equal(mismatch.status, 400);
  assert.equal(activationRequest, undefined);

  const response = await post('/activate-issuer', {
    email: 'Ada@example.com',
    activationCode: '123456',
    password: 'Strong-pass-123',
    confirmPassword: 'Strong-pass-123'
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.match(activationRequest.activationCodeHash, /^[a-f0-9]{64}$/);
  assert.equal(activationRequest.email, 'ada@example.com');
  assert.equal(activationRequest.password, 'Strong-pass-123');
  assert.equal(data.user.is_verified, true);
  assert.equal(data.user.issuer_status, 'approved');
  assert.ok(data.token);
});

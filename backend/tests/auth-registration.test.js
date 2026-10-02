const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fetch = require('cross-fetch');
const pool = require('../src/db/connection');
const User = require('../src/models/User');
const authRoutes = require('../src/routes/auth');

const originalQuery = pool.query;
const originalFindByEmail = User.findByEmail;
const originalCreate = User.create;
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

test('email OTP and forgotten-password endpoints are no longer registered', async () => {
  for (const route of ['/send-otp', '/resend-otp', '/verify-otp', '/forgot-password', '/verify-forgot-password', '/reset-password']) {
    const response = await post(route, {});
    assert.equal(response.status, 404, `${route} should not exist`);
  }
});

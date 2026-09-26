const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fetch = require('cross-fetch');
const jwt = require('jsonwebtoken');

const envNames = ['DEMO_MODE', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_JWT_SECRET', 'JWT_SECRET'];
const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
for (const name of envNames) delete process.env[name];
process.env.DEMO_MODE = 'false';
process.env.ADMIN_EMAIL = 'admin@certicheck.com';
process.env.ADMIN_PASSWORD = 'password';
process.env.ADMIN_JWT_SECRET = 'dev_secret_key';
process.env.JWT_SECRET = 'dev_secret_key';

const pool = require('../src/db/connection');
const User = require('../src/models/User');
const authRoutes = require('../src/routes/auth');
const { verifyAdminToken } = require('../src/middleware/auth');

const originalPoolQuery = pool.query;
const originalUserMethods = {
  findByEmail: User.findByEmail,
  findById: User.findById,
  create: User.create,
  verifyPassword: User.verifyPassword,
  updatePassword: User.updatePassword
};

let server;

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  pool.query = originalPoolQuery;
  Object.assign(User, originalUserMethods);
  for (const name of envNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

test('supports multiple seeded admins without allowing admin registration or password changes for other users', async () => {
  const usersByEmail = new Map();
  const usersById = new Map();
  const passwordUpdates = [];
  let nextId = 1;

  const safeUser = user => {
    if (!user) return null;
    const { password: _password, ...safe } = user;
    return safe;
  };

  User.findByEmail = async email => safeUser(usersByEmail.get(User.normalizeEmail(email)));
  User.findById = async id => safeUser(usersById.get(Number(id)));
  User.create = async (email, password, firstName, lastName, userType) => {
    const user = {
      id: nextId++,
      email: User.normalizeEmail(email),
      password,
      first_name: firstName,
      last_name: lastName,
      user_type: userType,
      is_active: false,
      must_change_password: true
    };
    usersByEmail.set(user.email, user);
    usersById.set(user.id, user);
    return safeUser(user);
  };
  User.verifyPassword = async (email, password) => {
    const user = usersByEmail.get(User.normalizeEmail(email));
    return user?.password === password ? safeUser(user) : null;
  };
  User.updatePassword = async (email, password, mustChangePassword = false) => {
    const normalizedEmail = User.normalizeEmail(email);
    const user = usersByEmail.get(normalizedEmail);
    passwordUpdates.push(normalizedEmail);
    if (user) {
      user.password = password;
      user.must_change_password = mustChangePassword;
    }
    return safeUser(user);
  };
  pool.query = async (sql, params = []) => {
    if (sql.includes('UPDATE users SET is_active = TRUE')) {
      const user = usersById.get(Number(params[0]));
      if (user) {
        user.is_active = true;
        user.must_change_password = false;
      }
    }
    return { rows: [] };
  };

  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes);
  app.get('/admin-only', verifyAdminToken, (req, res) => res.json({ user: req.user }));
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminAccounts = [
    ['admin@certicheck.com', 'Admin'],
    ['admin2@certicheck.com', 'Alex'],
    ['admin3@certicheck.com', 'Jordan']
  ];
  let adminToken;

  for (const [email, firstName] of adminAccounts) {
    const response = await fetch(`${baseUrl}/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password' })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.user.firstName, firstName);
    assert.equal(payload.user.userType, 'admin');
    assert.equal(payload.user.email, email);

    const claims = jwt.verify(payload.token, 'dev_secret_key');
    assert.equal(claims.firstName, firstName);
    assert.equal(claims.lastName, payload.user.lastName);
    assert.equal(claims.email, email);
    assert.equal(claims.userType, 'admin');
    assert.equal(claims.user_type, 'admin');
    adminToken ||= payload.token;
  }

  const seededAdmins = [...usersByEmail.values()].filter(user => user.user_type === 'admin');
  assert.equal(seededAdmins.length, 3);
  assert.equal(new Set(seededAdmins.map(user => user.first_name)).size, 3);
  assert.deepEqual(seededAdmins.map(user => user.password), ['password', 'password', 'password']);
  assert.deepEqual(passwordUpdates, []);

  const unauthorizedRegistration = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'selfmade@certicheck.com', password: 'password', firstName: 'Self', lastName: 'Made', userType: 'admin' })
  });
  assert.equal(unauthorizedRegistration.status, 403);

  const adminRequest = await fetch(`${baseUrl}/admin-only`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminRequest.status, 200);
  assert.equal((await adminRequest.json()).user.userType, 'admin');

  const camelCaseToken = jwt.sign({
    id: 100,
    firstName: 'Casey',
    lastName: 'Admin',
    email: 'casey@certicheck.com',
    userType: 'admin'
  }, 'dev_secret_key');
  const camelCaseAdminRequest = await fetch(`${baseUrl}/admin-only`, {
    headers: { Authorization: `Bearer ${camelCaseToken}` }
  });
  assert.equal(camelCaseAdminRequest.status, 200);
  assert.equal((await camelCaseAdminRequest.json()).user.user_type, 'admin');

  const regularUserToken = jwt.sign({ id: 101, email: 'user@certicheck.com', userType: 'user' }, 'dev_secret_key');
  const regularUserRequest = await fetch(`${baseUrl}/admin-only`, {
    headers: { Authorization: `Bearer ${regularUserToken}` }
  });
  assert.equal(regularUserRequest.status, 403);

  const otherUser = {
    id: 99,
    email: 'other@certicheck.com',
    password: 'other-password',
    first_name: 'Other',
    last_name: 'User',
    user_type: 'user',
    is_active: true
  };
  usersByEmail.set(otherUser.email, otherUser);
  usersById.set(otherUser.id, otherUser);

  const selfPasswordChange = await fetch(`${baseUrl}/auth/change-password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword: 'admin-new-password', email: otherUser.email, userId: otherUser.id })
  });
  assert.equal(selfPasswordChange.status, 200);
  assert.equal(usersByEmail.get('admin@certicheck.com').password, 'admin-new-password');
  assert.equal(otherUser.password, 'other-password');
});
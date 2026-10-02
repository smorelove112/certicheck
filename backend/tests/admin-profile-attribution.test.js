const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fetch = require('cross-fetch');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'certicheck-admin-'));
process.env.DEMO_MODE = 'true';
process.env.ADMIN_EMAIL = 'admin@certicheck.com';
process.env.ADMIN_JWT_SECRET = 'admin-profile-test-secret';
process.env.JWT_SECRET = 'admin-profile-test-secret';
process.env.DEMO_ADMIN_STORE_FILE = path.join(tempDir, 'admins.json');
process.env.DEMO_APPLICATION_STORE_FILE = path.join(tempDir, 'applications.json');

const pool = require('../src/db/connection');
const authRoutes = require('../src/routes/auth');
const applicationRoutes = require('../src/routes/applications');
const demoAppStore = require('../src/services/demoApplicationStore');
const originalPoolQuery = pool.query;
let server;

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  pool.query = originalPoolQuery;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('individual admin profiles and application decisions remain attributed', async () => {
  pool.query = async () => ({ rows: [] });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/applications', applicationRoutes);
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { token, method = 'GET', body } = {}) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    return { response, payload };
  };
  const login = async (email, password = 'password') => request('/api/auth/admin/login', {
    method: 'POST', body: { email, password }
  });

  const adminALogin = await login('admin@certicheck.com');
  const adminBLogin = await login('admin2@certicheck.com');
  assert.equal(adminALogin.response.status, 200);
  assert.equal(adminBLogin.response.status, 200);
  assert.notEqual(adminALogin.payload.user.adminId, adminBLogin.payload.user.adminId);
  assert.equal(jwt.verify(adminALogin.payload.token, process.env.ADMIN_JWT_SECRET).adminId, adminALogin.payload.user.adminId);

  const adminProfile = await request('/api/auth/admin/profile', { token: adminALogin.payload.token });
  assert.equal(adminProfile.payload.user.name, 'Admin User');
  const picture = 'data:image/png;base64,aGVsbG8=';
  const invalidPicture = await request('/api/auth/admin/profile', {
    token: adminALogin.payload.token,
    method: 'PUT',
    body: { profilePicture: 'data:image/svg+xml;base64,PHN2Zz4=' }
  });
  assert.equal(invalidPicture.response.status, 400);
  const profileUpdate = await request('/api/auth/admin/profile', {
    token: adminALogin.payload.token,
    method: 'PUT',
    body: { name: 'Admin A', profilePicture: picture }
  });
  assert.equal(profileUpdate.response.status, 200);
  assert.equal(profileUpdate.payload.user.name, 'Admin A');
  const pictureUrl = '/api/auth/admin/1/profile-picture';
  assert.equal(profileUpdate.payload.user.profilePicture, pictureUrl);
  assert.equal(jwt.verify(profileUpdate.payload.token, process.env.ADMIN_JWT_SECRET).profilePicture, pictureUrl);
  const avatar = await request(pictureUrl);
  assert.equal(avatar.response.status, 200);
  assert.match(avatar.response.headers.get('content-type'), /image\/png/);
  assert.equal(avatar.payload, 'hello');

  const adminAApp = demoAppStore.createApplication({
    orgName: 'Admin A Org', contactName: 'Applicant A', contactEmail: '', generatedEmail: ''
  });
  const adminBApp = demoAppStore.createApplication({
    orgName: 'Admin B Org', contactName: 'Applicant B', contactEmail: '', generatedEmail: ''
  });
  const approved = await request(`/api/applications/${adminAApp.id}/approve`, {
    token: profileUpdate.payload.token,
    method: 'PUT'
  });
  const rejected = await request(`/api/applications/${adminBApp.id}/reject`, {
    token: adminBLogin.payload.token,
    method: 'PUT'
  });
  assert.equal(approved.payload.application.processed_by_admin_name, 'Admin A');
  assert.equal(approved.payload.application.processed_by_admin_profile_picture_url, pictureUrl);
  assert.equal(approved.payload.application.action_type, 'APPROVED');
  assert.equal(rejected.payload.application.processed_by_admin_name, 'Alex Admin');
  assert.equal(rejected.payload.application.action_type, 'REJECTED');
  const sharedApprovedQueue = await request('/api/applications/approved', { token: adminBLogin.payload.token });
  const sharedRejectedQueue = await request('/api/applications/rejected', { token: profileUpdate.payload.token });
  assert.ok(sharedApprovedQueue.payload.applications.some(application => application.id === adminAApp.id));
  assert.ok(sharedRejectedQueue.payload.applications.some(application => application.id === adminBApp.id));

  const passwordChange = await request('/api/auth/admin/change-password', {
    token: profileUpdate.payload.token,
    method: 'POST',
    body: { currentPassword: 'password', newPassword: 'admin-a-new-password' }
  });
  assert.equal(passwordChange.response.status, 200);
  assert.equal((await login('admin@certicheck.com', 'password')).response.status, 401);
  assert.equal((await login('admin@certicheck.com', 'admin-a-new-password')).response.status, 200);

  assert.equal((await login('admin@certicheck.com', 'admin-a-new-password')).response.status, 200);
  assert.equal((await login('admin2@certicheck.com', 'password')).response.status, 200);
});

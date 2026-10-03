const test = require('node:test');
const assert = require('node:assert/strict');

const configuredOrigin = 'https://issuer-login-test.example';
const frontendUrl = 'https://certicheck-frontend-test.example';
process.env.CORS_ORIGINS = [
  process.env.CORS_ORIGINS,
  configuredOrigin
].filter(Boolean).join(',');
process.env.FRONTEND_URL = frontendUrl;

const app = require('../src/server');

test('CORS allows explicitly configured frontend origins for login', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  for (const origin of [configuredOrigin, frontendUrl]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      }
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
});

test('Render proxy is trusted so forwarded client IPs are accepted', async (t) => {
  assert.equal(app.get('trust proxy'), 1);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/dashboard`, {
    headers: { 'X-Forwarded-For': '198.51.100.24' }
  });
  assert.equal(response.status, 401);
});

test('CORS rejects an unconfigured origin with an explicit forbidden response', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted-origin.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'This website origin is not allowed to access the API' });
});

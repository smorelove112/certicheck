const test = require('node:test');
const assert = require('node:assert/strict');

let server;

async function startServer() {
  const app = require('../src/server');
  return new Promise((resolve, reject) => {
    server = app.listen(0, () => resolve(server.address().port));
    server.on('error', reject);
  });
}

test.before(async () => {
  process.env.DEMO_MODE = 'true';
  process.env.TEST_SERVER_PORT = await startServer();
});

test.after(async () => {
  if (server) server.close();
});

test('main and admin routes serve their dedicated pages', async () => {
  const port = process.env.TEST_SERVER_PORT;
  const base = `http://localhost:${port}`;

  const homeResponse = await fetch(`${base}/`);
  const homeText = await homeResponse.text();
  assert.equal(homeResponse.status, 200);
  assert.match(homeText, /Certicheck/i);
  assert.doesNotMatch(homeText, /Issuer Approval Console/i);

  const activationResponse = await fetch(`${base}/activate-account`);
  assert.equal(activationResponse.status, 200);
  assert.match(await activationResponse.text(), /id="issuerActivationForm"/);

  const adminResponse = await fetch(`${base}/admin`);
  const adminText = await adminResponse.text();
  assert.equal(adminResponse.status, 200);
  assert.match(adminText, /Certicheck Admin|Issuer Approval Console/i);
});

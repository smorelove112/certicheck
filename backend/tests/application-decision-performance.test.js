const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db/connection');
const Application = require('../src/models/Application');
const User = require('../src/models/User');

test('approval updates the application, issuer profile, and issuer account in one database round trip', async () => {
  const originalQuery = pool.query;
  const originalDemoMode = process.env.DEMO_MODE;
  const originalPasswordHash = User.getDefaultIssuerPasswordHash;
  const approvedApplication = { id: 31, issuer_id: 12, status: 'approved' };
  let queryCount = 0;
  let queryText;
  let queryParams;
  process.env.DEMO_MODE = 'false';
  User.getDefaultIssuerPasswordHash = async () => 'hashed-default-password';
  pool.query = async (sql, params) => {
    queryCount += 1;
    queryText = sql;
    queryParams = params;
    return { rows: [approvedApplication] };
  };

  try {
    const result = await Application.approve(31, 7, 'Admin User', '/api/auth/admin/7/profile-picture');

    assert.deepEqual(result, approvedApplication);
    assert.equal(queryCount, 1);
    assert.match(queryText, /WITH approved_application AS/);
    assert.match(queryText, /UPDATE issuer_profiles/);
    assert.match(queryText, /UPDATE users/);
    assert.match(queryText, /must_change_password = CASE/);
    assert.deepEqual(queryParams, [7, 31, 'Admin User', '/api/auth/admin/7/profile-picture', 'hashed-default-password']);
  } finally {
    pool.query = originalQuery;
    User.getDefaultIssuerPasswordHash = originalPasswordHash;
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  }
});

test('rejection updates the application and issuer profile in one database round trip', async () => {
  const originalQuery = pool.query;
  const originalDemoMode = process.env.DEMO_MODE;
  const rejectedApplication = { id: 32, issuer_id: 13, status: 'rejected' };
  let queryCount = 0;
  let queryText;
  process.env.DEMO_MODE = 'false';
  pool.query = async sql => {
    queryCount += 1;
    queryText = sql;
    return { rows: [rejectedApplication] };
  };

  try {
    const result = await Application.reject(32, 7, 'Admin User', null);

    assert.deepEqual(result, rejectedApplication);
    assert.equal(queryCount, 1);
    assert.match(queryText, /WITH rejected_application AS/);
    assert.match(queryText, /UPDATE issuer_profiles/);
  } finally {
    pool.query = originalQuery;
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  }
});

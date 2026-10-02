const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db/connection');
const Application = require('../src/models/Application');

test('approved application list returns newest reviewed entries first', async () => {
  const originalQuery = pool.query;
  const originalDemoMode = process.env.DEMO_MODE;
  const approvedApplications = [{ id: 12, status: 'approved' }];
  let query;
  let params;
  process.env.DEMO_MODE = 'false';
  pool.query = async (sql, values) => {
    query = sql;
    params = values;
    return { rows: approvedApplications };
  };

  try {
    const rows = await Application.getByStatus('approved', 200, 0);
    assert.deepEqual(rows, approvedApplications);
    assert.match(query, /ORDER BY reviewed_at DESC NULLS LAST, submitted_at DESC/);
    assert.deepEqual(params, ['approved', 200, 0]);
  } finally {
    pool.query = originalQuery;
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  }
});

test('all application list returns newest submissions first', async () => {
  const originalQuery = pool.query;
  const originalDemoMode = process.env.DEMO_MODE;
  const applications = [{ id: 20, status: 'pending' }];
  let query;
  let params;
  process.env.DEMO_MODE = 'false';
  pool.query = async (sql, values) => {
    query = sql;
    params = values;
    return { rows: applications };
  };

  try {
    const rows = await Application.getAll(200, 0);
    assert.deepEqual(rows, applications);
    assert.match(query, /ORDER BY submitted_at DESC NULLS LAST, id DESC/);
    assert.deepEqual(params, [200, 0]);
  } finally {
    pool.query = originalQuery;
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  }
});

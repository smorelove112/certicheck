const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/connection');
const OTP = require('../src/models/OTP');

test('password reset OTP creation supports existing OTP tables and generates a six-digit code', async () => {
  const originalQuery = pool.query;
  const queries = [];
  pool.query = async (sql, params) => {
    queries.push({ sql, params });
    return {
      rows: sql.includes('INSERT INTO otp_verification')
        ? [{ id: 1, email: params[0], otp_code: params[1], purpose: params[2], expires_at: params[3] }]
        : []
    };
  };

  try {
    const otp = await OTP.create('ada@example.com', 'reset_password');
    assert.match(otp.otp_code, /^\d{6}$/);
    assert.equal(otp.purpose, 'reset_password');
    assert.equal(queries.length, 2);
    assert.match(queries[0].sql, /purpose = \$2 AND is_used = FALSE/);
    assert.deepEqual(queries[0].params, ['ada@example.com', 'reset_password']);
    assert.match(queries[1].sql, /purpose, expires_at, is_used/);
    assert.equal(queries[1].params[2], 'reset_password');
    assert.ok(new Date(otp.expires_at).getTime() > Date.now());
  } finally {
    pool.query = originalQuery;
  }
});

test('database initialization migrates legacy OTP tables with missing purpose and usage columns', () => {
  const initSql = fs.readFileSync(path.join(__dirname, '../src/db/init.sql'), 'utf8');
  assert.match(initSql, /ALTER TABLE otp_verification\s+ADD COLUMN IF NOT EXISTS purpose VARCHAR\(50\) NOT NULL DEFAULT 'reset_password'/);
  assert.match(initSql, /ALTER TABLE otp_verification\s+ADD COLUMN IF NOT EXISTS is_used BOOLEAN NOT NULL DEFAULT FALSE/);
});

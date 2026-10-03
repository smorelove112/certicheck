const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const pool = require('../src/db/connection');
const User = require('../src/models/User');

const originalQuery = pool.query;
test.after(() => {
  pool.query = originalQuery;
});

test('account approval stores a hashed default password and forces password change', async () => {
  let queryText;
  let queryParams;
  pool.query = async (sql, params) => {
    queryText = sql;
    queryParams = params;
    return {
      rows: [{
        id: 12,
        email: 'new.user@example.edu',
        is_active: true,
        must_change_password: true
      }]
    };
  };

  const approved = await User.approveAccount(12);

  assert.match(queryText, /is_active = TRUE, must_change_password = TRUE/);
  assert.match(queryText, /WHERE id = \$2 AND is_active = FALSE AND COALESCE\(user_type, 'user'\) != 'admin'/);
  assert.equal(await bcrypt.compare('password', queryParams[0]), true);
  assert.equal(approved.is_active, true);
  assert.equal(approved.must_change_password, true);
});

test('issuer activation sets a hashed password and consumes the matching unexpired activation code', async () => {
  let queryText;
  let queryParams;
  pool.query = async (sql, params) => {
    queryText = sql;
    queryParams = params;
    return {
      rows: [{
        id: 23,
        email: 'issuer@example.edu',
        user_type: 'issuer',
        is_active: true,
        is_verified: true
      }]
    };
  };

  const activated = await User.activateIssuer('Issuer@Example.edu', 'a'.repeat(64), 'a-strong-password');

  assert.match(queryText, /activation_code_hash = \$3/);
  assert.match(queryText, /activation_expires_at > NOW\(\)/);
  assert.match(queryText, /issuer_profiles\.status = 'approved'/);
  assert.match(queryText, /activation_code_hash = NULL/);
  assert.equal(queryParams[1], 'issuer@example.edu');
  assert.equal(queryParams[2], 'a'.repeat(64));
  assert.equal(await bcrypt.compare('a-strong-password', queryParams[0]), true);
  assert.equal(activated.is_verified, true);
  assert.equal(activated.is_active, true);
});

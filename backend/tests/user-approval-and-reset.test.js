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

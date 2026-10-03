const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db/connection');
const Application = require('../src/models/Application');
const User = require('../src/models/User');

test('public application persistence creates its user, profile, and queue record in one database round trip', async () => {
  const originalQuery = pool.query;
  const originalDemoMode = process.env.DEMO_MODE;
  const originalPasswordHash = User.getDefaultIssuerPasswordHash;
  let queryCount = 0;
  let queryText = '';
  let queryParams;

  process.env.DEMO_MODE = 'false';
  User.getDefaultIssuerPasswordHash = async () => 'cached-password-hash';
  pool.query = async (sql, params) => {
    queryCount += 1;
    queryText = sql;
    queryParams = params;
    return {
      rows: [{
        id: 41,
        organization_name: 'Acme University',
        contact_email: 'ada@acme.edu',
        generated_email: 'ada@acme.edu',
        status: 'pending',
        submitted_at: '2026-10-03T10:00:00.000Z',
        applicant_user_id: 12
      }]
    };
  };

  try {
    const result = await Application.create({
      applicantEmail: 'ada@acme.edu',
      applicantFirstName: 'Ada',
      applicantLastName: 'Lovelace',
      orgName: 'Acme University',
      orgType: 'university',
      website: null,
      contactName: 'Ada Lovelace',
      contactEmail: 'ada@acme.edu',
      generatedEmail: 'ada@acme.edu',
      contactRole: 'Registrar',
      volume: '1-100',
      useCase: 'Academic credentials',
      wallet: null
    });

    assert.equal(result.applicant_user_id, 12);
    assert.equal(queryCount, 1);
    assert.match(queryText, /WITH applicant_user AS/);
    assert.match(queryText, /ON CONFLICT \(email\) DO UPDATE/);
    assert.match(queryText, /INSERT INTO issuer_profiles/);
    assert.match(queryText, /INSERT INTO pending_applications/);
    assert.deepEqual(queryParams, [
      null,
      'ada@acme.edu',
      'cached-password-hash',
      'Ada',
      'Lovelace',
      'Acme University',
      'university',
      null,
      'Ada Lovelace',
      'Registrar',
      '1-100',
      'Academic credentials',
      null,
      'ada@acme.edu',
      'ada@acme.edu'
    ]);
  } finally {
    pool.query = originalQuery;
    User.getDefaultIssuerPasswordHash = originalPasswordHash;
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  }
});

test('an existing applicant account is reused without hashing another default password', async () => {
  const originalQuery = pool.query;
  const originalDemoMode = process.env.DEMO_MODE;
  const originalPasswordHash = User.getDefaultIssuerPasswordHash;
  let queryParams;
  process.env.DEMO_MODE = 'false';
  User.getDefaultIssuerPasswordHash = async () => {
    throw new Error('Existing users must not incur a password hash');
  };
  pool.query = async (_sql, params) => {
    queryParams = params;
    return { rows: [{ id: 42, applicant_user_id: 12 }] };
  };

  try {
    await Application.create({
      issuerId: 12,
      applicantEmail: 'ada@acme.edu',
      orgName: 'Acme University',
      contactName: 'Ada Lovelace',
      contactEmail: 'ada@acme.edu',
      generatedEmail: 'ada@acme.edu'
    });

    assert.equal(queryParams[0], 12);
    assert.equal(queryParams[2], null);
  } finally {
    pool.query = originalQuery;
    User.getDefaultIssuerPasswordHash = originalPasswordHash;
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fetch = require('cross-fetch');
const jwt = require('jsonwebtoken');
const pool = require('../src/db/connection');
const { CertificateStore } = require('../src/services/certificateStore');
const app = require('../src/server');

let server;
let tempDir;
let storeFile;
const originalPinataJwt = process.env.PINATA_JWT;

const demoHeaders = {
  Authorization: 'Bearer demo-token',
  'Content-Type': 'application/json'
};

async function startServer() {
  return new Promise((resolve, reject) => {
    server = app.listen(0, () => {
      resolve(server.address().port);
    });
    server.on('error', reject);
  });
}

test.before(async () => {
  delete process.env.PINATA_JWT;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'certicheck-api-'));
  storeFile = path.join(tempDir, 'certificates.json');
  process.env.CERTIFICATE_STORE_FILE = storeFile;
  process.env.DEMO_MODE = 'true';
  process.env.SOLANA_ENABLE = 'false';
  fs.writeFileSync(storeFile, JSON.stringify([]));
  const port = await startServer();
  process.env.TEST_SERVER_PORT = port;
});

test.after(async () => {
  if (server) {
    server.close();
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalPinataJwt === undefined) delete process.env.PINATA_JWT;
  else process.env.PINATA_JWT = originalPinataJwt;
});

test('issue and revoke APIs reject unapproved users despite a spoofed issuer header', async () => {
  const originalQuery = pool.query;
  const token = jwt.sign(
    { id: 10, user_type: 'user', userType: 'user', must_change_password: false },
    process.env.JWT_SECRET || 'dev_secret_key'
  );
  pool.query = async () => ({
    rows: [{ id: 10, user_type: 'user', is_active: true, issuer_status: 'pending' }]
  });

  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      'x-demo-user-type': 'issuer',
      'Content-Type': 'application/json'
    };
    const issueResponse = await fetch(`http://localhost:${process.env.TEST_SERVER_PORT}/api/certificates/issue`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ certificateId: 'CERT-API-FORBIDDEN' })
    });
    assert.equal(issueResponse.status, 403);
    assert.equal((await issueResponse.json()).error, 'Issuer approval required');

    const revokeResponse = await fetch(`http://localhost:${process.env.TEST_SERVER_PORT}/api/certificates/my-issued/CERT-API-001/revoke`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ reason: 'Unapproved issuer attempt' })
    });
    assert.equal(revokeResponse.status, 403);
    assert.equal((await revokeResponse.json()).error, 'Issuer approval required');

    const legacyRevokeResponse = await fetch(`http://localhost:${process.env.TEST_SERVER_PORT}/api/certificates/revoke/CERT-API-001`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ reason: 'Unapproved issuer attempt' })
    });
    assert.equal(legacyRevokeResponse.status, 403);
    assert.equal((await legacyRevokeResponse.json()).error, 'Issuer approval required');
  } finally {
    pool.query = originalQuery;
  }
});

test('an approved issuer with the certificate authority wallet can revoke it', async () => {
  const originalQuery = pool.query;
  const originalSolanaEnable = process.env.SOLANA_ENABLE;
  process.env.SOLANA_ENABLE = 'false';
  const token = jwt.sign(
    { id: 10, user_type: 'issuer', userType: 'issuer', must_change_password: false },
    process.env.JWT_SECRET || 'dev_secret_key'
  );
  pool.query = async (sql) => {
    if (sql.includes('FROM users u')) {
      return { rows: [{ id: 10, user_type: 'issuer', is_active: true, issuer_status: 'approved' }] };
    }
    if (sql.includes('FROM certificates c')) {
      return {
        rows: [{
          certificate_id: 'CERT-API-AUTHORITY',
          issuer_user_id: 20,
          issuer_wallet: 'shared-authority-wallet',
          authorized_issuer_wallet: 'shared-authority-wallet'
        }]
      };
    }
    if (sql.includes('UPDATE certificates')) {
      return {
        rows: [{
          certificate_id: 'CERT-API-AUTHORITY',
          certificate_type: 'Authority Test',
          status: 'revoked',
          issuer_wallet: 'shared-authority-wallet'
        }]
      };
    }
    return { rows: [] };
  };

  try {
    const response = await fetch(`http://localhost:${process.env.TEST_SERVER_PORT}/api/certificates/my-issued/CERT-API-AUTHORITY/revoke`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason: 'Authority test revoke' })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.certificate.certificate_id, 'CERT-API-AUTHORITY');
    assert.equal(result.certificate.status, 'revoked');
  } finally {
    pool.query = originalQuery;
    if (originalSolanaEnable === undefined) delete process.env.SOLANA_ENABLE;
    else process.env.SOLANA_ENABLE = originalSolanaEnable;
  }
});

test('certificate lifecycle persists metadata and returns database, IPFS, and revocation state', async () => {
  const originalQuery = pool.query;
  const originalSolanaEnable = process.env.SOLANA_ENABLE;
  process.env.SOLANA_ENABLE = 'false';
  const token = jwt.sign(
    { id: 31, user_type: 'issuer', userType: 'issuer', must_change_password: false },
    process.env.JWT_SECRET || 'dev_secret_key'
  );
  let savedCertificate = null;
  pool.query = async (sql, params = []) => {
    if (sql.includes('FROM users u')) {
      return { rows: [{ id: 31, user_type: 'issuer', is_active: true, issuer_status: 'approved' }] };
    }
    if (sql.includes('SELECT certificate_id FROM certificates')) {
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO certificates')) {
      savedCertificate = {
        certificate_id: params[0],
        issuer_user_id: params[1],
        issuer_name: params[2],
        issuer_wallet: params[3],
        holder_name: params[4],
        holder_email: params[5],
        certificate_type: params[6],
        status: params[7],
        ipfs_cid: params[8],
        ipfs_uri: params[9],
        ipfs_source: null,
        attachment_cid: null,
        attachment_filename: null,
        attachment_uri: null,
        attachment_source: null,
        blockchain_transaction_id: params[10],
        metadata: JSON.parse(params[11]),
        issued_at: params[12],
        created_at: params[12],
        revoked_at: null
      };
      return { rows: [savedCertificate] };
    }
    if (sql.includes('UPDATE certificates')) {
      if (sql.includes("SET status = 'revoked'")) {
        savedCertificate = {
          ...savedCertificate,
          status: 'revoked',
          revoked_at: new Date().toISOString()
        };
        return { rows: [savedCertificate] };
      }
      savedCertificate = {
        ...savedCertificate,
        ipfs_cid: params[0],
        ipfs_uri: params[1],
        ipfs_source: params[2],
        attachment_cid: params[3],
        attachment_filename: params[4],
        attachment_uri: params[5],
        attachment_source: params[6],
        metadata: JSON.parse(params[7]),
        blockchain_transaction_id: params[8]
      };
      return { rows: [savedCertificate] };
    }
    if (sql.includes('FROM certificates c')) {
      return {
        rows: [{
          certificate_id: savedCertificate.certificate_id,
          issuer_user_id: savedCertificate.issuer_user_id,
          issuer_wallet: savedCertificate.issuer_wallet,
          authorized_issuer_wallet: null
        }]
      };
    }
    if (sql.includes('FROM certificates') && sql.includes('issuer_user_id')) {
      return { rows: [savedCertificate] };
    }
    if (sql.includes('FROM certificates WHERE certificate_id')) {
      return { rows: params[0] === savedCertificate?.certificate_id ? [savedCertificate] : [] };
    }
    if (sql.includes('FROM verify_history')) return { rows: [] };
    if (sql.includes('RETURNING id, certificate_id, verification_status')) {
      return { rows: [{ certificate_id: params[3], verification_status: 'revoked', revoked_at: new Date().toISOString() }] };
    }
    return { rows: [] };
  };

  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    const baseUrl = `http://localhost:${process.env.TEST_SERVER_PORT}/api/certificates`;
    const issueResponse = await fetch(`${baseUrl}/issue`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        certificateId: 'CERT-DB-LIFECYCLE-001',
        holderName: 'Lifecycle Holder',
        holderEmail: 'lifecycle@example.com',
        certificateType: 'Degree Certificate',
        issuerName: 'Lifecycle University',
        metadata: {
          programName: 'Computer Science',
          graduationYear: 2026,
          attachment: {
            name: 'degree.pdf',
            type: 'application/pdf',
            size: 8,
            dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ='
          }
        }
      })
    });
    assert.equal(issueResponse.status, 201);
    const issueResult = await issueResponse.json();
    assert.equal(issueResult.certificate.certificate_id, 'CERT-DB-LIFECYCLE-001');
    assert.equal(issueResult.certificate.status, 'valid');
    assert.equal(issueResult.certificate.metadata.programName, 'Computer Science');
    assert.ok(issueResult.certificate.issued_at);
    assert.ok(issueResult.certificate.created_at);
    assert.ok(issueResult.certificate.ipfs_cid);
    assert.equal(issueResult.certificate.ipfs_source, 'fallback');
    assert.equal(issueResult.certificate.ipfs_uri, null);
    assert.equal(issueResult.certificate.attachment_filename, 'degree.pdf');
    assert.equal(issueResult.certificate.attachment_cid, null);
    assert.equal(issueResult.certificate.attachment_source, 'fallback');
    assert.equal('dataUrl' in issueResult.certificate.metadata.attachment, false);
    assert.equal(savedCertificate.status, 'valid');
    assert.equal(savedCertificate.ipfs_source, 'fallback');

    const listResponse = await fetch(`${baseUrl}/my-issued`, { headers });
    assert.equal(listResponse.status, 200);
    const listResult = await listResponse.json();
    assert.equal(listResult.certificates.length, 1);
    assert.equal(listResult.certificates[0].certificate_id, 'CERT-DB-LIFECYCLE-001');
    assert.equal(listResult.certificates[0].status, 'valid');
    assert.equal(listResult.certificates[0].ipfs_cid, issueResult.certificate.ipfs_cid);
    assert.equal(listResult.certificates[0].ipfs_source, 'fallback');
    assert.equal(listResult.certificates[0].attachment_filename, 'degree.pdf');
    assert.equal(listResult.certificates[0].attachment_source, 'fallback');

    const revokeResponse = await fetch(`${baseUrl}/my-issued/CERT-DB-LIFECYCLE-001/revoke`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ reason: 'Lifecycle test revocation' })
    });
    assert.equal(revokeResponse.status, 200);
    const revokeResult = await revokeResponse.json();
    assert.equal(revokeResult.certificate.status, 'revoked');
    assert.ok(revokeResult.certificate.revoked_at);

    const verifyResponse = await fetch(`${baseUrl}/lookup/CERT-DB-LIFECYCLE-001`);
    assert.equal(verifyResponse.status, 200);
    const verifyResult = await verifyResponse.json();
    assert.equal(verifyResult.status, 'revoked');
    assert.equal(verifyResult.certificate.metadata.programName, 'Computer Science');
    assert.equal(verifyResult.certificate.metadata.graduationYear, 2026);
    assert.equal(verifyResult.certificate.ipfs_source, 'fallback');
    assert.equal(verifyResult.certificate.attachment_filename, 'degree.pdf');
    assert.equal(verifyResult.certificate.attachment_source, 'fallback');
    assert.ok(verifyResult.certificate.revoked_at);

    const missingResponse = await fetch(`${baseUrl}/lookup/CERT-DB-LIFECYCLE-MISSING`);
    assert.equal(missingResponse.status, 404);
    assert.equal((await missingResponse.json()).status, 'not_found');
  } finally {
    pool.query = originalQuery;
    if (originalSolanaEnable === undefined) delete process.env.SOLANA_ENABLE;
    else process.env.SOLANA_ENABLE = originalSolanaEnable;
  }
});

test('approved issuer can issue without a wallet while Solana mode is enabled', async () => {
  const originalQuery = pool.query;
  const originalSolanaEnable = process.env.SOLANA_ENABLE;
  process.env.SOLANA_ENABLE = 'true';
  const certificateId = `CERT-OFFCHAIN-${Date.now()}`;
  let savedCertificate = null;
  pool.query = async (sql, params = []) => {
    if (sql.includes('FROM users u')) {
      return { rows: [{ id: 1, user_type: 'issuer', is_active: true, issuer_status: 'approved' }] };
    }
    if (sql.includes('SELECT certificate_id FROM certificates')) return { rows: [] };
    if (sql.includes('INSERT INTO certificates')) {
      savedCertificate = {
        certificate_id: params[0],
        issuer_user_id: params[1],
        issuer_name: params[2],
        issuer_wallet: params[3],
        holder_name: params[4],
        holder_email: params[5],
        certificate_type: params[6],
        status: params[7],
        ipfs_cid: params[8],
        ipfs_uri: params[9],
        blockchain_transaction_id: params[10],
        metadata: JSON.parse(params[11]),
        issued_at: params[12],
        created_at: params[12],
        revoked_at: null
      };
      return { rows: [savedCertificate] };
    }
    if (sql.includes('UPDATE certificates')) {
      savedCertificate = {
        ...savedCertificate,
        ipfs_cid: params[0],
        ipfs_uri: params[1],
        blockchain_transaction_id: params[8],
        metadata: JSON.parse(params[7])
      };
      return { rows: [savedCertificate] };
    }
    if (sql.includes('FROM certificates WHERE certificate_id')) {
      return { rows: params[0] === certificateId && savedCertificate ? [savedCertificate] : [] };
    }
    return { rows: [] };
  };

  try {
    const baseUrl = `http://localhost:${process.env.TEST_SERVER_PORT}/api/certificates`;
    const issueResponse = await fetch(`${baseUrl}/issue`, {
      method: 'POST',
      headers: demoHeaders,
      body: JSON.stringify({
        certificateId,
        holderName: 'No Wallet Holder',
        holderEmail: 'no-wallet@example.com',
        certificateType: 'Completion Certificate',
        issuerName: 'Approved Issuer',
        issuerWallet: '',
        onChain: false
      })
    });
    assert.equal(issueResponse.status, 201);
    const issued = await issueResponse.json();
    assert.equal(issued.certificate.on_chain, false);
    assert.equal(issued.certificate.blockchain_transaction_id, null);
    assert.ok(issued.warnings.some(warning => warning.includes('off-chain')));

    const lookupResponse = await fetch(`${baseUrl}/lookup/${certificateId}`);
    assert.equal(lookupResponse.status, 200);
    const lookup = await lookupResponse.json();
    assert.equal(lookup.status, 'valid');
    assert.equal(lookup.onChain, false);
    assert.equal(lookup.verificationMode, 'off-chain');
  } finally {
    pool.query = originalQuery;
    if (originalSolanaEnable === undefined) delete process.env.SOLANA_ENABLE;
    else process.env.SOLANA_ENABLE = originalSolanaEnable;
  }
});

test('backend certificate issue, lookup, and revoke API flow', async () => {
  const port = process.env.TEST_SERVER_PORT;
  const baseUrl = `http://localhost:${port}`;
  const certificateId = `CERT-API-${Date.now()}`;

  const issueResponse = await fetch(`${baseUrl}/api/certificates/issue`, {
    method: 'POST',
    headers: demoHeaders,
    body: JSON.stringify({
      certificateId,
      holderName: 'Alice Example',
      holderEmail: 'alice@example.com',
      certificateType: 'API Integration Test',
      issuerName: 'Certicheck Test Issuer',
      issuerWallet: 'demo-wallet',
      issueOnChain: false,
      metadata: { program: 'Testing' }
    })
  });

  assert.equal(issueResponse.status, 201);
  const issueResult = await issueResponse.json();
  assert.equal(issueResult.success, true);
  assert.equal(issueResult.certificate.certificate_id, certificateId);
  assert.equal(issueResult.certificate.verification_status, 'valid');
  assert.ok(issueResult.certificate.ipfs_cid);
  assert.ok(issueResult.certificate.issued_at);
  assert.equal(issueResult.certificate.metadata.program, 'Testing');

  const listResponse = await fetch(`${baseUrl}/api/certificates/my-issued`, {
    headers: demoHeaders
  });
  assert.equal(listResponse.status, 200);
  const listResult = await listResponse.json();
  assert.equal(listResult.success, true);
  const listedCertificate = listResult.certificates.find(item => item.certificate_id === certificateId);
  assert.ok(listedCertificate);
  assert.equal(listedCertificate.ipfs_cid, issueResult.certificate.ipfs_cid);

  const lookupResponse = await fetch(`${baseUrl}/api/certificates/lookup/${encodeURIComponent(certificateId)}`);
  assert.equal(lookupResponse.status, 200);
  const lookupResult = await lookupResponse.json();
  assert.equal(lookupResult.success, true);
  assert.equal(lookupResult.certificate.certificate_id, certificateId);
  assert.equal(lookupResult.status, 'valid');
  assert.equal(lookupResult.certificate.metadata.program, 'Testing');

  const nonOwnerCertificate = new CertificateStore().issue({
    certificateId: 'CERT-API-NON-OWNER',
    holderName: 'Other Issuer',
    holderEmail: 'other@example.com',
    certificateType: 'Test',
    issuerName: 'Other Issuer',
    userId: 2
  });
  assert.equal(nonOwnerCertificate.certificate_id, 'CERT-API-NON-OWNER');
  const forbiddenResponse = await fetch(`${baseUrl}/api/certificates/my-issued/CERT-API-NON-OWNER/revoke`, {
    method: 'PUT',
    headers: demoHeaders,
    body: JSON.stringify({ reason: 'Should not revoke another issuer certificate' })
  });
  assert.equal(forbiddenResponse.status, 403);
  const forbiddenResult = await forbiddenResponse.json();
  assert.equal(forbiddenResult.error, 'Not allowed to revoke this certificate');

  const revokeResponse = await fetch(`${baseUrl}/api/certificates/my-issued/${encodeURIComponent(certificateId)}/revoke`, {
    method: 'PUT',
    headers: demoHeaders,
    body: JSON.stringify({ reason: 'Integration test issuer revoke' })
  });
  assert.equal(revokeResponse.status, 200);
  const revokeResult = await revokeResponse.json();
  assert.equal(revokeResult.success, true);
  assert.equal(revokeResult.certificate.verification_status, 'revoked');
  assert.ok(revokeResult.certificate.revoked_at);

  const legacyRevokeResponse = await fetch(`${baseUrl}/api/certificates/revoke/${encodeURIComponent(certificateId)}`, {
    method: 'PUT',
    headers: demoHeaders,
    body: JSON.stringify({ reason: 'Integration test legacy issuer revoke' })
  });
  assert.equal(legacyRevokeResponse.status, 200);

  const verifyResponse = await fetch(`${baseUrl}/api/certificates/lookup/${encodeURIComponent(certificateId)}`);
  assert.equal(verifyResponse.status, 200);
  const verifyResult = await verifyResponse.json();
  assert.equal(verifyResult.certificate.verification_status, 'revoked');
});

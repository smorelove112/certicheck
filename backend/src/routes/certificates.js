const express = require('express');
const pool = require('../db/connection');
const { verifyToken, verifyIssuer, logAudit } = require('../middleware/auth');
const { pinJsonToIpfs, pinFileToIpfs } = require('../services/ipfsService');
const {
  lookupCertificateOnChain,
  verifyIssuedCertificateOnChain,
  verifyProgramTransaction,
  getTransactionStatus
} = require('../services/solanaService');
const { getDemoCertificate } = require('../services/demoCertificateService');
const { CertificateStore } = require('../services/certificateStore');
const { isValidEmail } = require('../utils/validation');

const router = express.Router();
const MAX_CERTIFICATE_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function getCertificateAttachmentError(metadata) {
  const attachment = metadata?.attachment;
  if (!attachment) return null;
  if (typeof attachment !== 'object' || Array.isArray(attachment)) {
    return 'The supporting file could not be read. Please choose it again.';
  }
  if (attachment.name && String(attachment.name).length > 255) {
    return 'Supporting file names must be 255 characters or fewer.';
  }
  if (typeof attachment.dataUrl !== 'string') {
    return attachment.name && !attachment.cid
      ? 'The supporting file could not be read. Please choose it again.'
      : null;
  }
  const match = attachment.dataUrl.match(/^data:[^;,]+;base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) return 'The supporting file has an invalid format.';
  const size = Buffer.from(match[1], 'base64').length;
  if (size > MAX_CERTIFICATE_ATTACHMENT_BYTES || Number(attachment.size) > MAX_CERTIFICATE_ATTACHMENT_BYTES) {
    return 'Supporting files must be 4 MB or smaller.';
  }
  return null;
}

function getPublicCertificateMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const publicMetadata = { ...metadata };
  if (
    publicMetadata.attachment &&
    typeof publicMetadata.attachment === 'object' &&
    'dataUrl' in publicMetadata.attachment
  ) {
    const attachment = { ...publicMetadata.attachment };
    delete attachment.dataUrl;
    publicMetadata.attachment = attachment;
  }
  return publicMetadata;
}

async function pinCertificateAttachment(metadata) {
  const storedMetadata = getPublicCertificateMetadata(metadata);
  const attachment = metadata?.attachment;
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
    return { metadata: storedMetadata, attachment: null, warning: null };
  }
  if (typeof attachment.dataUrl !== 'string') {
    return {
      metadata: storedMetadata,
      attachment: attachment.cid ? {
        cid: attachment.cid,
        uri: attachment.uri || null,
        source: attachment.source || 'external',
        filename: attachment.name || null
      } : null,
      warning: null
    };
  }

  if (!process.env.PINATA_JWT) {
    storedMetadata.attachment = {
      ...storedMetadata.attachment,
      source: 'fallback',
      storage: 'File not pinned; configure PINATA_JWT to store attachments on IPFS'
    };
    return {
      metadata: storedMetadata,
      attachment: { source: 'fallback', filename: attachment.name || null },
      warning: 'Supporting file was not pinned because PINATA_JWT is not configured.'
    };
  }

  try {
    const result = await pinFileToIpfs({
      dataUrl: attachment.dataUrl,
      filename: attachment.name
    });
    storedMetadata.attachment = {
      ...storedMetadata.attachment,
      cid: result.cid,
      uri: result.uri,
      source: result.source,
      storage: 'Pinned to IPFS'
    };
    return {
      metadata: storedMetadata,
      attachment: {
        cid: result.cid,
        uri: result.uri,
        source: result.source,
        filename: attachment.name || null
      },
      warning: null
    };
  } catch (err) {
    console.error(`Supporting file upload failed for certificate attachment: ${err.message}`);
    storedMetadata.attachment = {
      ...storedMetadata.attachment,
      source: 'pinata-failed',
      storage: 'File upload to IPFS failed'
    };
    return {
      metadata: storedMetadata,
      attachment: { source: 'pinata-failed', filename: attachment.name || null },
      warning: 'Supporting file could not be pinned to IPFS. The certificate was issued without an IPFS file link.'
    };
  }
}

let certificateStore;
function getCertificateStore() {
  if (!certificateStore) {
    certificateStore = new CertificateStore();
  }
  return certificateStore;
}

async function safeTransactionStatus(signature) {
  if (!signature || typeof signature !== 'string' || signature.length < 40) {
    return null;
  }
  try {
    return await getTransactionStatus(signature);
  } catch (err) {
    console.warn('Transaction status fetch failed:', err.message);
    return null;
  }
}

async function safeQuery(text, params = []) {
  const timeoutMs = Number(process.env.DB_QUERY_TIMEOUT_MS || 1500);
  return Promise.race([
    pool.query(text, params),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timed out')), timeoutMs))
  ]);
}

router.post('/issue', verifyToken, verifyIssuer, async (req, res) => {
  try {
    const {
      certificateId,
      holderName,
      holderEmail,
      certificateType,
      issuerName,
      issuerWallet,
      onChain = false,
      metadata = {}
    } = req.body;

    const trimmedCertificateId = typeof certificateId === 'string' ? certificateId.trim() : '';
    const trimmedHolderName = typeof holderName === 'string' ? holderName.trim() : '';
    const trimmedHolderEmail = typeof holderEmail === 'string' ? holderEmail.trim() : '';
    const trimmedCertificateType = typeof certificateType === 'string' ? certificateType.trim() : '';
    const trimmedIssuerName = typeof issuerName === 'string' ? issuerName.trim() : '';
    const trimmedIssuerWallet = typeof issuerWallet === 'string' ? issuerWallet.trim() : '';

    if (onChain === true) {
      return res.status(409).json({
        error: 'On-chain issuance must be signed by the approved issuer wallet. Connect a wallet and use the wallet-signed issuance flow.'
      });
    }

    if (
      !trimmedCertificateId ||
      !trimmedHolderName ||
      !trimmedHolderEmail || !isValidEmail(trimmedHolderEmail) ||
      !trimmedCertificateType ||
      !trimmedIssuerName
    ) {
      return res.status(400).json({ error: 'Missing required certificate fields' });
    }

    const requestedMetadata = typeof metadata === 'object' && metadata !== null ? metadata : {};
    const attachmentError = getCertificateAttachmentError(requestedMetadata);
    if (attachmentError) return res.status(400).json({ error: attachmentError });
    const storedMetadata = getPublicCertificateMetadata(requestedMetadata);
    const issuedAt = new Date().toISOString();

    const existingCertificate = process.env.DEMO_MODE === 'true'
      ? getCertificateStore().lookup(trimmedCertificateId)
      : null;
    if (existingCertificate) {
      return res.status(409).json({ error: 'Certificate with this ID already exists' });
    }

    try {
      const existing = await safeQuery(
        'SELECT certificate_id FROM certificates WHERE certificate_id = $1 LIMIT 1',
        [trimmedCertificateId]
      );
      if (existing.rows[0]) {
        return res.status(409).json({ error: 'Certificate with this ID already exists' });
      }
    } catch (dbErr) {
      if (process.env.DEMO_MODE !== 'true') {
        return res.status(503).json({ error: 'Certificate database is unavailable. Please try again.' });
      }
      console.warn('Certificate duplicate check unavailable in demo mode:', dbErr.message);
    }

    let dbCertificate = null;
    try {
      const certificateResult = await safeQuery(
        `INSERT INTO certificates
          (certificate_id, issuer_user_id, issuer_name, issuer_wallet, holder_name, holder_email, certificate_type, status, ipfs_cid, ipfs_uri, blockchain_transaction_id, metadata, issued_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
         RETURNING *`,
        [
          trimmedCertificateId,
          req.user.id,
          trimmedIssuerName,
          trimmedIssuerWallet,
          trimmedHolderName,
          trimmedHolderEmail,
          trimmedCertificateType,
          'valid',
          null,
          null,
          null,
          JSON.stringify(storedMetadata),
          issuedAt
        ]
      );
      dbCertificate = certificateResult.rows[0];
    } catch (dbErr) {
      if (/duplicate|unique/i.test(dbErr.message)) {
        return res.status(409).json({ error: 'Certificate with this ID already exists' });
      }
      if (process.env.DEMO_MODE !== 'true') {
        console.error('Certificate database insert failed:', dbErr.message);
        return res.status(503).json({ error: 'Certificate could not be saved to the database. Please try again.' });
      }
      console.warn('Certificate database insert unavailable in demo mode:', dbErr.message);
    }

    let ipfsCid = null;
    let ipfsUri = null;
    let ipfsSource = process.env.PINATA_JWT ? 'pinata-failed' : 'fallback';
    let attachmentDetails = null;
    let blockchainTransactionId = null;
    let issuancePath = 'database-only';
    const warnings = [];
    try {
      const prepared = await pinCertificateAttachment(requestedMetadata);
      attachmentDetails = prepared.attachment;
      Object.assign(storedMetadata, prepared.metadata);
      if (prepared.warning) warnings.push(prepared.warning);

      const certificateMetadata = {
        certificateId: trimmedCertificateId,
        holderName: trimmedHolderName,
        holderEmail: trimmedHolderEmail,
        certificateType: trimmedCertificateType,
        issuerName: trimmedIssuerName,
        issuerWallet: trimmedIssuerWallet || null,
        issuedAt,
        status: 'valid',
        metadata: storedMetadata
      };
      const ipfsResult = await pinJsonToIpfs(certificateMetadata);
      ipfsSource = ipfsResult?.source || (process.env.PINATA_JWT ? 'pinata-failed' : 'fallback');
      ipfsCid = ipfsResult?.cid || null;
      ipfsUri = ipfsResult?.uri || null;
      if (!ipfsCid) warnings.push('Certificate was saved, but IPFS did not return a content identifier.');
      else issuancePath = ipfsSource === 'pinata' ? 'off-chain-ipfs-pinned' : 'off-chain-fallback-hash';
    } catch (ipfsErr) {
      ipfsSource = process.env.PINATA_JWT ? 'pinata-failed' : 'fallback';
      console.error(`Certificate ${trimmedCertificateId} was saved, but IPFS metadata pinning failed: ${ipfsErr.message}`);
      warnings.push(process.env.PINATA_JWT
        ? 'Certificate was saved, but Pinata did not pin its metadata. No Pinata CID is available.'
        : 'Certificate was saved, but IPFS metadata could not be pinned.');
    }

    if (process.env.SOLANA_ENABLE === 'true') {
      warnings.push('Issued without connecting a wallet. This certificate is off-chain and is not independently verified by Solana.');
    }

    if (dbCertificate) {
      try {
        const result = await safeQuery(
          `UPDATE certificates
           SET ipfs_cid = $1, ipfs_uri = $2, ipfs_source = $3,
               attachment_cid = $4, attachment_filename = $5, attachment_uri = $6,
               attachment_source = $7, metadata = $8,
               blockchain_transaction_id = $9, updated_at = NOW()
           WHERE certificate_id = $10
           RETURNING *`,
          [
            ipfsCid,
            ipfsUri,
            ipfsSource,
            attachmentDetails?.cid || null,
            attachmentDetails?.filename || null,
            attachmentDetails?.uri || null,
            attachmentDetails?.source || null,
            JSON.stringify(storedMetadata),
            blockchainTransactionId,
            trimmedCertificateId
          ]
        );
        dbCertificate = result.rows[0] || dbCertificate;
      } catch (dbErr) {
        console.error('Certificate saved but IPFS/chain details could not be updated:', dbErr.message);
        warnings.push('Certificate saved, but IPFS or blockchain details could not be updated in the database.');
      }
    }

    if (dbCertificate) try {
      await safeQuery(
        `INSERT INTO verify_history
          (user_id, certificate_id, certificate_type, verification_status, verification_message, blockchain_hash, blockchain_transaction_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.user.id, trimmedCertificateId, trimmedCertificateType, 'valid', 'Issued via Certicheck', ipfsCid, blockchainTransactionId]
      );
    } catch (verifyErr) {
      console.warn('Failed to save verify history record:', verifyErr.message);
    }

    let localCertificate = null;
    if (process.env.DEMO_MODE === 'true') {
      localCertificate = getCertificateStore().issue({
        certificateId: trimmedCertificateId,
        holderName: trimmedHolderName,
        holderEmail: trimmedHolderEmail,
        certificateType: trimmedCertificateType,
        issuerName: trimmedIssuerName,
        issuerWallet: trimmedIssuerWallet,
        ipfsCid,
        ipfsUri,
        ipfsSource,
        attachmentCid: attachmentDetails?.cid,
        attachmentFilename: attachmentDetails?.filename,
        attachmentUri: attachmentDetails?.uri,
        attachmentSource: attachmentDetails?.source,
        blockchainTransactionId,
        metadata: storedMetadata,
        issuedAt,
        userId: req.user.id
      });
    }

    await logAudit(req.user.id, 'CERTIFICATE_VERIFY', 'certificate', trimmedCertificateId, 'success', null, {
      certificateId: trimmedCertificateId,
      ipfsCid,
      ipfsUri,
      ipfsSource,
      attachmentCid: attachmentDetails?.cid || null,
      attachmentFilename: attachmentDetails?.filename || null,
      attachmentUri: attachmentDetails?.uri || null,
      issuerName: trimmedIssuerName,
      issuerWallet: trimmedIssuerWallet,
      holderName: trimmedHolderName,
      holderEmail: trimmedHolderEmail,
      issuancePath,
      blockchainTransactionId,
      dbStored: Boolean(dbCertificate),
      localId: localCertificate?.id || null
    });

    res.status(201).json({
      success: true,
      certificate: {
        certificate_id: trimmedCertificateId,
        ipfs_cid: ipfsCid,
        ipfs_uri: ipfsUri,
        ipfs_source: ipfsSource,
        attachment_cid: attachmentDetails?.cid || null,
        attachment_filename: attachmentDetails?.filename || null,
        attachment_uri: attachmentDetails?.uri || null,
        attachment_source: attachmentDetails?.source || null,
        blockchain_transaction_id: blockchainTransactionId,
        on_chain: false,
        certificate_type: trimmedCertificateType,
        status: 'valid',
        issued_at: dbCertificate?.issued_at || issuedAt,
        created_at: dbCertificate?.created_at || issuedAt,
        verification_status: 'valid',
        issuer_name: trimmedIssuerName,
        issuer_wallet: trimmedIssuerWallet,
        holder_name: trimmedHolderName,
        holder_email: trimmedHolderEmail,
        metadata: storedMetadata
      },
      warnings
    });
  } catch (err) {
    console.error('Issue certificate error:', err);
    res.status(500).json({ error: 'Failed to issue certificate', details: err.message });
  }
});

// Pin raw certificate metadata to IPFS and return the CID (used for client-side signing flows)
router.post('/pin', verifyToken, verifyIssuer, async (req, res) => {
  try {
    const requestedMetadata = req.body?.metadata || {};
    const attachmentError = getCertificateAttachmentError(requestedMetadata);
    if (attachmentError) return res.status(400).json({ success: false, error: attachmentError });
    const prepared = await pinCertificateAttachment(requestedMetadata);
    const pinResult = await pinJsonToIpfs(prepared.metadata);
    const ipfsCid = pinResult?.cid;
    if (!ipfsCid) return res.status(500).json({ success: false, error: 'Failed to pin metadata' });
    return res.json({
      success: true,
      cid: ipfsCid,
      uri: pinResult.uri || null,
      source: pinResult.source || 'fallback',
      metadata: prepared.metadata,
      attachment: prepared.attachment,
      warnings: prepared.warning ? [prepared.warning] : []
    });
  } catch (err) {
    console.error('Pin metadata error:', err);
    return res.status(500).json({ success: false, error: 'Pin failed', details: err.message });
  }
});

// Record a certificate that was issued with a client-signed on-chain transaction
router.post('/issue-client-signed', verifyToken, verifyIssuer, async (req, res) => {
  try {
    const {
      certificateId,
      holderName,
      holderEmail,
      certificateType,
      issuerName,
      issuerWallet,
      holderWallet,
      ipfsCid,
      ipfsUri: suppliedIpfsUri,
      ipfsSource: suppliedIpfsSource,
      blockchainTransactionId,
      metadata = {}
    } = req.body;

    const trimmedCertificateId = typeof certificateId === 'string' ? certificateId.trim() : '';
    if (!trimmedCertificateId || !holderName || !holderEmail || !isValidEmail(holderEmail) || !certificateType || !issuerName || !issuerWallet || !ipfsCid || !blockchainTransactionId) {
      return res.status(400).json({ error: 'Missing required fields for client-signed issuance' });
    }

    if (process.env.SOLANA_ENABLE !== 'true') {
      return res.status(409).json({ error: 'On-chain certificate issuance is not enabled on this backend.' });
    }
    if (req.user.issuer_wallet && req.user.issuer_wallet !== issuerWallet) {
      return res.status(403).json({ error: 'The connected wallet does not match the approved issuer wallet.' });
    }

    const normalizedMetadata = typeof metadata === 'object' && metadata !== null ? metadata : {};
    const attachmentError = getCertificateAttachmentError(normalizedMetadata);
    if (attachmentError) return res.status(400).json({ error: attachmentError });
    const ipfsSource = suppliedIpfsSource === 'pinata' ? 'pinata' : 'fallback';
    if (ipfsSource !== 'pinata') {
      return res.status(400).json({ error: 'Certificate metadata must be pinned to IPFS before on-chain issuance.' });
    }
    const ipfsUri = ipfsSource === 'pinata'
      ? (suppliedIpfsUri || `https://gateway.pinata.cloud/ipfs/${encodeURIComponent(ipfsCid)}`)
      : null;
    const storedMetadata = getPublicCertificateMetadata(normalizedMetadata);
    const attachment = storedMetadata.attachment && typeof storedMetadata.attachment === 'object'
      ? storedMetadata.attachment
      : {};
    const warnings = [];

    const issuedAt = new Date().toISOString();
    const [chainCertificate, transactionStatus] = await Promise.all([
      verifyIssuedCertificateOnChain({
        certificateId: trimmedCertificateId,
        issuerWallet,
        holderWallet,
        holderName,
        certificateType,
        ipfsCid
      }),
      getTransactionStatus(blockchainTransactionId)
    ]);
    if (!chainCertificate || chainCertificate.verification_status !== 'valid') {
      return res.status(409).json({ error: 'The submitted certificate does not exist as a valid certificate on-chain.' });
    }
    if (!transactionStatus || transactionStatus.err) {
      return res.status(409).json({ error: 'The issuance transaction is not confirmed successfully on Solana.' });
    }
    await verifyProgramTransaction({
      signature: blockchainTransactionId,
      instructionName: 'issueCertificate',
      expectedArgs: [
        ['certId', trimmedCertificateId],
        ['holderName', holderName],
        ['certType', certificateType],
        ['metadataUri', `ipfs://${ipfsCid}`],
        ['metadataHash', ipfsCid]
      ],
      issuerWallet
    });

    let dbCertificate = null;
    try {
      const result = await safeQuery(
        `INSERT INTO certificates
          (certificate_id, issuer_user_id, issuer_name, issuer_wallet, holder_name, holder_email, certificate_type, status, ipfs_cid, ipfs_uri, ipfs_source, attachment_cid, attachment_filename, attachment_uri, attachment_source, blockchain_transaction_id, metadata, issued_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
         RETURNING *`,
        [
          trimmedCertificateId,
          req.user.id,
          issuerName,
          issuerWallet || null,
          holderName,
          holderEmail,
          certificateType,
          'valid',
          ipfsCid,
          ipfsUri,
          ipfsSource,
          attachment.cid || null,
          attachment.filename || attachment.name || null,
          attachment.uri || null,
          attachment.source || null,
          blockchainTransactionId,
          JSON.stringify(storedMetadata),
          issuedAt
        ]
      );
      dbCertificate = result.rows[0];
    } catch (dbErr) {
      if (/duplicate|unique/i.test(dbErr.message)) {
        return res.status(409).json({ error: 'Certificate with this ID already exists' });
      }
      if (process.env.DEMO_MODE !== 'true') {
        console.error('Client-signed certificate database insert failed:', dbErr.message);
        return res.status(503).json({ error: 'Certificate could not be saved to the database. Please try again.' });
      }
      console.warn('Client-signed certificate database insert unavailable in demo mode:', dbErr.message);
    }

    try {
      await safeQuery(
        `INSERT INTO verify_history
          (user_id, certificate_id, certificate_type, verification_status, verification_message, blockchain_hash, blockchain_transaction_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.user.id, trimmedCertificateId, certificateType, 'valid', 'Issued via client-signed tx', ipfsCid, blockchainTransactionId]
      );
    } catch (verifyErr) {
      console.warn('Failed to save verify history record for client-signed issuance:', verifyErr.message);
    }

    if (process.env.DEMO_MODE === 'true') {
      try {
        getCertificateStore().issue({
        certificateId: trimmedCertificateId,
        holderName,
        holderEmail,
        certificateType,
        issuerName,
        issuerWallet:         issuerWallet,
        ipfsCid,
        ipfsUri,
        ipfsSource,
        attachmentCid: attachment.cid || null,
        attachmentFilename: attachment.filename || null,
        attachmentUri: attachment.uri || null,
        attachmentSource: attachment.source || null,
        blockchainTransactionId,
        metadata: storedMetadata,
        issuedAt,
        userId: req.user.id
        });
      } catch (storeErr) {
        if (/already exists/i.test(storeErr.message)) {
          return res.status(409).json({ error: 'Certificate with this ID already exists' });
        }
        console.error('Failed to store client-signed certificate locally:', storeErr.message);
        return res.status(500).json({ error: 'Certificate could not be stored locally' });
      }
    }

    await logAudit(req.user.id, 'CERTIFICATE_VERIFY', 'certificate', trimmedCertificateId, 'success', null, {
      certificateId: trimmedCertificateId,
      ipfsCid,
      ipfsUri,
      ipfsSource,
      issuerName,
      issuerWallet,
      holderName,
      holderEmail,
      issuancePath: 'client-signed',
      blockchainTransactionId
    });

    return res.status(201).json({ success: true, warnings, certificate: { certificate_id: trimmedCertificateId, ipfs_cid: ipfsCid, ipfs_uri: ipfsUri, ipfs_source: ipfsSource, attachment_cid: attachment.cid || null, attachment_filename: attachment.filename || null, attachment_uri: attachment.uri || null, attachment_source: attachment.source || null, blockchain_transaction_id: blockchainTransactionId, status: 'valid', verification_status: 'valid', issuer_name: issuerName, issuer_wallet: issuerWallet, holder_name: holderName, holder_email: holderEmail, certificate_type: certificateType, metadata: storedMetadata, issued_at: dbCertificate?.issued_at || issuedAt, created_at: dbCertificate?.created_at || issuedAt } });
  } catch (err) {
    console.error('Issue client-signed error:', err);
    return res.status(500).json({ error: 'Failed to record client-signed issuance', details: err.message });
  }
});

router.get('/my-issued', verifyToken, verifyIssuer, async (req, res) => {
  try {
    let certificates;
    try {
      const result = await safeQuery(
        `SELECT certificate_id, certificate_type, status, ipfs_cid, ipfs_uri, ipfs_source,
                attachment_cid, attachment_filename, attachment_uri, attachment_source,
                blockchain_transaction_id, holder_name, holder_email, issuer_name,
                issuer_wallet, metadata, issued_at, created_at, revoked_at
         FROM certificates
         WHERE issuer_user_id = $1
         ORDER BY issued_at DESC`,
        [req.user.id]
      );
      certificates = result.rows;
      if (process.env.DEMO_MODE === 'true') {
        const stored = getCertificateStore().listByIssuer(req.user.id).map((record) => ({
          certificate_id: record.certificate_id,
          certificate_type: record.certificate_type,
          status: record.verification_status,
          verification_status: record.verification_status,
          ipfs_cid: record.ipfs_cid || record.blockchain_hash,
          ipfs_uri: record.ipfs_uri,
          ipfs_source: record.ipfs_source || 'fallback',
          attachment_cid: record.attachment_cid || null,
          attachment_filename: record.attachment_filename || null,
          attachment_uri: record.attachment_uri || null,
          attachment_source: record.attachment_source || null,
          blockchain_transaction_id: record.blockchain_transaction_id,
          holder_name: record.holder_name,
          holder_email: record.holder_email,
          issuer_name: record.issuer_name,
          issuer_wallet: record.issuer_wallet,
          metadata: record.metadata || {},
          issued_at: record.issued_at || record.checked_at,
          created_at: record.issued_at || record.checked_at,
          revoked_at: record.revoked_at
        }));
        const seen = new Set(certificates.map((record) => record.certificate_id));
        certificates.push(...stored.filter((record) => !seen.has(record.certificate_id)));
      }
    } catch (dbErr) {
      if (process.env.DEMO_MODE !== 'true') {
        console.error('Issuer certificate list query failed:', dbErr.message);
        return res.status(503).json({ error: 'Unable to load issued certificates right now' });
      }
      console.warn('Issuer certificate list unavailable in database; using demo store:', dbErr.message);
      certificates = getCertificateStore().listByIssuer(req.user.id).map((record) => ({
        certificate_id: record.certificate_id,
        certificate_type: record.certificate_type,
        status: record.verification_status,
        verification_status: record.verification_status,
        ipfs_cid: record.ipfs_cid || record.blockchain_hash,
        ipfs_uri: record.ipfs_uri,
        ipfs_source: record.ipfs_source || 'fallback',
        attachment_cid: record.attachment_cid || null,
        attachment_filename: record.attachment_filename || null,
        attachment_uri: record.attachment_uri || null,
        attachment_source: record.attachment_source || null,
        blockchain_transaction_id: record.blockchain_transaction_id,
        holder_name: record.holder_name,
        holder_email: record.holder_email,
        issuer_name: record.issuer_name,
        issuer_wallet: record.issuer_wallet,
        metadata: record.metadata || {},
        issued_at: record.issued_at || record.checked_at,
        created_at: record.issued_at || record.checked_at,
        revoked_at: record.revoked_at
      }));
    }
    return res.json({ success: true, certificates });
  } catch (err) {
    console.error('Issuer certificate list error:', err);
    return res.status(500).json({ error: 'Failed to load issued certificates' });
  }
});

async function revokeIssuerCertificate(req, res) {
  try {
    const certificateId = String(req.params.certificateId || '').trim();
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'Revoked by issuer';
    const suppliedTransactionId = typeof req.body?.blockchainTransactionId === 'string'
      ? req.body.blockchainTransactionId.trim()
      : '';
    let certificate = null;
    let dbAvailable = true;
    let ownershipMismatch = false;

    try {
      const result = await safeQuery(
        `SELECT c.certificate_id, c.issuer_user_id, c.issuer_wallet,
                ip.wallet_address AS authorized_issuer_wallet
         FROM certificates c
         LEFT JOIN issuer_profiles ip ON ip.user_id = $2 AND ip.status = 'approved'
         WHERE c.certificate_id = $1 LIMIT 1`,
        [certificateId, req.user.id]
      );
      if (result.rows[0]) {
        const certificateWallet = String(result.rows[0].issuer_wallet || '').trim();
        const authorizedWallet = String(result.rows[0].authorized_issuer_wallet || '').trim();
        const isIssuingUser = Number(result.rows[0].issuer_user_id) === Number(req.user.id);
        const isMatchingAuthority = Boolean(certificateWallet && authorizedWallet && certificateWallet === authorizedWallet);
        ownershipMismatch = !isIssuingUser && !isMatchingAuthority;
        if (!ownershipMismatch) certificate = result.rows[0];
      }
      if (!certificate && process.env.DEMO_MODE === 'true') {
        const local = getCertificateStore().lookup(certificateId);
        if (local) {
          ownershipMismatch = Number(local.created_by) !== Number(req.user.id);
          if (!ownershipMismatch) certificate = local;
        }
      }
    } catch (dbErr) {
      dbAvailable = false;
      if (process.env.DEMO_MODE !== 'true') {
        console.error('Issuer certificate ownership check failed:', dbErr.message);
        return res.status(503).json({ error: 'Unable to verify certificate ownership right now' });
      }
      const local = getCertificateStore().lookup(certificateId);
      if (local) {
        ownershipMismatch = Number(local.created_by) !== Number(req.user.id);
        if (!ownershipMismatch) certificate = local;
      }
    }

    if (!certificate) {
      if (ownershipMismatch) return res.status(403).json({ error: 'Not allowed to revoke this certificate' });
      return res.status(404).json({ error: 'Certificate not found' });
    }

    let blockchainTransactionId = suppliedTransactionId || null;
    if (process.env.SOLANA_ENABLE === 'true') {
      const issuerWallet = certificate.issuer_wallet || req.user.issuer_wallet;
      if (!issuerWallet || !suppliedTransactionId) {
        return res.status(400).json({ error: 'Connect the issuing wallet and submit its on-chain revocation transaction first.' });
      }
      try {
        const [chainCertificate, transactionStatus] = await Promise.all([
          lookupCertificateOnChain(certificateId, issuerWallet),
          getTransactionStatus(suppliedTransactionId)
        ]);
        if (
          !chainCertificate ||
          chainCertificate.verification_status !== 'revoked' ||
          chainCertificate.revoke_reason !== reason ||
          !transactionStatus ||
          transactionStatus.err
        ) {
          return res.status(409).json({ error: 'The supplied revocation transaction is not reflected on-chain.' });
        }
        await verifyProgramTransaction({
          signature: suppliedTransactionId,
          instructionName: 'revokeCertificate',
          expectedArgs: [['reason', reason]],
          issuerWallet
        });
      } catch (chainErr) {
        console.error('On-chain issuer revoke validation failed; database status remains unchanged:', chainErr.message);
        return res.status(502).json({
          error: 'On-chain revocation could not be verified. The database status remains unchanged.'
        });
      }
    }

    let updated = null;
    if (dbAvailable) {
      try {
        const result = await safeQuery(
          `UPDATE certificates
           SET status = 'revoked', revoked_at = NOW(), revocation_reason = $1,
               blockchain_transaction_id = COALESCE($2, blockchain_transaction_id), updated_at = NOW()
           WHERE certificate_id = $3
             AND (
               issuer_user_id = $4
               OR (
                 NULLIF(BTRIM(issuer_wallet), '') IS NOT NULL
                 AND BTRIM(issuer_wallet) = (
                 SELECT wallet_address FROM issuer_profiles
                 WHERE user_id = $4 AND status = 'approved'
                   AND NULLIF(BTRIM(wallet_address), '') IS NOT NULL
                 LIMIT 1
                 )
               )
             )
           RETURNING certificate_id, certificate_type, status, ipfs_cid, ipfs_uri, ipfs_source,
                     attachment_cid, attachment_filename, attachment_uri, attachment_source,
                     blockchain_transaction_id, holder_name, holder_email, issuer_name,
                     issuer_wallet, metadata, issued_at, created_at, revoked_at`,
          [reason, blockchainTransactionId, certificateId, req.user.id]
        );
        updated = result.rows[0] || null;
      } catch (dbErr) {
        if (process.env.DEMO_MODE !== 'true') {
          console.error('Issuer certificate revoke update failed:', dbErr.message);
          return res.status(503).json({ error: 'Certificate revocation could not be saved. Please try again.' });
        }
      }
    }

    if (process.env.DEMO_MODE === 'true') {
      try {
        const local = getCertificateStore().lookup(certificateId);
        if (local && Number(local.created_by) === Number(req.user.id)) {
          const revoked = getCertificateStore().revoke(certificateId, reason, req.user.id);
          updated ||= {
            certificate_id: revoked.certificate_id,
            certificate_type: revoked.certificate_type,
            status: revoked.verification_status,
            verification_status: revoked.verification_status,
            ipfs_cid: revoked.ipfs_cid || revoked.blockchain_hash,
            ipfs_uri: revoked.ipfs_uri,
            ipfs_source: revoked.ipfs_source || 'fallback',
            attachment_cid: revoked.attachment_cid || null,
            attachment_filename: revoked.attachment_filename || null,
            attachment_uri: revoked.attachment_uri || null,
            attachment_source: revoked.attachment_source || null,
            blockchain_transaction_id: revoked.blockchain_transaction_id,
            holder_name: revoked.holder_name,
            holder_email: revoked.holder_email,
            issuer_name: revoked.issuer_name,
            issuer_wallet: revoked.issuer_wallet,
            metadata: revoked.metadata || {},
            issued_at: revoked.issued_at,
            created_at: revoked.issued_at,
            revoked_at: revoked.revoked_at
          };
        }
      } catch (storeErr) {
        console.error('Issuer certificate local revoke failed:', storeErr.message);
        if (!updated) return res.status(500).json({ error: 'Certificate revocation could not be saved' });
      }
    }

    if (!updated) return res.status(503).json({ error: 'Certificate revocation could not be saved. Please try again.' });
    updated.verification_status = updated.status;

    try {
      await safeQuery(
        `UPDATE verify_history
         SET verification_status = 'revoked', verification_message = $1, revoked_at = NOW(),
             revoked_by = $2, blockchain_transaction_id = COALESCE($3, blockchain_transaction_id)
         WHERE certificate_id = $4`,
        [reason, req.user.id, blockchainTransactionId, certificateId]
      );
    } catch (historyErr) {
      console.warn('Issuer certificate verification history update failed:', historyErr.message);
    }

    await logAudit(req.user.id, 'CERTIFICATE_REVOKE', 'certificate', certificateId, 'success', null, {
      certificateId,
      reason,
      blockchainTransactionId
    });
    return res.json({ success: true, certificate: updated });
  } catch (err) {
    console.error('Issuer certificate revoke error:', err);
    return res.status(500).json({ error: 'Failed to revoke certificate' });
  }
}

router.put('/my-issued/:certificateId/revoke', verifyToken, verifyIssuer, revokeIssuerCertificate);
router.put('/revoke/:certificateId', verifyToken, verifyIssuer, revokeIssuerCertificate);

router.get('/lookup/:certificateId', async (req, res) => {
  try {
    const { certificateId } = req.params;
    let storedCertificate = null;
    let databaseError = null;
    try {
      const result = await safeQuery(
        `SELECT certificate_id, certificate_type, status, ipfs_cid, ipfs_uri, ipfs_source,
                attachment_cid, attachment_filename, attachment_uri, attachment_source,
                blockchain_transaction_id, holder_name, holder_email, issuer_name,
                issuer_wallet, metadata, issued_at, created_at, revoked_at
         FROM certificates WHERE certificate_id = $1 LIMIT 1`,
        [certificateId]
      );
      storedCertificate = result.rows[0] || null;
    } catch (dbErr) {
      databaseError = dbErr;
      console.warn('Certificate lookup in certificates table failed:', dbErr.message);
    }

    const requireOnChain = Boolean(storedCertificate?.blockchain_transaction_id) ||
      (process.env.SOLANA_ENABLE === 'true' && !storedCertificate);
    if (requireOnChain) {
      const onChainCertificate = await lookupCertificateOnChain(certificateId);
      if (!onChainCertificate) {
        return res.status(404).json({
          success: false,
          status: 'not_found',
          error: 'Certificate is not present in the deployed Solana program.'
        });
      }

      const status = onChainCertificate.verification_status;
      const certificate = {
        ...(storedCertificate || {}),
        ...onChainCertificate,
        certificate_type: onChainCertificate.cert_type,
        status,
        verification_status: status,
        ipfs_cid: onChainCertificate.metadata_uri?.startsWith('ipfs://')
          ? onChainCertificate.metadata_uri.slice('ipfs://'.length)
          : storedCertificate?.ipfs_cid || null,
        metadata: getPublicCertificateMetadata(storedCertificate?.metadata)
      };
      return res.json({
        success: true,
        certificate,
        status,
        onChain: true,
        blockchainTransactionStatus: await safeTransactionStatus(storedCertificate?.blockchain_transaction_id),
        verifiedAt: new Date(onChainCertificate.issued_at * 1000).toISOString()
      });
    }

    if (storedCertificate) {
      return res.json({
        success: true,
        certificate: {
          ...storedCertificate,
          metadata: getPublicCertificateMetadata(storedCertificate.metadata),
          verification_status: storedCertificate.status
        },
        status: storedCertificate.status,
        onChain: false,
        verificationMode: 'off-chain',
        blockchainTransactionStatus: null,
        verifiedAt: storedCertificate.issued_at
      });
    }

    if (databaseError && process.env.DEMO_MODE !== 'true') {
      try {
        const onChainCertificate = await lookupCertificateOnChain(certificateId);
        if (onChainCertificate) {
          return res.json({
            success: true,
            certificate: onChainCertificate,
            status: onChainCertificate.verification_status,
            onChain: true,
            blockchainTransactionStatus: null,
            verifiedAt: new Date(onChainCertificate.issued_at * 1000).toISOString()
          });
        }
      } catch (chainErr) {
        console.error('On-chain lookup failed while the database is unavailable:', chainErr.message);
        return res.status(503).json({ success: false, error: 'Certificate verification is temporarily unavailable' });
      }
    }

    const demoCertificate = getDemoCertificate(certificateId);

    if (demoCertificate) {
      return res.json({
        success: true,
        certificate: demoCertificate,
        status: demoCertificate.verification_status,
        onChain: Boolean(demoCertificate.blockchain_transaction_id),
        blockchainTransactionStatus: null,
        verifiedAt: demoCertificate.checked_at
      });
    }

    const localCertificate = getCertificateStore().lookup(certificateId);
    if (localCertificate) {
      const transactionStatus = await safeTransactionStatus(localCertificate.blockchain_transaction_id);

      return res.json({
        success: true,
        certificate: {
          ...localCertificate,
          metadata: getPublicCertificateMetadata(localCertificate.metadata)
        },
        status: localCertificate.verification_status,
        onChain: Boolean(localCertificate.blockchain_transaction_id),
        blockchainTransactionStatus: transactionStatus,
        verifiedAt: localCertificate.checked_at
      });
    }

    let result;
    try {
      result = await safeQuery(
        `SELECT id, certificate_id, certificate_type, verification_status, verification_message, blockchain_hash, blockchain_transaction_id, checked_at, revoked_at, revoked_by
         FROM verify_history WHERE certificate_id = $1 LIMIT 1`,
        [certificateId]
      );
    } catch (historyErr) {
      if (process.env.DEMO_MODE !== 'true') throw historyErr;
      console.warn('Certificate lookup history unavailable in demo mode:', historyErr.message);
      return res.status(404).json({ success: false, status: 'not_found', error: 'Certificate not found' });
    }

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, status: 'not_found', error: 'Certificate not found' });
    }

    const transactionStatus = await safeTransactionStatus(result.rows[0].blockchain_transaction_id);

    res.json({
      success: true,
      certificate: result.rows[0],
      status: result.rows[0].verification_status,
      onChain: Boolean(result.rows[0].blockchain_transaction_id),
      blockchainTransactionStatus: transactionStatus,
      verifiedAt: result.rows[0].checked_at
    });
  } catch (err) {
    console.error('Lookup certificate error:', err);
    res.status(503).json({ success: false, error: 'Certificate verification is temporarily unavailable' });
  }
});

// Lookup certificates for a holder (chain-first, DB/local fallback)
router.get('/lookup-by-holder', async (req, res) => {
  try {
    const { email, wallet } = req.query;
    if (!email && !wallet) return res.status(400).json({ error: 'Provide email or wallet query param' });

    // First try chain-based search if wallet provided
    if (wallet) {
      try {
        // solanaService.lookupCertificateOnChain supports searching by issuer+certId only,
        // so we fall back to local store when looking up by holder wallet
      } catch (e) {
        // ignore
      }
    }

    // Search local certificate store
    const store = getCertificateStore();
    const all = store.read();
    const normalizedEmail = (email || '').toLowerCase();
    const matches = all.filter(c => {
      const holderEmail = String(c.holder_email || c.holderEmail || '').toLowerCase();
      const holderWallet = String(c.holder_wallet || c.holderWallet || '');
      return (normalizedEmail && holderEmail === normalizedEmail) || (wallet && holderWallet === wallet);
    });

    // If none found, try DB verify_history as fallback (demo-mode friendly)
    if (!matches.length) {
      try {
        const result = await safeQuery(
          `SELECT id, certificate_id, certificate_type, verification_status, verification_message, blockchain_hash, blockchain_transaction_id, checked_at
           FROM verify_history WHERE LOWER(holder_email) = LOWER($1) LIMIT 50`,
          [email]
        );
        if (result.rows && result.rows.length) {
          return res.json({ success: true, certificates: result.rows });
        }
      } catch (err) {
        // ignore DB errors in demo mode
      }
    }

    return res.json({ success: true, certificates: matches });
  } catch (err) {
    console.error('Lookup by holder error:', err);
    return res.status(500).json({ error: 'Failed to lookup by holder' });
  }
});

module.exports = router;

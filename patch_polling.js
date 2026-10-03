const fs = require('fs');
const scriptFile = '/workspaces/certicheck/script.js';
let content = fs.readFileSync(scriptFile, 'utf8');

const pollingLogic = `
// Background polling for real-time updates
setInterval(() => {
  if (document.hidden) return;
  const token = getAuthToken();
  if (!token) return;

  if (currentPage === 'issuer' && document.getElementById('issuerFormWrap')?.style.display !== 'none') {
    // Poll issuer certificates silently
    fetch(\`\${API_BASE_URL}/certificates/my-issued\`, {
      headers: { Authorization: \`Bearer \${token}\` }
    }).then(res => res.json()).then(data => {
      if (data.success && Array.isArray(data.certificates)) {
        const arr = data.certificates.map(entry => ({
          certificateId: entry.certificate_id,
          holderName: entry.holder_name || '',
          holderEmail: entry.holder_email || '',
          certificateType: entry.certificate_type,
          ipfsCid: entry.ipfs_cid || entry.blockchain_hash || '',
          ipfsUri: entry.ipfs_uri || '',
          ipfsSource: entry.ipfs_source || 'fallback',
          blockchainTransactionId: entry.blockchain_transaction_id || '',
          verificationStatus: entry.status || entry.verification_status || 'valid',
          issuedAt: entry.issued_at || entry.created_at
        }));
        
        // Only re-render if count changes or status changes (simple check)
        const currentArr = getIssuerIssuedCertificates();
        if (arr.length !== currentArr.length || JSON.stringify(arr) !== JSON.stringify(currentArr)) {
          setIssuerIssuedCertificates(arr, currentUser || getStoredUser());
          // Render it directly
          if (typeof renderIssuerCertificatesList === 'function') {
             renderIssuerCertificatesList();
          }
        }
      }
    }).catch(() => {});
  } else if (currentPage === 'home') {
    // Poll user profile to see if their application status changed
    fetch(\`\${API_BASE_URL}/auth/profile\`, {
      headers: { Authorization: \`Bearer \${token}\` }
    }).then(res => res.json()).then(data => {
       if (data.success && data.user) {
          const stored = getStoredUser();
          if (stored && (stored.issuer_status !== data.user.issuer_status)) {
             setStoredUser(data.user);
             currentUser = data.user;
             renderRoleLandingHome();
          }
       }
    }).catch(() => {});
  }
}, 5000);
`;

if (!content.includes('Background polling for real-time updates')) {
  content += pollingLogic;
  fs.writeFileSync(scriptFile, content);
}
console.log('Patched script.js with polling');

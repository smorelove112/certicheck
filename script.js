"use strict";

// Global error reporting overlay to prevent blank pages on runtime errors
function showAppError(message) {
  try {
    let el = document.getElementById('appErrorBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'appErrorBanner';
      el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#ef4444;color:white;padding:12px 20px;border-radius:8px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-family:sans-serif;font-size:14px;';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.display = 'block';
    setTimeout(() => { if (el) el.style.display = 'none'; }, 5000);
  } catch (e) {
    console.error('App error:', message, e);
  }
}

const FAQ_DATA = [
  {
    category: "About the System",
    items: [
      { q: "What is the Solana Certificate Verification System?",
        a: "Our platform issues tamper-proof digital certificates anchored on the Solana blockchain. Each certificate is a verifiable on-chain record that any third party can independently confirm — no middlemen, no central authority." },
      { q: "Who can issue certificates?",
        a: "Accredited institutions, training providers, universities, and businesses with a verified issuer account can mint certificates directly on-chain." },
      { q: "What types of certificates can be issued?",
        a: "Academic degrees, professional certifications, course completions, skill badges, event attendance, and any credential requiring verifiable authenticity." },
      { q: "Is this system open-source?",
        a: "Yes. Our smart contracts and verification SDK are fully open-source. You can review the code on GitHub at any time." },
    ],
  },
  {
    category: "Verification",
    items: [
      { q: "How do I verify a certificate?",
        a: "Enter the certificate ID or scan the QR code. Our verifier queries Solana directly and returns the authenticity result in seconds." },
      { q: "Can a certificate be faked or tampered with?",
        a: "No. Each certificate is cryptographically signed by the issuer's on-chain keypair and stored as an immutable transaction. Any alteration invalidates the signature." },
      { q: "What information is publicly visible on-chain?",
        a: "The certificate hash, issuer address, issuance timestamp, and revocation status. Personal details are stored off-chain and revealed only with the holder's consent." },
      { q: "How long does verification take?",
        a: "Typically under 2 seconds, thanks to Solana's high throughput and sub-second finality." },
      { q: "Can I verify without creating an account?",
        a: "Yes. Certificate verification is fully public and requires no login or wallet." },
    ],
  },
  {
    category: "For Certificate Holders",
    items: [
      { q: "How do I receive my certificate?",
        a: "After the issuer mints your certificate, you will receive an email with your unique certificate ID and a link to your digital certificate page." },
      { q: "Do I need a Solana wallet?",
        a: "No wallet is required to receive or share a certificate. A wallet is optional for holders who wish to take full self-custody." },
      { q: "Can I share my certificate on LinkedIn?",
        a: "Yes. Each certificate has a shareable link and an embeddable badge. LinkedIn, Twitter/X, and direct URL sharing are all supported." },
      { q: "What happens if I lose my certificate link?",
        a: "Log in to your holder dashboard and retrieve all certificates issued to your email at any time." },
      { q: "Can a certificate be revoked?",
        a: "Issuers can revoke certificates (e.g. in cases of fraud). A revoked certificate shows a clear revoked status during verification, but the on-chain record is never deleted." },
    ],
  },
  {
    category: "For Issuers",
    items: [
      { q: "How do I become a verified issuer?",
        a: "Apply through the issuer onboarding form. Our team reviews your credentials and activates your issuer account within 1–3 business days." },
      { q: "What does it cost to issue a certificate?",
        a: "Issuers pay a small Solana network fee per certificate (typically less than $0.01 USD) plus any applicable platform subscription fee." },
      { q: "Can I issue certificates in bulk?",
        a: "Yes. Our API and CSV upload tool support batch issuance — thousands of certificates in a single operation." },
      { q: "Can I customise the certificate design?",
        a: "Yes. Upload your logo, choose your colour scheme, and define custom fields in the issuer dashboard." },
    ],
  },
  {
    category: "Technical & Security",
    items: [
      { q: "Which Solana network is used?",
        a: "Production certificates are issued on Solana mainnet-beta. Devnet is available for testing before going live." },
      { q: "Has the smart contract been audited?",
        a: "Yes. Our on-chain program has been independently audited. The full report is publicly available in our documentation." },
      { q: "Is there an API I can integrate?",
        a: "Yes. A fully documented REST API and TypeScript SDK are available. See the Resources page for details." },
    ],
  },
];

const localApiOrigin = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  && ["3000", "5000"].includes(window.location.port)
  ? window.location.origin
  : null;
const API_BASE_URL = window.CERTICHECK_API_BASE_URL ||
  (localApiOrigin ? `${localApiOrigin}/api` : "https://certicheck-backend-8hu3.onrender.com/api");
const CERTIFICATE_PROGRAM_ID = '4aCWiNjpLPtMa1gQd3Tu5jfSpKEFDR3PbANP5br8Fmob';
let anchorLoading;
let passwordResetEmail = '';

async function withButtonLoading(button, asyncFn, loadingText = 'Please wait...') {
  if (!button || button.dataset.loading === '1') return;

  const originalText = button.textContent;
  const wasDisabled = button.disabled;
  const originalOpacity = button.style.opacity;
  button.dataset.loading = '1';
  button.disabled = true;
  button.textContent = loadingText;
  button.style.opacity = '0.7';

  try {
    await new Promise(resolve => {
      let fallback;
      const ready = () => {
        clearTimeout(fallback);
        resolve();
      };
      fallback = setTimeout(ready, 100);
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(ready);
      else ready();
    });
    return await asyncFn();
  } finally {
    button.dataset.loading = '0';
    button.disabled = wasDisabled;
    button.textContent = originalText;
    button.style.opacity = originalOpacity;
  }
}

function loadAnchor() {
  if (window.anchor) return Promise.resolve(window.anchor);
  if (!anchorLoading) {
    anchorLoading = import('https://esm.sh/@coral-xyz/anchor@0.29.0?bundle')
      .then((anchor) => {
        window.anchor = anchor;
        return anchor;
      })
      .catch((error) => {
        anchorLoading = null;
        throw new Error(`Unable to load the Anchor browser client: ${error.message}`);
      });
  }
  return anchorLoading;
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (url, options = {}) => {
  const requestUrl = new URL(url, window.location.href);
  const apiOrigin = new URL(API_BASE_URL, window.location.href).origin;
  return nativeFetch(url, {
    ...options,
    credentials: requestUrl.origin === apiOrigin ? "include" : options.credentials || "same-origin"
  });
};

function getPreviewBaseUrl() {
  try {
    const origin = window.location.origin;
    return origin || 'http://127.0.0.1:5500';
  } catch (e) {
    return 'http://127.0.0.1:5500';
  }
}

function bindPreviewLinks() {
  const base = getPreviewBaseUrl();
  const mainLink = document.getElementById('mainPreviewLink');
  const adminLink = document.getElementById('adminPreviewLink');
  if (mainLink) mainLink.href = base;
  if (adminLink) adminLink.href = `${base}/admin.html`;
}

  const iconPaths = {
    fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    zap: '<path d="m13 2-3 8h7l-6 12 1-9H5l8-11Z"/>',
    shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    package: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 8 9 5 9-5M3 8v9l9 5 9-5V8M12 13v9"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    cap: '<path d="m2 10 10-5 10 5-10 5-10-5Z"/><path d="M6 12v5c3.5 3 8.5 3 12 0v-5M22 10v6"/>',
    vote: '<path d="M9 12 11 14 15 10M5 7h1M5 12h1M5 17h1M9 7h10M9 17h10"/><path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/>',
    message: '<path d="M21 11.5a8.5 8.5 0 0 1-12.9 7.3L3 20l1.2-4.4A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    paperclip: '<path d="m21.4 11.1-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>'
  };

  function iconSvg(name) {
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.fileText}</svg>`;
  }

  const RESOURCES_DATA = [
  { icon: "fileText", title: "Documentation",         desc: "Full API reference, SDK docs, and integration guides.",             tag: "Docs", href: "quickstart.html#documentation" },
  { icon: "zap", title: "Quick Start Guide",      desc: "Issue your first certificate on Solana devnet in under 5 minutes.", tag: "Guide", href: "quickstart.html" },
  { icon: "shield", title: "Security Audit",         desc: "Read the independent smart-contract audit report.",                 tag: "Security" },
  { icon: "package", title: "TypeScript SDK",          desc: "npm install @nebulacert/sdk — type-safe certificate API.",          tag: "SDK" },
  { icon: "link", title: "REST API Reference",     desc: "OpenAPI spec, endpoints, auth, and rate limits.",                   tag: "API" },
  { icon: "cap", title: "Example Integrations",   desc: "Next.js, Express, and Django starter templates.",                   tag: "Examples" },
  { icon: "vote", title: "Governance",             desc: "How protocol upgrades are proposed and voted on-chain.",            tag: "DAO" },
  { icon: "message", title: "Community Discord",       desc: "Get help, share feedback, and connect with other builders.",       tag: "Community" },
];

/* ═══════════════════════════════════════════════
   ROUTER — state-based page switching
═══════════════════════════════════════════════ */
let currentPage = "home";
let currentUser = null;
let verifiedIssuerUserId = null;
let desiredSignupType = null; // 'holder' or 'issuer' set by home CTAs

function getAuthToken() {
  return localStorage.getItem("certicheck_auth_token");
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("certicheck_user") || "null");
  } catch {
    return null;
  }
}

function getRememberedLoginEmail() {
  return localStorage.getItem("certicheck_last_login_email") || "";
}

function setRememberedLoginEmail(email) {
  if (email) {
    localStorage.setItem("certicheck_last_login_email", email);
  } else {
    localStorage.removeItem("certicheck_last_login_email");
  }
}

function getSessionHistory() {
  try {
    const raw = localStorage.getItem('certicheck_session_history');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSessionProfile(user) {
  const activeUser = user || getStoredUser() || currentUser || {};
  const lastApp = (() => {
    try {
      const raw = localStorage.getItem('certicheck_latest_application');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();
  const draft = loadPendingApplicationDraft();
  const firstName = activeUser.first_name || activeUser.firstName || '';
  const lastName = activeUser.last_name || activeUser.lastName || '';
  const email = activeUser.email || '';
  const userType = activeUser.user_type || activeUser.userType || 'issuer';
  const institution = activeUser.organization_name || activeUser.institution || draft?.orgName || lastApp?.organization_name || lastApp?.orgName || [firstName, lastName].filter(Boolean).join(' ') || 'Issuer Institution';
  const profile = {
    id: activeUser.id || null,
    email,
    first_name: firstName,
    last_name: lastName,
    user_type: userType,
    display_name: activeUser.display_name || activeUser.name || [firstName, lastName].filter(Boolean).join(' ') || 'Issuer User',
    institution,
    wallet: getConnectedWalletAddress() || activeUser.wallet || '',
    signed_in_at: new Date().toISOString()
  };

  localStorage.setItem('certicheck_active_profile', JSON.stringify(profile));

  const history = getSessionHistory();
  const nextHistory = [
    { ...profile, entryType: 'login' },
    ...history.filter(item => String(item.email || '').toLowerCase() !== String(profile.email || '').toLowerCase())
  ].slice(0, 12);
  localStorage.setItem('certicheck_session_history', JSON.stringify(nextHistory));
  return profile;
}

function getActiveSessionProfile() {
  const user = currentUser || getStoredUser() || {};
  const saved = (() => {
    try {
      const raw = localStorage.getItem('certicheck_active_profile');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();
  const lastApp = (() => {
    try {
      const raw = localStorage.getItem('certicheck_latest_application');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();
  const draft = loadPendingApplicationDraft();
  const firstName = user.first_name || user.firstName || saved?.first_name || '';
  const lastName = user.last_name || user.lastName || saved?.last_name || '';
  const email = user.email || saved?.email || '';
  const userType = user.user_type || user.userType || saved?.user_type || 'issuer';
  const institution = user.organization_name || user.institution || saved?.institution || draft?.orgName || lastApp?.organization_name || lastApp?.orgName || [firstName, lastName].filter(Boolean).join(' ') || 'Issuer Institution';

  return {
    id: user.id || saved?.id || null,
    email,
    first_name: firstName,
    last_name: lastName,
    user_type: userType,
    display_name: user.display_name || user.name || saved?.display_name || [firstName, lastName].filter(Boolean).join(' ') || 'Issuer User',
    institution,
    wallet: getConnectedWalletAddress() || user.wallet || saved?.wallet || '',
    signed_in_at: saved?.signed_in_at || new Date().toISOString()
  };
}

function saveAuthSession(token, user) {
  localStorage.setItem("certicheck_auth_token", token);
  localStorage.setItem("certicheck_user", JSON.stringify(user));
  currentUser = user;
  verifiedIssuerUserId = null;
  persistSessionProfile(user);
  updateAuthUi();
  refreshIssuerAuthorization().catch((error) => {
    console.warn('Unable to verify issuer approval:', error.message || error);
  });
}

function clearAuthSession() {
  localStorage.removeItem("certicheck_auth_token");
  localStorage.removeItem("certicheck_user");
  localStorage.removeItem("certicheck_active_profile");
  verifiedIssuerUserId = null;
  currentUser = null;
  updateAuthUi();
}

function isVerifiedIssuer(user = currentUser || getStoredUser()) {
  return Boolean(
    user &&
    user.user_type === 'issuer' &&
    verifiedIssuerUserId !== null &&
    String(verifiedIssuerUserId) === String(user.id)
  );
}

async function refreshIssuerAuthorization() {
  const token = getAuthToken();
  if (!token) {
    verifiedIssuerUserId = null;
    return { approved: false, error: 'Sign in to access issuer tools.' };
  }
  if ((currentUser || getStoredUser())?.user_type === 'admin') {
    verifiedIssuerUserId = null;
    return { approved: false, error: 'Issuer approval required' };
  }

  const response = await fetch(`${API_BASE_URL}/auth/profile`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.user) {
    verifiedIssuerUserId = null;
    if (response.status === 401) clearAuthSession();
    return { approved: false, error: data.error || 'Issuer approval required' };
  }

  currentUser = data.user;
  localStorage.setItem('certicheck_user', JSON.stringify(data.user));
  const approved = data.user.user_type === 'issuer' &&
    data.user.is_active === true &&
    data.user.issuer_status === 'approved';
  verifiedIssuerUserId = approved ? data.user.id : null;
  updateAuthUi();
  if (currentPage === 'home') {
    renderRoleLandingHome();
    if (approved) {
      refreshIssuerDashboardCertificates(data.user).catch((error) => {
        console.error('Unable to refresh issuer certificates:', error.message || error);
        const notice = document.getElementById('issuerDashboardNotice');
        if (notice) {
          notice.textContent = error.message || 'Unable to load issued certificates.';
          notice.style.display = 'block';
        }
      });
    }
  }
  return {
    approved,
    error: approved ? '' : 'Issuer approval required'
  };
}

function getConnectedWalletAddress() {
  const direct = localStorage.getItem('certicheck_wallet_address');
  if (direct) return direct;
  const storedUser = getStoredUser();
  return storedUser?.wallet || '';
}

function getActivePhantomWalletAddress() {
  const provider = getPhantomProvider();
  return provider?.isConnected && provider.publicKey
    ? provider.publicKey.toString()
    : '';
}

function persistWalletAddress(value) {
  const wallet = value ? String(value).trim() : '';
  if (wallet) localStorage.setItem('certicheck_wallet_address', wallet);
  else localStorage.removeItem('certicheck_wallet_address');
  return wallet;
}

function getPhantomProvider() {
  if (typeof window === 'undefined') return null;
  return window.solana && window.solana.isPhantom ? window.solana : null;
}

function formatWalletShort(value) {
  const wallet = value ? String(value).trim() : '';
  if (!wallet) return 'Connect Wallet';
  if (wallet.length <= 8) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

function setWalletConnectionState(walletAddress) {
  const normalized = walletAddress ? String(walletAddress).trim() : '';
  if (normalized) {
    persistWalletAddress(normalized);
  } else {
    localStorage.removeItem('certicheck_wallet_address');
  }
  updateWalletActionAvailability();
  return normalized;
}

function clearWalletConnectionState() {
  persistWalletAddress('');
  updateWalletActionAvailability();
}

function updateWalletUiState() {
  updateWalletActionAvailability();
}

function ensureWalletMessage(button) {
  const parent = button?.parentElement || button?.closest('div') || document.body;
  if (!parent) return null;
  let messageEl = parent.querySelector('.wallet-inline-message');
  if (!messageEl) {
    messageEl = document.createElement('div');
    messageEl.className = 'wallet-inline-message';
    messageEl.style.cssText = 'margin-top:8px;font-size:12px;display:none;line-height:1.4;';
    parent.appendChild(messageEl);
  }
  return messageEl;
}

function setWalletMessage(button, message, kind = 'error') {
  const messageEl = ensureWalletMessage(button);
  if (!messageEl) return;
  if (!message) {
    messageEl.textContent = '';
    messageEl.style.display = 'none';
    return;
  }
  messageEl.textContent = message;
  messageEl.style.display = 'block';
  messageEl.style.color = kind === 'success' ? '#059669' : '#dc2626';
  messageEl.style.fontWeight = '600';
}

function updateWalletButtonUi(button, walletAddress) {
  if (!button) return;
  const connected = Boolean(walletAddress);
  const label = connected ? formatWalletShort(walletAddress) : 'Connect Wallet';
  button.innerHTML = connected
    ? `<span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;"></span>${label}</span>`
    : 'Connect Wallet';
  button.dataset.connected = connected ? 'true' : 'false';
  button.setAttribute('aria-label', connected ? `Connected wallet ${walletAddress}` : 'Connect Wallet');
  button.title = connected ? `Connected wallet: ${walletAddress}` : 'Connect your Phantom wallet';
  button.classList.toggle('wallet-connected', connected);
  if (!connected) {
    button.style.opacity = '1';
  }
}

function updateWalletActionAvailability() {
  const connectedWallet = getActivePhantomWalletAddress();
  const hasWallet = Boolean(connectedWallet);

  document.querySelectorAll('[data-wallet-connect]').forEach((button) => {
    updateWalletButtonUi(button, connectedWallet);
  });

  const walletBadge = document.getElementById('connectedWalletBadge');
  if (walletBadge) {
    walletBadge.textContent = hasWallet ? formatWalletShort(connectedWallet) : '';
    walletBadge.title = hasWallet ? connectedWallet : 'No wallet connected';
  }
}

async function handleWalletDisconnect(button) {
  const provider = getPhantomProvider();
  try {
    if (provider && typeof provider.disconnect === 'function') {
      await provider.disconnect();
    }
  } catch (error) {
    console.warn('Phantom disconnect failed', error?.message || error);
  }
  persistWalletAddress('');
  if (button) {
    updateWalletButtonUi(button, '');
    setWalletMessage(button, 'Wallet disconnected.', 'success');
    setTimeout(() => setWalletMessage(button, '', 'success'), 1800);
  }
  updateWalletActionAvailability();
}

async function handleWalletConnect(button) {
  const provider = getPhantomProvider();
  if (!provider || !provider.isPhantom) {
    updateWalletButtonUi(button, '');
    setWalletMessage(button, 'Phantom is not installed. Please install it from phantom.app and refresh this page.', 'error');
    return;
  }

  const connected = button?.dataset?.connected === 'true';
  if (connected) {
    await handleWalletDisconnect(button);
    return;
  }

  try {
    const response = await provider.connect();
    const publicKey = response?.publicKey?.toString ? response.publicKey.toString() : provider.publicKey?.toString?.();
    if (!publicKey) {
      setWalletMessage(button, 'Phantom connected but no public key was returned.', 'error');
      return;
    }
    persistWalletAddress(publicKey);
    updateWalletButtonUi(button, publicKey);
    updateWalletActionAvailability();
    setWalletMessage(button, '', 'success');
  } catch (error) {
    const message = error?.message || 'Unable to connect Phantom wallet.';
    setWalletMessage(button, message, 'error');
  }
}

function initializePhantomWallet() {
  const provider = getPhantomProvider();
  const connectButtons = document.querySelectorAll('[data-wallet-connect]');
  connectButtons.forEach((button) => {
    updateWalletButtonUi(button, getConnectedWalletAddress());
    button.onclick = async (event) => {
      event.preventDefault();
      await handleWalletConnect(button);
    };
  });

  if (!provider) {
    updateWalletActionAvailability();
    return;
  }

  const syncConnectedWallet = (publicKey) => {
    const nextAddress = publicKey ? String(publicKey).trim() : '';
    if (nextAddress) {
      persistWalletAddress(nextAddress);
    } else {
      persistWalletAddress('');
    }
    document.querySelectorAll('[data-wallet-connect]').forEach((button) => {
      updateWalletButtonUi(button, nextAddress);
    });
    updateWalletActionAvailability();
  };

  try {
    if (provider.isConnected && provider.publicKey) {
      syncConnectedWallet(provider.publicKey.toString());
    } else {
      provider.connect({ onlyIfTrusted: true }).then((response) => {
        const publicKey = response?.publicKey?.toString ? response.publicKey.toString() : provider.publicKey?.toString?.();
        if (publicKey) syncConnectedWallet(publicKey);
      }).catch(() => {});
    }
  } catch (error) {
    console.warn('Eager Phantom connect failed:', error?.message || error);
  }

  if (typeof provider.on === 'function') {
    provider.on('connect', (publicKey) => syncConnectedWallet(publicKey?.toString ? publicKey.toString() : publicKey));
    provider.on('disconnect', () => {
      persistWalletAddress('');
      document.querySelectorAll('[data-wallet-connect]').forEach((button) => updateWalletButtonUi(button, ''));
      updateWalletActionAvailability();
    });
    provider.on('accountChanged', (publicKey) => {
      syncConnectedWallet(publicKey?.toString ? publicKey.toString() : publicKey);
    });
  }

  updateWalletActionAvailability();
}

async function issueCertificateWithPhantomWallet(payload, token) {
  const provider = getPhantomProvider();
  if (!provider || !provider.isPhantom) {
    throw new Error('Phantom wallet is not installed or connected.');
  }

  const publicKey = provider.publicKey?.toString?.() || '';
  if (!publicKey) {
    throw new Error('Connect your Phantom wallet before issuing certificates on-chain.');
  }
  if (payload.issuerWallet && payload.issuerWallet !== publicKey) {
    throw new Error('The connected Phantom wallet does not match the issuer wallet in this session.');
  }
  if (!token) throw new Error('Sign in again before issuing a certificate.');
  if (!payload.certificateId || new TextEncoder().encode(payload.certificateId).length > 32) {
    throw new Error('Certificate IDs must contain between 1 and 32 UTF-8 bytes.');
  }

  const anchor = await loadAnchor();
  const { Connection, PublicKey, SystemProgram } = anchor.web3;
  if (!Connection || !PublicKey || !SystemProgram) {
    throw new Error('Anchor browser client does not include the Solana web3 APIs.');
  }

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wallet = {
    publicKey: new PublicKey(publicKey),
    signTransaction: async (tx) => provider.signTransaction(tx),
    signAllTransactions: async (txs) => provider.signAllTransactions(txs)
  };
  const issuedAt = new Date().toISOString();
  const metadataDetails = { ...(payload.metadata || {}) };
  const attachment = metadataDetails.attachment || null;
  delete metadataDetails.attachment;
  const metadataToPin = {
    certificateId: payload.certificateId,
    ...metadataDetails,
    holderName: payload.holderName,
    holderEmail: payload.holderEmail,
    certificateType: payload.certificateType,
    issuerName: payload.issuerName,
    issuerWallet: publicKey,
    issuedAt,
    status: 'valid',
    metadata: metadataDetails,
    attachment
  };
  const pinResponse = await fetch(`${API_BASE_URL}/certificates/pin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ metadata: metadataToPin })
  });
  const pinResult = await pinResponse.json().catch(() => ({}));
  if (!pinResponse.ok) throw new Error(pinResult.error || 'Unable to pin certificate metadata to IPFS.');
  if (pinResult.source !== 'pinata' || !pinResult.cid) {
    throw new Error('On-chain issuance requires a real IPFS pin. Configure PINATA_JWT on the backend and try again.');
  }

  const pinnedMetadata = pinResult.metadata || metadataToPin;
  const metadataUri = `ipfs://${pinResult.cid}`;
  const programId = new PublicKey(CERTIFICATE_PROGRAM_ID);
  const providerInstance = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const idl = await fetch('/solana-program/idl/certificate_system.json').then((res) => {
    if (!res.ok) throw new Error('Unable to load the deployed certificate program interface.');
    return res.json();
  });
  const program = new anchor.Program(idl, programId, providerInstance);

  const [issuerPda] = await PublicKey.findProgramAddress([Buffer.from('issuer'), wallet.publicKey.toBuffer()], program.programId);
  const [certificatePda] = await PublicKey.findProgramAddress([Buffer.from('certificate'), issuerPda.toBuffer(), Buffer.from(payload.certificateId)], program.programId);

  let holderPublicKey = wallet.publicKey;
  let holderWallet = null;
  if (payload.holderWallet) {
    try {
      holderPublicKey = new PublicKey(payload.holderWallet);
      holderWallet = holderPublicKey.toBase58();
    } catch {
      holderPublicKey = wallet.publicKey;
    }
  }
  const existingIssuer = await program.account.issuerProfile.fetchNullable(issuerPda);
  if (!existingIssuer) {
    await program.methods
      .initializeIssuer(payload.issuerName || 'Certicheck Issuer', metadataUri)
      .accounts({
        issuer: issuerPda,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId
      })
      .rpc();
  }

  const signature = await program.methods
    .issueCertificate(
      payload.certificateId,
      payload.holderName || '',
      payload.certificateType || '',
      metadataUri,
      pinResult.cid
    )
    .accounts({
      issuer: issuerPda,
      holder: holderPublicKey,
      certificate: certificatePda,
      authority: wallet.publicKey,
      systemProgram: SystemProgram.programId
    })
    .rpc();

  const recordResponse = await fetch(`${API_BASE_URL}/certificates/issue-client-signed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      ...payload,
      holderWallet,
      issuerWallet: publicKey,
      ipfsCid: pinResult.cid,
      ipfsUri: pinResult.uri,
      ipfsSource: pinResult.source,
      blockchainTransactionId: signature,
      metadata: pinnedMetadata
    })
  });
  const recordResult = await recordResponse.json().catch(() => ({}));
  if (!recordResponse.ok) {
    throw new Error(`On-chain certificate issued (${signature}), but backend recording failed: ${recordResult.error || 'please contact support with the transaction signature'}`);
  }
  return recordResult;
}

async function issueCertificateWithoutWallet(payload, token) {
  if (!token) throw new Error('Sign in again before issuing a certificate.');
  const response = await fetch(`${API_BASE_URL}/certificates/issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ ...payload, issuerWallet: '', onChain: false })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Unable to issue the certificate without a wallet.');
  return result;
}

async function revokeCertificateWithPhantomWallet(certificateId, reason, issuerWallet) {
  const provider = getPhantomProvider();
  if (!provider || !provider.isPhantom) {
    throw new Error('Phantom wallet is not installed or connected.');
  }

  const publicKey = provider.publicKey?.toString?.() || '';
  if (!publicKey) {
    throw new Error('Connect your wallet before revoking a certificate.');
  }
  if (issuerWallet && issuerWallet !== publicKey) {
    throw new Error('The connected wallet does not match the certificate issuer.');
  }

  const anchor = await loadAnchor();
  const { Connection, PublicKey } = anchor.web3;
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wallet = {
    publicKey: new PublicKey(publicKey),
    signTransaction: async (tx) => provider.signTransaction(tx),
    signAllTransactions: async (txs) => provider.signAllTransactions(txs)
  };
  const anchorProvider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const idl = await fetch('/solana-program/idl/certificate_system.json').then((res) => res.json());
  const programId = new PublicKey(CERTIFICATE_PROGRAM_ID);
  const program = new anchor.Program(idl, programId, anchorProvider);

  const issuerPubkey = new PublicKey(publicKey);
  const [issuerPda] = await PublicKey.findProgramAddress([Buffer.from('issuer'), issuerPubkey.toBuffer()], program.programId);
  const [certificatePda] = await PublicKey.findProgramAddress([Buffer.from('certificate'), issuerPda.toBuffer(), Buffer.from(certificateId)], program.programId);

  const signature = await program.methods
    .revokeCertificate(reason || 'Revoked by issuer')
    .accounts({
      certificate: certificatePda,
      issuer: issuerPda,
      authority: issuerPubkey
    })
    .rpc();

  return signature;
}

function updateAuthUi() {
  const navActions = document.querySelector('.nav-actions');
  if (!navActions) return;

  navActions.querySelectorAll('.auth-item').forEach(el => el.remove());

  if (currentUser && currentUser.email) {
    const user = currentUser;
    let userBadge = null;
    if (user.user_type !== 'issuer') {
      userBadge = document.createElement('div');
      userBadge.className = 'auth-item';
      userBadge.style.marginRight = '8px';
      userBadge.style.color = 'var(--text-secondary)';
      userBadge.textContent = 'Signed in';
    }

    const signoutBtn = document.createElement('button');
    signoutBtn.className = 'btn-ghost auth-item';
    signoutBtn.textContent = 'Sign Out';
    signoutBtn.addEventListener('click', () => {
      clearAuthSession();
      navigate('home');
    });
    navActions.querySelectorAll('[data-page="signup"],[data-page="login"]').forEach(b => b.style.display = 'none');
    navActions.querySelectorAll('[data-page="signup"],[data-page="login"]').forEach(b => b.style.display = 'none');
    navActions.prepend(signoutBtn);
    navActions.prepend(signoutBtn);
    navActions.prepend(signoutBtn);
  } else {
    navActions.querySelectorAll('[data-page="signup"],[data-page="login"]').forEach(b => b.style.display = 'inline-block');
    navActions.querySelectorAll('.auth-item').forEach(el => el.remove());
  }
}

function getDemoCertificateData(certificateId) {
  const normalized = String(certificateId || "").trim().toUpperCase();
  const demoCertificates = {
    "CERT-SOL-2024-00418": {
      id: 1,
      certificate_id: "CERT-SOL-2024-00418",
      certificate_type: "Degree Certificate",
      verification_status: "valid",
      verification_message: "Demo certificate is active and verifiable.",
      blockchain_hash: "demo-ipfs-cid-valid",
      blockchain_transaction_id: null,
      checked_at: new Date().toISOString(),
      revoked_at: null,
      revoked_by: null
    },
    "REV-001": {
      id: 2,
      certificate_id: "REV-001",
      certificate_type: "Revocation Demo",
      verification_status: "revoked",
      verification_message: "Demo certificate has been revoked by the issuer.",
      blockchain_hash: "demo-ipfs-cid-revoked",
      blockchain_transaction_id: "demo-revoke-rev-001",
      checked_at: new Date().toISOString(),
      revoked_at: new Date().toISOString(),
      revoked_by: 1
    }
  };

  return demoCertificates[normalized] || null;
}

function getDemoTpsData() {
  return {
    currentTps: 1820,
    peakTps: 2470,
    averageTps: 1640,
    samples: [1800, 1820, 1750, 1900, 1840, 1880, 1760, 1830]
  };
}

function createDemoUser(email, firstName = "Demo", lastName = "User") {
  return {
    id: Date.now(),
    email,
    firstName,
    lastName,
    user_type: "issuer"
  };
}

function saveDemoAuthSession(email, firstName = "Demo", lastName = "User") {
  const user = createDemoUser(email, firstName, lastName);
  saveAuthSession("demo-token", user);
  return user;
}

// Enhanced demo session helper accepting a role
function saveDemoAuthSessionWithRole(email, firstName = "Demo", lastName = "User", role = 'issuer') {
  const user = createDemoUser(email, firstName, lastName);
  user.user_type = role || 'issuer';
  saveAuthSession("demo-token", user);
  return user;
}

function getIssuerIssuedCertificates() {
  try {
    const user = currentUser || getStoredUser();
    const key = issuerIssuedKeyFor(user);
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function issuerIssuedKeyFor(user) {
  const u = user || currentUser || getStoredUser() || {};
  const id = (u.email || u.id || 'anonymous').toString();
  return `certicheck_issued_certificates:${id}`;
}

function issuerLastResultKeyFor(user) {
  const u = user || currentUser || getStoredUser() || {};
  const id = (u.email || u.id || 'anonymous').toString();
  return `certicheck_last_issuer_result:${id}`;
}

function setIssuerIssuedCertificates(list, user) {
  try {
    const key = issuerIssuedKeyFor(user);
    localStorage.setItem(key, JSON.stringify(Array.isArray(list) ? list : []));
  } catch (e) {
    console.warn('Failed to persist issuer certificates', e?.message || e);
  }
}

function setLastIssuerResult(obj, user) {
  try {
    const key = issuerLastResultKeyFor(user);
    localStorage.setItem(key, JSON.stringify(obj || null));
  } catch (e) {
    console.warn('Failed to persist last issuer result', e?.message || e);
  }
}

function clearUserIssuerStorage(user) {
  try {
    const u = user || currentUser || getStoredUser();
    if (!u) return;
    localStorage.removeItem(issuerIssuedKeyFor(u));
    localStorage.removeItem(issuerLastResultKeyFor(u));
  } catch (e) {
    console.warn('Failed to clear issuer scoped storage', e?.message || e);
  }
}

function getRoleLandingStats() {
  const issued = getIssuerIssuedCertificates();
  const entries = issued;
  const valid = entries.filter(item => String(item.verificationStatus || item.status || '').toLowerCase() !== 'revoked').length;
  const revoked = entries.filter(item => String(item.verificationStatus || item.status || '').toLowerCase() === 'revoked').length;

  return { total: entries.length, valid, revoked, institution: '', recent: entries.slice(0, 4) };
}

async function refreshIssuerDashboardCertificates(user = currentUser || getStoredUser()) {
  const token = getAuthToken();
  if (!token || !user || !isVerifiedIssuer(user)) {
    throw new Error('Issuer approval required');
  }

  const response = await fetch(`${API_BASE_URL}/certificates/my-issued`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Unable to load issued certificates.');
  }
  if (!Array.isArray(data.certificates)) {
    throw new Error('Invalid certificate list response.');
  }

  const certificates = data.certificates.map((certificate) => ({
    certificateId: certificate.certificate_id,
    holderName: certificate.holder_name || '',
    holderEmail: certificate.holder_email || '',
    certificateType: certificate.certificate_type || '',
    issuerName: certificate.issuer_name || '',
    issuerWallet: certificate.issuer_wallet || '',
    ipfsCid: certificate.ipfs_cid || '',
    ipfsUri: certificate.ipfs_uri || '',
    ipfsSource: certificate.ipfs_source || 'fallback',
    attachmentCid: certificate.attachment_cid || '',
    attachmentUri: certificate.attachment_uri || '',
    attachmentFilename: certificate.attachment_filename || '',
    attachmentSource: certificate.attachment_source || '',
    blockchainTransactionId: certificate.blockchain_transaction_id || '',
    verificationStatus: certificate.status || certificate.verification_status || 'valid',
    status: certificate.status || certificate.verification_status || 'valid',
    issuedAt: certificate.issued_at || certificate.created_at || '',
    revokedAt: certificate.revoked_at || null,
    metadata: certificate.metadata || {}
  }));
  setIssuerIssuedCertificates(certificates, user);
  if (currentPage === 'home' && String((currentUser || {}).id) === String(user.id)) {
    renderRoleLandingHome();
  }
  return certificates;
}

function getCertificateFieldCatalog() {
  return {
    'Degree Certificate': [
      { name: 'recipientFullName', label: 'Recipient full name', type: 'text', placeholder: 'Jane Doe', required: true },
      { name: 'institutionName', label: 'Institution / School name', type: 'text', placeholder: 'Obafemi Awolowo University', required: true },
      { name: 'programName', label: 'Program / Degree title', type: 'text', placeholder: 'B.Sc. Computer Science', required: true },
      { name: 'graduationYear', label: 'Year of graduation', type: 'number', placeholder: '2026', required: true },
      { name: 'dateAwarded', label: 'Awarded date', type: 'date', required: true },
      { name: 'cgpa', label: 'CGPA / final score', type: 'text', placeholder: '4.62 / 5.00', required: false },
      { name: 'classHonours', label: 'Class of honours', type: 'text', placeholder: 'First Class Honours', required: false },
      { name: 'remarks', label: 'Additional remarks', type: 'textarea', placeholder: 'Awarded with distinction and leadership in... ', required: false }
    ],
    'Transcript': [
      { name: 'recipientFullName', label: 'Student full name', type: 'text', placeholder: 'Jane Doe', required: true },
      { name: 'institutionName', label: 'School / institution', type: 'text', placeholder: 'University of Lagos', required: true },
      { name: 'studentId', label: 'Student ID / registration number', type: 'text', placeholder: 'STU-2024-0158', required: true },
      { name: 'department', label: 'Department / faculty', type: 'text', placeholder: 'Accounting', required: true },
      { name: 'yearOfStudy', label: 'Academic year', type: 'text', placeholder: '2024/2025', required: true },
      { name: 'gpa', label: 'GPA / grade summary', type: 'text', placeholder: '3.82', required: false },
      { name: 'courseSummary', label: 'Course summary', type: 'textarea', placeholder: 'Business Law, Financial Reporting, Project Management', required: false },
      { name: 'issueDate', label: 'Issue date', type: 'date', required: true }
    ],
    'Professional Diploma': [
      { name: 'recipientFullName', label: 'Learner full name', type: 'text', placeholder: 'Jane Doe', required: true },
      { name: 'institutionName', label: 'Training body / institution', type: 'text', placeholder: 'Certicheck Academy', required: true },
      { name: 'programName', label: 'Diploma title', type: 'text', placeholder: 'AI Product Management', required: true },
      { name: 'completionDate', label: 'Completion date', type: 'date', required: true },
      { name: 'duration', label: 'Duration / schedule', type: 'text', placeholder: '6 months', required: false },
      { name: 'competency', label: 'Key competency delivered', type: 'textarea', placeholder: 'Roadmapping, stakeholder management, decision analysis', required: false }
    ],
    'Certificate of Completion': [
      { name: 'recipientFullName', label: 'Participant full name', type: 'text', placeholder: 'Jane Doe', required: true },
      { name: 'programName', label: 'Course / program name', type: 'text', placeholder: 'Cybersecurity Fundamentals', required: true },
      { name: 'institutionName', label: 'Provider / organization', type: 'text', placeholder: 'Certicheck Labs', required: true },
      { name: 'completionDate', label: 'Completion date', type: 'date', required: true },
      { name: 'hours', label: 'Training hours / credits', type: 'text', placeholder: '40 hours', required: false },
      { name: 'achievement', label: 'Completion statement', type: 'textarea', placeholder: 'Completed all learning modules and assessment criteria.', required: true }
    ],
    'Will': [
      { name: 'testatorName', label: 'Testator / will owner full name', type: 'text', placeholder: 'Jane Doe', required: true },
      { name: 'executorName', label: 'Executor / personal representative', type: 'text', placeholder: 'John Doe', required: true },
      { name: 'beneficiaries', label: 'Beneficiaries / heirs', type: 'textarea', placeholder: 'Mary Doe, Tunde Doe, etc.', required: true },
      { name: 'assetSummary', label: 'Assets / estate summary', type: 'textarea', placeholder: 'Household property, shares, vehicle, business interest', required: true },
      { name: 'executionDate', label: 'Date executed', type: 'date', required: true },
      { name: 'statement', label: 'Statement by will owner', type: 'textarea', placeholder: 'I declare that this will represents my final wishes...', required: true }
    ],
    'Certificate of Ownership': [
      { name: 'ownerName', label: 'Owner / legal owner full name', type: 'text', placeholder: 'Jane Doe', required: true },
      { name: 'assetDescription', label: 'Asset description', type: 'text', placeholder: 'Toyota Prado 2022', required: true },
      { name: 'assetIdentifier', label: 'Asset ID / registration / VIN / serial', type: 'text', placeholder: 'VIN: JT2BG22K...', required: true },
      { name: 'assetLocation', label: 'Location / jurisdiction', type: 'text', placeholder: 'Lagos State, Nigeria', required: true },
      { name: 'ownershipDate', label: 'Ownership date', type: 'date', required: true },
      { name: 'declaration', label: 'Declaration statement', type: 'textarea', placeholder: 'This certifies that the above named owner lawfully possesses the described asset in accordance with applicable law.', required: true }
    ],
    'Employment Certificate': [
      { name: 'employeeName', label: 'Employee full name', type: 'text', placeholder: 'Jane Doe', required: true },
      { name: 'employerName', label: 'Employer / organization', type: 'text', placeholder: 'Certicheck Limited', required: true },
      { name: 'roleTitle', label: 'Role / designation', type: 'text', placeholder: 'Senior Product Manager', required: true },
      { name: 'employmentStart', label: 'Employment start date', type: 'date', required: true },
      { name: 'employmentEnd', label: 'Employment end date', type: 'date', required: false },
      { name: 'salaryBand', label: 'Salary / compensation band', type: 'text', placeholder: 'NGN 12,000,000 / annum', required: false },
      { name: 'employmentStatement', label: 'Employment statement', type: 'textarea', placeholder: 'This individual served in the role with professionalism and diligence.', required: true }
    ],
    'Medical Certificate': [
      { name: 'patientName', label: 'Patient full name', type: 'text', placeholder: 'Jane Doe', required: true },
      { name: 'diagnosis', label: 'Diagnosis / condition', type: 'text', placeholder: 'Upper respiratory infection', required: true },
      { name: 'consultationDate', label: 'Consultation date', type: 'date', required: true },
      { name: 'doctorName', label: 'Doctor / clinician name', type: 'text', placeholder: 'Dr. Ada Okafor', required: true },
      { name: 'treatment', label: 'Treatment / care summary', type: 'textarea', placeholder: 'Prescribed antibiotics and rest for 5 days.', required: false }
    ],
    'Permit / License': [
      { name: 'permitHolder', label: 'Permit holder / licensee', type: 'text', placeholder: 'Jane Doe', required: true },
      { name: 'permitTitle', label: 'Permit title / licence number', type: 'text', placeholder: 'Business License No. BL-2025-1048', required: true },
      { name: 'issuerAuthority', label: 'Issuing authority', type: 'text', placeholder: 'Ministry of Trade', required: true },
      { name: 'validFrom', label: 'Valid from', type: 'date', required: true },
      { name: 'validUntil', label: 'Valid until', type: 'date', required: true },
      { name: 'permitConditions', label: 'Conditions / scope', type: 'textarea', placeholder: 'Valid for retail operations within the city limits.', required: false }
    ]
  };
}

function getCertificateOptions() {
  return [
    'Degree Certificate',
    'Transcript',
    'Professional Diploma',
    'Certificate of Completion',
    'Will',
    'Certificate of Ownership',
    'Employment Certificate',
    'Medical Certificate',
    'Permit / License'
  ];
}

const MAX_CERTIFICATE_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function renderCertificateDetailFields(certificateType) {
  const container = document.getElementById('issuerDynamicCertificateFields');
  if (!container) return;

  const catalog = getCertificateFieldCatalog();
  const fields = catalog[certificateType] || [
    { name: 'certificateTitle', label: 'Certificate title', type: 'text', placeholder: 'Official certificate', required: true },
    { name: 'recipientName', label: 'Recipient full name', type: 'text', placeholder: 'Jane Doe', required: true },
    { name: 'issuedOn', label: 'Issue date', type: 'date', required: true },
    { name: 'details', label: 'Certificate details', type: 'textarea', placeholder: 'This certificate confirms...', required: true }
  ];

  const html = fields.map((field) => {
    const requiredAttr = field.required ? 'required' : '';
    const placeholder = field.placeholder ? `placeholder="${field.placeholder}"` : '';

    if (field.type === 'textarea') {
      return `
        <div class="field">
          <label class="field-label" for="certField_${field.name}">${field.label}</label>
          <textarea id="certField_${field.name}" class="field-input" ${requiredAttr} ${placeholder} style="min-height:110px;resize:vertical;"></textarea>
        </div>
      `;
    }

    return `
      <div class="field">
        <label class="field-label" for="certField_${field.name}">${field.label}</label>
        <input id="certField_${field.name}" class="field-input" type="${field.type}" ${requiredAttr} ${placeholder} />
      </div>
    `;
  }).join('');

  const attachmentHtml = `
    <div class="field">
      <label class="field-label" for="issuerCertificateAttachmentUpload">Supporting file (optional)</label>
      <input id="issuerCertificateAttachmentUpload" class="field-input" type="file" />
      <small class="small-text">Any file type, including PDF. Maximum 4 MB.</small>
    </div>
    <div id="issuerCertificateAttachmentPreview" style="display:none;border:1px solid var(--border-light);border-radius:12px;padding:12px;background:rgba(76,29,149,0.03);color:var(--text-secondary);font-size:13px;"></div>
  `;

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
      ${html}
    </div>
    <div style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
      ${attachmentHtml}
    </div>
  `;

  const attachmentInput = document.getElementById('issuerCertificateAttachmentUpload');
  const preview = document.getElementById('issuerCertificateAttachmentPreview');
  if (attachmentInput && preview) {
    attachmentInput.addEventListener('change', () => {
      const file = attachmentInput.files && attachmentInput.files[0];
      if (!file) {
        preview.style.display = 'none';
        preview.textContent = '';
        return;
      }
      preview.style.display = 'block';
      preview.textContent = file.size > MAX_CERTIFICATE_ATTACHMENT_BYTES
        ? 'This file exceeds the 4 MB attachment limit.'
        : `Attached file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    });
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read uploaded media'));
    reader.readAsDataURL(file);
  });
}

function escapeCertificateMarkup(value) {
  return String(value ?? '—').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function getCredentialDetailsMarkup(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  const entries = Object.entries(metadata).filter(([key, value]) =>
    key !== 'attachment' && value !== null && value !== undefined
  );
  if (!entries.length) return '';
  return `<dl class="mini-certificate-details">${entries.map(([key, value]) => {
    const displayValue = typeof value === 'string' ? value : JSON.stringify(value);
    return `<div><dt>${escapeCertificateMarkup(key)}</dt><dd>${escapeCertificateMarkup(displayValue)}</dd></div>`;
  }).join('')}</dl>`;
}

function getMiniCertificateCardMarkup(certificate, { statusLabel = 'VALID', verification = false } = {}) {
  const holderName = certificate.holder_name || certificate.holderName || certificate.holder || 'Certificate holder';
  const certificateId = certificate.certificate_id || certificate.certificateId || '';
  const certificateType = certificate.certificate_type || certificate.certificateType || certificate.cert_type || 'Certificate';
  const issuerName = certificate.issuer_name || certificate.issuerName || 'CertiCheck issuer';
  const issuedAt = certificate.issued_at || certificate.issuedAt || certificate.created_at;
  const metadata = certificate.metadata && typeof certificate.metadata === 'object' ? certificate.metadata : {};
  const cid = certificate.ipfs_cid || certificate.ipfsCid || '';
  const ipfsSource = certificate.ipfs_source || certificate.ipfsSource || '';
  const transaction = certificate.blockchain_transaction_id || certificate.blockchainTransactionId || '';
  const cluster = certificate.cluster || 'devnet';
  const qr = certificateId
    ? `<img class="mini-certificate-qr" src="${API_BASE_URL}/certificates/qr/${encodeURIComponent(certificateId)}" alt="QR code to verify certificate ${escapeCertificateMarkup(certificateId)}" loading="lazy"/>`
    : '';
  const cidMarkup = cid
    ? `<div><dt>${ipfsSource === 'pinata' ? 'IPFS CID' : 'Record ID'}</dt><dd>${ipfsSource === 'pinata'
      ? `<a href="https://gateway.pinata.cloud/ipfs/${encodeURIComponent(cid)}" target="_blank" rel="noopener noreferrer">${escapeCertificateMarkup(cid)}</a>`
      : escapeCertificateMarkup(cid)}</dd></div>`
    : '';
  const transactionMarkup = transaction
    ? `<div><dt>Solana transaction</dt><dd><a href="https://explorer.solana.com/tx/${encodeURIComponent(transaction)}?cluster=${encodeURIComponent(cluster)}" target="_blank" rel="noopener noreferrer">${escapeCertificateMarkup(transaction)}</a></dd></div>`
    : `<div><dt>Network</dt><dd>${certificate.on_chain === true || certificate.onChain === true ? 'Solana Devnet' : 'Off-chain record'}</dd></div>`;
  const statusText = String(statusLabel).toUpperCase();
  const credentialDetails = getCredentialDetailsMarkup(metadata);

  return `<article class="mini-certificate-preview${verification ? ' verification-mini-certificate' : ''}${statusText === 'REVOKED' ? ' is-revoked' : ''}" aria-label="Certificate for ${escapeCertificateMarkup(holderName)}">
    ${statusText === 'VALID' && verification ? `<div class="verification-pop-confetti" aria-hidden="true">${Array.from({ length: 24 }, (_, index) => `<span class="piece-${index % 7}" style="--x:${(index % 8 - 3.5) * 28}px;--y:${-80 - Math.floor(index / 8) * 34}px;--angle:${index * 41}deg;--pop-delay:${Math.floor(index / 6) * 20}ms"></span>`).join('')}</div>` : ''}
    <div class="mini-certificate-brand"><span class="mini-certificate-seal" aria-hidden="true">${statusText === 'REVOKED' ? '!' : '✓'}</span><span>Certicheck <small>Digital credential</small></span><span class="mini-certificate-status">${statusText === 'VALID' && verification ? 'VERIFIED' : statusText}</span></div>
    <div class="mini-certificate-heading">CERTIFICATE OF ACHIEVEMENT</div>
    <div class="mini-certificate-type">${escapeCertificateMarkup(certificateType)}</div>
    <div class="mini-certificate-recipient">Presented to <strong>${escapeCertificateMarkup(holderName)}</strong></div>
    <div class="mini-certificate-issuer">Issued by ${escapeCertificateMarkup(issuerName)}${issuedAt ? ` · ${escapeCertificateMarkup(new Date(issuedAt).toLocaleDateString())}` : ''}</div>
    <dl class="mini-certificate-details">
      <div><dt>Certificate ID</dt><dd>${escapeCertificateMarkup(certificateId)}</dd></div>
      <div><dt>Status</dt><dd>${statusText}${certificate.revoked_at || certificate.revokedAt ? ` · revoked ${escapeCertificateMarkup(new Date(certificate.revoked_at || certificate.revokedAt).toLocaleString())}` : ''}</dd></div>
      ${cidMarkup}
      ${transactionMarkup}
    </dl>
    ${credentialDetails}
    ${qr ? `<div class="mini-certificate-qr-wrap">${qr}<span>Scan to verify</span></div>` : ''}
  </article>`;
}

function getMiniCertificateSvg(certificate) {
  const escapeXml = (value) => escapeCertificateMarkup(value);
  const issuedAt = certificate.issuedAt || certificate.issued_at || certificate.created_at;
  const date = issuedAt
    ? new Date(issuedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : 'Date not provided';
  const status = String(certificate.status || certificate.verification_status || 'valid').toLowerCase() === 'revoked'
    ? 'REVOKED'
    : 'VALID';
  const statusColor = status === 'VALID' ? '#059669' : '#dc2626';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520" role="img" aria-labelledby="title description">
  <title id="title">Certicheck mini certificate for ${escapeXml(certificate.holderName || certificate.holder_name)}</title>
  <desc id="description">${escapeXml(certificate.certificateType || certificate.certificate_type || 'Certificate')}, issued by ${escapeXml(certificate.issuerName || certificate.issuer_name)}.</desc>
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" /><stop offset="1" stop-color="#f4f0ff" /></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7c3aed" /><stop offset="1" stop-color="#4338ca" /></linearGradient>
  </defs>
  <rect width="900" height="520" rx="32" fill="#ede9fe" />
  <rect x="18" y="18" width="864" height="484" rx="25" fill="url(#paper)" stroke="#7c3aed" stroke-width="3" />
  <path d="M52 58h796" stroke="#ddd6fe" stroke-width="2" />
  <circle cx="92" cy="100" r="31" fill="url(#accent)" />
  <path d="M78 100 88 110 107 87" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
  <text x="140" y="94" fill="#312e81" font-family="Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="3">CERTICHECK · SOLANA CREDENTIAL</text>
  <text x="450" y="190" text-anchor="middle" fill="#6d28d9" font-family="Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="5">CERTIFICATE OF ACHIEVEMENT</text>
  <text x="450" y="252" text-anchor="middle" fill="#1e1b4b" font-family="Arial,sans-serif" font-size="34" font-weight="700">${escapeXml(certificate.certificateType || certificate.certificate_type || 'Certificate')}</text>
  <text x="450" y="302" text-anchor="middle" fill="#64748b" font-family="Arial,sans-serif" font-size="17">Proudly presented to</text>
  <text x="450" y="352" text-anchor="middle" fill="#312e81" font-family="Arial,sans-serif" font-size="30" font-weight="700">${escapeXml(certificate.holderName || certificate.holder_name || 'Certificate holder')}</text>
  <text x="450" y="397" text-anchor="middle" fill="#64748b" font-family="Arial,sans-serif" font-size="16">Issued by ${escapeXml(certificate.issuerName || certificate.issuer_name || 'Certicheck issuer')} · ${escapeXml(date)}</text>
  <path d="M52 434h796" stroke="#ddd6fe" stroke-width="2" />
  <text x="60" y="470" fill="#475569" font-family="monospace" font-size="15">ID: ${escapeXml(certificate.certificateId || certificate.certificate_id)}</text>
  <text x="840" y="470" text-anchor="end" fill="${statusColor}" font-family="Arial,sans-serif" font-size="15" font-weight="700">● ${status}</text>
</svg>`;
}

function downloadMiniCertificate(certificate) {
  const blob = new Blob([getMiniCertificateSvg(certificate)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `certicheck-mini-certificate-${String(certificate.certificateId || certificate.certificate_id || 'certificate').replace(/[^a-zA-Z0-9_-]/g, '_')}.svg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getCertificateIssuanceSuccessMarkup(certificate, warnings = []) {
  const holderName = escapeCertificateMarkup(certificate.holderName || certificate.holder_name);
  const certificateId = escapeCertificateMarkup(certificate.certificateId || certificate.certificate_id);
  const certificateType = escapeCertificateMarkup(certificate.certificateType || certificate.certificate_type || 'Certificate');
  const issuerName = escapeCertificateMarkup(certificate.issuerName || certificate.issuer_name || 'Certicheck issuer');
  const issuedAt = certificate.issuedAt || certificate.issued_at || certificate.created_at;
  const status = String(certificate.status || certificate.verification_status || 'valid').toLowerCase() === 'revoked' ? 'Revoked' : 'Valid';
  const transaction = certificate.transaction || certificate.blockchainTransactionId || certificate.blockchain_transaction_id;
  const onChain = certificate.onChain === true || certificate.on_chain === true || Boolean(transaction);
  const ipfsCid = certificate.ipfsCid || certificate.ipfs_cid;
  const ipfsSource = certificate.ipfsSource || certificate.ipfs_source;
  const transactionMarkup = transaction
    ? `<span class="celebration-break"><strong>Transaction:</strong> ${escapeCertificateMarkup(transaction)} · <a href="https://explorer.solana.com/tx/${encodeURIComponent(transaction)}?cluster=devnet" target="_blank" rel="noopener noreferrer">View on Solana Explorer</a></span>`
    : '';
  const ipfsMarkup = ipfsCid
    ? `<span class="celebration-break"><strong>${ipfsSource === 'pinata' ? 'IPFS CID:' : 'IPFS record:'}</strong> ${ipfsSource === 'pinata' ? `<a href="https://gateway.pinata.cloud/ipfs/${encodeURIComponent(ipfsCid)}" target="_blank" rel="noopener noreferrer">${escapeCertificateMarkup(ipfsCid)}</a>` : escapeCertificateMarkup(ipfsCid)}</span>`
    : '';
  const confetti = Array.from({ length: 28 }, (_, index) => `<span class="celebration-confetti-piece piece-${index % 7}"></span>`).join('');

  return `<section class="issuance-celebration" aria-labelledby="issuanceCelebrationTitle">
    <div class="celebration-scene" aria-hidden="true">
      <span class="celebration-flare flare-one"></span>
      <span class="celebration-flare flare-two"></span>
      <span class="celebration-glitter"></span>
      <div class="celebration-confetti">${confetti}</div>
    </div>
    <div class="issuance-celebration-content">
      <div class="celebration-kicker"><span aria-hidden="true">✦</span> ${onChain ? 'On-chain issuance complete' : 'Certificate issuance complete · off-chain'}</div>
      <h3 id="issuanceCelebrationTitle">Congratulations, ${holderName}!</h3>
      <p class="celebration-subtitle">Your ${certificateType} certificate is now issued.</p>
      ${getMiniCertificateCardMarkup(certificate, { statusLabel: status.toUpperCase() })}
      <div class="celebration-actions">
        <button class="btn-primary" type="button" data-download-mini-certificate>Download mini-certificate</button>
      </div>
      <div class="celebration-issuance-details">
        <span><strong>Status:</strong> ${escapeCertificateMarkup(status)}</span>
        ${issuedAt ? `<span><strong>Issued:</strong> ${escapeCertificateMarkup(new Date(issuedAt).toLocaleString())}</span>` : ''}
        ${transactionMarkup}
        ${ipfsMarkup}
      </div>
      ${warnings.length ? `<div class="issuance-warnings">${warnings.map((warning) => `<div class="alert alert-info">${escapeCertificateMarkup(warning)}</div>`).join('')}</div>` : ''}
    </div>
  </section>`;
}

function wireMiniCertificateDownload(container, certificate) {
  container?.querySelector('[data-download-mini-certificate]')?.addEventListener('click', () => {
    downloadMiniCertificate(certificate);
  });
}

function showCertificateIssuanceCelebration(resultContainer, certificate, warnings = []) {
  const markup = getCertificateIssuanceSuccessMarkup(certificate, warnings);
  const dialog = document.getElementById('issuanceSuccessDialog');
  const content = document.getElementById('issuanceSuccessContent');
  if (dialog && content && typeof dialog.showModal === 'function') {
    content.innerHTML = markup;
    wireMiniCertificateDownload(content, certificate);
    if (resultContainer) {
      const certificateId = certificate.certificateId || certificate.certificate_id;
      resultContainer.innerHTML = `<div class="alert alert-success" role="status">Certificate ${escapeCertificateMarkup(certificateId)} issued successfully.</div>`;
    }
    if (!dialog.open) dialog.showModal();
    return;
  }

  if (resultContainer) {
    resultContainer.innerHTML = markup;
    wireMiniCertificateDownload(resultContainer, certificate);
  }
}

function collectCertificateFieldValues(certificateType) {
  const catalog = getCertificateFieldCatalog();
  const fields = catalog[certificateType] || [];
  const values = {};

  fields.forEach((field) => {
    const elem = document.getElementById(`certField_${field.name}`);
    if (!elem) return;
    values[field.name] = elem.value.trim();
  });

  return values;
}

function downloadCertificateArtifact(certificatePayload) {
  const certificateHtml = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; background: #f8fafc; padding: 32px; }
          .certificate { max-width: 980px; margin: 0 auto; border: 2px solid #d1d5db; background: #fff; border-radius: 18px; padding: 36px; position: relative; }
          .crest { position: absolute; top: 28px; right: 40px; width: 92px; height: 92px; border: 2px solid #7c3aed; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #7c3aed; }
          .title { font-size: 30px; font-weight: 800; text-align: center; color: #1f2937; margin-bottom: 22px; }
          .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; font-size: 14px; color: #374151; }
          .label { font-weight: 700; color: #111827; }
        </style>
      </head>
      <body>
        <div class="certificate">
          <div class="crest">C</div>
          <div class="title">${certificatePayload.certificateType}</div>
          <div class="meta">
            ${Object.entries(certificatePayload.metadata || {}).map(([key, value]) => `
              <div><span class="label">${key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:</span> ${String(value || '—')}</div>
            `).join('')}
          </div>
        </div>
      </body>
    </html>
  `;

  const blob = new Blob([certificateHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${String(certificatePayload.certificateType).replace(/\s+/g, '-').toLowerCase()}-${certificatePayload.certificateId}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function renderRoleLandingHome() {
  const roleHome = document.getElementById('roleHomePanel');
  const hero = document.querySelector('#page-home .hero');
  const features = document.querySelector('#page-home .features');
  const footer = document.querySelector('.site-footer');
  const user = currentUser || getStoredUser();
  if (!roleHome || !hero) return;

  if (!user || (user.user_type !== 'issuer' && user.user_type !== 'admin')) {
    roleHome.style.display = 'none';
    hero.style.display = 'block';
    if (features) features.style.display = 'block';
    if (footer && currentPage === 'home') footer.style.display = '';
    return;
  }

  // If user is issuer but pending or rejected, show that status immediately
  if (user.user_type === 'issuer' && !isVerifiedIssuer(user)) {
    hero.style.display = 'none';
    roleHome.style.display = 'block';
    if (features) features.style.display = 'none';
    if (footer) footer.style.display = 'none';

    document.getElementById('roleHomeBadge').textContent = 'Issuer Status';
    document.getElementById('roleHomeTitle').textContent = user.issuer_status === 'rejected' ? 'Application Rejected' : 'Application Pending';
    document.getElementById('roleHomeMeta').textContent = user.email || '';
    document.getElementById('roleHomeStats').innerHTML = '';

    document.getElementById('roleHomeSystem').innerHTML = '';
    document.getElementById('roleHomeActions').innerHTML = `<div class="alert alert-info" style="margin-top:20px;">${user.issuer_status === 'rejected' ? 'Your application to become an issuer was rejected. Please contact support.' : 'Your application has been submitted and is currently pending review by an admin. You will be able to issue certificates once approved.'}</div>`;
    return;
  }

  const activeProfile = getActiveSessionProfile();
  const isAdmin = user.user_type === 'admin';
  const isIssuer = user.user_type === 'issuer';
  const stats = getRoleLandingStats();
  roleHome.classList.toggle('issuer-role-dashboard', isIssuer);
  document.getElementById('roleHomeCard')?.classList.toggle('issuer-role-home-card', isIssuer);

  hero.style.display = 'none';
  roleHome.style.display = 'block';
  if (features) features.style.display = 'none';
  if (footer) footer.style.display = 'none';

  if (isAdmin) {
    document.getElementById('roleHomeBadge').textContent = 'Admin Control Center';
    document.getElementById('roleHomeTitle').innerHTML = activeProfile.display_name || 'System overview';
    document.getElementById('roleHomeMeta').textContent = `${activeProfile.email || 'admin@certicheck.com'} • admin console view`;
    document.getElementById('roleHomeStats').innerHTML = [
      { label: 'Total', value: stats.total },
      { label: 'Valid', value: stats.valid },
      { label: 'Revoked', value: stats.revoked },
      { label: 'Issuers', value: 6 }
    ].map(item => `
      <div class="role-stat">
        <div class="role-stat-label">${item.label}</div>
        <div class="role-stat-value">${item.value}</div>
      </div>
    `).join('');

    const walletAddress = getConnectedWalletAddress();
    document.getElementById('roleHomeActions').innerHTML = `
      <a href="admin.html" class="btn-primary" style="display:inline-flex;align-items:center;justify-content:center;">Open full Admin Dashboard</a>
      <button class="btn-ghost" data-page="test">Verify</button>
    `;

    document.getElementById('roleHomeSystem').innerHTML = `
      <div class="alert alert-info">
        <strong>System health</strong>
        <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
          <div><strong>API:</strong> online</div>
          <div><strong>Pinata:</strong> configured only when a server PINATA_JWT is present</div>
          <div><strong>Solana:</strong> demo/local fallback unless devnet is configured</div>
          <div><strong>Wallet:</strong> ${walletAddress ? walletAddress.slice(0, 8) + '…' : 'Not connected'}</div>
          <div><strong>Account:</strong> ${activeProfile.email || 'admin@certicheck.com'}</div>
          <div><strong>Timestamp:</strong> ${new Date().toLocaleString()}</div>
        </div>
      </div>
    `;
  } else {
    const institution = activeProfile.institution || 'Issuer Institution';
    const recent = stats.recent;
    const issuedCount = recent.length;
    const activeCount = recent.filter(item => String(item.verificationStatus || item.status || 'Valid').toLowerCase() !== 'revoked').length;
    const revokedCount = recent.filter(item => String(item.verificationStatus || item.status || '').toLowerCase() === 'revoked').length;
    const today = new Date().toDateString();
    const verificationsToday = recent.filter((item) => {
      const checkedAt = item.checkedAt || item.checked_at;
      return checkedAt && new Date(checkedAt).toDateString() === today;
    }).length;
    const walletAddress = getConnectedWalletAddress();
    const walletStatusMarkup = walletAddress
      ? `<div style="display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border-radius:999px;background:rgba(5,150,105,0.08);border:1px solid rgba(5,150,105,0.14);color:#059669;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;"><span style="width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block;"></span>${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}</div>`
      : `<div style="display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border-radius:999px;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.18);color:var(--text-secondary);font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">Connect Wallet</div>`;
    const avatarText = institution.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'IS';

    document.getElementById('roleHomeBadge').textContent = 'Issuer Dashboard';
    document.getElementById('roleHomeTitle').textContent = institution;
    document.getElementById('roleHomeMeta').textContent = `${institution} • ${activeProfile.email || 'issuer@certicheck.com'}`;

    document.getElementById('roleHomeStats').innerHTML = [
      { label: 'Issued', value: issuedCount },
      { label: 'Active', value: activeCount },
      { label: 'Revoked', value: revokedCount },
      { label: 'Verifications today', value: verificationsToday }
    ].map(item => `
      <div class="role-stat">
        <div class="role-stat-label">${item.label}</div>
        <div class="role-stat-value">${item.value}</div>
      </div>
    `).join('');

    fetch(`${API_BASE_URL}/verify/my-history?limit=100&offset=0`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` }
    }).then((response) => response.ok ? response.json() : null).then((data) => {
      if (!data?.history) return;
      const actualToday = data.history.filter((item) => {
        return item.checked_at && new Date(item.checked_at).toDateString() === today;
      }).length;
      const verificationStat = [...document.querySelectorAll('#roleHomeStats .role-stat')]
        .find((stat) => stat.querySelector('.role-stat-label')?.textContent === 'Verifications today');
      if (verificationStat) {
        const value = verificationStat.querySelector('.role-stat-value');
        if (value) value.textContent = String(actualToday);
      }
    }).catch(() => {});

      const latestIssuerResult = (() => {
        try {
          return JSON.parse(localStorage.getItem(issuerLastResultKeyFor()) || 'null');
        } catch {
          return null;
        }
      })();

    document.getElementById('roleHomeActions').innerHTML = `
      <div class="issuer-dashboard-shell">
        <section class="issuer-profile-panel">
          <div class="issuer-profile-heading">
            <div class="issuer-avatar">${avatarText}</div>
            <div class="issuer-profile-identity">
              <div class="issuer-name">${institution}</div>
              <div class="issuer-role-badge">ISSUER</div>
            </div>
          </div>

          <div class="issuer-meta-list">
            <div class="issuer-meta-row"><span>Email</span><strong>${activeProfile.email || 'issuer@certicheck.com'}</strong></div>
            <div class="issuer-meta-row"><span>Role</span><strong>${activeProfile.user_type || 'issuer'}</strong></div>
            <div class="issuer-meta-row"><span>Wallet</span><strong>${walletAddress ? formatWalletShort(walletAddress) : 'Not connected'}</strong></div>
          </div>

          <div class="issuer-side-actions">
            ${walletStatusMarkup}
            <button id="issuerWalletConnectButton" data-wallet-connect class="btn-primary btn-block" type="button">${walletAddress ? formatWalletShort(walletAddress) : 'Connect Wallet'}</button>
          </div>
        </section>

        <main class="issuer-workspace-panel">
          <div class="issuer-topbar">
            <div>
              <div class="issuer-panel-label">Issuer Dashboard</div>
              <div class="issuer-panel-title">Issue a New Certificate</div>
            </div>
          </div>

          <div style="background:var(--bg-subtle);border:1px solid var(--border-light);border-radius:18px;padding:18px 18px 12px; margin-bottom:18px;">
            <form id="issuerDashboardForm" style="display:grid;gap:14px;">
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">
                <div class="field">
                  <label class="field-label" for="issuerHomeHolderName">Holder full name</label>
                  <input class="field-input" id="issuerHomeHolderName" type="text" placeholder="Jane Doe" required />
                </div>
                <div class="field">
                  <label class="field-label" for="issuerHomeHolderEmail">Holder email</label>
                  <input class="field-input" id="issuerHomeHolderEmail" type="email" placeholder="jane@example.com" autocomplete="email" required />
                </div>
                <div class="field">
                  <label class="field-label" for="issuerHomeHolderWallet">Holder wallet / ID</label>
                  <input class="field-input" id="issuerHomeHolderWallet" type="text" placeholder="7xKX...9mQ2 or student ID" />
                </div>
              </div>

              <div class="field">
                <label class="field-label" for="issuerHomeType">Certificate type</label>
                <select class="field-input" id="issuerHomeType" required>
                  <option value="">Select type</option>
                  ${getCertificateOptions().map(type => `<option value="${type}">${type}</option>`).join('')}
                </select>
              </div>

              <div id="issuerDynamicCertificateFields"></div>

              <div style="padding:12px 14px;border:1px dashed var(--border);border-radius:12px;background:rgba(124,58,237,0.04);color:var(--text-secondary);font-size:13px;">
                Certificate document is generated automatically with the Certicheck crest and the stored metadata fields for the selected document type.
              </div>
              <label class="issuer-chain-choice" for="issuerDashboardOnChain">
                <input id="issuerDashboardOnChain" type="checkbox"/>
                <span>Issue on Solana devnet (requires a connected Phantom wallet). Leave unchecked to issue off-chain without a wallet.</span>
              </label>

              <div class="form-actions" style="margin-top:0; padding-top:0; border-top:none; justify-content:flex-end;">
                <button class="btn-primary" type="submit">Issue Certificate</button>
              </div>
            </form>
            <div id="issuerDashboardNotice" style="display:none;margin-top:10px;font-size:13px;color:var(--text-secondary);"></div>
            <div id="issuerDashboardResult" style="margin-top:14px;">${latestIssuerResult ? getCertificateIssuanceSuccessMarkup(latestIssuerResult) : ''}</div>
          </div>

          <div style="background:var(--bg-subtle);border:1px solid var(--border-light);border-radius:18px;padding:18px;margin-bottom:18px;">
            <div class="issuer-panel-label">Verify certificate</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;align-items:end;margin-top:12px;">
              <div class="field" style="margin:0;">
                <label class="field-label" for="issuerVerifyCertId">Certificate ID</label>
                <input class="field-input" id="issuerVerifyCertId" type="text" placeholder="CERT-OAU-2026-001" />
              </div>
              <button id="issuerVerifyCertBtn" class="btn-ghost" type="button">Verify</button>
            </div>
            <div id="issuerVerifyResult" style="margin-top:12px;"></div>
          </div>

          <div class="issuer-list-header">
            <div>
              <div class="issuer-list-heading">Recent issuances</div>
            </div>
          </div>

          <div class="issuer-table-wrap">
            <table class="issuer-table">
              <thead>
                <tr>
                  <th>Holder</th>
                  <th>Cert ID</th>
                  <th>Issued</th>
                  <th>IPFS CID</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${recent.map(item => `
                  <tr data-certificate-row="${item.certificateId || ''}">
                    <td>${item.holderName || '—'}</td>
                    <td style="font-family:var(--font-mono);">${item.certificateId || '—'}</td>
                    <td>${item.issuedAt ? new Date(item.issuedAt).toLocaleDateString() : '—'}</td>
                    <td>${item.ipfsCid ? (item.ipfsSource === 'pinata' ? `<a href="https://gateway.pinata.cloud/ipfs/${encodeURIComponent(item.ipfsCid)}" target="_blank" rel="noopener noreferrer">${item.ipfsCid}</a>` : `${item.ipfsCid} (fallback)`) : '—'}</td>
                    <td><span class="status-pill ${String(item.verificationStatus || item.status || 'valid').toLowerCase() === 'revoked' ? 'status-revoked' : 'status-valid'}">${String(item.verificationStatus || item.status || 'valid').toLowerCase() === 'revoked' ? 'Revoked' : 'Valid'}</span></td>
                    <td>${String(item.verificationStatus || item.status || 'valid').toLowerCase() === 'revoked' ? '<span style="color:var(--text-muted);">Revoked</span>' : `<button class="table-action revoke-certificate" type="button" data-certificate-id="${item.certificateId}">Revoke</button>`}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    `;

    const walletConnectBtn = document.getElementById('issuerWalletConnectButton');
    if (walletConnectBtn) {
      walletConnectBtn.onclick = async (event) => {
        event.preventDefault();
        await handleWalletConnect(walletConnectBtn);
      };
    }
    const savedIssuerResult = document.getElementById('issuerDashboardResult');
    if (latestIssuerResult) wireMiniCertificateDownload(savedIssuerResult, latestIssuerResult);

    document.querySelectorAll('.revoke-certificate').forEach(button => {
      button.addEventListener('click', async () => {
        const certificateId = button.dataset.certificateId;
        if (!certificateId) return;

        const reason = window.prompt('Enter a reason for revoking this certificate:', 'Certificate withdrawn or invalid');
        if (reason === null) return;

        await withButtonLoading(button, async () => {
        const token = getAuthToken();
        try {
          if (!token || !isVerifiedIssuer()) {
            throw new Error('Issuer approval required');
          }
          const blockchainTransactionId = await revokeCertificateWithPhantomWallet(
            certificateId,
            reason || 'Revoked by issuer',
            getConnectedWalletAddress()
          );
          const response = await fetch(`${API_BASE_URL}/certificates/my-issued/${encodeURIComponent(certificateId)}/revoke`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ reason: reason || 'Revoked by issuer', blockchainTransactionId })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Revoke failed');

          const entries = getIssuerIssuedCertificates();
          setIssuerIssuedCertificates(entries.map(item => item.certificateId === certificateId
            ? { ...item, verificationStatus: 'revoked', status: 'revoked', revokedAt: data.certificate?.revoked_at || new Date().toISOString() }
            : item));
          renderRoleLandingHome();
          try {
            await refreshIssuerDashboardCertificates();
          } catch (refreshError) {
            console.error('Certificate revoked but dashboard refresh failed:', refreshError.message || refreshError);
          }
        } catch (error) {
          alert(error.message || 'Unable to revoke certificate.');
        }
        }, 'Revoking...');
      });
    });

    const issuerDashboardForm = document.getElementById('issuerDashboardForm');
    if (issuerDashboardForm) {
      const typeSelector = document.getElementById('issuerHomeType');
      if (typeSelector) {
        typeSelector.addEventListener('change', (event) => {
          const nextType = event.target.value;
          renderCertificateDetailFields(nextType || '');
        });
      }
      renderCertificateDetailFields(typeSelector?.value || '');

      issuerDashboardForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const notice = document.getElementById('issuerDashboardNotice');
        const result = document.getElementById('issuerDashboardResult');
        const holderName = document.getElementById('issuerHomeHolderName').value.trim();
        const holderEmailInput = document.getElementById('issuerHomeHolderEmail');
        const holderEmail = holderEmailInput.value.trim();
        const holderWallet = document.getElementById('issuerHomeHolderWallet').value.trim();
        const certificateType = document.getElementById('issuerHomeType').value.trim();
        const token = getAuthToken();
        const user = getStoredUser();

        const connectedWallet = getConnectedWalletAddress();
        const wantsOnChain = document.getElementById('issuerDashboardOnChain')?.checked === true;
        if (!holderName || !holderEmail || !certificateType || !token || !user || !isVerifiedIssuer(user)) {
          notice.textContent = 'Issuer approval required. Enter the holder details and certificate type, and sign in as an approved issuer.';
          notice.style.display = 'block';
          return;
        }
        if (wantsOnChain && !connectedWallet) {
          notice.textContent = 'Connect your Phantom wallet or turn off Solana issuance to issue off-chain.';
          notice.style.display = 'block';
          return;
        }
        if (!holderEmailInput.checkValidity()) {
          holderEmailInput.reportValidity();
          return;
        }
        const detailFields = collectCertificateFieldValues(certificateType);
        const missingRequired = Object.entries(detailFields).filter(([key, value]) => {
          const fieldDef = getCertificateFieldCatalog()[certificateType]?.find(field => field.name === key);
          return fieldDef?.required && !String(value || '').trim();
        });

        if (missingRequired.length) {
          notice.textContent = 'Please complete all required certificate details for the selected document type.';
          notice.style.display = 'block';
          return;
        }

        notice.textContent = 'Saving certificate and pinning metadata...';
        notice.style.display = 'block';
        result.innerHTML = '';

        const submitButton = event.submitter || issuerDashboardForm.querySelector('[type="submit"]');
        await withButtonLoading(submitButton, async () => {
          try {
            const attachmentFile = document.getElementById('issuerCertificateAttachmentUpload')?.files?.[0] || null;
            if (attachmentFile && attachmentFile.size > MAX_CERTIFICATE_ATTACHMENT_BYTES) {
              throw new Error('Supporting files must be 4 MB or smaller.');
            }
            const attachmentData = await readFileAsDataUrl(attachmentFile);
            const certificateId = `CERT-${institution.replace(/\s+/g, '').substring(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`;
          const metadata = {
            type: 'Auto-generated certificate',
            documentType: certificateType,
            generatedBy: 'Certicheck issuer dashboard',
            holderWallet: holderWallet || null,
            institution,
            issuerName: institution,
            issuerEmail: user.email || 'issuer@certicheck.com',
            issuerAccountType: user.user_type || 'issuer',
            ...detailFields,
            attachment: attachmentData ? {
              name: attachmentFile?.name || 'certificate-attachment',
              type: attachmentFile?.type || 'application/octet-stream',
              size: attachmentFile?.size || 0,
              dataUrl: attachmentData,
              storage: 'Uploaded as a separate IPFS attachment when Pinata is configured'
            } : {
              name: null,
              storage: 'No supporting file attached'
            }
          };

            const payload = {
              certificateId,
              holderName,
              holderEmail,
              holderWallet,
              certificateType,
              issuerName: institution,
              issuerWallet: wantsOnChain ? connectedWallet : '',
              metadata,
              onChain: wantsOnChain
            };

          const data = wantsOnChain
            ? await issueCertificateWithPhantomWallet(payload, token)
            : await issueCertificateWithoutWallet(payload, token);

          const issued = data.certificate || {};
          const nextId = issued.certificate_id;
          if (!nextId) throw new Error('Certificate saved, but the API response did not include its certificate ID.');
          const ipfsCid = issued.ipfs_cid || '';
          const ipfsSource = issued.ipfs_source || 'fallback';
          const txSig = issued.blockchain_transaction_id || '';
          const issuedAt = issued.issued_at || issued.created_at;
          const successDetails = {
            title: 'Certificate issued successfully.',
            certificateId: nextId,
            ipfsCid,
            ipfsSource,
            transaction: txSig,
            holderName,
            holderEmail,
            certificateType,
            issuerName: institution,
            issuedAt,
            onChain: Boolean(txSig),
            status: issued.status || 'valid',
          };
          setLastIssuerResult(successDetails, user);

          notice.style.display = 'none';
          showCertificateIssuanceCelebration(result, successDetails, data.warnings || []);
          issuerDashboardForm.reset();
          try {
            await refreshIssuerDashboardCertificates(user);
          } catch (refreshError) {
            console.error('Certificate issued but dashboard refresh failed:', refreshError.message || refreshError);
            notice.textContent = `Certificate issued. ${refreshError.message || 'The certificate list could not be refreshed.'}`;
            notice.style.display = 'block';
          }
          } catch (error) {
            notice.textContent = error.message || 'Issuance failed.';
            notice.style.display = 'block';
            result.innerHTML = `
              <div class="alert alert-error"><strong>Issuance failed.</strong><br/>${error.message || 'Please try again.'}</div>
            `;
          }
        }, 'Issuing...');
      });
    }

    const issuerVerifyCertBtn = document.getElementById('issuerVerifyCertBtn');
    const issuerVerifyResult = document.getElementById('issuerVerifyResult');
    if (issuerVerifyCertBtn && issuerVerifyResult) {
      issuerVerifyCertBtn.addEventListener('click', async () => {
        const certId = document.getElementById('issuerVerifyCertId')?.value?.trim();
        if (!certId) {
          issuerVerifyResult.innerHTML = '<div class="alert alert-error">Enter a certificate ID to verify.</div>';
          return;
        }

        issuerVerifyResult.innerHTML = '<div class="alert alert-info">Checking certificate status...</div>';
        await withButtonLoading(issuerVerifyCertBtn, async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/certificates/lookup/${encodeURIComponent(certId)}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Certificate not found');

            const certificate = data.certificate || {};
            const status = (certificate.verification_status || certificate.status || 'valid').toLowerCase();
            const badgeClass = status === 'revoked' ? 'alert-error' : 'alert-success';
            issuerVerifyResult.innerHTML = `
              <div class="${badgeClass}">
                <strong>Status:</strong> ${status === 'revoked' ? 'Revoked' : 'Valid'}<br/>
                <strong>Certificate:</strong> ${certificate.certificate_id || certId}<br/>
                <strong>Holder:</strong> ${certificate.holderName || certificate.holder_name || 'Unknown'}<br/>
                <strong>Issuer:</strong> ${certificate.issuerName || certificate.issuer_name || institution}
              </div>
            `;
          } catch (error) {
            issuerVerifyResult.innerHTML = `<div class="alert alert-error">${error.message || 'Verification failed.'}</div>`;
          }
        }, 'Checking...');
      });
    }
  }
}

function navigate(page) {
  if (page === currentPage && page !== 'home') return;

  // Deactivate old page & nav item
  document.querySelector(".page.active")?.classList.remove("active");
  document.querySelector(".nav-item.active")?.classList.remove("active");

  // Activate new page
  const el = document.getElementById(`page-${page}`);
  if (el) { el.classList.add("active"); currentPage = page; }

  const footer = document.querySelector('.site-footer');
  if (footer) footer.style.display = page === 'home' && !(currentUser || getStoredUser()) ? '' : 'none';

  if (page === 'home') {
    renderRoleLandingHome();
  }

  // Activate nav item
  const navBtn = document.querySelector(`[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add("active");

  window.scrollTo({ top: 0, behavior: "smooth" });

  // Lazy-init pages
  if (page === "tps")       initTPS();
  if (page === "faqs")      renderFAQs();
  if (page === "resources") renderResources();
  if (page === "issuer")    initIssuerDashboard();
  if (page === "holder")    initHolderDashboard();
  if (page === "verify")    { /* verify page is static in DOM; no extra init needed */ }
  initAuthPageForms(page);
}

function initAuthPageForms(page) {
  if (page === "change-password") initChangePasswordForm();
  if (page === "forgot-password") initForgotPasswordForm();
  if (page === "verify-reset-otp") initResetPasswordForm();
  if (page === "activate-account") initIssuerActivationForm();
}

function initIssuerActivationForm() {
  const form = document.getElementById('issuerActivationForm');
  const emailEl = document.getElementById('activationEmail');
  const codeEl = document.getElementById('activationCode');
  const passwordFields = document.getElementById('activationPasswordFields');
  const passwordEl = document.getElementById('activationPassword');
  const confirmEl = document.getElementById('activationConfirmPassword');
  const errorEl = document.getElementById('activationError');
  const button = document.getElementById('issuerActivationBtn');
  let activationCodeVerified = false;

  if (!form || form.dataset.bound === 'true') return;
  form.dataset.bound = 'true';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.style.display = 'none';
    const email = emailEl.value.trim().toLowerCase();
    const activationCode = codeEl.value.trim();
    if (!activationCodeVerified) {
      await withButtonLoading(button, async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/auth/verify-issuer-activation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, activationCode })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'Unable to verify activation code');

          activationCodeVerified = true;
          emailEl.readOnly = true;
          codeEl.readOnly = true;
          passwordFields.hidden = false;
          passwordEl.required = true;
          confirmEl.required = true;
          button.textContent = 'Create password';
        } catch (error) {
          errorEl.textContent = error.message || 'Unable to verify activation code';
          errorEl.style.display = 'block';
        }
      }, 'Verifying code...');
      return;
    }

    const password = passwordEl.value;
    const confirmPassword = confirmEl.value;
    if (password !== confirmPassword) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.style.display = 'block';
      return;
    }
    if (password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      errorEl.style.display = 'block';
      return;
    }

    await withButtonLoading(button, async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/activate-issuer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, activationCode, password, confirmPassword })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to activate issuer account');
        if (data.token && data.user) {
          currentUser = data.user;
          saveAuthSession(data.token, data.user);
          updateAuthUi();
          navigate('home');
        } else {
          navigate('login');
          showLoginNotice('Account activated', data.message || 'You can now sign in.');
        }
      } catch (error) {
        errorEl.textContent = error.message || 'Unable to activate issuer account';
        errorEl.style.display = 'block';
      }
    }, 'Creating password...');
  });
}

function initForgotPasswordForm() {
  const form = document.getElementById('forgotPasswordForm');
  const emailEl = document.getElementById('forgotEmail');
  const errorEl = document.getElementById('forgotError');
  const button = document.getElementById('forgotBtn');

  if (!form || form.dataset.bound === 'true') return;
  form.dataset.bound = 'true';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.style.display = 'none';
    const email = emailEl.value.trim().toLowerCase();
    if (!emailEl.checkValidity()) {
      errorEl.textContent = 'Enter a valid email address';
      errorEl.style.display = 'block';
      return;
    }

    await withButtonLoading(button, async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to send a reset code');

        passwordResetEmail = email;
        navigate('verify-reset-otp');
      } catch (error) {
        errorEl.textContent = error.message || 'Unable to send a reset code';
        errorEl.style.display = 'block';
      }
    }, 'Sending code...');
  });
}

function initResetPasswordForm() {
  const form = document.getElementById('resetPasswordForm');
  const codeEl = document.getElementById('resetOtpCode');
  const passwordEl = document.getElementById('newPassword');
  const confirmEl = document.getElementById('confirmNewPassword');
  const errorEl = document.getElementById('resetError');
  const button = document.getElementById('resetPasswordBtn');

  if (!form || form.dataset.bound === 'true') return;
  form.dataset.bound = 'true';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.style.display = 'none';
    const otpCode = codeEl.value.trim();
    const newPassword = passwordEl.value;

    if (!passwordResetEmail) {
      errorEl.textContent = 'Request a reset code first.';
      errorEl.style.display = 'block';
      navigate('forgot-password');
      return;
    }
    if (!/^\d{6}$/.test(otpCode)) {
      errorEl.textContent = 'Enter the 6-digit code from your email.';
      errorEl.style.display = 'block';
      return;
    }
    if (newPassword.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters.';
      errorEl.style.display = 'block';
      return;
    }
    if (newPassword !== confirmEl.value) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.style.display = 'block';
      return;
    }

    await withButtonLoading(button, async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: passwordResetEmail, otpCode, newPassword })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to reset password');

        passwordResetEmail = '';
        form.reset();
        navigate('login');
        showLoginNotice('Password reset', data.message || 'Your password has been reset successfully. You can now sign in.');
      } catch (error) {
        errorEl.textContent = error.message || 'Unable to reset password';
        errorEl.style.display = 'block';
      }
    }, 'Resetting password...');
  });
}

function VerificationResultModal({ response, certificateId = '' }) {
  const dialog = document.getElementById('verificationResultModal');
  if (!dialog) return null;

  const certificate = response?.certificate || {};
  const rawStatus = String(
    certificate.verification_status || certificate.status || response?.status || ''
  ).toLowerCase();
  const state = !response?.success || response?.status === 'not_found'
    ? 'not-found'
    : rawStatus === 'revoked'
      ? 'revoked'
      : rawStatus === 'valid'
        ? 'valid'
        : 'not-found';
  const statusContent = {
    valid: {
      title: 'VALID',
      message: 'This certificate is authentic and currently active.',
      icon: '✓'
    },
    revoked: {
      title: 'REVOKED',
      message: 'This certificate was issued, but is no longer valid.',
      icon: '!'
    },
    'not-found': {
      title: 'NOT FOUND',
      message: 'We could not find a certificate matching this ID.',
      icon: '×'
    }
  }[state];
  const issuedAt = certificate.issued_at || certificate.created_at || certificate.checked_at || certificate.verifiedAt;
  const revokedAt = certificate.revoked_at || certificate.revokedAt;
  const cid = certificate.ipfs_cid || certificate.ipfsCid || certificate.blockchain_hash;
  const ipfsSource = certificate.ipfs_source || certificate.ipfsSource || '';
  const metadata = certificate.metadata && typeof certificate.metadata === 'object'
    ? certificate.metadata
    : {};
  const name = certificate.holder_name || certificate.holderName || certificate.holder ||
    metadata.recipientFullName || metadata.holderName || certificate.holder_email || '—';
  const type = certificate.certificate_type || certificate.certificateType || metadata.documentType || '—';
  const issuer = certificate.issuer_name || certificate.issuerName || certificate.issuer || '—';

  dialog.dataset.state = state;
  dialog.querySelector('#verificationStatusIcon').textContent = statusContent.icon;
  dialog.querySelector('#verificationResultTitle').textContent = statusContent.title;
  const isOffChain = response?.onChain === false;
  const message = state === 'not-found' && response?.error
    ? response.error
    : isOffChain && state === 'valid'
      ? 'This certificate is recorded in Certicheck but was not issued to Solana.'
      : statusContent.message;
  dialog.querySelector('#verificationResultMessage').textContent = state === 'revoked' && revokedAt
    ? `${message} Revoked on ${new Date(revokedAt).toLocaleString()}.`
    : message;

  const miniCertificate = dialog.querySelector('#verificationMiniCertificate');
  miniCertificate.innerHTML = state === 'valid' || state === 'revoked'
    ? getMiniCertificateCardMarkup({
      ...certificate,
      certificate_id: certificate.certificate_id || certificate.certificateId || certificateId,
      on_chain: response?.onChain === true,
      status: state,
      verification_status: state
    }, {
      statusLabel: state === 'valid' ? 'VALID' : 'REVOKED',
      verification: true
    })
    : '';

  const metadataList = dialog.querySelector('#verificationResultMetadata');
  metadataList.replaceChildren();
  const addMetadata = (label, value, { href = '' } = {}) => {
    const item = document.createElement('div');
    item.className = 'verification-metadata-item';
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = value;
      description.appendChild(link);
    } else {
      description.textContent = value;
    }
    item.append(term, description);
    metadataList.appendChild(item);
  };

  if (state !== 'not-found') {
    addMetadata('Name', String(name));
    addMetadata('Type', String(type));
    addMetadata('Issuer', String(issuer));
    addMetadata('Issued', issuedAt ? new Date(issuedAt).toLocaleDateString() : '—');
    addMetadata(ipfsSource === 'pinata' ? 'IPFS CID' : 'Fallback ID', cid ? String(cid) : '—', {
      href: cid && ipfsSource === 'pinata'
        ? `https://gateway.pinata.cloud/ipfs/${encodeURIComponent(cid)}`
        : ''
    });
    if (certificate.attachment_cid || certificate.metadata?.attachment?.cid) {
      const attachmentCid = certificate.attachment_cid || certificate.metadata.attachment.cid;
      const attachmentFilename = certificate.attachment_filename || certificate.metadata?.attachment?.name || 'Supporting file';
      const attachmentSource = certificate.attachment_source || certificate.metadata?.attachment?.source;
      addMetadata('File', String(attachmentFilename));
      addMetadata('File CID', String(attachmentCid), {
        href: attachmentSource === 'pinata'
          ? `https://gateway.pinata.cloud/ipfs/${encodeURIComponent(attachmentCid)}`
          : ''
      });
    }
    addMetadata('Status', statusContent.title);
    if (response?.onChain === true) addMetadata('Blockchain', 'Verified on Solana');
    else if (isOffChain) addMetadata('Blockchain', 'Off-chain record; not verified on Solana');
    if (state === 'revoked' && revokedAt) {
      addMetadata('Revoked', new Date(revokedAt).toLocaleString());
    }
  } else if (certificateId) {
    addMetadata('Certificate ID', certificateId);
    addMetadata('Status', statusContent.title);
  }

  if (!dialog.dataset.eventsBound) {
    const closeDialog = (focusInput) => {
      if (dialog.open) dialog.close();
      if (focusInput) {
        const input = document.getElementById('certIdInput');
        input?.focus();
        input?.select();
      }
    };
    dialog.querySelectorAll('[data-verification-close]').forEach((button) => {
      button.addEventListener('click', () => closeDialog(false));
    });
    dialog.querySelector('#verificationResultClose')?.addEventListener('click', () => closeDialog(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog(false);
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(false);
      }
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(false);
    });
    dialog.dataset.eventsBound = 'true';
  }

  if (!dialog.open) dialog.showModal();
  dialog.querySelector('[data-verification-close]')?.focus();
  return dialog;
}

async function renderVerifyResult(response, certificateId = '') {
  VerificationResultModal({ response, certificateId });
}

async function verifyCertificate(button = document.getElementById("verifyBtn")) {
  const input = document.getElementById("certIdInput");
  const certificateId = input?.value?.trim();
  const resultEl = document.getElementById("verifyResult");

  if (!certificateId) {
    if (resultEl) {
      resultEl.innerHTML = `<div class="alert alert-error">Please enter a certificate ID.</div>`;
    }
    return;
  }

  if (resultEl) {
    resultEl.textContent = '';
  }

  return withButtonLoading(button, async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/certificates/lookup/${encodeURIComponent(certificateId)}`);
      const data = await response.json();
      if (!response.ok) {
        await renderVerifyResult({ success: false, status: data?.status || 'not_found', error: data?.error || 'Not Found' }, certificateId);
        return;
      }
      await renderVerifyResult(data, certificateId);
    } catch (err) {
      await renderVerifyResult(
        { success: false, status: 'unavailable', error: 'Certificate verification is temporarily unavailable. Please try again.' },
        certificateId
      );
    }
  }, 'Checking...');
}

const REMEMBERED_FIELD_PREFIX = 'certicheck_field_';

function isRememberableField(field) {
  if (!field?.id) return false;
  const type = String(field.type || '').toLowerCase();
  return !['password', 'file', 'hidden', 'radio', 'checkbox', 'submit', 'button'].includes(type)
    && !/otp|one[-_ ]?time|verification[-_ ]?code/i.test(field.id);
}

function restoreRememberedFields(root = document) {
  root.querySelectorAll?.('input, textarea, select').forEach((field) => {
    if (!isRememberableField(field)) return;
    const remembered = localStorage.getItem(`${REMEMBERED_FIELD_PREFIX}${field.id}`);
    if (remembered !== null && field.value !== remembered) field.value = remembered;
  });
}

function initializeRememberedFields() {
  restoreRememberedFields();

  document.addEventListener('input', (event) => {
    const field = event.target;
    if (!isRememberableField(field)) return;
    localStorage.setItem(`${REMEMBERED_FIELD_PREFIX}${field.id}`, field.value);
  });

  document.addEventListener('change', (event) => {
    const field = event.target;
    if (!isRememberableField(field)) return;
    localStorage.setItem(`${REMEMBERED_FIELD_PREFIX}${field.id}`, field.value);
  });

  const observer = new MutationObserver(() => restoreRememberedFields());
  observer.observe(document.body, { childList: true, subtree: true });
}

// Wire all nav buttons & CTAs
document.addEventListener("DOMContentLoaded", () => {
  bindPreviewLinks();
  // Use event delegation on the navbar to reliably catch clicks even when
  // nav links are dynamically hidden/shown (mobile toggle).
  const navbarEl = document.getElementById('navbar');
  if (navbarEl) {
    navbarEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn) return;
      const page = btn.dataset.page;
      if (page) navigate(page);
    });
  }
  document.querySelectorAll('[data-page]').forEach((element) => {
    if (navbarEl?.contains(element)) return;
    element.addEventListener('click', () => navigate(element.dataset.page));
  });
  currentUser = getStoredUser();
  initTheme();
  initializeRememberedFields();
  initSignupForm();
  initLoginForm();
  initAuthPageForms(currentPage);

  // Demo code chips: populate input but do not auto-submit
  document.querySelectorAll(".code-inline[data-demo]").forEach(code => {
    code.addEventListener("click", () => {
      const value = code.dataset.demo;
      const input = document.getElementById("certIdInput");
      if (input) {
        input.value = value;
        input.focus();
      }
    });
  });

  // Prefer form submission (Enter key) for verification
  const verifyForm = document.getElementById('verifyForm');
  if (verifyForm) {
    verifyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      verifyCertificate(document.getElementById("verifyBtn"));
    });
  } else {
    document.getElementById("verifyBtn")?.addEventListener("click", event => {
      event.preventDefault();
      verifyCertificate(event.currentTarget);
    });
  }
  
  // Home CTAs set signup type
  document.getElementById('homeGraduateBtn')?.addEventListener('click', () => { desiredSignupType = 'holder'; });
  // Apply as issuer should open sign-up and preselect issuer role
  document.getElementById('homeIssuerBtn')?.addEventListener('click', (e) => { desiredSignupType = 'issuer'; });
  document.getElementById('homeVerifyBtn')?.addEventListener('click', () => { desiredSignupType = null; });

  // Keep the application email as the official company or department contact.
  document.querySelectorAll('[data-page="apply"],[data-page="signup"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const emailInput = document.getElementById('contactEmailInput');
      const emailHidden = document.getElementById('contactEmail');
      if (emailInput) emailInput.value = '';
      if (emailHidden) emailHidden.value = '';
    });
  });
  // Ensure hero CTA buttons navigate on all screen sizes
  const homeVerify = document.getElementById('homeVerifyBtn');
  const homeIssuer = document.getElementById('homeIssuerBtn');
  if (homeVerify) homeVerify.addEventListener('click', (e) => { e.preventDefault(); navigate('verify'); });
  if (homeIssuer) homeIssuer.addEventListener('click', (e) => { e.preventDefault(); navigate('apply'); });

  // Wire holder page init on navigation
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.page;
      if (p === 'holder') initHolderDashboard();
    });
  });

  // Mobile nav toggle
  const navToggle = document.getElementById('navToggle');
  navToggle && navToggle.addEventListener('click', () => {
    const links = document.querySelector('.nav-links');
    if (!links) return;
    const isOpen = links.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
    navToggle.textContent = isOpen ? '×' : '☰';
  });
  document.querySelector('.nav-links')?.addEventListener('click', event => {
    if (!event.target.closest('[data-page], a')) return;
    const links = document.querySelector('.nav-links');
    if (!links) return;
    links.classList.remove('is-open');
    navToggle?.setAttribute('aria-expanded', 'false');
    if (navToggle) navToggle.textContent = '☰';
  });
  // Show toggle on small screens
  function updateNavForWidth() {
    const links = document.querySelector('.nav-links');
    const toggle = document.getElementById('navToggle');
    if (window.innerWidth <= 900) {
      if (toggle) toggle.style.display = 'inline-block';
    } else {
      if (links) links.classList.remove('is-open');
      if (toggle) toggle.style.display = 'none';
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = '☰';
      }
    }
  }
  updateNavForWidth();
  window.addEventListener('resize', updateNavForWidth);

  // Make sure the default landing page is active exactly once and auth UI is synced.
  document.getElementById("page-home")?.classList.add("active");
  document.querySelector('[data-page="home"]')?.classList.add("active");
  currentUser = getStoredUser();
  updateAuthUi();
  renderRoleLandingHome();
  const requestedPage = new URLSearchParams(window.location.search).get('page');
  if (window.location.pathname.replace(/\/+$/, '') === '/activate-account' || requestedPage === 'activate-account') {
    navigate('activate-account');
  }
  const certificateId = new URLSearchParams(window.location.search).get('certificateId');
  if (certificateId) {
    navigate('verify');
    const certificateInput = document.getElementById('certIdInput');
    if (certificateInput) {
      certificateInput.value = certificateId;
      verifyCertificate();
    }
  }
  if (getAuthToken()) {
    refreshIssuerAuthorization().catch((error) => {
      verifiedIssuerUserId = null;
      console.error('Unable to verify issuer approval:', error.message || error);
      renderRoleLandingHome();
    });
  }
  try { initTheme(); } catch (e) {}
});

/* ═══════════════════════════════════════════════
   NAVBAR — scroll shadow
═══════════════════════════════════════════════ */
const navbar = document.getElementById("navbar");
if (navbar) {
  window.addEventListener("scroll", () => {
    navbar.classList.toggle("scrolled", window.scrollY > 20);
  }, { passive: true });
}

/* ═══════════════════════════════════════════════
   SCROLL HINT
═══════════════════════════════════════════════ */
document.getElementById("scrollHint")?.addEventListener("click", () => {
  window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
});

/* ═══════════════════════════════════════════════
   CUBE PARALLAX
═══════════════════════════════════════════════ */
const cubeWraps = document.querySelectorAll(".cube-wrap");
if (cubeWraps && cubeWraps.length) {
  document.addEventListener("mousemove", (e) => {
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    const dx = (e.clientX - cx) / cx;
    const dy = (e.clientY - cy) / cy;

    cubeWraps.forEach((wrap, i) => {
      const depth = 0.6 + i * 0.14;
      wrap.style.transform = `translate(${dx * 18 * depth}px, ${dy * 12 * depth}px)`;
    });
  });
}

/* ═══════════════════════════════════════════════
   TPS — live Solana data
═══════════════════════════════════════════════ */
let tpsTimer   = null;
let tpsCountRef = 10;
let tpsInitialised = false;

function tpsStatus(tps) {
  if (tps >= 2000) return { label: "Healthy",   color: "#059669", bg: "rgba(5,150,105,0.1)",   text: "#065f46" };
  if (tps >= 800)  return { label: "Normal",    color: "#2563eb", bg: "rgba(37,99,235,0.1)",   text: "#1e3a8a" };
  if (tps >= 200)  return { label: "Degraded",  color: "#d97706", bg: "rgba(217,119,6,0.1)",   text: "#78350f" };
  return                   { label: "Congested", color: "#dc2626", bg: "rgba(220,38,38,0.1)",   text: "#7f1d1d" };
}

function tpsBarColor(tps) {
  if (tps >= 2000) return "#059669";
  if (tps >= 800)  return "#2563eb";
  if (tps >= 200)  return "#d97706";
  return "#dc2626";
}

async function fetchTPS() {
  const errBox   = document.getElementById("tps-error");
  const curEl    = document.getElementById("tpsCurrent");
  const peakEl   = document.getElementById("tpsPeak");
  const avgEl    = document.getElementById("tpsAvg");
  const badgeEl  = document.getElementById("tpsStatusBadge");
  const barsEl   = document.getElementById("tpsBars");
  const updatedEl= document.getElementById("tpsUpdated");

  errBox.style.display = "none";

  [curEl, peakEl, avgEl].forEach(el => { if (el && !el.dataset.loaded) el.innerHTML = `<div class="skeleton" style="width:${el === curEl ? '180px' : '100px'};height:${el === curEl ? '64px' : '32px'};border-radius:6px"></div>`; });

  try {
    const res = await fetch(`${API_BASE_URL}/network/tps`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Unable to load TPS data from the backend");
    }

    const arr = Array.isArray(data.samples) ? data.samples : [];
    if (!arr.length) throw new Error("Empty TPS response from the backend");

    const current = Number(data.currentTps ?? arr[0] ?? 0);
    const peak    = Number(data.peakTps ?? Math.max(...arr));
    const avg     = Number(data.averageTps ?? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length));
    const max     = Math.max(peak, 1);
    const st      = tpsStatus(current);

    curEl.dataset.loaded = "1";
    curEl.innerHTML = `<span style="color:${st.color}">${current.toLocaleString()}</span>`;

    badgeEl.innerHTML = `
      <div class="status-badge" style="background:${st.bg};color:${st.text}">
        <span class="pulse-dot" style="background:${st.color}"></span>
        ${st.label}
      </div>`;

    peakEl.dataset.loaded = avgEl.dataset.loaded = "1";
    peakEl.textContent = peak.toLocaleString();
    avgEl.textContent  = avg.toLocaleString();

    barsEl.innerHTML = arr.map(t => {
      const pct = Math.max(6, Math.round((t / max) * 100));
      return `<div class="tps-bar" style="height:${pct}%;background:${tpsBarColor(t)}" title="${t.toLocaleString()} TPS"></div>`;
    }).join("");

    const now = new Date();
    updatedEl.textContent = `last updated ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  } catch (err) {
    const demo = getDemoTpsData();
    const current = demo.currentTps;
    const peak = demo.peakTps;
    const avg = demo.averageTps;
    const max = Math.max(peak, 1);
    const st = tpsStatus(current);

    curEl.dataset.loaded = "1";
    curEl.innerHTML = `<span style="color:${st.color}">${current.toLocaleString()}</span>`;
    badgeEl.innerHTML = `
      <div class="status-badge" style="background:${st.bg};color:${st.text}">
        <span class="pulse-dot" style="background:${st.color}"></span>
        ${st.label}
      </div>`;
    peakEl.dataset.loaded = avgEl.dataset.loaded = "1";
    peakEl.textContent = peak.toLocaleString();
    avgEl.textContent = avg.toLocaleString();
    barsEl.innerHTML = demo.samples.map(t => {
      const pct = Math.max(6, Math.round((t / max) * 100));
      return `<div class="tps-bar" style="height:${pct}%;background:${tpsBarColor(t)}" title="${t.toLocaleString()} TPS"></div>`;
    }).join("");
    updatedEl.textContent = `last updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  }
}

function initTPS() {
  if (tpsInitialised) return;
  tpsInitialised = true;

  fetchTPS();

  // Countdown + auto-refresh
  tpsTimer = setInterval(() => {
    tpsCountRef -= 1;
    const cdEl = document.getElementById("tpsCountdown");
    if (cdEl) cdEl.textContent = `next refresh in ${tpsCountRef}s`;
    if (tpsCountRef <= 0) { tpsCountRef = 10; fetchTPS(); }
  }, 1_000);

  // Manual refresh button
  document.getElementById("tpsRefreshBtn")?.addEventListener("click", () => {
    tpsCountRef = 10;
    fetchTPS();
  });
}

// Pause timer when not on TPS page
document.addEventListener("visibilitychange", () => {
  if (document.hidden && tpsTimer) { clearInterval(tpsTimer); tpsTimer = null; }
  else if (!document.hidden && currentPage === "tps" && !tpsTimer) { initTPS(); }
});

const THEME_KEY = "certicheck_theme";
const PENDING_APPS_KEY = "certicheck_pending_apps";

async function initIssuerDashboard() {
  const formWrap = document.getElementById("issuerFormWrap");
  const notice = document.getElementById("issuerNotice");
  const form = document.getElementById("issuerIssueForm");
  const button = document.getElementById("issuerSubmitBtn");
  const errorEl = document.getElementById("issuerError");
  const resultEl = document.getElementById("issuerResult");

  if (!formWrap || !notice || !button) return;

  const token = getAuthToken();
  if (!token) {
    notice.textContent = 'Sign in to access issuer tools.';
    notice.style.display = "block";
    formWrap.style.display = "none";
    return;
  }

  let authorization;
  try {
    authorization = await refreshIssuerAuthorization();
  } catch (error) {
    console.error('Unable to verify issuer approval:', error.message || error);
    notice.textContent = 'Unable to verify issuer approval. Please try again.';
    notice.style.display = 'block';
    formWrap.style.display = 'none';
    return;
  }
  const user = currentUser || getStoredUser();
  if (!authorization.approved || !user || user.user_type !== 'issuer') {
    notice.textContent = authorization.error || 'Issuer approval required';
    notice.style.display = "block";
    formWrap.style.display = "none";
    return;
  }

  notice.style.display = "none";
  formWrap.style.display = "block";

  // Render issuer certificate list from the backend when possible
  async function loadIssuerCertificates() {
    const listEl = document.getElementById('issuerCertificatesList');
    if (!listEl) return [];

    try {
      const response = await fetch(`${API_BASE_URL}/certificates/my-issued`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` }
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) {
        verifiedIssuerUserId = null;
        notice.textContent = data.error || 'Issuer approval required';
        notice.style.display = 'block';
        formWrap.style.display = 'none';
        return [];
      }
      if (!response.ok) throw new Error(data.error || 'Unable to load issued certificates');
      if (data.success && Array.isArray(data.certificates)) {
        return data.certificates.map((entry) => ({
          certificateId: entry.certificate_id,
          holderName: entry.holder_name || '',
          holderEmail: entry.holder_email || '',
          certificateType: entry.certificate_type,
          ipfsCid: entry.ipfs_cid || '',
          ipfsUri: entry.ipfs_uri || '',
          ipfsSource: entry.ipfs_source || 'fallback',
          attachmentCid: entry.attachment_cid || '',
          attachmentUri: entry.attachment_uri || '',
          attachmentFilename: entry.attachment_filename || '',
          attachmentSource: entry.attachment_source || '',
          blockchainTransactionId: entry.blockchain_transaction_id || '',
          verificationStatus: entry.status || entry.verification_status || 'valid',
          issuedAt: entry.issued_at || entry.created_at,
          revokedAt: entry.revoked_at,
          metadata: entry.metadata || {}
        }));
      }
      throw new Error(data.error || 'Invalid certificate list response');
    } catch (err) {
      console.error('Unable to load issuer certificates from backend:', err.message);
      notice.textContent = err.message || 'Unable to load issuer certificates.';
      notice.style.display = 'block';
      return [];
    }

    return [];
  }

  async function renderIssuerCertificatesList() {
    const listEl = document.getElementById('issuerCertificatesList');
    if (!listEl) return;
    const all = await loadIssuerCertificates();
    const ours = all.filter(c => c.certificateId);
    if (!ours.length) {
      listEl.innerHTML = 'No certificates issued yet.';
      return;
    }

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;table-layout:fixed;border-collapse:collapse';
    const header = document.createElement('thead');
    const headingRow = document.createElement('tr');
    ['ID', 'Type', 'Issued', 'IPFS CID', 'On-chain', 'Status', 'Actions'].forEach((label) => {
      const cell = document.createElement('th');
      cell.textContent = label;
      headingRow.appendChild(cell);
    });
    header.appendChild(headingRow);
    const body = document.createElement('tbody');
    ours.forEach((certificate) => {
      const row = document.createElement('tr');
      row.dataset.certId = certificate.certificateId;
      const idCell = document.createElement('td');
      idCell.style.cssText = 'font-family:var(--font-mono);overflow-wrap:anywhere';
      idCell.textContent = certificate.certificateId;
      const typeCell = document.createElement('td');
      typeCell.style.overflowWrap = 'anywhere';
      typeCell.textContent = certificate.certificateType || '—';
      const dateCell = document.createElement('td');
      dateCell.textContent = certificate.issuedAt ? new Date(certificate.issuedAt).toLocaleDateString() : '—';
      const cidCell = document.createElement('td');
      cidCell.className = 'issuer-cid';
      cidCell.style.overflowWrap = 'anywhere';
      if (certificate.ipfsCid) {
        if (certificate.ipfsSource === 'pinata') {
          const link = document.createElement('a');
          link.href = `https://gateway.pinata.cloud/ipfs/${encodeURIComponent(certificate.ipfsCid)}`;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = certificate.ipfsCid;
          cidCell.appendChild(link);
        } else {
          cidCell.textContent = `${certificate.ipfsCid} (fallback)`;
        }
      } else {
        cidCell.textContent = '—';
      }
      const chainCell = document.createElement('td');
      chainCell.textContent = certificate.blockchainTransactionId ? 'Yes' : 'No';
      const statusCell = document.createElement('td');
      statusCell.textContent = String(certificate.verificationStatus || 'valid').toLowerCase() === 'revoked' ? 'Revoked' : 'Valid';
      const actionsCell = document.createElement('td');
      if (certificate.verificationStatus === 'revoked') {
        const label = document.createElement('em');
        label.textContent = 'Revoked';
        actionsCell.appendChild(label);
      } else {
        const button = document.createElement('button');
        button.className = 'btn-ghost btn-revoke';
        button.dataset.cert = certificate.certificateId;
        button.textContent = 'Revoke';
        actionsCell.appendChild(button);
      }
      [idCell, typeCell, dateCell, cidCell, chainCell, statusCell, actionsCell].forEach((cell) => row.appendChild(cell));
      body.appendChild(row);
    });
    table.append(header, body);
    listEl.replaceChildren(table);

    // Wire revoke buttons
    listEl.querySelectorAll('.btn-revoke').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const certId = btn.dataset.cert;
        if (!certId) return;
        if (!confirm(`Revoke certificate ${certId}? This action is recorded.`)) return;

        await withButtonLoading(btn, async () => {
        const token = getAuthToken();
        try {
          if (!token || !isVerifiedIssuer()) throw new Error('Issuer approval required');
          const blockchainTransactionId = await revokeCertificateWithPhantomWallet(
            certId,
            'Revoked via issuer dashboard',
            getConnectedWalletAddress()
          );
          const res = await fetch(`${API_BASE_URL}/certificates/my-issued/${encodeURIComponent(certId)}/revoke`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ reason: 'Revoked via issuer dashboard', blockchainTransactionId })
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Revoke failed');

          await renderIssuerCertificatesList();
        } catch (err) {
          alert('Unable to revoke certificate: ' + (err.message || err));
        }
        }, 'Revoking...');
      });
    });
  }

  renderIssuerCertificatesList();

  // Wallet connect (Phantom)
  const connectBtn = document.getElementById('connectWalletBtn');
  const walletBadge = document.getElementById('connectedWalletBadge');
  if (connectBtn) {
    connectBtn.setAttribute('data-wallet-connect', 'true');
    connectBtn.onclick = async (event) => {
      event.preventDefault();
      await handleWalletConnect(connectBtn);
    };
  }

  const existingWallet = getActivePhantomWalletAddress();
  if (existingWallet && walletBadge) {
    walletBadge.textContent = formatWalletShort(existingWallet);
    const wInput = document.getElementById('issuerWallet');
    if (wInput) wInput.value = existingWallet;
  }

  updateWalletActionAvailability();

  button.onclick = async () => {
    errorEl.style.display = "none";
    errorEl.textContent = "";
    resultEl.innerHTML = "";
    if (!getAuthToken() || !isVerifiedIssuer()) {
      errorEl.textContent = 'Issuer approval required';
      errorEl.style.display = 'block';
      return;
    }

    const payload = {
      certificateId: document.getElementById("issuerCertId")?.value?.trim() || "",
      holderName: document.getElementById("issuerHolderName")?.value?.trim() || "",
      holderEmail: document.getElementById("issuerHolderEmail")?.value?.trim() || "",
      certificateType: document.getElementById("issuerType")?.value?.trim() || "",
      issuerName: document.getElementById("issuerName")?.value?.trim() || "",
      issuerWallet: document.getElementById("issuerWallet")?.value?.trim() || "",
      metadata: {},
      expiry: document.getElementById("issuerExpiry")?.value || null,
      onChain: document.getElementById("issuerOnChain")?.checked || false
    };

    const rawMetadata = document.getElementById('issuerMetadata')?.value?.trim() || '';
    if (rawMetadata) {
      try {
        const parsedMetadata = JSON.parse(rawMetadata);
        if (!parsedMetadata || typeof parsedMetadata !== 'object' || Array.isArray(parsedMetadata)) throw new Error();
        payload.metadata = parsedMetadata;
      } catch (err) {
        errorEl.textContent = 'Metadata must be a valid JSON object.';
        errorEl.style.display = 'block';
        return;
      }
    }

    const attachmentFile = document.getElementById('issuerStaticAttachment')?.files?.[0] || null;
    if (attachmentFile && attachmentFile.size > MAX_CERTIFICATE_ATTACHMENT_BYTES) {
      errorEl.textContent = 'Supporting files must be 4 MB or smaller.';
      errorEl.style.display = 'block';
      return;
    }

    await withButtonLoading(button, async () => {
      try {
      const attachmentData = await readFileAsDataUrl(attachmentFile);
      payload.metadata = {
        ...payload.metadata,
        expiry: payload.expiry,
        attachment: attachmentData ? {
          name: attachmentFile.name,
          type: attachmentFile.type || 'application/octet-stream',
          size: attachmentFile.size,
          dataUrl: attachmentData,
          storage: 'Uploaded as a separate IPFS attachment when Pinata is configured'
        } : null
      };

      const wantsOnChain = document.getElementById('issuerOnChain')?.checked === true;
      const connectedWallet = getActivePhantomWalletAddress();
      if (wantsOnChain && !connectedWallet) {
        throw new Error('Connect your Phantom wallet or turn off Solana issuance to issue off-chain.');
      }
      payload.issuerWallet = wantsOnChain ? connectedWallet : '';
      const data = wantsOnChain
        ? await issueCertificateWithPhantomWallet(payload, getAuthToken())
        : await issueCertificateWithoutWallet(payload, getAuthToken());

      const certificate = data.certificate || {};
      const certificateId = certificate.certificate_id || payload.certificateId;
      localStorage.setItem("certicheck_last_certificate", JSON.stringify(certificate));
      localStorage.setItem("certicheck_last_certificate_id", certificateId);

      const certInput = document.getElementById("certIdInput");
      if (certInput) {
        certInput.value = certificateId;
      }

      const status = String(certificate.status || 'valid').toLowerCase() === 'revoked' ? 'Revoked' : 'Valid';
      const issuedAt = certificate.issued_at || certificate.created_at || new Date().toISOString();
      const ipfsSource = certificate.ipfs_source || 'fallback';

      // Append to issuer certificate list in localStorage for dashboard rendering
      try {
        const arr = getIssuerIssuedCertificates();
        const entry = {
          certificateId,
          holderName: certificate.holderName || payload.holderName || payload.holderEmail,
          holderEmail: payload.holderEmail || null,
          certificateType: payload.certificateType || certificate.certificate_type || null,
          ipfsCid: certificate.ipfsCid || certificate.ipfs_cid || certificate.blockchain_hash || null,
          ipfsUri: certificate.ipfsUri || certificate.ipfs_uri || null,
          ipfsSource: certificate.ipfs_source || 'fallback',
          blockchainTransactionId: certificate.blockchainTransactionId || certificate.blockchain_transaction_id || null,
          blockchainExplorerUrl: certificate.blockchainExplorerUrl || null,
          issuerEmail: user.email,
          issuerWallet: payload.issuerWallet || null,
          metadata: payload.metadata || certificate.metadata || null,
          expiry: payload.expiry || certificate.expiry || null,
          issuedAt
        };
        arr.unshift(entry);
        setIssuerIssuedCertificates(arr, user);
      } catch (e) { console.warn('Failed to store issued certificate locally', e); }

      const successDetails = {
        certificateId,
        holderName: payload.holderName,
        certificateType: payload.certificateType,
        issuerName: payload.issuerName,
        issuedAt,
        status,
        onChain: Boolean(certificate.blockchain_transaction_id),
        transaction: certificate.blockchain_transaction_id || null,
        ipfsCid: certificate.ipfs_cid,
        ipfsSource
      };
      showCertificateIssuanceCelebration(resultEl, successDetails, data.warnings || []);

      // Refresh issuer list view if visible
      try { renderIssuerCertificatesList(); } catch (e) {}
    } catch (err) {
      const message = err?.message || "The backend could not issue the certificate.";
      errorEl.textContent = message;
      errorEl.style.display = "block";
      resultEl.innerHTML = `
        <div class="alert alert-error">
          <strong>Issuance failed.</strong><br/>
          <div style="margin-top:8px;font-size:13px">${message}</div>
        </div>`;
      }
    }, "Issuing...");
  };
}

function toggleTheme() {
  const nextTheme = document.body.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(nextTheme);
  return nextTheme === 'dark';
}

function initTheme() {
  const toggle = document.getElementById('themeToggle');
  const storedTheme = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = storedTheme || (prefersDark ? 'dark' : 'light');

  applyTheme(theme);

  if (toggle && !toggle.dataset.themeBound) {
    toggle.dataset.themeBound = 'true';
    toggle.addEventListener('click', toggleTheme);
  }
}

function buildVerificationLink(certificateId) {
  const base = window.location.origin + window.location.pathname;
  return `${base}?certificate=${encodeURIComponent(certificateId)}`;
}

async function copyVerificationLink(certificateId) {
  const link = buildVerificationLink(certificateId);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(link);
      return true;
    }

    const helper = document.createElement('textarea');
    helper.value = link;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
    return true;
  } catch (err) {
    console.warn('Failed to copy verification link:', err);
    return false;
  }
}

function getHolderCertificatesForUser(user) {
  if (!user) return [];

  const arr = getIssuerIssuedCertificates();

  return arr.filter((certificate) => {
    const holderEmail = String(certificate.holderEmail || certificate.holder_email || '').toLowerCase();
    const holderWallet = String(certificate.holderWallet || certificate.holder_wallet || '');
    const issuerEmail = String(certificate.issuerEmail || certificate.issuer_email || '').toLowerCase();
    const userEmail = String(user.email || '').toLowerCase();
    const userWallet = String(user.wallet || '');

    return (
      (userEmail && holderEmail && holderEmail === userEmail) ||
      (userWallet && holderWallet && holderWallet === userWallet) ||
      (user.id && Number(certificate.userId) === Number(user.id)) ||
      (userEmail && issuerEmail && issuerEmail === userEmail)
    );
  });
}

function initHolderDashboard() {
  const notice = document.getElementById('holderNotice');
  const wrap = document.getElementById('holderCertListWrap');
  const listEl = document.getElementById('holderCertificatesList');

  if (!notice || !wrap || !listEl) return;
  const token = getAuthToken();
  const user = getStoredUser();
  if (!token || !user) {
    notice.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }

  notice.style.display = 'none';
  wrap.style.display = 'block';

  try {
    const ours = getHolderCertificatesForUser(user);
    if (!ours.length) {
      listEl.innerHTML = '<div>No certificates found for your account.</div>';
      return;
    }

    listEl.innerHTML = ours.map((certificate) => {
      const certId = certificate.certificateId || certificate.certificate_id || 'Unknown certificate';
      const status = certificate.status || certificate.verification_status || 'valid';
      const issuer = certificate.issuerName || certificate.issuer_name || certificate.issuerWallet || certificate.issuer_wallet || 'Unknown issuer';
      const date = certificate.issuedAt ? new Date(certificate.issuedAt).toLocaleDateString() : (certificate.issued_at ? new Date(certificate.issued_at).toLocaleDateString() : 'N/A');
      const ipfsSource = certificate.ipfsSource || certificate.ipfs_source;
      const ipfsUrl = ipfsSource === 'pinata' && certificate.ipfsCid
        ? `https://gateway.pinata.cloud/ipfs/${encodeURIComponent(certificate.ipfsCid)}`
        : null;
      const verificationUrl = buildVerificationLink(certId);

      return `
        <div style="padding:16px 14px;border:1px solid rgba(0,0,0,0.06);border-radius:12px;margin-bottom:12px;background:rgba(255,255,255,0.5)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div>
              <div style="font-family:var(--font-mono);font-size:13px;font-weight:700">${certId}</div>
              <div style="margin-top:6px;color:var(--text-secondary);font-size:13px">${certificate.certificateType || certificate.certificate_type || 'Certificate'} • ${date}</div>
            </div>
            <span style="padding:4px 8px;border-radius:999px;background:${status === 'revoked' ? 'rgba(220,38,38,0.12)' : 'rgba(5,118,210,0.12)'};color:${status === 'revoked' ? '#b91c1c' : '#0f172a'};font-size:12px;font-weight:600;text-transform:capitalize">${status}</span>
          </div>

          <div style="margin-top:10px;font-size:13px;color:var(--text-secondary)">
            <div><strong>Issuer:</strong> ${issuer}</div>
          </div>

          <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-ghost" data-share-cert="${certId}" type="button">Share</button>
            ${ipfsUrl ? `<a class="btn-ghost" href="${ipfsUrl}" target="_blank" rel="noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center">Download</a>` : '<button class="btn-ghost" type="button" disabled>Download</button>'}
            <a class="btn-ghost" href="${verificationUrl}" target="_blank" rel="noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center">Verify</a>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-share-cert]').forEach((button) => {
      button.addEventListener('click', async () => {
        const certId = button.getAttribute('data-share-cert');
        const copied = await copyVerificationLink(certId);
        button.textContent = copied ? 'Copied' : 'Copy failed';
        setTimeout(() => { button.textContent = 'Share'; }, 1200);
      });
    });
  } catch (e) {
    console.warn('Failed to render holder dashboard certificates:', e);
    listEl.innerHTML = '<div>Error loading certificates.</div>';
  }
}

function applyTheme(theme) {
  const body = document.body;
  const toggle = document.getElementById("themeToggle");
  const nextTheme = theme === "dark" ? "dark" : "light";

  body.classList.toggle("dark", nextTheme === "dark");
  document.documentElement.setAttribute("data-theme", nextTheme);
  localStorage.setItem(THEME_KEY, nextTheme);

  if (toggle) {
    toggle.title = nextTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    toggle.setAttribute("aria-label", nextTheme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
}

function updateThemeToggleState() {
  const toggle = document.getElementById("themeToggle");
  if (!toggle) return;
  const isDark = document.body.classList.contains("dark");
  toggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}

/* ═══════════════════════════════════════════════
   AUTHENTICATION — Signup & Login
═══════════════════════════════════════════════ */
function initSignupForm() {
  const btn = document.getElementById("signupBtn");
  const emailEl = document.getElementById("signupEmail");
  const firstNameEl = document.getElementById("signupFirstName");
  const lastNameEl = document.getElementById("signupLastName");
  const errorEl = document.getElementById("signupError");

  if (!btn || btn.dataset.bound === "true") return;
  btn.dataset.bound = "true";

  btn.addEventListener("click", async () => {
    errorEl.style.display = "none";
    const email = emailEl.value.trim().toLowerCase();
    const firstName = firstNameEl.value.trim();
    const lastName = lastNameEl.value.trim();

    if (!email || !firstName || !lastName) {
      errorEl.textContent = "All fields are required";
      errorEl.style.display = "block";
      return;
    }
    if (!emailEl.checkValidity()) {
      errorEl.textContent = "Enter a valid email address";
      errorEl.style.display = "block";
      return;
    }

    await withButtonLoading(btn, async () => {
      try {
        const registerResponse = await fetch(`${API_BASE_URL}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            firstName,
            lastName,
            userType: desiredSignupType || 'issuer'
          })
        });
        const registerData = await registerResponse.json().catch(() => ({}));
        if (!registerResponse.ok) throw new Error(registerData.error || 'Registration failed');

        const draft = loadPendingApplicationDraft();
        let applicationNotice = '';
        if (draft) {
          try {
            draft.contactEmail = email;
            const applicationResponse = await fetch(`${API_BASE_URL}/applications/submit`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(draft)
            });
            const applicationData = await applicationResponse.json().catch(() => ({}));
            if (applicationResponse.ok) {
              clearPendingApplicationDraft();
            } else {
              applicationNotice = ` Your application was not submitted: ${applicationData.error || 'Please submit it again.'}`;
            }
          } catch (applicationError) {
            applicationNotice = ` Your application could not be submitted: ${applicationError.message || 'Please submit it again.'}`;
          }
        }

        navigate('login');
        showLoginNotice('Account created', `${registerData.message || 'Your account is pending admin approval. You can sign in after it has been approved.'}${applicationNotice}`);
      } catch (err) {
        errorEl.textContent = err.message || 'Unable to complete registration';
        errorEl.style.display = 'block';
      }
    }, 'Creating account...');
  });
}

function showLoginNotice(title, message) {
  const dialog = document.getElementById('loginNoticeDialog');
  const titleEl = document.getElementById('loginNoticeTitle');
  const messageEl = document.getElementById('loginNoticeMessage');
  if (!dialog || typeof dialog.showModal !== 'function') return false;

  titleEl.textContent = title;
  messageEl.textContent = message;
  if (dialog.open) dialog.close();
  dialog.showModal();
  return true;
}

function initLoginForm() {
  const btn = document.getElementById("loginBtn");
  const emailEl = document.getElementById("loginEmail");
  const passwordEl = document.getElementById("loginPassword");
  const rememberEl = document.getElementById("loginRemember");
  const errorEl = document.getElementById("loginError");
  const noticeDialog = document.getElementById('loginNoticeDialog');
  const noticeClose = document.getElementById('loginNoticeClose');

  if (!btn) return;

  const savedEmail = getRememberedLoginEmail();
  if (emailEl && savedEmail) {
    emailEl.value = savedEmail;
  }
  if (rememberEl) {
    rememberEl.checked = Boolean(savedEmail);
  }
  if (noticeClose && noticeDialog) noticeClose.onclick = () => noticeDialog.close();

  btn.addEventListener("click", async () => {
    errorEl.style.display = "none";
    const email = emailEl.value.trim().toLowerCase();
    const password = passwordEl.value;
    const remember = rememberEl?.checked;

    if (!email || !password) {
      errorEl.textContent = "Email and password are required";
      errorEl.style.display = "block";
      return;
    }
    if (!emailEl.checkValidity()) {
      errorEl.textContent = "Enter a valid email address";
      errorEl.style.display = "block";
      return;
    }

    await withButtonLoading(btn, async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.token) {
            if (remember) setRememberedLoginEmail(email); else setRememberedLoginEmail("");
            saveAuthSession(data.token, data.user);
            if (data.user.must_change_password) {
              navigate('change-password');
              return;
            }
            return navigate(data.user.user_type === 'admin' ? 'home' : data.user.user_type === 'issuer' ? 'home' : 'holder');
          }
        }

        // Use status-specific dialog messages only when the server provides a known code.
        let errMsg = 'Incorrect email or password';
        let errCode = '';
        try {
          const errData = await response.json();
          if (errData && errData.error) errMsg = errData.error;
          if (errData && errData.code) errCode = errData.code;
        } catch (e) {}
        if (errCode === 'ISSUER_ACTIVATION_REQUIRED') {
          const activationEmail = document.getElementById('activationEmail');
          if (activationEmail) activationEmail.value = email;
          navigate('activate-account');
          const activationError = document.getElementById('activationError');
          if (activationError) {
            activationError.textContent = errMsg;
            activationError.style.display = 'block';
          }
          if (remember) setRememberedLoginEmail(email); else setRememberedLoginEmail("");
          return;
        }
        const noticeTitles = {
          EMAIL_NOT_REGISTERED: 'Email not registered',
          APPLICATION_PENDING: 'Application pending',
          APPLICATION_REJECTED: 'Application rejected',
          APPLICATION_APPROVED: 'Application approved',
          USER_PENDING_APPROVAL: 'Account pending approval',
          ISSUER_ACTIVATION_REQUIRED: 'Issuer account approved'
        };
        if (noticeTitles[errCode] && !showLoginNotice(noticeTitles[errCode], errMsg)) {
          errorEl.textContent = errMsg;
          errorEl.style.display = 'block';
        } else if (!noticeTitles[errCode]) {
          errorEl.textContent = errMsg;
          errorEl.style.display = 'block';
        }
        if (remember) setRememberedLoginEmail(email); else setRememberedLoginEmail("");

      } catch (err) {
        console.warn('Login request failed (network):', err.message || err);
        showLoginNotice('Unable to sign in', 'The Certicheck login service could not be reached. Check your connection and try again.');
      }
    }, 'Signing in...');
  });
}

function initChangePasswordForm() {
  const btn = document.getElementById("changePasswordBtn");
  const passwordEl = document.getElementById("changePassword");
  const confirmPasswordEl = document.getElementById("confirmChangePassword");
  const errorEl = document.getElementById("changePasswordError");

  if (!btn || btn.dataset.bound === "true") return;
  btn.dataset.bound = "true";

  btn.addEventListener("click", async () => {
    const newPassword = passwordEl.value;
    if (newPassword.length < 6 || newPassword === "password") {
      errorEl.textContent = 'Password must be at least 6 characters and cannot be "password"';
      errorEl.style.display = "block";
      return;
    }
    if (newPassword !== confirmPasswordEl.value) {
      errorEl.textContent = "Passwords do not match";
      errorEl.style.display = "block";
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Saving...";
      const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ newPassword })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to change password');

      const user = { ...getStoredUser(), ...(data.user || {}), must_change_password: false };
      saveAuthSession(data.token, user);
      navigate(user.user_type === 'admin' || user.user_type === 'issuer' ? 'home' : 'holder');
    } catch (err) {
      errorEl.textContent = err.message || "Unable to change password";
      errorEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Save Password";
    }
  });
}

/* ═══════════════════════════════════════════════
   FAQs — accordion + category filter
═══════════════════════════════════════════════ */
let faqActiveCat = "All";
let faqRendered  = false;

function renderFAQs() {
  if (faqRendered) return;
  faqRendered = true;

  // Category pills
  const catsEl = document.getElementById("faqCats");
  const categories = ["All", ...FAQ_DATA.map(g => g.category)];
  catsEl.innerHTML = categories.map(c => `
    <button class="faq-cat-btn ${c === "All" ? "active" : ""}" data-cat="${c}">${c}</button>
  `).join("");

  catsEl.addEventListener("click", e => {
    const btn = e.target.closest(".faq-cat-btn");
    if (!btn) return;
    faqActiveCat = btn.dataset.cat;
    catsEl.querySelectorAll(".faq-cat-btn").forEach(b => b.classList.toggle("active", b === btn));
    buildAccordion();
  });

  buildAccordion();
}

function buildAccordion() {
  const root    = document.getElementById("faqAccordion");
  const groups  = faqActiveCat === "All" ? FAQ_DATA : FAQ_DATA.filter(g => g.category === faqActiveCat);

  root.innerHTML = groups.map(group => `
    <div class="faq-group">
      <div class="faq-group-title">${group.category}</div>
      <div class="faq-group-inner">
        ${group.items.map((item, i) => `
          <div class="faq-item">
            <button class="faq-q" data-idx="${i}">
              <span>${item.q}</span>
              <span class="faq-icon">+</span>
            </button>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  // Store answers for lookup
  root._groups = groups;

  // Accordion toggle
  root.addEventListener("click", e => {
    const btn = e.target.closest(".faq-q");
    if (!btn) return;

    const item   = btn.closest(".faq-item");
    const isOpen = btn.classList.contains("open");

    // Close all
    root.querySelectorAll(".faq-q.open").forEach(q => {
      q.classList.remove("open");
      q.nextElementSibling?.remove();
    });

    if (!isOpen) {
      // Find answer
      const groupEl  = btn.closest(".faq-group");
      const groupIdx = [...root.querySelectorAll(".faq-group")].indexOf(groupEl);
      const idx      = parseInt(btn.dataset.idx);
      const answer   = root._groups[groupIdx]?.items[idx]?.a || "";

      btn.classList.add("open");
      const ansEl = document.createElement("div");
      ansEl.className = "faq-a";
      ansEl.textContent = answer;
      item.appendChild(ansEl);
    }
  });
}

/* ═══════════════════════════════════════════════
   APPLY — multi-step form
═══════════════════════════════════════════════ */
let applyStep = 1;

const ROLE_OPTIONS_BY_ORG_TYPE = {
  university: [
    "Registrar",
    "Dean",
    "Provost",
    "Academic Director",
    "Admissions Officer",
    "Program Manager",
    "Academic Advisor"
  ],
  college: [
    "Registrar",
    "Dean of Students",
    "Admissions Director",
    "Academic Director",
    "Program Coordinator",
    "Career Services Lead"
  ],
  bootcamp: [
    "Co-Founder",
    "Academic Director",
    "Admissions Manager",
    "Career Coach",
    "Program Lead",
    "Partnerships Manager"
  ],
  corporate: [
    "CTO",
    "Head of Compliance",
    "HR Director",
    "Operations Manager",
    "People Lead",
    "Learning & Development Manager"
  ],
  "law-firm": [
    "Managing Partner",
    "Senior Counsel",
    "Legal Director",
    "Compliance Officer",
    "Operations Manager",
    "Client Relationship Lead"
  ],
  bank: [
    "Branch Manager",
    "Risk Manager",
    "Compliance Officer",
    "Operations Director",
    "Finance Manager",
    "Head of Digital Banking"
  ],
  government: [
    "Director",
    "Program Manager",
    "Policy Analyst",
    "Chief Administrator",
    "Department Head",
    "Public Sector Operations Lead"
  ],
  ngo: [
    "Executive Director",
    "Program Manager",
    "Partnerships Lead",
    "Operations Lead",
    "Grant Manager",
    "Community Engagement Manager"
  ],
  other: [
    "Founder",
    "Director",
    "Operations Manager",
    "Administrator",
    "Program Lead",
    "Department Head"
  ]
};

function updateContactRoleOptions() {
  const orgType = document.getElementById("orgType")?.value || "other";
  const roleSelect = document.getElementById("contactRole");
  if (!roleSelect) return;

  const roleOptions = ROLE_OPTIONS_BY_ORG_TYPE[orgType] || ROLE_OPTIONS_BY_ORG_TYPE.other;
  const currentValue = roleSelect.value;

  roleSelect.innerHTML = `
    <option value="">Select a role/title</option>
    ${roleOptions.map(role => `<option value="${role}">${role}</option>`).join("")}
  `;

  if (roleOptions.includes(currentValue)) {
    roleSelect.value = currentValue;
  }
}

(function initApplyForm() {
  const nextBtn = document.getElementById("formNext");
  const backBtn = document.getElementById("formBack");
  const volumeSelect = document.getElementById("volume");
  const volumeCustomField = document.getElementById("volumeCustomField");
  const volumeCustomInput = document.getElementById("volumeCustom");
  const orgTypeSelect = document.getElementById("orgType");

  if (!nextBtn) return;

  const toggleCustomVolume = () => {
    const isCustom = volumeSelect?.value === "custom";
    if (volumeCustomField) volumeCustomField.style.display = isCustom ? "block" : "none";
    if (volumeCustomInput) {
      volumeCustomInput.required = isCustom;
      if (!isCustom) volumeCustomInput.value = "";
    }
  };

  orgTypeSelect?.addEventListener("change", updateContactRoleOptions);
  volumeSelect?.addEventListener("change", toggleCustomVolume);
  toggleCustomVolume();
  updateContactRoleOptions();

  nextBtn.addEventListener("click", (event) => {
    event.preventDefault();
    if (!validateApplyStep(applyStep)) return;
    if (applyStep < 3) {
      setApplyStep(applyStep + 1);
    } else {
      submitApplyForm();
    }
  });

  backBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    if (applyStep > 1) setApplyStep(applyStep - 1);
  });
})();

function validateApplyStep(step) {
  const stepElement = document.getElementById(`form-step-${step}`);
  if (!stepElement) return false;

  const invalidField = stepElement.querySelector(':invalid');
  if (!invalidField) return true;

  invalidField.reportValidity();
  invalidField.focus();
  return false;
}

function setApplyStep(step) {
  // Hide old step
  document.getElementById(`form-step-${applyStep}`)?.classList.remove("active");
  // Show new step
  document.getElementById(`form-step-${step}`)?.classList.add("active");

  // Update step indicator
  document.querySelectorAll(".step").forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle("active", s === step);
    el.classList.toggle("done",   s <  step);
  });

  // Button labels
  const nextBtn = document.getElementById("formNext");
  const backBtn = document.getElementById("formBack");
  if (nextBtn) nextBtn.textContent = step === 3 ? "Submit Application" : "Continue →";
  if (backBtn) backBtn.style.display = step > 1 ? "inline-flex" : "none";

  applyStep = step;
}

async function submitApplyForm() {
  const name  = document.getElementById("contactName")?.value || "";
  const emailInput = document.getElementById("contactEmailInput");
  const email = (emailInput?.value || "").trim();
  const volumeSelect = document.getElementById("volume");
  const volumeCustomInput = document.getElementById("volumeCustom");
  let volumeText = volumeSelect?.value || "";

  if (volumeText === "custom" && volumeCustomInput?.value) {
    volumeText = `${volumeCustomInput.value.trim()} certificate${volumeCustomInput.value.trim() === "1" ? "" : "s"}`;
  } else {
    volumeText = volumeSelect?.selectedOptions[0]?.text || volumeText;
  }

  const authToken = localStorage.getItem('certicheck_auth_token');

  const applicationData = {
    orgName: document.getElementById("orgName")?.value.trim() || "",
    orgType: document.getElementById("orgType")?.value || "",
    website: document.getElementById("orgWebsite")?.value.trim() || "",
    contactName: name,
    contactEmail: email,
    contactRole: document.getElementById("contactRole")?.value.trim() || "",
    useCase: document.getElementById("useCase")?.value.trim() || "",
    volume: volumeText,
    wallet: document.getElementById("wallet")?.value.trim() || ""
  };

  if (!name.trim() || !email || !email.includes('@')) {
    alert('Enter your name and official company or department email.');
    return;
  }

  const headers = {
    'Content-Type': 'application/json'
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const submitButton = document.getElementById('formNext');
  const backButton = document.getElementById('formBack');
  const statusMessage = document.getElementById('applicationSubmitError');
  if (submitButton?.disabled) return;

  if (statusMessage) {
    statusMessage.textContent = '';
    statusMessage.style.display = 'none';
  }
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting…';
  }
  if (backButton) backButton.disabled = true;

  try {
    const response = await fetch(`${API_BASE_URL}/issuers/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify(applicationData)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !(data.success || data.id || data.application)) {
      throw new Error(data.error || 'The application could not be submitted.');
    }

    clearPendingApplicationDraft();
    const hidden = document.getElementById('contactEmail');
    if (hidden) hidden.value = email;
    if (currentUser) { currentUser.issuer_status = 'pending'; setStoredUser(currentUser); if (currentPage === 'home') renderRoleLandingHome(); }
    showSuccessMessage(email, data.notification?.emailSent !== false);
  } catch (error) {
    console.error('Error submitting application:', error);
    saveApplicationLocally(applicationData);
    if (statusMessage) {
      statusMessage.textContent = `Your application was not submitted and is not yet in the admin review queue. Your details are saved as a draft in this browser. ${error.message || 'Please check your connection and try again.'}`;
      statusMessage.style.display = 'flex';
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = applyStep === 3 ? 'Submit Application' : 'Continue →';
    }
    if (backButton) backButton.disabled = false;
  }
}

function saveApplicationLocally(applicationData) {
  const application = {
    id: `app-${Date.now()}`,
    ...applicationData,
    submittedAt: new Date().toISOString(),
    status: "pending"
  };

    // Save application draft locally but do not force a signup; show success state instead.
    try {
      localStorage.setItem('certicheck_pending_application_draft', JSON.stringify(applicationData));
    } catch (e) {
      const apps = loadPendingApplications();
      apps.push(application);
      savePendingApplications(apps);
    }
}

function loadPendingApplicationDraft() {
  try {
    const raw = localStorage.getItem('certicheck_pending_application_draft');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearPendingApplicationDraft() {
  try { localStorage.removeItem('certicheck_pending_application_draft'); } catch (e) {}
}

function showSuccessMessage(officialEmail, confirmationEmailSent = true) {
  navigate("apply");
  document.getElementById(`form-step-${applyStep}`)?.classList.remove("active");
  document.getElementById("form-step-success")?.classList.add("active");
  document.getElementById("formActions").style.display = "none";

  const msg = document.getElementById("successMsg");
  if (msg) {
    msg.innerHTML = `<div style="font-weight:800;font-size:18px;color:var(--purple-mid);">WAITING FOR REVIEW</div><div style="margin-top:10px;">${confirmationEmailSent ? 'We sent a confirmation email with next steps.' : 'Your application was saved, but its confirmation email could not be delivered. Our team will still review it.'}</div><div style="margin-top:16px;text-align:left;background:var(--bg-subtle);padding:14px;border-radius:8px;"><strong>Official contact:</strong> ${escapeCertificateMarkup(officialEmail)}</div>`;
  }

  // Mark all steps done
  document.querySelectorAll(".step").forEach(el => el.classList.add("done"));
}

function loadPendingApplications() {
  try {
    const raw = localStorage.getItem(PENDING_APPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function savePendingApplications(apps) {
  localStorage.setItem(PENDING_APPS_KEY, JSON.stringify(apps));
}

function loadVerifyHistory() {
  try {
    const raw = localStorage.getItem("certicheck_verify_history");
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function saveVerifyHistory(history) {
  localStorage.setItem("certicheck_verify_history", JSON.stringify(history));
}

/* ═══════════════════════════════════════════════
   RESOURCES — render cards
═══════════════════════════════════════════════ */
function renderResources() {
  const grid = document.getElementById("resourcesGrid");
  if (!grid || grid.dataset.rendered) return;
  grid.dataset.rendered = "1";

  grid.innerHTML = RESOURCES_DATA.map((r, i) => `
    <div class="resource-card" style="animation-delay:${i * 0.06}s">
      <div class="resource-card-top">
        <div class="resource-icon-wrap">${iconSvg(r.icon)}</div>
        <span class="resource-tag">${r.tag}</span>
      </div>
      <div class="resource-title">${r.href ? `<a href="${r.href}" style="color:inherit;text-decoration:none">${r.title}</a>` : r.title}</div>
      <div class="resource-desc">${r.desc}</div>
    </div>
  `).join("");
}

// Background polling for real-time updates
setInterval(() => {
  if (document.hidden) return;
  const token = getAuthToken();
  if (!token) return;

  if (currentPage === 'issuer' && document.getElementById('issuerFormWrap')?.style.display !== 'none') {
    // Poll issuer certificates silently
    fetch(`${API_BASE_URL}/certificates/my-issued`, {
      headers: { Authorization: `Bearer ${token}` }
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
    fetch(`${API_BASE_URL}/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` }
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

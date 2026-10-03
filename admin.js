"use strict";

const DEFAULT_API_BASE_URL = "https://certicheck-backend-8hu3.onrender.com";
const localApiOrigin = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? (["3000", "5000"].includes(window.location.port)
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname}:5000`)
  : null;
const API_BASE_URL = window.CERTICHECK_API_BASE_URL
  ? window.CERTICHECK_API_BASE_URL.replace(/\/api\/?$/, "")
  : localApiOrigin || DEFAULT_API_BASE_URL;
const apiFetch = (url, options = {}) => fetch(url, { ...options, credentials: "include" });

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

const ADMIN_SESSION_KEY = "certicheck_admin_logged_in";
const ADMIN_TOKEN_KEY = "certicheck_admin_token";
const ADMIN_USER_KEY = "certicheck_admin_user";
const ADMIN_AVATAR_KEY_PREFIX = 'certicheck_admin_avatar:';
// Reduced admin sections: keep only 'audit' and surface other items in audit view
const ADMIN_SECTIONS = [
  { id: "audit", label: "Audit log" },
];

let adminCurrentSection = "audit";
let adminReviewFilters = {
  query: '',
  status: 'all',
  sort: 'newest'
};
let adminDashboardRequest = null;

let adminState = {
  token: localStorage.getItem(ADMIN_TOKEN_KEY) || "",
  user: null,
  stats: null,
  pendingApps: [],
  approvedApps: [],
  dashboardWarning: "",
  rejectedApps: [],
  checks: [],
  revoked: [],
  auditLog: []
};

function isAdminLoggedIn() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1" || !!adminState.token;
}

function formatDateTime(value) {
  try {
    return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch (err) {
    return value || "—";
  }
}

function getMetadataValue(metadata, key, fallback = '—') {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  return source[key] ?? source[key.toLowerCase()] ?? source[key.replace(/_/g, '')] ?? fallback;
}

function getMediaSummary(metadata) {
  const media = metadata?.media || metadata?.uploadedMedia || metadata?.attachment || null;
  if (!media || typeof media !== 'object') {
    return { summary: 'No media attached', location: 'No upload recorded' };
  }
  const fileName = media.name || media.fileName || 'uploaded-file';
  const fileType = media.type || media.mimeType || 'unknown';
  const fileSize = media.size ? `${Math.max(1, Number(media.size) / 1024).toFixed(1)} KB` : 'unknown';
  const location = media.uploadLocation || media.storage || media.location || 'Embedded in metadata record';
  return { summary: `${fileName} (${fileType}, ${fileSize})`, location };
}

function downloadCerticheckCertificate(record) {
  const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const title = record?.certificateType || record?.certificate_type || metadata.documentType || 'Certicheck Certificate';
  const certificateId = record?.certificateId || record?.certificate_id || 'CERT-0000';
  const issuedBy = record?.issuerName || record?.issuer_name || metadata.issuerName || 'Certicheck Issuer';
  const issuedFor = record?.holderName || record?.holder_name || metadata.recipientFullName || metadata.recipientName || 'Certificate Recipient';
  const rows = Object.entries(metadata).filter(([key]) => !['media', 'dataUrl', 'imageData', 'documentType', 'generatedBy'].includes(key)).map(([key, value]) => {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());
    const display = typeof value === 'object' ? JSON.stringify(value) : String(value || '—');
    return `<div><span style="font-weight:700;">${label}:</span> ${display}</div>`;
  });

  const html = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; background: #f8fafc; padding: 30px; }
          .card { max-width: 1100px; margin: 0 auto; border-radius: 22px; border: 2px solid #d9d2fa; background: #ffffff; padding: 38px; position: relative; }
          .crest { position: absolute; right: 32px; top: 28px; width: 90px; height: 90px; border-radius: 50%; border: 2px solid #7c3aed; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 36px; color: #7c3aed; }
          .title { text-align: center; font-size: 32px; font-weight: 800; color: #111827; letter-spacing: 0.03em; margin-bottom: 18px; }
          .sub { text-align: center; color: #4b5563; margin-bottom: 24px; }
          .meta { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 14px; margin-top: 18px; font-size: 14px; color: #374151; }
          .label { font-weight: 700; color: #111827; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="crest">C</div>
          <div class="title">${title}</div>
          <div class="sub">Certificate ID: ${certificateId}</div>
          <div class="meta">
            <div><span class="label">Issued by:</span> ${issuedBy}</div>
            <div><span class="label">Issued to:</span> ${issuedFor}</div>
            <div><span class="label">Status:</span> Valid</div>
            <div><span class="label">Generated on:</span> ${new Date().toLocaleDateString()}</div>
            ${rows.join('')}
          </div>
        </div>
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${String(title).replace(/\s+/g, '-').toLowerCase()}-${certificateId}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

window.downloadCerticheckCertificate = downloadCerticheckCertificate;

function showAdminError(message) {
  const errorBox = document.getElementById("adminLoginError");
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.style.display = "block";
}

function clearAdminError() {
  const errorBox = document.getElementById("adminLoginError");
  if (errorBox) {
    errorBox.textContent = "";
    errorBox.style.display = "none";
  }
}

function getAuthHeaders(body = null) {
  const headers = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (adminState.token) {
    headers.Authorization = `Bearer ${adminState.token}`;
  }
  return headers;
}

async function requestJson(path, options = {}) {
  const response = await apiFetch(`${API_BASE_URL}/api${path}`, {
    ...options,
    headers: {
      ...getAuthHeaders(options.body),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = response.status;
    if (response.status === 401 && adminState.token && path !== "/auth/admin/login") {
      setAdminState(false);
      showAdminError('Your admin session has expired. Please sign in again.');
    }
    throw error;
  }
  return data;
}

function updateAdminCredentials(data) {
  if (data.token) {
    adminState.token = data.token;
    localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
  }
  adminState.user = { ...adminState.user, ...data.user };
  localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(adminState.user));
  setAdminState(true, adminState.user);
}

function getApplicationList(data) {
  if (Array.isArray(data?.applications)) return data.applications;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function getAdminDisplayName(user) {
  if (user?.name) return user.name;
  const firstName = user?.firstName || user?.first_name || '';
  const lastName = user?.lastName || user?.last_name || '';
  return [firstName, lastName].filter(Boolean).join(' ') || user?.email || 'Admin';
}

function escapeAdminHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function getAdminHeaderLabel(user) {
  return `Signed in as ${getAdminDisplayName(user)} (Admin)`;
}

function getAdminAvatarKey(user = adminState.user) {
  const accountId = user?.id || user?.email || 'current';
  return `${ADMIN_AVATAR_KEY_PREFIX}${String(accountId).trim().toLowerCase()}`;
}

function getAdminAvatarSource(photo) {
  return typeof photo === 'string' && photo.startsWith('/api/')
    ? `${API_BASE_URL}${photo}`
    : photo;
}

function updateAdminAvatar(user = adminState.user) {
  const avatar = document.getElementById('adminAvatarButton');
  if (!avatar) return;

  let photo = user?.profilePicture || user?.profile_picture_url || null;
  try {
    photo = photo || localStorage.getItem(getAdminAvatarKey(user));
  } catch (err) {}

  if (photo) {
    const image = document.createElement('img');
    image.src = getAdminAvatarSource(photo);
    image.alt = '';
    avatar.replaceChildren(image);
    avatar.classList.add('has-photo');
    return;
  }

  const nameParts = getAdminDisplayName(user).trim().split(/\s+/).filter(Boolean);
  avatar.textContent = `${nameParts[0]?.[0] || 'A'}${nameParts.length > 1 ? nameParts[nameParts.length - 1][0] : ''}`.toUpperCase();
  avatar.classList.remove('has-photo');
}

function setAdminState(enabled, user = null) {
  const loginCard = document.getElementById("adminLoginCard");
  const dashboard = document.getElementById("adminDashboard");
  const welcome = document.getElementById("adminWelcome");
  const signedInUser = document.getElementById('adminSignedInUser');
  const profileMenu = document.getElementById('adminProfileMenu');
  const statsSection = document.querySelector('.admin-stats');
  const mainGrid = document.querySelector('.admin-main-grid');

  if (signedInUser) {
    signedInUser.style.display = enabled ? 'flex' : 'none';
  }
  if (profileMenu) {
    profileMenu.style.display = 'none';
  }

  if (enabled) {
    sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
    if (loginCard) loginCard.style.display = "none";
    if (dashboard) dashboard.style.display = "flex";
    if (statsSection) statsSection.style.display = 'block';
    if (mainGrid) mainGrid.style.display = 'grid';
    clearAdminError();
    if (welcome) {
      welcome.textContent = getAdminDisplayName(user);
    }
    const navAdminName = document.getElementById('navAdminName');
    const navAdminEmail = document.getElementById('navAdminEmail');
    const menuName = document.getElementById('menuName');
    const menuEmail = document.getElementById('menuEmail');
    const displayName = getAdminDisplayName(user);
    if (navAdminName) navAdminName.textContent = getAdminHeaderLabel(user);
    if (menuName) menuName.textContent = displayName;
    if (navAdminEmail) navAdminEmail.textContent = user?.email || '';
    if (menuEmail) menuEmail.textContent = user?.email || '';
    const profileName = document.getElementById('adminProfileName');
    const profileEmail = document.getElementById('adminProfileEmail');
    const profileRole = document.getElementById('adminProfileRole');
    const avatar = document.querySelector('#adminProfile div[style*="width:72px"]');
    if (profileName) profileName.textContent = displayName;
    if (profileEmail) profileEmail.textContent = user?.email || '';
    if (profileRole) profileRole.innerHTML = `<span style="background:rgba(124,58,237,0.08);color:var(--purple-mid);padding:6px 10px;border-radius:999px;font-weight:700;font-size:12px;">${(user?.userType || user?.user_type || 'admin').toUpperCase()}</span>`;
    if (avatar) avatar.textContent = getAdminDisplayName(user).slice(0, 1).toUpperCase();
    updateAdminAvatar(user);
    loadAdminDashboard();
    return;
  }

  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
  adminState.token = "";
  adminState.user = null;
  if (loginCard) loginCard.style.display = "block";
  if (dashboard) dashboard.style.display = "none";
  if (statsSection) statsSection.style.display = 'none';
  if (mainGrid) mainGrid.style.display = 'none';
  clearAdminError();
}

function setAdminSection(section) {
  if (!ADMIN_SECTIONS.some(item => item.id === section)) return;
  adminCurrentSection = section;
  document.querySelectorAll(".admin-tab-button").forEach(button => {
    button.classList.toggle("active", button.dataset.section === section);
  });
  renderAdminDashboard();
}

// Apply audit filter inside renderAdminDashboard

function showAdminToast(message, tone = 'info') {
  const stack = document.getElementById('adminToastStack');
  if (!stack) return;

  const toast = document.createElement('div');
  const bg = tone === 'success' ? '#1f9d6b' : tone === 'danger' ? '#d34f4f' : '#3b82f6';
  toast.style.background = bg;
  toast.style.color = '#fff';
  toast.style.borderRadius = '12px';
  toast.style.padding = '10px 12px';
  toast.style.fontSize = '13px';
  toast.style.fontWeight = '700';
  toast.style.boxShadow = '0 12px 30px rgba(15, 23, 42, 0.15)';
  toast.style.maxWidth = '320px';
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function getAdminReviewItems() {
  const reviewItems = [];

  (adminState.pendingApps || []).forEach(app => {
    reviewItems.push({
      id: app.id,
      status: 'pending',
      action_type: 'Pending Application',
      timestamp: app.submitted_at || app.created_at || new Date().toISOString(),
      organization_name: app.organization_name || app.orgName || 'Organisation',
      contact_email: app.contact_email || app.contactEmail || app.email || '',
      contact_name: app.contact_name || app.contactName || '',
      orgType: app.organization_type || app.orgType || '',
      data: app
    });
  });

  (adminState.rejectedApps || []).forEach(app => {
    reviewItems.push({
      id: app.id,
      status: 'rejected',
      action_type: 'Rejected Application',
      timestamp: app.rejected_at || app.updated_at || app.submitted_at || new Date().toISOString(),
      organization_name: app.organization_name || app.orgName || 'Organisation',
      contact_email: app.contact_email || app.contactEmail || app.email || '',
      contact_name: app.contact_name || app.contactName || '',
      orgType: app.organization_type || app.orgType || '',
      data: app
    });
  });

  (adminState.approvedApps || []).forEach(app => {
    reviewItems.push({
      id: app.id,
      status: 'approved',
      action_type: 'Approved Application',
      timestamp: app.approved_at || app.updated_at || app.submitted_at || new Date().toISOString(),
      organization_name: app.organization_name || app.orgName || 'Organisation',
      contact_email: app.contact_email || app.contactEmail || app.email || '',
      contact_name: app.contact_name || app.contactName || '',
      orgType: app.organization_type || app.orgType || '',
      data: app
    });
  });

  (adminState.checks || []).forEach(entry => {
    reviewItems.push({
      id: `check-${entry.id || Math.random().toString(16).slice(2)}`,
      status: 'checks',
      action_type: 'Certificate Check',
      timestamp: entry.checked_at || entry.created_at || new Date().toISOString(),
      organization_name: entry.certificate_id || entry.id || 'Certificate',
      contact_email: entry.verification_message || 'Verification check',
      contact_name: entry.verification_status || 'Checked',
      orgType: entry.certificate_type || 'Verification',
      data: entry
    });
  });

  (adminState.revoked || []).forEach(entry => {
    reviewItems.push({
      id: `revoked-${entry.id || Math.random().toString(16).slice(2)}`,
      status: 'revoked',
      action_type: 'Revoked Certificate',
      timestamp: entry.revoked_at || entry.updated_at || new Date().toISOString(),
      organization_name: entry.certificate_id || 'Certificate',
      contact_email: entry.revocation_reason || 'Revoked by admin',
      contact_name: entry.verification_status || 'Revoked',
      orgType: 'Certificate',
      data: entry
    });
  });

  const query = adminReviewFilters.query.trim().toLowerCase();
  const filtered = reviewItems.filter(item => {
    const matchesStatus = adminReviewFilters.status === 'all' || item.status === adminReviewFilters.status;
    const matchesQuery = !query || [
      item.organization_name,
      item.contact_email,
      item.contact_name,
      item.orgType,
      item.action_type
    ].join(' ').toLowerCase().includes(query);
    return matchesStatus && matchesQuery;
  });

  filtered.sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    return adminReviewFilters.sort === 'oldest' ? aTime - bTime : bTime - aTime;
  });

  return filtered;
}

function openAdminDetail(item) {
  const drawer = document.getElementById('adminDetailDrawer');
  const content = document.getElementById('adminDetailContent');
  if (!drawer || !content) return;

  const app = item.data || item;
  const email = app.contact_email || app.contactEmail || app.email || '—';
  const org = app.organization_name || app.orgName || '—';
  const person = app.contact_name || app.contactName || '—';
  const orgType = app.organization_type || app.orgType || '—';
  const website = app.organization_website || app.website || '—';
  const wallet = app.wallet_address || app.wallet || '—';
  const useCase = app.use_case || app.useCase || '—';
  const volume = app.certificate_volume || app.volume || '—';
  const role = app.contact_role || app.contactRole || '—';
  const status = app.status || item.status || '—';
  const submittedAt = app.submitted_at || app.created_at || item.timestamp || '—';
  const reviewedAt = app.reviewed_at || app.updated_at || null;
  const processedByName = app.processed_by_admin_name || app.processedByAdminName || null;
  const processedAt = app.processed_at || app.processedAt || reviewedAt;
  const processedByPicture = app.processed_by_admin_profile_picture_url || app.processedByAdminProfilePictureUrl || null;
  const actionLabel = String(app.action_type || status).toLowerCase();
  const capitalizedActionLabel = actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1);
  const issuerId = app.issuer_id || app.issuerId || '—';
  const applicantId = app.id || item.id || '—';

  const metadata = app.metadata || app.data?.metadata || {};
  const issuanceType = app.certificate_type || app.certificateType || metadata.documentType || 'Certificate';
  const issuerName = app.issuer_name || app.issuerName || metadata.issuerName || app.contact_name || '—';
  const mediaSummary = getMediaSummary(metadata);
  const certificateId = app.certificate_id || app.certificateId || metadata.certificateId || app.id || null;

  const actionButtons = item.status === 'pending'
    ? `
      <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
        <button class="btn-success" data-detail-action="approve" data-id="${item.id}">Approve</button>
        <button class="btn-danger" data-detail-action="reject" data-id="${item.id}">Reject</button>
      </div>
    `
    : `
      <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
        ${certificateId ? `<button class="btn-ghost" type="button" onclick="downloadCerticheckCertificate(${JSON.stringify({ certificateId, certificateType: issuanceType, issuerName, holderName: person, metadata }).replace(/"/g, '&quot;')})">Download certificate</button>` : ''}
      </div>
    `;

  const metadataRows = [
    ['Application ID', applicantId],
    ['Status', status],
    ['Organization', org],
    ['Organization type', orgType],
    ['Website', website],
    ['Contact name', person],
    ['Contact email', email],
    ['Contact role', role],
    ['Wallet', wallet],
    ['Use case', useCase],
    ['Expected volume', volume],
    ['Issuer ID', issuerId],
    ['Issued by', issuerName],
    ['Certificate type', issuanceType],
    ['Media upload', mediaSummary.summary],
    ['Media location', mediaSummary.location],
    ['Submitted', formatDateTime(submittedAt)],
    ['Reviewed', reviewedAt ? formatDateTime(reviewedAt) : 'Not reviewed yet']
  ].map(([label, value]) => `
    <div style="display:grid;grid-template-columns:180px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-light);">
      <div style="font-weight:700;color:var(--text-secondary);">${label}</div>
      <div style="color:var(--text-primary);word-break:break-word;">${value}</div>
    </div>
  `).join('');

  const actionHistory = processedByName ? `
    <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-subtle);">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:var(--text-secondary);text-transform:uppercase;margin-bottom:8px;">Action history</div>
      <div style="display:flex;align-items:center;gap:10px">
        ${processedByPicture ? `<img src="${escapeAdminHtml(getAdminAvatarSource(processedByPicture))}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover">` : ''}
        <span>${escapeAdminHtml(capitalizedActionLabel)} by <strong>${escapeAdminHtml(processedByName)}</strong> on ${escapeAdminHtml(formatDateTime(processedAt))}</span>
      </div>
    </div>
  ` : '';

  const metadataSummary = Object.keys(metadata || {}).length ? `
    <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-subtle);">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:var(--text-secondary);text-transform:uppercase;margin-bottom:8px;">Certificate metadata</div>
      ${Object.entries(metadata).filter(([k]) => !['media', 'dataUrl', 'imageData'].includes(k)).slice(0, 8).map(([key, value]) => `
        <div style="display:grid;grid-template-columns:170px 1fr;gap:8px;padding:5px 0;border-bottom:1px solid rgba(148,163,184,0.14);">
          <div style="font-weight:700;color:var(--text-secondary);">${key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</div>
          <div style="word-break:break-word;">${typeof value === 'object' ? JSON.stringify(value) : String(value || '—')}</div>
        </div>
      `).join('')}
    </div>
  ` : '';

  content.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:var(--text-secondary);text-transform:uppercase;">${item.action_type}</div>
        <div style="font-size:28px;font-weight:800;margin-top:6px;color:var(--text-primary);">${org}</div>
      </div>

      <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-subtle);">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:var(--text-secondary);text-transform:uppercase;margin-bottom:8px;">Applicant</div>
        <div><strong>Applicant:</strong> ${person}</div>
        <div><strong>Email:</strong> ${email}</div>
        <div><strong>Role:</strong> ${role}</div>
        <div><strong>Website:</strong> ${website}</div>
        <div><strong>Wallet:</strong> ${wallet}</div>
      </div>

      <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-subtle);">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:var(--text-secondary);text-transform:uppercase;margin-bottom:8px;">Issuance details</div>
        ${metadataRows}
      </div>

      ${actionHistory}
      ${metadataSummary}

      ${actionButtons}
    </div>
  `;

  drawer.style.display = 'block';

  content.querySelectorAll('[data-detail-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.detailAction;
      const succeeded = await handleApplicationAction(action, btn.dataset.id, btn);
      if (succeeded) drawer.style.display = 'none';
    });
  });
}

function bindAdminReviewControls() {
  const searchInput = document.getElementById('adminReviewSearch');
  const statusSelect = document.getElementById('adminReviewStatus');
  const sortSelect = document.getElementById('adminReviewSort');
  const selectAll = document.getElementById('adminSelectAll');
  const bulkApprove = document.getElementById('adminBulkApprove');
  const bulkReject = document.getElementById('adminBulkReject');
  const drawerClose = document.getElementById('adminDrawerClose');

  searchInput?.addEventListener('input', (event) => {
    adminReviewFilters.query = event.target.value;
    renderAdminDashboard();
  });

  statusSelect?.addEventListener('change', (event) => {
    adminReviewFilters.status = event.target.value || 'all';
    renderAdminDashboard();
  });

  sortSelect?.addEventListener('change', (event) => {
    adminReviewFilters.sort = event.target.value || 'newest';
    renderAdminDashboard();
  });

  selectAll?.addEventListener('change', (event) => {
    const checked = event.target.checked;
    document.querySelectorAll('.admin-row-select').forEach(input => {
      input.checked = checked;
    });
  });

  bulkApprove?.addEventListener('click', () => handleBulkAction('approve', bulkApprove));
  bulkReject?.addEventListener('click', () => handleBulkAction('reject', bulkReject));
  drawerClose?.addEventListener('click', () => {
    const drawer = document.getElementById('adminDetailDrawer');
    if (drawer) drawer.style.display = 'none';
  });
}

function applyApplicationDecisionLocally(action, id, application) {
  const applicationId = String(id);
  const pendingIndex = adminState.pendingApps.findIndex(item => String(item.id) === applicationId);
  if (pendingIndex === -1) return false;

  const [pendingApplication] = adminState.pendingApps.splice(pendingIndex, 1);
  const targetKey = action === 'approve' ? 'approvedApps' : 'rejectedApps';
  const status = action === 'approve' ? 'approved' : 'rejected';
  const targetAlreadyContainsApplication = adminState[targetKey].some(item => String(item.id) === applicationId);
  const updatedApplication = { ...pendingApplication, ...application, status };
  adminState[targetKey] = [
    updatedApplication,
    ...adminState[targetKey].filter(item => String(item.id) !== applicationId)
  ];
  adminState.approvedApps = adminState.approvedApps.filter(item => String(item.id) !== applicationId || targetKey === 'approvedApps');
  adminState.rejectedApps = adminState.rejectedApps.filter(item => String(item.id) !== applicationId || targetKey === 'rejectedApps');

  if (adminState.stats) {
    adminState.stats.pendingApplications = Math.max(0, Number(adminState.stats.pendingApplications || 0) - 1);
    if (action === 'approve' && !targetAlreadyContainsApplication) {
      adminState.stats.approvedApplications = Number(adminState.stats.approvedApplications || 0) + 1;
    }
  }

  renderAdminDashboard();
  return true;
}

async function handleBulkAction(action, button) {
  const selected = [...document.querySelectorAll('.admin-row-select:checked')].map(input => input.dataset.id).filter(Boolean);
  if (!selected.length) {
    showAdminToast('Select at least one application to continue.', 'danger');
    return;
  }

  await withButtonLoading(button, async () => {
    const decisions = await Promise.allSettled(selected.map(async id => {
      const result = await requestJson(`/applications/${id}/${action}`, { method: 'PUT' });
      if (result.success !== true) throw new Error(result.error || 'The application update was not confirmed.');
      return { id, application: result.application };
    }));
    const successful = decisions.flatMap(decision => decision.status === 'fulfilled' ? [decision.value] : []);
    const failed = decisions.flatMap(decision => decision.status === 'rejected' ? [decision.reason] : []);

    successful.forEach(({ id, application }) => applyApplicationDecisionLocally(action, id, application));
    if (successful.length) { renderAdminDashboard(); void loadAdminDashboard(); }

    if (failed.length) {
      const summary = `${successful.length} of ${selected.length} applications ${action === 'approve' ? 'approved' : 'rejected'}. ${failed.length} failed: ${failed[0].message || 'Request failed.'}`;
      showAdminToast(summary, 'danger');
    } else {
      const actionMessage = `${selected.length} application${selected.length > 1 ? 's were' : ' was'} ${action === 'approve' ? 'approved' : 'rejected'}.`;
      showAdminToast(actionMessage, 'success');
    }
  }, `${action === 'approve' ? 'Approving' : 'Rejecting'} ${selected.length}...`);
}

function renderAdminDashboard() {
  const list = document.getElementById("adminList");
  const summary = document.getElementById("adminSummary");
  const statsGrid = document.getElementById("adminStatsGrid");
  if (!list || !summary) return;

  if (statsGrid) {
    const pendingCount = adminState.pendingApps?.length ?? adminState.stats?.pendingApplications ?? 0;
    const approvedCount = adminState.approvedApps?.length ?? adminState.stats?.approvedApplications ?? 0;
    const rejectedCount = adminState.rejectedApps?.length ?? 0;
    const revokedCount = adminState.revoked?.length ?? adminState.stats?.revokedCertificates ?? 0;
    const checksCount = adminState.checks?.length ?? adminState.stats?.totalVerifications ?? 0;

    statsGrid.innerHTML = `
      <div class="resource-card" style="padding:18px 20px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-secondary);">Pending</div>
        <div style="font-size:28px;font-weight:800;margin-top:6px;">${pendingCount}</div>
      </div>
      <div class="resource-card" style="padding:18px 20px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-secondary);">Approved</div>
        <div style="font-size:28px;font-weight:800;margin-top:6px;">${approvedCount}</div>
      </div>
      <div class="resource-card" style="padding:18px 20px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-secondary);">Rejected</div>
        <div style="font-size:28px;font-weight:800;margin-top:6px;">${rejectedCount}</div>
      </div>
      <div class="resource-card" style="padding:18px 20px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-secondary);">Checks</div>
        <div style="font-size:28px;font-weight:800;margin-top:6px;">${checksCount}</div>
      </div>
    `;
  }

  const renderEmpty = message => `
    <div style="padding:24px;border-radius:20px;border:1px solid var(--border);background:var(--bg-subtle);color:var(--text-secondary);">${message}</div>
  `;

  const auditLog = (adminState.auditLog || []).slice();
  (adminState.pendingApps || []).forEach(app => {
    const email = app.contact_email || app.contactEmail || app.email || '—';
    auditLog.unshift({
      action_type: 'Pending Application',
      timestamp: app.submitted_at || app.created_at || new Date().toISOString(),
      status: 'pending',
      error_message: `${app.organization_name || app.orgName || 'Organisation'} — ${email}`,
      contact_email: email,
      organization_name: app.organization_name || app.orgName || 'Organisation'
    });
  });
  (adminState.rejectedApps || []).forEach(app => {
    const email = app.contact_email || app.contactEmail || app.email || '—';
    auditLog.unshift({
      action_type: 'Rejected Application',
      timestamp: app.rejected_at || app.updated_at || new Date().toISOString(),
      status: 'rejected',
      error_message: `${app.organization_name || app.orgName || 'Organisation'} — ${email}`,
      contact_email: email,
      organization_name: app.organization_name || app.orgName || 'Organisation'
    });
  });

  summary.textContent = `${auditLog.length} audit entries`;

  const reviewItems = getAdminReviewItems();
  const toolbar = `
    <div class="admin-review-toolbar" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:18px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--bg-subtle);">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex:1;min-width:220px;">
        <input id="adminReviewSearch" value="${adminReviewFilters.query.replace(/"/g, '&quot;')}" placeholder="Search organisation or email" style="flex:1;min-width:180px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);" />
        <select id="adminReviewStatus" style="padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);">
          <option value="all" ${adminReviewFilters.status === 'all' ? 'selected' : ''}>All statuses</option>
          <option value="pending" ${adminReviewFilters.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="approved" ${adminReviewFilters.status === 'approved' ? 'selected' : ''}>Approved</option>
          <option value="rejected" ${adminReviewFilters.status === 'rejected' ? 'selected' : ''}>Rejected</option>
          <option value="revoked" ${adminReviewFilters.status === 'revoked' ? 'selected' : ''}>Revoked</option>
          <option value="checks" ${adminReviewFilters.status === 'checks' ? 'selected' : ''}>Checks</option>
        </select>
        <select id="adminReviewSort" style="padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);">
          <option value="newest" ${adminReviewFilters.sort === 'newest' ? 'selected' : ''}>Newest first</option>
          <option value="oldest" ${adminReviewFilters.sort === 'oldest' ? 'selected' : ''}>Oldest first</option>
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;color:var(--text-secondary);font-size:13px;">
          <input id="adminSelectAll" type="checkbox" />
          Select all
        </label>
        <button id="adminBulkApprove" class="btn-success" type="button">Approve selected</button>
        <button id="adminBulkReject" class="btn-danger" type="button">Reject selected</button>
      </div>
    </div>
  `;
  const dashboardWarning = adminState.dashboardWarning
    ? `<div class="alert alert-danger" role="alert" style="margin-bottom:16px;">${escapeAdminHtml(adminState.dashboardWarning)}</div>`
    : '';

  if (!reviewItems.length) {
    list.innerHTML = dashboardWarning + toolbar + `<div class="admin-activity-scroll" role="region" aria-label="Admin activity list" tabindex="0">${renderEmpty("No matching applications found.")}</div>`;
    bindAdminReviewControls();
    return;
  }

  const activityMarkup = reviewItems.map(item => {
    const applicantEmail = item.contact_email || '';
    const applicantName = item.organization_name || 'Applicant';
    return `
      <div class="admin-list-card" data-review-item="${item.id}" style="cursor:pointer;">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">
          <div style="display:flex;gap:10px;align-items:flex-start;flex:1;min-width:0;">
            <input class="admin-row-select" type="checkbox" data-id="${item.id}" style="margin-top:4px;" />
            <div style="flex:1;min-width:0;">
              <div style="font-size:15px;font-weight:800;color:var(--text-primary);">${item.action_type}</div>
              <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">${formatDateTime(item.timestamp)}</div>
            </div>
          </div>
          <div class="admin-status-pill ${item.status === 'rejected' ? 'danger' : item.status === 'revoked' ? 'danger' : item.status === 'pending' ? 'warning' : item.status === 'approved' ? 'success' : item.status === 'checks' ? 'info' : 'info'}">${item.status}</div>
        </div>

        <div class="admin-list-card-meta" style="margin-top:12px;color:var(--text-secondary);font-size:13px;line-height:1.7;">
          <div><strong>Organization:</strong> ${applicantName}</div>
          ${applicantEmail ? `<div><strong>Gmail / email:</strong> ${applicantEmail}</div>` : ''}
        </div>

        <div class="admin-list-card-actions">
          <button class="btn-ghost" type="button" data-open-detail="${item.id}">View details</button>
          ${item.status === 'pending' ? `<button class="btn-success" type="button" data-action="approve" data-id="${item.id}">Approve</button><button class="btn-danger" type="button" data-action="reject" data-id="${item.id}">Reject</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  list.innerHTML = dashboardWarning + toolbar + `<div id="adminActivityItems" class="admin-activity-scroll" role="region" aria-label="Admin activity list" tabindex="0">${activityMarkup}</div>`;

  bindAdminReviewControls();

  list.querySelectorAll('[data-open-detail]').forEach(button => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const itemId = button.dataset.openDetail;
      const item = reviewItems.find(entry => String(entry.id) === itemId);
      if (item) openAdminDetail(item);
      else showAdminToast('This activity is no longer available. Refresh the dashboard and try again.', 'danger');
    });
  });

  list.querySelectorAll('button[data-action]').forEach(button => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = button.dataset.action;
      const id = button.dataset.id;
      if (!id) return;
      if (action === 'approve' || action === 'reject') {
        await handleApplicationAction(action, id, button);
      }
    });
  });
}

async function handleCreateAccountForApplication(id, button) {
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Linking account...';
  }
  try {
    const data = await requestJson(`/applications/${id}/create-account`, { method: 'POST' });
    if (data.success && data.credentials) {
      alert(`Issuer account created:\nEmail: ${data.credentials.email}\nPassword: ${data.credentials.password}`);
    } else if (data.success && data.user) {
      alert(`Existing account linked for ${data.user.email}`);
    } else {
      throw new Error('The account request did not return a result.');
    }
    await loadAdminDashboard();
    return true;
  } catch (err) {
    if (err.status === 401) return false;
    showAdminToast(`Could not link the issuer account: ${err.message}`, 'danger');
    return false;
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function handleApplicationAction(action, id, button) {
  return withButtonLoading(button, async () => {
    try {
      const endpoint = action === "approve" ? `/applications/${id}/approve` : `/applications/${id}/reject`;
      const result = await requestJson(endpoint, { method: "PUT" });
      if (result.success !== true) throw new Error(result.error || 'The application update was not confirmed.');
      applyApplicationDecisionLocally(action, id, result.application);
      renderAdminDashboard();
      const actionMessage = result.warning ||
        (action === 'approve' ? 'Application approved and moved to approved queue.' : 'Application rejected and moved to rejected queue.');
      showAdminToast(actionMessage, (result.warning || action === 'reject') ? 'danger' : 'success');
      void loadAdminDashboard();
      return true;
    } catch (err) {
      if (err.status === 401) return false;
      showAdminToast(`Could not ${action} the application: ${err.message}`, 'danger');
      return false;
    }
  }, action === 'approve' ? 'Approving...' : 'Rejecting...');
}

async function handleRevokeAction(id, button) {
  return withButtonLoading(button, async () => {
    try {
      const result = await requestJson(`/verify/${id}/revoke`, { method: "PUT" });
      adminState.checks = adminState.checks.filter(entry => String(entry.id) !== String(id));
      if (result.entry) {
        adminState.revoked = [
          result.entry,
          ...adminState.revoked.filter(entry => String(entry.id) !== String(id))
        ];
      }
      if (adminState.stats) {
        adminState.stats.totalVerifications = Math.max(0, Number(adminState.stats.totalVerifications || 0) - 1);
        adminState.stats.revokedCertificates = Number(adminState.stats.revokedCertificates || 0) + 1;
      }
      renderAdminDashboard();
      showAdminToast('Certificate revoked.', 'success');
      void loadAdminDashboard();
      return true;
    } catch (err) {
      if (err.status === 401) return false;
      showAdminToast(`Could not revoke the certificate: ${err.message}`, 'danger');
      return false;
    }
  }, 'Revoking...');
}

async function loadAdminDashboard() {
  if (adminDashboardRequest) return adminDashboardRequest;

  adminDashboardRequest = loadAdminDashboardData();
  try {
    await adminDashboardRequest;
  } finally {
    adminDashboardRequest = null;
  }
}

async function loadAdminDashboardData() {
  try {
    const dashboardData = await requestJson("/admin/dashboard");
    let applicationLists = {
      pending: getApplicationList({
        applications: dashboardData.pendingApplications ?? dashboardData.pendingApps ?? dashboardData.pending
      }),
      approved: getApplicationList({
        applications: dashboardData.approvedApplications ?? dashboardData.approvedApps ?? dashboardData.approved
      }),
      rejected: getApplicationList({
        applications: dashboardData.rejectedApplications ?? dashboardData.rejectedApps ?? dashboardData.rejected
      })
    };
    let dashboardWarning = "";

    const applicationListMissing = !Array.isArray(dashboardData.pendingApplications) ||
      !Array.isArray(dashboardData.approvedApplications) ||
      !Array.isArray(dashboardData.rejectedApplications);
    const applicationListTruncated = [
      ['pending', dashboardData.stats?.pendingApplications],
      ['approved', dashboardData.stats?.approvedApplications]
    ].some(([status, count]) => Number(count) > applicationLists[status].length);

    if (applicationListMissing || applicationListTruncated) {
      try {
        const applicationsData = await requestJson("/applications?limit=200&offset=0");
        const applications = getApplicationList(applicationsData);
        if (applications.length) {
          applicationLists = {
            pending: applications.filter(app => app.status === "pending"),
            approved: applications.filter(app => app.status === "approved"),
            rejected: applications.filter(app => app.status === "rejected")
          };
        } else if (Object.values(applicationLists).some(apps => apps.length)) {
          dashboardWarning = "The applications list endpoint returned no records; showing the dashboard's available application data.";
        }
      } catch (err) {
        dashboardWarning = `Could not refresh the application list: ${err.message}`;
      }
    }

    adminState.stats = dashboardData.stats || adminState.stats || null;
    adminState.dashboardWarning = dashboardWarning;
    adminState.pendingApps = applicationLists.pending;
    adminState.rejectedApps = applicationLists.rejected;
    adminState.approvedApps = applicationLists.approved;
    adminState.checks = Array.isArray(dashboardData.history) ? dashboardData.history : [];
    adminState.revoked = Array.isArray(dashboardData.revoked) ? dashboardData.revoked : [];
    adminState.auditLog = Array.isArray(dashboardData.auditLog) ? dashboardData.auditLog : [];

    requestJson("/admin/access-log", {
      method: "POST",
      body: JSON.stringify({ section: adminCurrentSection, method: "dashboard" })
    }).catch(() => {});

    renderAdminDashboard();
  } catch (err) {
    if (err.status === 401) {
      return;
    }
    adminState.dashboardWarning = `Dashboard data could not be loaded: ${err.message}`;
    renderAdminDashboard();
    showAdminToast(`Dashboard data could not be loaded: ${err.message}`, 'danger');
  }
}

async function loginAdmin(event) {
  event.preventDefault();
  const emailInput = document.getElementById("adminEmail");
  const passwordInput = document.getElementById("adminPassword");
  const email = emailInput?.value?.trim() || "";
  const password = passwordInput?.value || "";

  if (!email || !password) {
    showAdminError("Enter both your admin email and password.");
    return;
  }

  const loginButton = event.submitter || event.currentTarget.querySelector('[type="submit"]');
  await withButtonLoading(loginButton, async () => {
    try {
      const data = await requestJson("/auth/admin/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      if ((data.user?.userType || data.user?.user_type) !== "admin") {
        throw new Error("This account is not an admin account.");
      }

      adminState.token = data.token;
      adminState.user = data.user;
      // store admin token separately from regular user token
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
      setAdminState(true, data.user);
    } catch (err) {
      // If backend is unreachable or login fails, provide clearer feedback.
      if (err.message && err.message.toLowerCase().includes('failed to fetch')) {
        showAdminError('Unable to reach backend API. Ensure the backend is running at the expected API URL.');
      } else {
        showAdminError(err.message || 'Incorrect email or password');
      }
    }
  }, 'Signing in...');
}

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("adminLoginForm");
  const logoutBtn = document.getElementById("adminLogoutBtn");
  const returnBtn = document.getElementById("adminReturnBtn");

  loginForm?.addEventListener("submit", loginAdmin);
  // Wire logout button in navbar/menu
  logoutBtn?.addEventListener("click", () => setAdminState(false));
  returnBtn?.addEventListener("click", () => window.location.href = "index.html");

  const signOutButtons = [
    document.getElementById('menuSignOut'),
    logoutBtn
  ].filter(Boolean);
  signOutButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (window.signOutFirebaseUser) {
        window.signOutFirebaseUser().catch((error) => console.warn('Firebase admin sign-out failed:', error.message || error));
      }
      setAdminState(false);
    });
  });

  const storedUser = localStorage.getItem(ADMIN_USER_KEY);
  if (storedUser) {
    adminState.user = JSON.parse(storedUser);
  }

  if (isAdminLoggedIn()) {
    setAdminState(true, adminState.user);
  }
  // show sign out in navbar if logged in
  if (logoutBtn && isAdminLoggedIn()) logoutBtn.style.display = 'inline-block';
  // navbar profile menu
  const profileToggle = document.getElementById('adminProfileToggle');
  const profileMenu = document.getElementById('adminProfileMenu');
  const avatarButton = document.getElementById('adminAvatarButton');
  const avatarInput = document.getElementById('adminAvatarInput');
  const avatarMenu = document.getElementById('adminAvatarMenu');
  const avatarDialog = document.getElementById('adminAvatarDialog');
  const avatarPreview = document.getElementById('adminAvatarPreview');
  const menuSignOut = document.getElementById('menuSignOut');
  const navAdminName = document.getElementById('navAdminName');
  const navAdminEmail = document.getElementById('navAdminEmail');
  const menuName = document.getElementById('menuName');
  const menuEmail = document.getElementById('menuEmail');
  const profileSettingsDialog = document.getElementById('adminProfileSettingsDialog');
  const profileSettingsForm = document.getElementById('adminProfileSettingsForm');
  const passwordChangeForm = document.getElementById('adminPasswordChangeForm');

  if (profileToggle && profileMenu) {
    profileToggle.addEventListener('click', (event) => {
      if (event.target.closest('#adminAvatarButton')) {
        event.preventDefault();
        profileMenu.style.display = 'none';
        const photo = adminState.user?.profilePicture || adminState.user?.profile_picture_url ||
          localStorage.getItem(getAdminAvatarKey());
        if (!photo) {
          avatarInput?.click();
          return;
        }
        if (avatarMenu) avatarMenu.style.display = avatarMenu.style.display === 'grid' ? 'none' : 'grid';
        return;
      }
      if (avatarMenu) avatarMenu.style.display = 'none';
      profileMenu.style.display = profileMenu.style.display === 'block' ? 'none' : 'block';
    });
  }

  avatarInput?.addEventListener('change', async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      showAdminToast('Choose a PNG, JPEG, or WebP image smaller than 2 MB.', 'danger');
      avatarInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = await requestJson('/auth/admin/profile', {
          method: 'PUT',
          body: JSON.stringify({ profilePicture: String(reader.result) })
        });
        updateAdminCredentials(data);
        updateAdminAvatar();
        if (avatarMenu) avatarMenu.style.display = 'none';
        showAdminToast('Profile photo updated.', 'success');
      } catch (err) {
        showAdminToast(err.message || 'Unable to save this profile photo.', 'danger');
      }
      avatarInput.value = '';
    };
    reader.onerror = () => showAdminToast('Unable to read this image file.', 'danger');
    reader.readAsDataURL(file);
  });

  document.getElementById('adminAvatarView')?.addEventListener('click', () => {
    const photo = adminState.user?.profilePicture || adminState.user?.profile_picture_url ||
      localStorage.getItem(getAdminAvatarKey());
    if (!photo || !avatarDialog || !avatarPreview) return;
    avatarPreview.src = getAdminAvatarSource(photo);
    avatarMenu.style.display = 'none';
    avatarDialog.showModal();
  });
  document.getElementById('adminAvatarChange')?.addEventListener('click', () => avatarInput?.click());
  document.getElementById('adminAvatarDialogChange')?.addEventListener('click', () => {
    avatarDialog?.close();
    avatarInput?.click();
  });
  document.getElementById('adminAvatarRemove')?.addEventListener('click', async () => {
    try {
      const data = await requestJson('/auth/admin/profile', {
        method: 'PUT',
        body: JSON.stringify({ profilePicture: null })
      });
      updateAdminCredentials(data);
      localStorage.removeItem(getAdminAvatarKey());
      updateAdminAvatar();
      avatarMenu.style.display = 'none';
      showAdminToast('Profile photo removed.', 'success');
    } catch (err) {
      showAdminToast(err.message || 'Unable to remove the profile photo.', 'danger');
    }
  });
  document.getElementById('adminAvatarDialogClose')?.addEventListener('click', () => avatarDialog?.close());
  avatarDialog?.addEventListener('click', event => {
    if (event.target === avatarDialog) avatarDialog.close();
  });

  if (menuSignOut) {
    menuSignOut.addEventListener('click', () => setAdminState(false));
  }

  document.getElementById('menuProfileSettings')?.addEventListener('click', () => {
    document.getElementById('adminProfileNameInput').value = getAdminDisplayName(adminState.user);
    document.getElementById('adminProfileSettingsError').textContent = '';
    profileMenu.style.display = 'none';
    profileSettingsDialog?.showModal();
  });
  document.getElementById('adminProfileSettingsClose')?.addEventListener('click', () => profileSettingsDialog?.close());

  profileSettingsForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const error = document.getElementById('adminProfileSettingsError');
    error.textContent = '';
    try {
      const data = await requestJson('/auth/admin/profile', {
        method: 'PUT',
        body: JSON.stringify({ name: document.getElementById('adminProfileNameInput').value.trim() })
      });
      updateAdminCredentials(data);
      profileSettingsDialog.close();
      showAdminToast('Profile updated.', 'success');
    } catch (err) {
      error.textContent = err.message || 'Unable to update profile.';
    }
  });

  passwordChangeForm?.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await requestJson('/auth/admin/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: document.getElementById('adminCurrentPassword').value,
          newPassword: document.getElementById('adminNewPassword').value
        })
      });
      passwordChangeForm.reset();
      showAdminToast('Password updated.', 'success');
    } catch (err) {
      showAdminToast(err.message || 'Unable to update password.', 'danger');
    }
  });

  // update navbar profile when state present
  if (adminState.user) {
    try {
      const name = getAdminDisplayName(adminState.user);
      if (navAdminName) navAdminName.textContent = getAdminHeaderLabel(adminState.user);
      if (menuName) menuName.textContent = name;
      if (navAdminEmail) navAdminEmail.textContent = adminState.user.email || '';
      if (menuEmail) menuEmail.textContent = adminState.user.email || '';
      updateAdminAvatar(adminState.user);
    } catch (e) {}
  }

});


// Background polling for real-time updates
setInterval(() => {
  if (!document.hidden && getAdminToken() && !adminState.isLoading) {
    requestJson("/admin/dashboard").then(dashboardData => {
      if (!dashboardData || !dashboardData.pendingApplications) return;
      
      const prevPending = adminState.pendingApps?.length || 0;
      const prevApproved = adminState.approvedApps?.length || 0;
      const prevRejected = adminState.rejectedApps?.length || 0;
      const prevChecks = adminState.checks?.length || 0;
      const prevRevoked = adminState.revoked?.length || 0;

      const newPending = dashboardData.pendingApplications || dashboardData.pendingApps || dashboardData.pending || [];
      const newApproved = dashboardData.approvedApplications || dashboardData.approvedApps || dashboardData.approved || [];
      const newRejected = dashboardData.rejectedApplications || dashboardData.rejectedApps || dashboardData.rejected || [];
      
      const pendingChanged = newPending.length !== prevPending;
      const approvedChanged = newApproved.length !== prevApproved;
      const rejectedChanged = newRejected.length !== prevRejected;
      const checksChanged = (dashboardData.history?.length || 0) !== prevChecks;
      const revokedChanged = (dashboardData.revoked?.length || 0) !== prevRevoked;

      if (pendingChanged || approvedChanged || rejectedChanged || checksChanged || revokedChanged) {
        adminState.stats = dashboardData.stats || adminState.stats;
        adminState.pendingApps = newPending;
        adminState.approvedApps = newApproved;
        adminState.rejectedApps = newRejected;
        adminState.checks = dashboardData.history || adminState.checks;
        adminState.revoked = dashboardData.revoked || adminState.revoked;
        
        renderAdminDashboard();
      }
    }).catch(() => {});
  }
}, 5000);

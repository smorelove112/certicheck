"use strict";

const API_BASE_URL = "https://certicheck-backend-8hu3.onrender.com";
const apiFetch = (url, options = {}) => fetch(url, { ...options, credentials: "include" });
const ADMIN_SESSION_KEY = "certicheck_admin_logged_in";
const ADMIN_TOKEN_KEY = "certicheck_admin_token";
const ADMIN_USER_KEY = "certicheck_admin_user";
// Reduced admin sections: keep only 'audit' and surface other items in audit view
const ADMIN_SECTIONS = [
  { id: "audit", label: "Audit log" },
];

let adminCurrentSection = "audit";
let adminAuditFilter = 'all';
let adminReviewFilters = {
  query: '',
  status: 'all',
  sort: 'newest'
};
let adminActivityExpanded = false;
let adminPollTimer = null;

function startAdminDashboardPolling() {
  if (adminPollTimer) return;
  adminPollTimer = setInterval(() => {
    if (isAdminLoggedIn()) {
      loadAdminDashboard().catch(() => {});
    }
  }, 15000);
}

function stopAdminDashboardPolling() {
  if (adminPollTimer) {
    clearInterval(adminPollTimer);
    adminPollTimer = null;
  }
}

let adminState = {
  token: localStorage.getItem(ADMIN_TOKEN_KEY) || "",
  user: null,
  stats: null,
  pendingApps: [],
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
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function getApplicationList(data) {
  if (Array.isArray(data?.applications)) return data.applications;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function getAdminDisplayName(user) {
  const firstName = user?.firstName || user?.first_name || '';
  const lastName = user?.lastName || user?.last_name || '';
  return [firstName, lastName].filter(Boolean).join(' ') || user?.email || 'Admin';
}

function getAdminHeaderLabel(user) {
  return `Signed in as ${getAdminDisplayName(user)} (Admin)`;
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
    startAdminDashboardPolling();
    if (loginCard) loginCard.style.display = "none";
    if (dashboard) dashboard.style.display = "block";
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
    const firstName = user?.firstName || user?.first_name;
    const lastName = user?.lastName || user?.last_name;
    if (avatar && firstName) {
      const initials = (firstName[0] || 'A') + (lastName ? lastName[0] : 'D');
      avatar.textContent = initials.toUpperCase();
    }
    loadAdminDashboard();
    return;
  }

  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
  stopAdminDashboardPolling();
  adminState.token = "";
  adminState.user = null;
  if (loginCard) loginCard.style.display = "block";
  if (dashboard) dashboard.style.display = "none";
  if (statsSection) statsSection.style.display = 'none';
  if (mainGrid) mainGrid.style.display = 'none';
  clearAdminError();
}

// Quick action wiring: filter audit view
function bindQuickActions() {
  const container = document.querySelector('.quick-actions');
  if (!container) return;
  container.querySelectorAll('button[data-action-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.actionQuick;
      adminActivityExpanded = false;
      adminAuditFilter = action || 'all';
      if (['pending', 'approved', 'rejected', 'revoked', 'checks'].includes(action)) {
        adminReviewFilters.status = action;
      } else {
        adminReviewFilters.status = 'all';
      }
      adminCurrentSection = 'audit';
      renderAdminDashboard();
    });
  });
}

function renderAdminTabs() {
  // tabs intentionally removed — quick actions control the view
  return;
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
  const reviewedAt = app.reviewed_at || app.updated_at || '—';
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

      ${metadataSummary}

      ${actionButtons}
    </div>
  `;

  drawer.style.display = 'block';

  content.querySelectorAll('[data-detail-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.detailAction;
      handleApplicationAction(action, btn.dataset.id);
      drawer.style.display = 'none';
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
    adminActivityExpanded = false;
    renderAdminDashboard();
  });

  statusSelect?.addEventListener('change', (event) => {
    adminReviewFilters.status = event.target.value || 'all';
    adminActivityExpanded = false;
    renderAdminDashboard();
  });

  sortSelect?.addEventListener('change', (event) => {
    adminReviewFilters.sort = event.target.value || 'newest';
    adminActivityExpanded = false;
    renderAdminDashboard();
  });

  selectAll?.addEventListener('change', (event) => {
    const checked = event.target.checked;
    document.querySelectorAll('.admin-row-select').forEach(input => {
      input.checked = checked;
    });
  });

  bulkApprove?.addEventListener('click', () => handleBulkAction('approve'));
  bulkReject?.addEventListener('click', () => handleBulkAction('reject'));
  drawerClose?.addEventListener('click', () => {
    const drawer = document.getElementById('adminDetailDrawer');
    if (drawer) drawer.style.display = 'none';
  });
}

async function handleBulkAction(action) {
  const selected = [...document.querySelectorAll('.admin-row-select:checked')].map(input => input.dataset.id).filter(Boolean);
  if (!selected.length) {
    showAdminToast('Select at least one application to continue.', 'danger');
    return;
  }

  try {
    for (const id of selected) {
      await requestJson(`/applications/${id}/${action === 'approve' ? 'approve' : 'reject'}`, { method: 'PUT' });
    }
    showAdminToast(`${selected.length} application${selected.length > 1 ? 's were' : ' was'} ${action === 'approve' ? 'approved' : 'rejected'}.`, 'success');
    await loadAdminDashboard();
  } catch (err) {
    showAdminToast(err.message || 'Bulk action failed.', 'danger');
  }
}

function renderAdminDashboard() {
  const list = document.getElementById("adminList");
  const summary = document.getElementById("adminSummary");
  const intro = document.getElementById("adminSectionIntro");
  const statsGrid = document.getElementById("adminStatsGrid");
  if (!list || !summary || !intro) return;

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
  intro.textContent = "Review privileged admin activity, pending and rejected issuer applications.";

  const reviewItems = getAdminReviewItems();
  const toolbar = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:18px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--bg-subtle);">
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
          ${!adminActivityExpanded && reviewItems.length > 5 ? 'Select visible' : 'Select all'}
        </label>
        <button id="adminBulkApprove" class="btn-success" type="button">Approve selected</button>
        <button id="adminBulkReject" class="btn-danger" type="button">Reject selected</button>
      </div>
    </div>
  `;

  if (!reviewItems.length) {
    list.innerHTML = toolbar + renderEmpty("No matching applications found.");
    bindAdminReviewControls();
    return;
  }

  const visibleReviewItems = adminActivityExpanded ? reviewItems : reviewItems.slice(0, 5);
  const activityMarkup = visibleReviewItems.map(item => {
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

        <div style="margin-top:12px;color:var(--text-secondary);font-size:13px;line-height:1.7;">
          <div><strong>Organization:</strong> ${applicantName}</div>
          ${applicantEmail ? `<div><strong>Gmail / email:</strong> ${applicantEmail}</div>` : ''}
        </div>

        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-ghost" type="button" data-open-detail="${item.id}">View details</button>
          ${item.status === 'pending' ? `<button class="btn-success" type="button" data-action="approve" data-id="${item.id}">Approve</button><button class="btn-danger" type="button" data-action="reject" data-id="${item.id}">Reject</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  const activityToggle = reviewItems.length > 5
    ? `<button class="btn-ghost" type="button" data-toggle-activity aria-expanded="${adminActivityExpanded}" aria-controls="adminActivityItems" style="margin-top:12px;">${adminActivityExpanded ? 'Show recent activity' : `View all activity (${reviewItems.length})`}</button>`
    : '';

  list.innerHTML = toolbar + `<div id="adminActivityItems">${activityMarkup}</div>${activityToggle}`;

  bindAdminReviewControls();

  list.querySelector('[data-toggle-activity]')?.addEventListener('click', () => {
    adminActivityExpanded = !adminActivityExpanded;
    renderAdminDashboard();
  });

  list.querySelectorAll('[data-open-detail]').forEach(button => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const itemId = Number(button.dataset.openDetail);
      const item = reviewItems.find(entry => Number(entry.id) === itemId);
      if (item) openAdminDetail(item);
    });
  });

  list.querySelectorAll('button[data-action]').forEach(button => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = button.dataset.action;
      const id = button.dataset.id;
      if (!id) return;
      if (action === 'approve' || action === 'reject') handleApplicationAction(action, id);
    });
  });
}

async function handleCreateAccountForApplication(id) {
  try {
    const data = await requestJson(`/applications/${id}/create-account`, { method: 'POST' });
    if (data.success && data.credentials) {
      alert(`Issuer account created:\nEmail: ${data.credentials.email}\nPassword: ${data.credentials.password}`);
    } else if (data.success && data.user) {
      alert(`Existing account linked for ${data.user.email}`);
    }
    await loadAdminDashboard();
  } catch (err) {
    showAdminError(err.message);
  }
}

async function handleApplicationAction(action, id) {
  try {
    const endpoint = action === "approve" ? `/applications/${id}/approve` : `/applications/${id}/reject`;
    await requestJson(endpoint, { method: "PUT" });
    showAdminToast(action === 'approve' ? 'Application approved and moved to approved queue.' : 'Application revoked and moved to revoked queue.', action === 'approve' ? 'success' : 'danger');
    await loadAdminDashboard();
  } catch (err) {
    showAdminError(err.message);
  }
}

async function handleRevokeAction(id) {
  try {
    await requestJson(`/verify/${id}/revoke`, { method: "PUT" });
    await loadAdminDashboard();
  } catch (err) {
    showAdminError(err.message);
  }
}

async function loadAdminDashboard() {
  try {
    const results = await Promise.allSettled([
      requestJson("/admin/dashboard"),
      requestJson("/applications/pending?limit=50&offset=0"),
      requestJson("/applications/rejected?limit=50&offset=0"),
      requestJson("/applications/approved?limit=50&offset=0"),
      requestJson("/verify/history?limit=50&offset=0"),
      requestJson("/verify/revoked?limit=50&offset=0"),
      requestJson("/admin/audit-log?limit=50&offset=0")
    ]);

    const valueAt = index => results[index].status === 'fulfilled' ? results[index].value : {};
    const dashboardData = valueAt(0);
    const pendingData = valueAt(1);
    const rejectedData = valueAt(2);
    const approvedData = valueAt(3);
    const historyData = valueAt(4);
    const revokedData = valueAt(5);
    const auditData = valueAt(6);

    adminState.stats = dashboardData.stats || adminState.stats || null;
    if (results[1].status === 'fulfilled') adminState.pendingApps = getApplicationList(pendingData);
    if (results[2].status === 'fulfilled') adminState.rejectedApps = getApplicationList(rejectedData);
    if (results[3].status === 'fulfilled') adminState.approvedApps = getApplicationList(approvedData);
    if (results[4].status === 'fulfilled') adminState.checks = Array.isArray(historyData.history) ? historyData.history : [];
    if (results[5].status === 'fulfilled') adminState.revoked = Array.isArray(revokedData.revoked) ? revokedData.revoked : [];
    if (results[6].status === 'fulfilled') adminState.auditLog = Array.isArray(auditData.auditLog) ? auditData.auditLog : [];

    requestJson("/admin/access-log", {
      method: "POST",
      body: JSON.stringify({ section: adminCurrentSection, method: "dashboard" })
    }).catch(() => {});

    renderAdminDashboard();
  } catch (err) {
    showAdminError(err.message);
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

  try {
    if (window.getFirebaseAuth) {
      try {
        await window.getFirebaseAuth().signInWithEmailAndPassword(email, password);
      } catch (firebaseError) {
        console.warn('Firebase admin sign-in unavailable; using backend admin session:', firebaseError.message || firebaseError);
      }
    }

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
  // bind quick actions after DOM ready
  try { bindQuickActions(); } catch (e) { /* ignore */ }
  // navbar profile menu
  const profileToggle = document.getElementById('adminProfileToggle');
  const profileMenu = document.getElementById('adminProfileMenu');
  const menuSignOut = document.getElementById('menuSignOut');
  const navAdminName = document.getElementById('navAdminName');
  const navAdminEmail = document.getElementById('navAdminEmail');
  const menuName = document.getElementById('menuName');
  const menuEmail = document.getElementById('menuEmail');

  if (profileToggle && profileMenu) {
    profileToggle.addEventListener('click', () => {
      profileMenu.style.display = profileMenu.style.display === 'block' ? 'none' : 'block';
    });
  }

  if (menuSignOut) {
    menuSignOut.addEventListener('click', () => setAdminState(false));
  }

  // update navbar profile when state present
  if (adminState.user) {
    try {
      const name = getAdminDisplayName(adminState.user);
      if (navAdminName) navAdminName.textContent = getAdminHeaderLabel(adminState.user);
      if (menuName) menuName.textContent = name;
      if (navAdminEmail) navAdminEmail.textContent = adminState.user.email || '';
      if (menuEmail) menuEmail.textContent = adminState.user.email || '';
    } catch (e) {}
  }
});

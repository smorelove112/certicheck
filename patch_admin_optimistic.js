const fs = require('fs');

const adminFile = '/workspaces/certicheck/admin.js';
let content = fs.readFileSync(adminFile, 'utf8');

// Inject renderAdminDashboard() for immediate UI update in bulk action
content = content.replace(
  /if \(successful\.length\) void loadAdminDashboard\(\);/g,
  'if (successful.length) { renderAdminDashboard(); void loadAdminDashboard(); }'
);

// Inject renderAdminDashboard() for immediate UI update in single action
content = content.replace(
  /applyApplicationDecisionLocally\(action, id, result\.application\);(\s*)const actionMessage/g,
  'applyApplicationDecisionLocally(action, id, result.application);\n      renderAdminDashboard();$1const actionMessage'
);

// Inject renderAdminDashboard() in handleRevokeAction
content = content.replace(
  /adminState\.revoked\.unshift\(result\.entry\);\n      }(\s*)showAdminToast/g,
  'adminState.revoked.unshift(result.entry);\n      }\n      renderAdminDashboard();$1showAdminToast'
);

// Add a silent polling mechanism for admin dashboard
const pollingCode = `

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
`;

if (!content.includes('Background polling for real-time updates')) {
  content += pollingCode;
}

fs.writeFileSync(adminFile, content);
console.log('Patched admin.js');

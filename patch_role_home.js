const fs = require('fs');

const scriptFile = '/workspaces/certicheck/script.js';
let content = fs.readFileSync(scriptFile, 'utf8');

const newRenderRoleLandingHome = `function renderRoleLandingHome() {
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
    document.getElementById('roleHomeActions').innerHTML = \`<div class="alert alert-info" style="margin-top:20px;">\${user.issuer_status === 'rejected' ? 'Your application to become an issuer was rejected. Please contact support.' : 'Your application has been submitted and is currently pending review by an admin. You will be able to issue certificates once approved.'}</div>\`;
    return;
  }

  const activeProfile = getActiveSessionProfile();
  const isAdmin = user.user_type === 'admin';
  const isIssuer = user.user_type === 'issuer';
  const stats = getRoleLandingStats();`;

// Replace from `function renderRoleLandingHome() {` to `const stats = getRoleLandingStats();`
const matchRegex = /function renderRoleLandingHome\(\)\s*\{[\s\S]*?const stats = getRoleLandingStats\(\);/;

if (matchRegex.test(content)) {
  content = content.replace(matchRegex, newRenderRoleLandingHome);
} else {
  console.log('Regex did not match.');
}

const applySubmitReplace = "if (currentUser) { currentUser.issuer_status = 'pending'; setStoredUser(currentUser); if (currentPage === 'home') renderRoleLandingHome(); } showSuccessMessage(email);";
content = content.replace(/showSuccessMessage\(email\);/g, applySubmitReplace);

fs.writeFileSync(scriptFile, content);
console.log('Patched script.js for role home');

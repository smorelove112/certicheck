const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const scriptJs = fs.readFileSync(path.join(rootDir, 'script.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(rootDir, 'admin.js'), 'utf8');

test('application form buttons do not submit the page', () => {
  assert.match(indexHtml, /<button type="button" class="btn-ghost" id="formBack"/);
  assert.match(indexHtml, /id="formBack"[^>]*>Back<\/button>/);
  assert.match(indexHtml, /<button type="button" class="btn-primary" id="formNext"/);
  assert.match(scriptJs, /nextBtn\.addEventListener\("click", \(event\) => \{\s*event\.preventDefault\(\);/s);
  assert.match(scriptJs, /if \(!validateApplyStep\(applyStep\)\) return;/);
  assert.match(scriptJs, /function validateApplyStep\(step\)/);
  assert.match(indexHtml, /id="orgName"[^>]*required/);
  assert.match(indexHtml, /id="orgType"[^>]*required/);
  assert.match(indexHtml, /id="contactName"[^>]*required/);
  assert.match(indexHtml, /id="contactEmailInput"[^>]*required/);
  assert.match(indexHtml, /id="contactRole"[^>]*required/);
  const useCaseField = indexHtml.match(/<textarea class="field-input" id="useCase"[^>]*>/)?.[0] || '';
  assert.doesNotMatch(useCaseField, /\brequired\b/);
  assert.match(indexHtml, /id="volume"[^>]*required/);
  const walletField = indexHtml.match(/<input class="field-input font-mono" id="wallet"[^>]*>/)?.[0] || '';
  assert.doesNotMatch(walletField, /\brequired\b/);
  assert.match(indexHtml, /for="useCase">Use Case <span[^>]*>\(optional\)<\/span>/);
  assert.match(indexHtml, /for="wallet">Solana Wallet Address <span[^>]*>\(optional\)<\/span>/);
  assert.doesNotMatch(indexHtml.match(/<input class="field-input" id="orgWebsite"[^>]*>/)?.[0] || '', /\brequired\b/);
  assert.match(indexHtml, /id="volumeCustom" type="number" min="1" step="1" placeholder="[^"]+" \/>/);
  assert.match(indexHtml, /<option value="custom">Custom<\/option>/);
  assert.match(scriptJs, /volumeCustomInput\.required = isCustom/);
  assert.match(scriptJs, /backBtn\?\.addEventListener\("click", \(event\) => \{\s*event\.preventDefault\(\);/s);
});

test('application confirmation does not show an auto-generated CertiCheck email', () => {
  assert.doesNotMatch(indexHtml, /generatedEmailCard|Your CertiCheck email/);
  assert.doesNotMatch(scriptJs, /generateCertiCheckEmail|generatedEmailCard/);
  assert.match(scriptJs, /showSuccessMessage\(officialEmail, notification = \{\}\)/);
});

test('signup communicates welcome-email delivery failures', () => {
  assert.match(scriptJs, /welcomeEmailNotice/);
  assert.match(scriptJs, /account was created, but the welcome email could not be delivered/i);
  assert.match(scriptJs, /notification\?\.emailSent === false/);
});

test('failed application submissions show an error instead of a false success state', () => {
  const submitFunction = scriptJs.match(/async function submitApplyForm\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(indexHtml, /id="applicationSubmitError"[^>]*role="alert"/);
  assert.match(submitFunction, /submitButton\.disabled = true/);
  assert.match(submitFunction, /Your application was not submitted and is not yet in the admin review queue/);
  const successIndex = submitFunction.indexOf('showSuccessMessage(email,');
  const catchIndex = submitFunction.indexOf('} catch (error) {');
  assert.ok(successIndex >= 0 && successIndex < catchIndex, 'Success should only be shown before the failure handler');
  assert.match(submitFunction, /showSuccessMessage\(email, data\.notification \|\| \{\}\)/);
  assert.match(scriptJs, /notification\.emailPending/);
  assert.match(scriptJs, /confirmation email is being sent/i);
  assert.match(scriptJs, /we could not send the confirmation email/i);
});

test('static localhost previews use the deployed API instead of an unavailable localhost backend', () => {
  assert.match(scriptJs, /const localApiOrigin = \["localhost", "127\.0\.0\.1"\]\.includes\(window\.location\.hostname\)\s*&& \["3000", "5000"\]\.includes\(window\.location\.port\)\s*\?\s*window\.location\.origin\s*:\s*null;/);
  assert.match(scriptJs, /"https:\/\/certicheck-backend-8hu3\.onrender\.com\/api"/);
  assert.match(indexHtml, /script\.js\?v=20261002-application-api/);
});

test('forgot-password OTP screen provides a resend control with a 40-second cooldown', () => {
  assert.match(indexHtml, /id="resendResetOtpBtn"[^>]*disabled>Resend code in 40s/);
  assert.match(scriptJs, /FORGOT_OTP_RESEND_COOLDOWN_MS = 40_000/);
  assert.match(scriptJs, /beginForgotOtpResendCooldown\(\)/);
  assert.match(scriptJs, /\/auth\/forgot-password/);
  assert.match(scriptJs, /Resend code in \$\{remaining\}s/);
});

test('login guidance explains the default password and required password change', () => {
  assert.match(indexHtml, /default password is <strong>password<\/strong>.*must change it before you can access your account/i);
});

test('admin dashboard avoids automatic refreshes and refreshes after admin actions', () => {
  assert.doesNotMatch(adminJs, /setInterval|startAdminDashboardPolling|stopAdminDashboardPolling/);
  assert.match(adminJs, /async function handleApplicationAction[\s\S]*?await loadAdminDashboard\(\);/);
  assert.match(adminJs, /async function handleBulkAction[\s\S]*?await loadAdminDashboard\(\);/);
  assert.match(adminJs, /if \(enabled\)[\s\S]*?loadAdminDashboard\(\);/);
});

test('admin actions show a warning when notification delivery fails', () => {
  assert.match(adminJs, /Email notification was not delivered/);
  assert.match(adminJs, /Email notification failed for/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');
const scriptJs = fs.readFileSync(path.join(rootDir, 'script.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(rootDir, 'admin.js'), 'utf8');
const stylingCss = fs.readFileSync(path.join(rootDir, 'styling.css'), 'utf8');

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
  assert.match(scriptJs, /showSuccessMessage\(email, data\.notification\?\.emailSent !== false\)/);
});

test('signup creates accounts directly and does not depend on email delivery', () => {
  assert.match(indexHtml, /id="signupBtn"[^>]*>Create Account/);
  assert.match(scriptJs, /fetch\(`\$\{API_BASE_URL\}\/auth\/register`/);
  assert.doesNotMatch(indexHtml + scriptJs, /Send OTP|verify-otp|send-otp|welcomeEmailNotice/);
});

test('duplicate registration presents an editable-email error with a login action', () => {
  assert.match(indexHtml, /id="signupEmailErrorMessage"/);
  assert.match(indexHtml, /id="signupEmailLogin"[^>]*>Log in/);
  assert.match(scriptJs, /applicationResponse\.status === 409/);
  assert.match(scriptJs, /registerResponse\.status === 409/);
  assert.match(scriptJs, /This email has already been used\. Please log in or try another email\./);
  assert.match(scriptJs, /showPasswordLoginOnLogin\(emailEl\.value\.trim\(\)\.toLowerCase\(\)\)/);
});

test('failed application submissions show an error instead of a false success state', () => {
  const submitFunction = scriptJs.match(/async function submitApplyForm\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(indexHtml, /id="applicationSubmitError"[^>]*role="alert"/);
  assert.match(submitFunction, /submitButton\.disabled = true/);
  assert.match(submitFunction, /Your application was not submitted and is not yet in the admin review queue/);
  assert.match(submitFunction, /data\.notification\?\.emailSent/);
  const successIndex = submitFunction.indexOf('showSuccessMessage(email,');
  const catchIndex = submitFunction.indexOf('} catch (error) {');
  assert.ok(successIndex >= 0 && successIndex < catchIndex, 'Success should only be shown before the failure handler');
});

test('static localhost previews use the deployed API instead of an unavailable localhost backend', () => {
  assert.match(scriptJs, /const localApiOrigin = \["localhost", "127\.0\.0\.1"\]\.includes\(window\.location\.hostname\)\s*&& \["3000", "5000"\]\.includes\(window\.location\.port\)\s*\?\s*window\.location\.origin\s*:\s*null;/);
  assert.match(scriptJs, /"https:\/\/certicheck-backend-8hu3\.onrender\.com\/api"/);
  assert.match(indexHtml, /script\.js\?v=20260308-gmail-certificate-refresh/);
});

test('login page includes the approved issuer activation flow', () => {
  assert.match(indexHtml, /id="page-login"/);
  assert.match(indexHtml, /id="loginIssuerActivation"/);
  assert.match(indexHtml, /class="login-section-title" id="loginIssuerSetupTitle">Issuer account setup/);
  assert.match(indexHtml, /id="loginSignInFields" hidden/);
  assert.match(indexHtml, /id="issuerActivationForm"/);
  assert.match(indexHtml, /<label class="field-label" for="activationCode">Activation code<\/label>/);
  assert.match(indexHtml, /id="activationCode"[^>]*pattern="\[0-9\]\{6\}"/);
  assert.match(indexHtml, /id="resendActivationCode"/);
  assert.match(scriptJs, /function initIssuerActivationForm\(\)/);
  assert.match(scriptJs, /\/auth\/activate-issuer/);
  assert.match(scriptJs, /\/auth\/verify-issuer-activation/);
  assert.match(scriptJs, /\/auth\/resend-issuer-activation/);
  assert.match(scriptJs, /page === "login"[\s\S]*?initIssuerActivationForm\(\)/);
  assert.match(scriptJs, /ISSUER_ACTIVATION_REQUIRED/);
  assert.match(scriptJs, /showIssuerActivationOnLogin\(email, errMsg\)/);
  assert.match(scriptJs, /\/issuers\/apply/);
  assert.match(indexHtml, /id="activationPasswordFields" hidden/);
  const loginPage = indexHtml.match(/<div id="page-login"[\s\S]*?<\/div>\s*<!-- ═══/)[0];
  assert.doesNotMatch(loginPage, /Approved issuers: enter your email and activation code|Verify your email and activation code to create your password/);
});

test('user password-reset screens are wired to the email OTP endpoints', () => {
  assert.match(indexHtml, /id="forgotPasswordForm"/);
  assert.match(indexHtml, /id="page-verify-reset-otp"/);
  assert.match(indexHtml, /id="resetPasswordForm"/);
  assert.match(scriptJs, /function initForgotPasswordForm\(\)/);
  assert.match(scriptJs, /function initResetPasswordForm\(\)/);
  assert.match(scriptJs, /if \(page === "forgot-password"\) initForgotPasswordForm\(\)/);
  assert.match(scriptJs, /if \(page === "verify-reset-otp"\) initResetPasswordForm\(\)/);
  assert.match(scriptJs, /\/auth\/forgot-password/);
  assert.match(scriptJs, /sessionStorage\.setItem\(PASSWORD_RESET_EMAIL_KEY, email\)/);
  assert.match(scriptJs, /Sending code\.\.\./);
  assert.match(scriptJs, /\/auth\/reset-password/);
  assert.match(scriptJs, /if \(!\/\^\\d\{6\}\$\/\.test\(otpCode\)\)/);
  assert.doesNotMatch(adminHtml + adminJs, /forgot-password|verify-reset-otp|adminResetOtp/i);
});

test('certificate preview and download use a restrained landscape design', () => {
  assert.match(indexHtml, /id="verificationMiniCertificate"/);
  assert.match(scriptJs, /function getMiniCertificateCardMarkup/);
  assert.match(scriptJs, /certificates\/qr\//);
  assert.match(scriptJs, /verification: true/);
  assert.match(scriptJs, /verification \? ' verification-mini-certificate' : ''/);
  assert.match(scriptJs, /statusText === 'REVOKED' \? ' is-revoked' : ''/);
  assert.match(scriptJs, /width="1600" height="900" viewBox="0 0 1600 900"/);
  assert.match(scriptJs, /CERTIFICATE OF ACHIEVEMENT/);
  assert.match(scriptJs, /Certificate ID/);
  assert.doesNotMatch(scriptJs, /verification-pop-confetti|celebration-confetti-piece|celebration-glitter/);
  assert.doesNotMatch(stylingCss, /verification-confetti-pop|celebration-confetti-fall|celebration-glitter-drift/);
});

test('issuer activation guidance explains the emailed code and password setup', () => {
  assert.match(indexHtml, /Verify code/);
  assert.match(indexHtml, /Create password/);
});

test('admin dashboard avoids automatic refreshes and refreshes after admin actions', () => {
  assert.doesNotMatch(adminJs, /setInterval|startAdminDashboardPolling|stopAdminDashboardPolling/);
  assert.match(adminJs, /await handleApplicationAction\(action, id, button\)/);
  assert.match(adminJs, /async function handleApplicationAction[\s\S]*?showAdminToast\(`Could not \$\{action\} the application: \$\{err\.message\}`/);
  assert.match(adminJs, /async function handleApplicationAction[\s\S]*?void loadAdminDashboard\(\);/);
  assert.match(adminJs, /async function handleRevokeAction[\s\S]*?renderAdminDashboard\(\);[\s\S]*?void loadAdminDashboard\(\);/);
  assert.doesNotMatch(adminJs.match(/async function handleRevokeAction[\s\S]*?\n}/)?.[0] || '', /await loadAdminDashboard/);
  assert.match(adminJs, /async function handleBulkAction[\s\S]*?Promise\.allSettled/);
  assert.match(adminJs, /async function handleBulkAction[\s\S]*?of \$\{selected\.length\} applications/);
  assert.match(adminJs, /async function handleBulkAction[\s\S]*?withButtonLoading\(button,[\s\S]*?Approving/);
  assert.match(adminJs, /function applyApplicationDecisionLocally[\s\S]*?renderAdminDashboard\(\);/);
  assert.match(adminJs, /if \(enabled\)[\s\S]*?loadAdminDashboard\(\);/);
});

test('issuer wallet is optional and no-wallet issuance is identified as off-chain', () => {
  assert.match(indexHtml, /Wallet connection is optional/);
  assert.match(indexHtml, /id="issuerOnChain" type="checkbox"/);
  assert.match(scriptJs, /id="issuerDashboardOnChain" type="checkbox"/);
  assert.match(indexHtml, /Leave the option below unchecked to issue off-chain without a wallet/);
  assert.match(scriptJs, /async function issueCertificateWithoutWallet\(payload, token\)/);
  assert.match(scriptJs, /const wantsOnChain = document\.getElementById\('issuerOnChain'\)\?\.checked === true/);
  assert.match(scriptJs, /const wantsOnChain = document\.getElementById\('issuerDashboardOnChain'\)\?\.checked === true/);
  assert.match(scriptJs, /if \(wantsOnChain && !connectedWallet\)/);
  assert.match(scriptJs, /const data = wantsOnChain[\s\S]*?await issueCertificateWithPhantomWallet\(payload, token\)[\s\S]*?:\s*await issueCertificateWithoutWallet\(payload, token\)/);
  assert.match(scriptJs, /const connectedWallet = getActivePhantomWalletAddress\(\);/);
  assert.match(scriptJs, /This certificate is recorded in Certicheck but was not issued to Solana/);
  assert.match(scriptJs, /else if \(isOffChain\) addMetadata\('Blockchain', 'Off-chain record; not verified on Solana'\)/);
  assert.doesNotMatch(scriptJs, /Connect the approved issuer wallet before issuing on-chain/);
});

test('on-chain issuance does not wait for a redundant confirmation after Anchor rpc resolves', () => {
  const issueFunction = scriptJs.match(/async function issueCertificateWithPhantomWallet\(payload, token\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(issueFunction, /\.rpc\(\)/);
  assert.doesNotMatch(issueFunction, /connection\.confirmTransaction/);
});

test('successful certificate issuance opens a celebration dialog', () => {
  assert.match(indexHtml, /<dialog id="issuanceSuccessDialog" class="issuance-success-dialog"/);
  assert.match(indexHtml, /id="issuanceSuccessContent"/);
  assert.match(scriptJs, /function showCertificateIssuanceCelebration\(resultContainer, certificate, warnings = \[\]\)/);
  assert.match(scriptJs, /content\.innerHTML = markup;[\s\S]*?dialog\.showModal\(\)/);
  assert.equal((scriptJs.match(/showCertificateIssuanceCelebration\((?:result|resultEl), successDetails, data\.warnings \|\| \[\]\)/g) || []).length, 2);
});

test('local admin preview uses the local backend instead of the deployed API', () => {
  assert.match(adminJs, /:\s*`\$\{window\.location\.protocol\}\/\/\$\{window\.location\.hostname\}:5000`/);
  assert.match(adminHtml, /admin\.js\?v=20261002-admin-action-fast/);
});

test('expired admin tokens clear the stale session and return to sign-in', () => {
  assert.match(adminJs, /error\.status = response\.status/);
  assert.match(adminJs, /if \(response\.status === 401 && adminState\.token && path !== "\/auth\/admin\/login"\) \{\s*setAdminState\(false\);\s*showAdminError\('Your admin session has expired\. Please sign in again\.'\);/);
  assert.match(adminJs, /if \(err\.status === 401\) return false;\s*showAdminToast\(`Could not \$\{action\} the application/);
});

test('admin actions give status feedback without email delivery checks', () => {
  assert.match(adminJs, /showAdminToast\(actionMessage, 'success'\)/);
  assert.doesNotMatch(adminJs, /emailPending|emailSent|notification email/i);
});

test('admin action refresh avoids redundant application fetches and does not block action completion', () => {
  assert.match(adminJs, /if \(applicationListMissing \|\| applicationListTruncated\) \{/);
  assert.match(adminJs, /void loadAdminDashboard\(\);/);
});

test('slow user actions show painted, duplicate-safe button loading feedback', () => {
  assert.match(scriptJs, /async function withButtonLoading\(button, asyncFn, loadingText = 'Please wait\.\.\.'\)/);
  assert.match(scriptJs, /button\.dataset\.loading = '1'[\s\S]*?requestAnimationFrame/);
  assert.match(scriptJs, /withButtonLoading\(btn,[\s\S]*?Creating account\.\.\./);
  assert.match(scriptJs, /withButtonLoading\(btn,[\s\S]*?Signing in\.\.\./);
  assert.match(scriptJs, /withButtonLoading\(button,[\s\S]*?Issuing\.\.\./);
  assert.match(scriptJs, /withButtonLoading\(button,[\s\S]*?Revoking\.\.\./);
  assert.match(scriptJs, /verifyForm\.addEventListener\('submit',[\s\S]*?verifyCertificate\(document\.getElementById\("verifyBtn"\)\)/);
  assert.doesNotMatch(scriptJs, /document\.getElementById\("verifyBtn"\)\?\.addEventListener\("click", verifyCertificate\)/);
  assert.match(adminJs, /async function withButtonLoading\(button, asyncFn, loadingText = 'Please wait\.\.\.'\)/);
  assert.match(adminJs, /loginButton[\s\S]*?withButtonLoading\(loginButton,[\s\S]*?Signing in\.\.\./);
});

test('shared buttons have fast press feedback and accessible disabled styling', () => {
  assert.match(stylingCss, /button,\s*button\[class\*="btn-"\], \.btn, \[data-page\], \.nav-item\s*\{[\s\S]*?transition: transform 0\.1s ease, opacity 0\.15s ease/);
  assert.match(stylingCss, /button:active:not\(:disabled\)[\s\S]*?transform: scale\(0\.97\)/);
  assert.match(stylingCss, /button:disabled, \.btn:disabled\s*\{[\s\S]*?cursor: wait;[\s\S]*?opacity: 0\.7/);
  assert.match(stylingCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(indexHtml, /styling\.css\?v=20260308-certificate-refresh/);
  assert.match(adminHtml, /styling\.css\?v=20261002-button-interaction/);
});

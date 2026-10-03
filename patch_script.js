const fs = require('fs');

const scriptFile = '/workspaces/certicheck/script.js';
let content = fs.readFileSync(scriptFile, 'utf8');

const forgotLogic = `
  // ── FORGOT PASSWORD FLOW ──────────────────────────────────────────────────
  const forgotBtn = document.getElementById('forgotBtn');
  const forgotEmail = document.getElementById('forgotEmail');
  const forgotError = document.getElementById('forgotError');
  let resetEmailValue = '';

  if (forgotBtn) {
    forgotBtn.addEventListener('click', async () => {
      forgotError.style.display = 'none';
      const email = forgotEmail.value.trim();
      if (!email) {
        forgotError.textContent = 'Please enter your email.';
        forgotError.style.display = 'block';
        return;
      }
      forgotBtn.disabled = true;
      forgotBtn.textContent = 'Sending...';
      try {
        const res = await fetch(\`\${API_BASE_URL}/auth/forgot-password\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
          resetEmailValue = email;
          navigateTo('verify-reset-otp');
        } else {
          forgotError.textContent = data.error || 'Failed to send reset code.';
          forgotError.style.display = 'block';
        }
      } catch (err) {
        forgotError.textContent = 'Network error. Please try again.';
        forgotError.style.display = 'block';
      } finally {
        forgotBtn.disabled = false;
        forgotBtn.textContent = 'Send Reset Code';
      }
    });
  }

  const resetPasswordBtn = document.getElementById('resetPasswordBtn');
  const resetOtpCode = document.getElementById('resetOtpCode');
  const newPasswordInput = document.getElementById('newPassword');
  const confirmNewPasswordInput = document.getElementById('confirmNewPassword');
  const resetError = document.getElementById('resetError');

  if (resetPasswordBtn) {
    resetPasswordBtn.addEventListener('click', async () => {
      resetError.style.display = 'none';
      const otpCode = resetOtpCode.value.trim();
      const newPassword = newPasswordInput.value;
      const confirmNewPassword = confirmNewPasswordInput.value;

      if (!otpCode || otpCode.length < 6) {
        resetError.textContent = 'Please enter the 6-digit code.';
        resetError.style.display = 'block';
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        resetError.textContent = 'Password must be at least 6 characters.';
        resetError.style.display = 'block';
        return;
      }
      if (newPassword !== confirmNewPassword) {
        resetError.textContent = 'Passwords do not match.';
        resetError.style.display = 'block';
        return;
      }

      resetPasswordBtn.disabled = true;
      resetPasswordBtn.textContent = 'Resetting...';

      try {
        const res = await fetch(\`\${API_BASE_URL}/auth/reset-password\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: resetEmailValue, otpCode, newPassword })
        });
        const data = await res.json();
        if (data.success) {
          alert('Password reset successfully. Please login.');
          navigateTo('login');
        } else {
          resetError.textContent = data.error || 'Failed to reset password.';
          resetError.style.display = 'block';
        }
      } catch (err) {
        resetError.textContent = 'Network error. Please try again.';
        resetError.style.display = 'block';
      } finally {
        resetPasswordBtn.disabled = false;
        resetPasswordBtn.textContent = 'Reset Password';
      }
    });
  }
`;

// Insert the logic before the end of initAuthPageForms (or just append if safe)
// Let's find "function initAuthPageForms" and put it at the end of it.
const searchStr = `const loginBtn = document.getElementById('loginBtn');`;
content = content.replace(searchStr, forgotLogic + '\n  ' + searchStr);

fs.writeFileSync(scriptFile, content);
console.log('Patched script.js');

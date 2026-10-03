const fs = require('fs');

const indexFile = '/workspaces/certicheck/index.html';
let content = fs.readFileSync(indexFile, 'utf8');

const forgotLink = `
        <p style="text-align:center;color:var(--text-secondary);margin-top:16px;font-size:13px">
          Don't have an account? <button class="btn-ghost" data-page="apply" style="background:none;border:none;padding:0;text-decoration:underline;cursor:pointer">Sign up</button>
        </p>
        <p style="text-align:center;color:var(--text-secondary);margin-top:12px;font-size:13px">
          <button class="btn-ghost" data-page="forgot-password" style="background:none;border:none;padding:0;text-decoration:underline;cursor:pointer">Forgot password?</button>
        </p>`;

content = content.replace(
  /<p style="text-align:center;color:var\(--text-secondary\);margin-top:16px;font-size:13px">\s*Don't have an account\? <button class="btn-ghost" data-page="apply".*?<\/button>\s*<\/p>/g,
  forgotLink
);

const forgotPages = `

  <!-- ══════════════════════════════════════
       PAGE: FORGOT PASSWORD
  ══════════════════════════════════════ -->
  <div id="page-forgot-password" class="page">
    <div class="page-wrap" style="max-width:500px">
      <div class="page-header">
        <h1 class="page-title">Reset Password</h1>
        <p class="page-desc">Enter your email to receive a password reset code.</p>
      </div>

      <div class="form-card">
        <div class="field">
          <label class="field-label" for="forgotEmail">Email</label>
          <input class="field-input" id="forgotEmail" name="email" type="email" autocomplete="email" placeholder="your@email.com"/>
        </div>
        <div id="forgotError" style="color:var(--red);font-size:13px;margin-bottom:16px;display:none;"></div>
        <button class="btn-primary" id="forgotBtn" style="width:100%">Send Reset Code</button>
        <p style="text-align:center;color:var(--text-secondary);margin-top:16px;font-size:13px">
          <button class="btn-ghost" data-page="login" style="background:none;border:none;padding:0;text-decoration:underline;cursor:pointer">Back to Login</button>
        </p>
      </div>
    </div>
  </div>

  <!-- ══════════════════════════════════════
       PAGE: VERIFY FORGOT PASSWORD OTP
  ══════════════════════════════════════ -->
  <div id="page-verify-reset-otp" class="page">
    <div class="page-wrap" style="max-width:500px">
      <div class="page-header">
        <h1 class="page-title">Verify Code</h1>
        <p class="page-desc">Enter the 6-digit code sent to your email.</p>
      </div>

      <div class="form-card">
        <div class="field">
          <label class="field-label" for="resetOtpCode">Verification Code</label>
          <input class="field-input" id="resetOtpCode" type="text" placeholder="000000" maxlength="6" inputmode="numeric" style="text-align:center;font-size:24px;letter-spacing:4px;font-weight:600;"/>
        </div>
        <div class="field">
          <label class="field-label" for="newPassword">New Password</label>
          <input class="field-input" id="newPassword" name="new-password" type="password" autocomplete="new-password" placeholder="••••••••"/>
        </div>
        <div class="field">
          <label class="field-label" for="confirmNewPassword">Confirm Password</label>
          <input class="field-input" id="confirmNewPassword" name="new-password" type="password" autocomplete="new-password" placeholder="••••••••"/>
        </div>
        <div id="resetError" style="color:var(--red);font-size:13px;margin-bottom:16px;display:none;"></div>
        <button class="btn-primary" id="resetPasswordBtn" style="width:100%">Reset Password</button>
      </div>
    </div>
  </div>

  <!-- ══════════════════════════════════════
       PAGE: SET NEW PASSWORD
  ══════════════════════════════════════ -->`;

content = content.replace(
  /<!-- ══════════════════════════════════════\s*PAGE: SET NEW PASSWORD\s*══════════════════════════════════════ -->/g,
  forgotPages
);

fs.writeFileSync(indexFile, content);
console.log('Patched index.html');

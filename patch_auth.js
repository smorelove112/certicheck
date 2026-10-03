const fs = require('fs');

const authFile = '/workspaces/certicheck/backend/src/routes/auth.js';
let content = fs.readFileSync(authFile, 'utf8');

const newRoutes = `

// ── FORGOT PASSWORD ─────────────────────────────────────────────────────────
const OTP = require('../models/OTP');
const emailService = require('../services/emailService');
const bcrypt = require('bcryptjs');

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    
    // Check if user exists (Optional: can just send OTP anyway to avoid enumeration)
    const user = await User.findByEmail(normalizedEmail);
    if (!user) {
      // Don't leak if user exists or not, just return success
      return res.json({ success: true, message: 'If an account with that email exists, we sent a reset code.' });
    }

    const otp = await OTP.create(normalizedEmail, 'reset_password');
    await emailService.sendOTP(normalizedEmail, otp.otp_code);

    res.json({ success: true, message: 'If an account with that email exists, we sent a reset code.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process forgot password request' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, otpCode, newPassword } = req.body;
    if (!email || !otpCode || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Verify OTP
    const isValid = await OTP.verify(normalizedEmail, otpCode, 'reset_password');
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired reset code' });
    }

    // Hash and update password
    const user = await User.findByEmail(normalizedEmail);
    if (!user) {
       return res.status(404).json({ error: 'User not found' });
    }

    // We can use User.updatePassword if it handles hashing, let's see. 
    // From auth.js, we see: await User.updatePassword(user.email, newPassword, false);
    await User.updatePassword(normalizedEmail, newPassword, false);

    // Consume OTP
    await OTP.consume(normalizedEmail, otpCode, 'reset_password');

    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
`;

content = content.replace('module.exports = router;', newRoutes);
fs.writeFileSync(authFile, content);
console.log('Patched auth.js');

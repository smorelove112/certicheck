const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db/connection');
const User = require('../models/User');
const OTP = require('../models/OTP');
const EmailService = require('../services/emailService');
const { logAudit, verifyToken } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isCertiCheckEmail(email) {
  return normalizeEmail(email).endsWith('@certicheck.com');
}

const DEFAULT_ADMIN_PASSWORD = 'password';
const DEFAULT_ADMIN_ACCOUNTS = [
  {
    email: normalizeEmail(process.env.ADMIN_EMAIL || 'admin@certicheck.com'),
    password: DEFAULT_ADMIN_PASSWORD,
    firstName: 'Admin',
    lastName: 'User',
    userType: 'admin'
  },
  {
    email: 'admin2@certicheck.com',
    password: DEFAULT_ADMIN_PASSWORD,
    firstName: 'Alex',
    lastName: 'Admin',
    userType: 'admin'
  },
  {
    email: 'admin3@certicheck.com',
    password: DEFAULT_ADMIN_PASSWORD,
    firstName: 'Jordan',
    lastName: 'Admin',
    userType: 'admin'
  }
];

function isReservedAdminEmail(email) {
  return DEFAULT_ADMIN_ACCOUNTS.some(account => account.email === normalizeEmail(email));
}

function buildAuthIdentity(user) {
  const firstName = user.first_name ?? user.firstName ?? '';
  const lastName = user.last_name ?? user.lastName ?? '';
  const userType = user.user_type ?? user.userType ?? 'user';

  return {
    id: user.id,
    firstName,
    lastName,
    email: user.email,
    userType,
    first_name: firstName,
    last_name: lastName,
    user_type: userType
  };
}

function validateNewPassword(password) {
  return typeof password === 'string' && password.length >= 6 && password !== 'password';
}

function setAuthCookie(res, token) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

async function ensureSeededAccounts() {
  const defaultAccounts = [
    ...DEFAULT_ADMIN_ACCOUNTS,
    {
      email: process.env.ISSUER_EMAIL || 'issuer@certicheck.com',
      password: process.env.ISSUER_PASSWORD || 'password',
      firstName: 'Issuer',
      lastName: 'User',
      userType: 'issuer'
    }
  ];

  for (const account of defaultAccounts) {
    const existingUser = await User.findByEmail(account.email);
    if (!existingUser) {
      const created = await User.create(account.email, account.password, account.firstName, account.lastName, account.userType);
      await pool.query(
        'UPDATE users SET is_active = TRUE, must_change_password = FALSE, updated_at = NOW() WHERE id = $1',
        [created.id]
      );
      if (account.userType === 'issuer') {
        await pool.query(
          `INSERT INTO issuer_profiles (user_id, organization_name, organization_type, website, contact_name, contact_role, certificate_volume, use_case, wallet_address, status, approval_timestamp, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', NOW(), NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET status = 'approved', approval_timestamp = NOW(), updated_at = NOW()`,
          [created.id, `${account.firstName} ${account.lastName}`, 'Default Issuer', '', `${account.firstName} ${account.lastName}`, 'Administrator', '1-50', 'Default seeded issuer account', '',]
        );
      }
      continue;
    }

    if (account.userType === 'admin') {
      const legacyPassword = process.env.ADMIN_PASSWORD || 'admin123';
      if (existingUser.user_type === 'admin' && account.password !== legacyPassword && await User.verifyPassword(account.email, legacyPassword)) {
        await User.updatePassword(account.email, account.password, false);
      }
      continue;
    }

    if (account.userType === 'issuer') {
      const profileExists = await pool.query(
        'SELECT id FROM issuer_profiles WHERE user_id = $1 LIMIT 1',
        [existingUser.id]
      );

      if (!profileExists.rows[0]) {
        await pool.query(
          `INSERT INTO issuer_profiles (user_id, organization_name, organization_type, website, contact_name, contact_role, certificate_volume, use_case, wallet_address, status, approval_timestamp, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', NOW(), NOW(), NOW())`,
          [existingUser.id, `${account.firstName} ${account.lastName}`, 'Default Issuer', '', `${account.firstName} ${account.lastName}`, 'Administrator', '1-50', 'Default seeded issuer account', '']
        );
      } else {
        await pool.query(
          `UPDATE issuer_profiles SET status = 'approved', approval_timestamp = COALESCE(approval_timestamp, NOW()), updated_at = NOW() WHERE user_id = $1`,
          [existingUser.id]
        );
      }
    }
  }
}

// ── SEND OTP FOR SIGNUP ──────────────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!EmailService.isValidEmail(email) || !isCertiCheckEmail(email)) {
      return res.status(400).json({ error: 'Please use a valid @certicheck.com email address' });
    }

    if (isReservedAdminEmail(email)) {
      return res.status(403).json({ error: 'This email is reserved for admin access' });
    }

    // Check if email already registered
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'This email is already registered. Please sign in instead.' });
    }

    // Generate and store OTP
    const otp = await OTP.create(email, 'signup');
    
    // Send OTP email
    await EmailService.sendOTP(email, otp.otp_code, 'signup');

    res.json({
      success: true,
      message: `OTP sent successfully to ${email}`,
      expiresAt: otp.expires_at
    });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Failed to send OTP: ' + (err.message || 'Internal error') });
  }
});

// ── RESEND OTP ──────────────────────────────────────────────────────────────
router.post('/resend-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email || !EmailService.isValidEmail(email) || !isCertiCheckEmail(email)) {
      return res.status(400).json({ error: 'A valid @certicheck.com email is required' });
    }

    if (isReservedAdminEmail(email)) {
      return res.status(403).json({ error: 'This email is reserved for admin access' });
    }

    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'This email is already registered. Please sign in instead.' });
    }

    const otp = await OTP.create(email, 'signup');
    await EmailService.sendOTP(email, otp.otp_code, 'signup');

    res.json({
      success: true,
      message: `A new OTP has been sent to ${email}`,
      expiresAt: otp.expires_at
    });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

// ── VERIFY OTP ───────────────────────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();

    if (!email || !otp) {
      return res.status(400).json({ error: 'Both email and 6-digit OTP are required' });
    }

    if (!EmailService.isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }

    const verified = await OTP.verify(email, otp, 'signup');
    
    if (!verified) {
      await OTP.incrementAttempts(email, otp, 'signup');
      return res.status(401).json({ error: 'Invalid or expired OTP code. Please try again.' });
    }

    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// ── REGISTER WITH OTP ────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password, firstName, lastName, userType = 'user', otp } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields: email, password, firstName, lastName' });
    }

    if (userType === 'admin') {
      return res.status(403).json({ error: 'Admin accounts cannot be created through registration' });
    }
    if (!['user', 'issuer'].includes(userType)) {
      return res.status(400).json({ error: 'Invalid user type' });
    }

    if (!EmailService.isValidEmail(email) || !isCertiCheckEmail(email)) {
      return res.status(400).json({ error: 'Please use a valid @certicheck.com email address' });
    }

    if (isReservedAdminEmail(email)) {
      return res.status(403).json({ error: 'This email is reserved for admin access' });
    }

    // Verify OTP requirement: check if verified in session or via direct OTP parameter
    let otpValid = await OTP.isVerified(email, 'signup');
    if (!otpValid && otp) {
      const verifiedRecord = await OTP.verify(email, otp, 'signup');
      otpValid = !!verifiedRecord;
    }

    if (!otpValid) {
      return res.status(403).json({ 
        error: 'Email has not been verified with OTP. Please complete OTP verification first.' 
      });
    }

    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const newUser = await User.create(email, 'password', firstName, lastName, userType);
    
    // Invalidate the verified OTP now that registration is complete
    await OTP.consume(email, 'signup');

    await logAudit(newUser.id, 'REGISTER', 'user', newUser.id, 'success');

    // Send welcome email
    await EmailService.sendWelcome(email, firstName);

    const identity = buildAuthIdentity(newUser);
    const token = jwt.sign(
      identity,
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: { ...newUser, ...identity },
      token
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed: ' + (err.message || 'Internal server error') });
  }
});

// ── FORGOT PASSWORD - SEND OTP ───────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Only users who completed the initial password change may use this flow.
    const user = await User.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists for security
      return res.json({
        success: true,
        message: 'If email exists, OTP will be sent'
      });
    }
    if (user.must_change_password) {
      return res.json({
        success: true,
        message: 'If email exists, OTP will be sent'
      });
    }

    // Generate and store OTP
    const otp = await OTP.create(email, 'forgot_password');
    
    // Send OTP email
    await EmailService.sendOTP(email, otp.otp_code, 'forgot_password');

    res.json({
      success: true,
      message: 'OTP sent to email',
      expiresAt: otp.expires_at
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to send reset OTP' });
  }
});

// ── VERIFY FORGOT PASSWORD OTP ───────────────────────────────────────────────
router.post('/verify-forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = req.body.otp;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP required' });
    }

    const verified = await OTP.verify(email, otp, 'forgot_password');
    
    if (!verified) {
      await OTP.incrementAttempts(email, otp, 'forgot_password');
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    res.json({
      success: true,
      message: 'OTP verified successfully'
    });
  } catch (err) {
    console.error('Verify forgot password OTP error:', err);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// ── RESET PASSWORD ───────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { newPassword, otp } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email and new password required' });
    }

    // Verify OTP
    const isOtpVerified = await OTP.isVerified(email, 'forgot_password');
    if (!isOtpVerified) {
      return res.status(401).json({ error: 'OTP verification required' });
    }

    // Check if email exists
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.must_change_password) {
      return res.status(403).json({ error: 'Set your new password before using password recovery' });
    }

    if (!validateNewPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters and cannot be "password"' });
    }

    // Update password
    await User.updatePassword(email, newPassword);
    
    await logAudit(user.id, 'PASSWORD_CHANGE', 'user', user.id, 'success');

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ── SET INITIAL PASSWORD ────────────────────────────────────────────────────
router.post('/change-password', verifyToken, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!validateNewPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters and cannot be "password"' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await User.updatePassword(user.email, newPassword, false);
    await logAudit(user.id, 'PASSWORD_CHANGE', 'user', user.id, 'success');
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ── LOGIN ───────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    await ensureSeededAccounts();

    const user = await User.verifyPassword(email, password);
    
    if (!user) {
      await logAudit(null, 'LOGIN', 'user', null, 'failed', 'Incorrect email or password');
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    if (!user.is_active) {
      await logAudit(user.id, 'LOGIN', 'user', user.id, 'failed', 'Account inactive');
      return res.status(403).json({ error: 'Account is inactive' });
    }

    await logAudit(user.id, 'LOGIN', 'user', user.id, 'success');

    const issuerProfile = await pool.query(
      'SELECT organization_name, status, wallet_address FROM issuer_profiles WHERE user_id = $1 LIMIT 1',
      [user.id]
    );
    const profile = issuerProfile.rows[0] || {};

    const identity = buildAuthIdentity(user);
    const token = jwt.sign(
      identity,
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    setAuthCookie(res, token);

    res.json({
      success: true,
      message: 'Login successful',
      user: { ...identity, must_change_password: user.must_change_password, organization_name: profile.organization_name || '', issuer_status: profile.status || '', wallet: profile.wallet_address || '' },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── ADMIN LOGIN (separate endpoint) ─────────────────────────────────────────
router.post('/admin/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // In demo mode, accept each of the seeded admin identities without a database.
    if (process.env.DEMO_MODE === 'true') {
      const demoAdmin = DEFAULT_ADMIN_ACCOUNTS.find(account => account.email === email && account.password === password);
      if (demoAdmin) {
        const identity = buildAuthIdentity({ id: 1, ...demoAdmin });
        const token = jwt.sign({ ...identity, isAdmin: true }, process.env.ADMIN_JWT_SECRET || JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
        setAuthCookie(res, token);
        await logAudit(1, 'LOGIN', 'admin', 1, 'success');
        return res.json({ success: true, token, user: identity });
      }
      await logAudit(null, 'LOGIN', 'admin', null, 'failed', 'Invalid admin credentials (demo)');
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    await ensureSeededAccounts();

    const user = await User.verifyPassword(email, password);
    if (!user || user.user_type !== 'admin') {
      // generic error to avoid account enumeration
      await logAudit(null, 'LOGIN', 'admin', null, 'failed', 'Invalid admin credentials');
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    if (!user.is_active) {
      await logAudit(user.id, 'LOGIN', 'admin', user.id, 'failed', 'Admin account inactive');
      return res.status(403).json({ error: 'Account inactive' });
    }

    const identity = buildAuthIdentity(user);
    const token = jwt.sign({ ...identity, isAdmin: true }, process.env.ADMIN_JWT_SECRET || JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
    setAuthCookie(res, token);

    await logAudit(user.id, 'LOGIN', 'admin', user.id, 'success');

    res.json({ success: true, token, user: identity });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET PROFILE ─────────────────────────────────────────────────────────────
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true, user: { ...user, userType: user.user_type } });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── UPDATE PROFILE ──────────────────────────────────────────────────────────
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { firstName, lastName } = req.body;
    const user = await User.updateProfile(req.user.id, firstName, lastName);
    
    await logAudit(req.user.id, 'PROFILE_UPDATE', 'user', req.user.id, 'success');
    
    res.json({ success: true, user });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;

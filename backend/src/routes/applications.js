const express = require('express');
const Application = require('../models/Application');
const User = require('../models/User');
const pool = require('../db/connection');
const { verifyToken, verifyAdmin, verifyAdminToken, logAudit } = require('../middleware/auth');
const { isValidEmail } = require('../utils/validation');
const router = express.Router();

function getAdminActor(req) {
  const id = req.user.adminId || req.user.id;
  return {
    id,
    name: req.user.name ||
      [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') ||
      req.user.email || 'Admin',
    profilePicture: req.user.profilePicture || null
  };
}

function scheduleApplicationDecisionFollowUp(actor, appId, approved) {
  setImmediate(() => {
    Promise.resolve().then(() => logAudit(
      actor.id,
      approved ? 'APPLICATION_APPROVE' : 'APPLICATION_REJECT',
      'application',
      appId,
      'success',
      null,
      {
        processedByAdminId: actor.id,
        processedByAdminName: actor.name
      }
    )).catch(error => {
      console.error(`Application ${approved ? 'approval' : 'rejection'} audit logging failed:`, error.message || error);
    });
  });
}

// ── SUBMIT APPLICATION ──────────────────────────────────────────────────────
router.post('/submit', async (req, res) => {
  try {
    const { orgName, orgType, website, contactName, contactEmail, contactRole, volume, useCase, wallet } = req.body;

    if (!orgName || !contactName || !contactEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isValidEmail(contactEmail)) {
      return res.status(400).json({ error: 'A valid contact email address is required' });
    }

    const applicantEmail = String(contactEmail).trim().toLowerCase();
    const generatedEmail = applicantEmail;

    let userId = req.user?.id || null;
    if (!userId) {
      if (process.env.DEMO_MODE === 'true') {
        userId = 1;
      } else {
        const existingUser = await User.findByEmail(applicantEmail);
        if (existingUser) {
          userId = existingUser.id;
        } else {
          const nameParts = String(contactName).trim().split(/\s+/).filter(Boolean);
          const firstName = nameParts.shift() || 'Issuer';
          const lastName = nameParts.join(' ') || 'User';
          const applicant = await User.create(applicantEmail, 'password', firstName, lastName, 'issuer');
          userId = applicant.id;
        }
      }
    }

    const app = await Application.create(
      userId, orgName, orgType, website, contactName, contactEmail, generatedEmail, contactRole, volume, useCase, wallet
    );

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      application: { ...app, generated_email: app.generated_email || generatedEmail }
    });

    setImmediate(() => {
      logAudit(userId, 'APPLICATION_SUBMIT', 'application', app.id, 'success').catch(error => {
        console.error('Application submission audit logging failed:', error.message || error);
      });
    });
  } catch (err) {
    console.error('Application submit error:', err);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// ── GET PENDING APPLICATIONS (ADMIN) ────────────────────────────────────────
router.get('/pending', verifyAdminToken, verifyAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const apps = await Application.getPending(limit, offset);
    const count = await Application.countByStatus('pending');

    res.json({
      success: true,
      applications: apps,
      total: count,
      limit,
      offset
    });
  } catch (err) {
    console.error('Fetch pending apps error:', err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// ── GET REJECTED APPLICATIONS (ADMIN) ───────────────────────────────────────
router.get('/rejected', verifyAdminToken, verifyAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const apps = await Application.getByStatus('rejected', limit, offset);
    const count = await Application.countByStatus('rejected');

    res.json({
      success: true,
      applications: apps,
      total: count,
      limit,
      offset
    });
  } catch (err) {
    console.error('Fetch rejected apps error:', err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// ── GET APPROVED APPLICATIONS (ADMIN) ───────────────────────────────────────
router.get('/approved', verifyAdminToken, verifyAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const apps = await Application.getByStatus('approved', limit, offset);
    const count = await Application.countByStatus('approved');

    res.json({
      success: true,
      applications: apps,
      total: count,
      limit,
      offset
    });
  } catch (err) {
    console.error('Fetch approved apps error:', err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// ── APPROVE APPLICATION (ADMIN) ─────────────────────────────────────────────
router.put('/:appId/approve', verifyAdminToken, verifyAdmin, async (req, res) => {
  try {
    const { appId } = req.params;

    const actor = await getAdminActor(req);
    const app = await Application.approve(appId, actor.id, actor.name, actor.profilePicture);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    scheduleApplicationDecisionFollowUp(actor, appId, true);

    res.json({
      success: true,
      message: 'Application approved',
      application: app
    });
  } catch (err) {
    console.error('Approve application error:', err);
    res.status(500).json({ error: 'Failed to approve application' });
  }
});

// ── CREATE OR LINK ISSUER ACCOUNT FOR APPLICATION (ADMIN) ──────────────────
router.post('/:appId/create-account', verifyAdminToken, verifyAdmin, async (req, res) => {
  try {
    const { appId } = req.params;

    // Fetch pending application and its issuer_profile
    const appRes = await pool.query(
      `SELECT pa.*, ip.id AS issuer_profile_id, ip.user_id
       FROM pending_applications pa
       LEFT JOIN issuer_profiles ip ON pa.issuer_id = ip.id
       WHERE pa.id = $1 LIMIT 1`,
      [appId]
    );

    const app = appRes.rows[0];
    if (!app) return res.status(404).json({ error: 'Application not found' });

    // If there's already a linked user, return that info (no-op). Admins never
    // receive or modify password data.
    if (app.user_id) {
      const userRes = await pool.query('SELECT id, email, first_name, last_name FROM users WHERE id = $1 LIMIT 1', [app.user_id]);
      const user = userRes.rows[0];
      await logAudit(req.user.adminId || req.user.id, 'ADMIN_ACTION', 'application', appId, 'success', null, {
        action: 'APPLICATION_ACCOUNT_LINK',
        adminName: req.user.name || req.user.email
      });
      return res.json({ success: true, user });
    }

    // Create a new user account for the contact email
    const contactEmail = String(app.contact_email || app.contactEmail || app.generated_email || app.generatedEmail || '').trim().toLowerCase();
    if (!contactEmail) return res.status(400).json({ error: 'No contact email available to create account' });

    const User = require('../models/User');

    // An account must be created by the user through the signup flow; admins
    // cannot set or disclose passwords.
    const existing = await User.findByEmail(contactEmail);
    if (existing) {
      if (app.issuer_profile_id) {
        await pool.query('UPDATE issuer_profiles SET user_id = $1, updated_at = NOW() WHERE id = $2', [existing.id, app.issuer_profile_id]);
      }
      await logAudit(req.user.adminId || req.user.id, 'ADMIN_ACTION', 'application', appId, 'success', null, {
        action: 'APPLICATION_ACCOUNT_LINK',
        adminName: req.user.name || req.user.email
      });
      return res.json({ success: true, user: { id: existing.id, email: existing.email, first_name: existing.first_name, last_name: existing.last_name } });
    }
    return res.status(409).json({ error: 'The contact must complete signup before an account can be linked' });
  } catch (err) {
    console.error('Create account for application error:', err);
    res.status(500).json({ error: 'Failed to create or link account for application' });
  }
});

// ── REJECT APPLICATION (ADMIN) ──────────────────────────────────────────────
router.put('/:appId/reject', verifyAdminToken, verifyAdmin, async (req, res) => {
  try {
    const { appId } = req.params;

    const actor = await getAdminActor(req);
    const app = await Application.reject(appId, actor.id, actor.name, actor.profilePicture);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    scheduleApplicationDecisionFollowUp(actor, appId, false);

    res.json({
      success: true,
      message: 'Application rejected',
      application: app
    });
  } catch (err) {
    console.error('Reject application error:', err);
    res.status(500).json({ error: 'Failed to reject application' });
  }
});

// ── GET ALL APPLICATIONS (ADMIN) ────────────────────────────────────────────
router.get('/', verifyAdminToken, verifyAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const apps = await Application.getAll(limit, offset);

    res.json({
      success: true,
      applications: apps,
      limit,
      offset
    });
  } catch (err) {
    console.error('Fetch all apps error:', err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

module.exports = router;

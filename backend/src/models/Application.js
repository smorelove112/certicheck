const pool = require('../db/connection');
const User = require('./User');
const demoAppStore = require('../services/demoApplicationStore');

class Application {
  static async create(issuerId, orgName, orgType, website, contactName, contactEmail, generatedEmail, contactRole, volume, useCase, wallet) {
    if (process.env.DEMO_MODE === 'true') {
      return demoAppStore.createApplication({
        issuerId,
        orgName,
        orgType,
        website,
        contactName,
        contactEmail,
        generatedEmail,
        contactRole,
        volume,
        useCase,
        wallet
      });
    }

    const existingProfile = await pool.query(
      'SELECT id FROM issuer_profiles WHERE user_id = $1 LIMIT 1',
      [issuerId]
    );

    let issuerProfileId;
    if (existingProfile.rows[0]) {
      issuerProfileId = existingProfile.rows[0].id;
      await pool.query(
        `UPDATE issuer_profiles
         SET organization_name = COALESCE($2, organization_name), organization_type = COALESCE($3, organization_type), website = COALESCE($4, website), contact_name = COALESCE($5, contact_name), contact_role = COALESCE($6, contact_role), certificate_volume = COALESCE($7, certificate_volume), use_case = COALESCE($8, use_case), wallet_address = COALESCE($9, wallet_address), status = 'pending', updated_at = NOW()
         WHERE id = $1`,
        [issuerProfileId, orgName, orgType, website, contactName, contactRole, volume, useCase, wallet]
      );
    } else {
      const createdProfile = await pool.query(
        `INSERT INTO issuer_profiles (user_id, organization_name, organization_type, website, contact_name, contact_role, certificate_volume, use_case, wallet_address, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
         RETURNING id`,
        [issuerId, orgName, orgType, website, contactName, contactRole, volume, useCase, wallet]
      );
      issuerProfileId = createdProfile.rows[0].id;
    }

    const result = await pool.query(
      `INSERT INTO pending_applications 
      (issuer_id, organization_name, organization_type, organization_website, contact_name, contact_email, generated_email, contact_role, certificate_volume, use_case, wallet_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, organization_name, contact_email, generated_email, status, submitted_at`,
          [issuerProfileId, orgName, orgType, website, contactName, contactEmail, generatedEmail, contactRole, volume, useCase, wallet]
    );
    return result.rows[0];
  }

  static async getPending(limit = 50, offset = 0) {
    if (process.env.DEMO_MODE === 'true') {
      return demoAppStore.getApplicationsByStatus('pending', limit, offset);
    }

    const result = await pool.query(
      `SELECT * FROM pending_applications WHERE status = 'pending' LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }

  static async getByStatus(status, limit = 50, offset = 0) {
    if (process.env.DEMO_MODE === 'true') {
      return demoAppStore.getApplicationsByStatus(status, limit, offset);
    }

    const result = await pool.query(
      `SELECT * FROM pending_applications
       WHERE status = $1
       ORDER BY reviewed_at DESC NULLS LAST, submitted_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );
    return result.rows;
  }

  static async approve(appId, reviewerId, adminName = null, adminPicture = null) {
    if (process.env.DEMO_MODE === 'true') {
      const app = demoAppStore.updateStatus(appId, 'approved', reviewerId, adminName, adminPicture);
      return app ? {
        id: app.id, issuer_id: app.issuer_id, organization_name: app.organization_name,
        contact_name: app.contact_name, contact_email: app.contact_email,
        status: app.status, reviewed_at: app.reviewed_at,
        processed_by_admin_id: app.processed_by_admin_id,
        processed_by_admin_name: app.processed_by_admin_name,
        processed_by_admin_profile_picture_url: app.processed_by_admin_profile_picture_url,
        action_type: app.action_type, processed_at: app.processed_at
      } : null;
    }

    const result = await pool.query(
      `UPDATE pending_applications
       SET status = 'approved', reviewed_at = NOW(), reviewer_id = $1,
           processed_by_admin_id = $1, processed_by_admin_name = $3,
           processed_by_admin_profile_picture_url = $4,
           action_type = 'APPROVED', processed_at = NOW()
       WHERE id = $2
       RETURNING id, issuer_id, organization_name, contact_name, contact_email, status, reviewed_at,
                 processed_by_admin_id, processed_by_admin_name, processed_by_admin_profile_picture_url,
                 action_type, processed_at`,
      [reviewerId, appId, adminName, adminPicture]
    );

    if (result.rows[0]) {
      await pool.query(
        `UPDATE issuer_profiles
         SET status = 'approved', approval_timestamp = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [result.rows[0].issuer_id]
      );

      const profile = await pool.query(
        'SELECT user_id FROM issuer_profiles WHERE id = $1 LIMIT 1',
        [result.rows[0].issuer_id]
      );

      if (profile.rows[0]?.user_id) {
        await User.approveAccount(profile.rows[0].user_id);
        await pool.query(
          `UPDATE users SET user_type = 'issuer', is_active = TRUE, updated_at = NOW() WHERE id = $1`,
          [profile.rows[0].user_id]
        );
      }
    }

    return result.rows[0];
  }

  static async reject(appId, reviewerId, adminName = null, adminPicture = null) {
    if (process.env.DEMO_MODE === 'true') {
      const app = demoAppStore.updateStatus(appId, 'rejected', reviewerId, adminName, adminPicture);
      return app ? {
        id: app.id, issuer_id: app.issuer_id, organization_name: app.organization_name,
        contact_name: app.contact_name, contact_email: app.contact_email,
        status: app.status, reviewed_at: app.reviewed_at,
        processed_by_admin_id: app.processed_by_admin_id,
        processed_by_admin_name: app.processed_by_admin_name,
        processed_by_admin_profile_picture_url: app.processed_by_admin_profile_picture_url,
        action_type: app.action_type, processed_at: app.processed_at
      } : null;
    }

    const result = await pool.query(
      `UPDATE pending_applications
       SET status = 'rejected', reviewed_at = NOW(), reviewer_id = $1,
           processed_by_admin_id = $1, processed_by_admin_name = $3,
           processed_by_admin_profile_picture_url = $4,
           action_type = 'REJECTED', processed_at = NOW()
       WHERE id = $2
       RETURNING id, issuer_id, organization_name, contact_name, contact_email, status, reviewed_at,
                 processed_by_admin_id, processed_by_admin_name, processed_by_admin_profile_picture_url,
                 action_type, processed_at`,
      [reviewerId, appId, adminName, adminPicture]
    );

    if (result.rows[0]?.issuer_id) {
      await pool.query(
        `UPDATE issuer_profiles SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
        [result.rows[0].issuer_id]
      );
    }

    return result.rows[0];
  }

  static async getAll(limit = 50, offset = 0) {
    if (process.env.DEMO_MODE === 'true') {
      return demoAppStore.getAllApplications(limit, offset);
    }

    const result = await pool.query(
      `SELECT * FROM pending_applications
       ORDER BY submitted_at DESC NULLS LAST, id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }

  static async findApplicationByEmail(email) {
    if (process.env.DEMO_MODE === 'true') {
      return demoAppStore.findApplicationByEmail(email);
    }

    const result = await pool.query(
      `SELECT status FROM pending_applications
       WHERE LOWER(contact_email) = LOWER($1) OR LOWER(generated_email) = LOWER($1)
       ORDER BY submitted_at DESC NULLS LAST
       LIMIT 1`,
      [String(email || '').trim()]
    );
    return result.rows[0] || null;
  }

  static async countByStatus(status) {
    if (process.env.DEMO_MODE === 'true') {
      return demoAppStore.countByStatus(status);
    }

    const result = await pool.query(
      `SELECT COUNT(*) as count FROM pending_applications WHERE status = $1`,
      [status]
    );
    return parseInt(result.rows[0].count);
  }
}

module.exports = Application;

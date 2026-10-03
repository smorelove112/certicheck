const pool = require('../db/connection');
const User = require('./User');
const demoAppStore = require('../services/demoApplicationStore');

class Application {
  static findApplicationByEmail(email) {
    if (process.env.DEMO_MODE === 'true') {
      return demoAppStore.findApplicationByEmail(email);
    }
    return null;
  }

  static async create({
    issuerId,
    applicantEmail,
    applicantFirstName,
    applicantLastName,
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
  }) {
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

    const passwordHash = issuerId ? null : await User.getDefaultIssuerPasswordHash();
    const result = await pool.query(
      `WITH applicant_user AS (
         INSERT INTO users (email, password_hash, first_name, last_name, user_type, is_active, must_change_password)
         SELECT $2, $3, $4, $5, 'issuer', FALSE, TRUE
         WHERE $1::INTEGER IS NULL
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id
       ),
       resolved_user AS (
         SELECT id FROM applicant_user
         UNION ALL
         SELECT $1::INTEGER WHERE $1::INTEGER IS NOT NULL
       ),
       issuer_profile AS (
         INSERT INTO issuer_profiles
           (user_id, organization_name, organization_type, website, contact_name, contact_role, certificate_volume, use_case, wallet_address, status)
         SELECT id, $6, $7, $8, $9, $10, $11, $12, $13, 'pending'
         FROM resolved_user
         ON CONFLICT (user_id) DO UPDATE
         SET organization_name = COALESCE(EXCLUDED.organization_name, issuer_profiles.organization_name),
             organization_type = COALESCE(EXCLUDED.organization_type, issuer_profiles.organization_type),
             website = COALESCE(EXCLUDED.website, issuer_profiles.website),
             contact_name = COALESCE(EXCLUDED.contact_name, issuer_profiles.contact_name),
             contact_role = COALESCE(EXCLUDED.contact_role, issuer_profiles.contact_role),
             certificate_volume = COALESCE(EXCLUDED.certificate_volume, issuer_profiles.certificate_volume),
             use_case = COALESCE(EXCLUDED.use_case, issuer_profiles.use_case),
             wallet_address = COALESCE(EXCLUDED.wallet_address, issuer_profiles.wallet_address),
             status = 'pending',
             updated_at = NOW()
         RETURNING id
       ),
       pending_application AS (
         INSERT INTO pending_applications
           (issuer_id, organization_name, organization_type, organization_website, contact_name, contact_email, generated_email, contact_role, certificate_volume, use_case, wallet_address)
         SELECT id, $6, $7, $8, $9, $14, $15, $10, $11, $12, $13
         FROM issuer_profile
         RETURNING id, organization_name, contact_email, generated_email, status, submitted_at
       )
       SELECT pending_application.*, resolved_user.id AS applicant_user_id
       FROM pending_application CROSS JOIN resolved_user`,
      [
        issuerId || null,
        applicantEmail,
        passwordHash,
        applicantFirstName,
        applicantLastName,
        orgName,
        orgType,
        website,
        contactName,
        contactRole,
        volume,
        useCase,
        wallet,
        contactEmail,
        generatedEmail
      ]
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

  static async approve(appId, reviewerId, adminName = null, adminPicture = null, activationCodeHash = null, activationExpiresAt = null) {
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
      `WITH approved_application AS (
         UPDATE pending_applications
         SET status = 'approved', reviewed_at = NOW(), reviewer_id = $1,
             processed_by_admin_id = $1, processed_by_admin_name = $3,
             processed_by_admin_profile_picture_url = $4,
             action_type = 'APPROVED', processed_at = NOW()
         WHERE id = $2
         RETURNING id, issuer_id, organization_name, contact_name, contact_email, status, reviewed_at,
                   processed_by_admin_id, processed_by_admin_name, processed_by_admin_profile_picture_url,
                   action_type, processed_at
       ),
       updated_profile AS (
         UPDATE issuer_profiles
         SET status = 'approved', approval_timestamp = NOW(), updated_at = NOW()
         FROM approved_application
         WHERE issuer_profiles.id = approved_application.issuer_id
         RETURNING issuer_profiles.user_id
       ),
       activated_user AS (
         UPDATE users
         SET is_active = FALSE,
             is_verified = FALSE,
             must_change_password = TRUE,
             activation_code_hash = $5,
             activation_expires_at = $6,
             user_type = 'issuer',
             updated_at = NOW()
         FROM updated_profile
         WHERE users.id = updated_profile.user_id
         RETURNING users.id, users.email AS activation_email
       )
       SELECT approved_application.*, activated_user.activation_email
       FROM approved_application
       LEFT JOIN updated_profile ON TRUE
       LEFT JOIN activated_user ON activated_user.id = updated_profile.user_id`,
      [reviewerId, appId, adminName, adminPicture, activationCodeHash, activationExpiresAt]
    );

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
      `WITH rejected_application AS (
         UPDATE pending_applications
         SET status = 'rejected', reviewed_at = NOW(), reviewer_id = $1,
             processed_by_admin_id = $1, processed_by_admin_name = $3,
             processed_by_admin_profile_picture_url = $4,
             action_type = 'REJECTED', processed_at = NOW()
         WHERE id = $2
         RETURNING id, issuer_id, organization_name, contact_name, contact_email, status, reviewed_at,
                   processed_by_admin_id, processed_by_admin_name, processed_by_admin_profile_picture_url,
                   action_type, processed_at
       ),
       updated_profile AS (
         UPDATE issuer_profiles
         SET status = 'rejected', updated_at = NOW()
         FROM rejected_application
         WHERE issuer_profiles.id = rejected_application.issuer_id
         RETURNING issuer_profiles.id
       )
       SELECT * FROM rejected_application`,
      [reviewerId, appId, adminName, adminPicture]
    );
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

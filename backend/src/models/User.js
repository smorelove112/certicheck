const bcrypt = require('bcryptjs');
const pool = require('../db/connection');

let defaultIssuerPasswordHashPromise;

function getDefaultIssuerPasswordHash() {
  if (!defaultIssuerPasswordHashPromise) {
    defaultIssuerPasswordHashPromise = bcrypt.hash('password', 10).catch(error => {
      defaultIssuerPasswordHashPromise = null;
      throw error;
    });
  }
  return defaultIssuerPasswordHashPromise;
}

class User {
  static getDefaultIssuerPasswordHash() {
    return getDefaultIssuerPasswordHash();
  }

  static normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  static async create(email, password = 'password', firstName, lastName, userType = 'user') {
    const normalizedEmail = this.normalizeEmail(email);
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, user_type, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, FALSE, TRUE)
       RETURNING id, email, first_name, last_name, user_type, is_active, must_change_password, created_at`,
      [normalizedEmail, hashedPassword, firstName, lastName, userType]
    );

    return result.rows[0];
  }

  static async findByEmail(email) {
    const normalizedEmail = this.normalizeEmail(email);
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [normalizedEmail]
    );
    return result.rows[0];
  }

  static async findById(id) {
    if (!id) return null;

    const result = await pool.query(
      'SELECT id, email, first_name, last_name, user_type, is_active, must_change_password, created_at FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  static async findSafeByEmail(email) {
    const normalizedEmail = this.normalizeEmail(email);
    const result = await pool.query(
      'SELECT id, email, first_name, last_name, user_type, is_active, created_at FROM users WHERE email = $1',
      [normalizedEmail]
    );
    return result.rows[0];
  }

  static async getPendingAccounts(limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, user_type, is_active, must_change_password, created_at
       FROM users
       WHERE is_active = FALSE AND COALESCE(user_type, 'user') != 'admin'
       ORDER BY created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }

  static async approveAccount(userId) {
    const hashedPassword = await getDefaultIssuerPasswordHash();
    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1, is_active = TRUE, must_change_password = TRUE, updated_at = NOW()
       WHERE id = $2 AND is_active = FALSE AND COALESCE(user_type, 'user') != 'admin'
       RETURNING id, email, first_name, last_name, user_type, is_active, must_change_password, created_at`,
      [hashedPassword, userId]
    );
    return result.rows[0] || null;
  }

  static async verifyPassword(email, password) {
    const user = await this.findByEmail(email);
    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return null;

    return user;
  }

  static async getAllUsers(limit = 50, offset = 0) {
    const result = await pool.query(
      'SELECT id, email, first_name, last_name, user_type, is_active, created_at FROM users LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return result.rows;
  }

  static async updateProfile(userId, firstName, lastName) {
    const result = await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, email, first_name, last_name, user_type, is_active, created_at`,
      [firstName, lastName, userId]
    );
    return result.rows[0];
  }

  static async updatePassword(email, newPassword, mustChangePassword = false) {
    const normalizedEmail = this.normalizeEmail(email);
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    const result = await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = $3, updated_at = NOW()
       WHERE email = $2
       RETURNING id, email, first_name, last_name, user_type, is_active, must_change_password, created_at`,
      [hashedPassword, normalizedEmail, mustChangePassword]
    );
    return result.rows[0];
  }

  static async activateIssuer(email, activationCodeHash, newPassword) {
    const normalizedEmail = this.normalizeEmail(email);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1,
           is_active = TRUE,
           is_verified = TRUE,
           must_change_password = FALSE,
           activation_code_hash = NULL,
           activation_expires_at = NULL,
           updated_at = NOW()
       WHERE email = $2
         AND user_type = 'issuer'
         AND activation_code_hash = $3
         AND activation_expires_at > NOW()
         AND EXISTS (
           SELECT 1 FROM issuer_profiles
           WHERE issuer_profiles.user_id = users.id AND issuer_profiles.status = 'approved'
         )
       RETURNING id, email, first_name, last_name, user_type, is_active, is_verified`,
      [passwordHash, normalizedEmail, activationCodeHash]
    );
    return result.rows[0] || null;
  }

  static async verifyIssuerActivation(email, activationCodeHash) {
    const normalizedEmail = this.normalizeEmail(email);
    const result = await pool.query(
      `SELECT users.id
       FROM users
       JOIN issuer_profiles ON issuer_profiles.user_id = users.id
       WHERE users.email = $1
         AND users.user_type = 'issuer'
         AND users.activation_code_hash = $2
         AND users.activation_expires_at > NOW()
         AND issuer_profiles.status = 'approved'
       LIMIT 1`,
      [normalizedEmail, activationCodeHash]
    );
    return result.rows.length > 0;
  }

  static async renewIssuerActivation(email, activationCodeHash, expiresAt) {
    const normalizedEmail = this.normalizeEmail(email);
    const result = await pool.query(
      `UPDATE users
       SET activation_code_hash = $2,
           activation_expires_at = $3,
           updated_at = NOW()
       WHERE email = $1
         AND user_type = 'issuer'
         AND is_active = FALSE
         AND EXISTS (
           SELECT 1 FROM issuer_profiles
           WHERE issuer_profiles.user_id = users.id
             AND issuer_profiles.status = 'approved'
         )
       RETURNING id, email, first_name, last_name,
         (SELECT organization_name FROM issuer_profiles WHERE user_id = users.id LIMIT 1) AS organization_name`,
      [normalizedEmail, activationCodeHash, expiresAt]
    );
    return result.rows[0] || null;
  }
}

module.exports = User;

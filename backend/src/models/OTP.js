const pool = require('../db/connection');
const crypto = require('crypto');

class OTP {
  static async create(email, purpose = 'reset_password') {
    const otpCode = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 15 * 60000);

    // Invalidate previous active OTPs for this email and purpose
    await pool.query(
      `UPDATE otp_verification 
       SET is_used = TRUE 
       WHERE email = $1 AND purpose = $2 AND is_used = FALSE`,
      [email, purpose]
    );

    const result = await pool.query(
      `INSERT INTO otp_verification (email, otp_code, purpose, expires_at, is_used)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, email, otp_code, purpose, expires_at`,
      [email, otpCode, purpose, expiresAt]
    );

    return result.rows[0];
  }

  static async verify(email, otpCode, purpose = 'reset_password') {
    const result = await pool.query(
      `SELECT * FROM otp_verification 
       WHERE email = $1 
         AND otp_code = $2 
         AND purpose = $3 
         AND is_used = FALSE 
         AND expires_at > NOW() 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [email, otpCode, purpose]
    );

    if (result.rows.length === 0) {
      return false;
    }

    return true; // We don't mark it as used yet until the final action is complete
  }

  static async consume(email, otpCode, purpose = 'reset_password') {
    const result = await pool.query(
      `UPDATE otp_verification 
       SET is_used = TRUE 
       WHERE email = $1 
         AND otp_code = $2 
         AND purpose = $3 
         AND is_used = FALSE 
         AND expires_at > NOW() 
       RETURNING id`,
      [email, otpCode, purpose]
    );

    return result.rows.length > 0;
  }
}

module.exports = OTP;

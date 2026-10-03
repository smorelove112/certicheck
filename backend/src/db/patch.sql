DROP TABLE IF EXISTS otp_verification;
CREATE TABLE otp_verification (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_code VARCHAR(10) NOT NULL,
  purpose VARCHAR(50) DEFAULT 'reset_password',
  expires_at TIMESTAMP NOT NULL,
  is_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_otp_email ON otp_verification(email, is_used, expires_at);

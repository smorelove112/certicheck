const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.memoryStore = new Map();
    this.initTransporter();
  }

  initTransporter() {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      this.mode = 'smtp';
      console.log('📧 Email Service: SMTP configured');
    } else {
      this.transporter = null;
      this.mode = process.env.NODE_ENV === 'production' ? 'disabled' : 'console';
      if (this.mode === 'console') {
        console.log('📧 Email Service: Running in Development/Console Mode');
      } else {
        console.error('📧 Email Service: SMTP credentials are required in production');
      }
    }
  }

  getFromAddress() {
    return process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@certicheck.com';
  }

  async sendEmail({ to, subject, html, text }) {
    if (this.mode === 'console') {
      console.log('\n=========================================');
      console.log(`✉️  EMAIL MOCK TO: ${to}`);
      console.log(`🏷️  SUBJECT: ${subject}`);
      console.log(`📝  TEXT: ${text || html}`);
      console.log('=========================================\n');
      return true;
    }
    if (this.mode !== 'smtp') {
      console.error('📧 Email Send Error: SMTP is not configured');
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.getFromAddress(),
        to,
        subject,
        text,
        html,
      });
      console.log(`✉️  Email sent to ${to}: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error('📧 Email Send Error:', error);
      return false;
    }
  }

  async sendOTP(email, otpCode) {
    this.memoryStore.set(email, otpCode);
    const subject = 'Your Certicheck Verification Code';
    const text = `Your verification code is: ${otpCode}. It will expire in 15 minutes.`;
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px;">
        <h2 style="color: #4f46e5;">Certicheck</h2>
        <p>Hello,</p>
        <p>Your verification code is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; margin: 30px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
          ${otpCode}
        </div>
        <p>This code will expire in 15 minutes.</p>
        <p style="color: #666; font-size: 13px; margin-top: 40px;">If you didn't request this code, you can safely ignore this email.</p>
      </div>
    `;

    return this.sendEmail({ to: email, subject, text, html });
  }

  // Helper method for testing in development
  getLastSentOTP(email) {
    return this.memoryStore.get(email);
  }
}

module.exports = new EmailService();

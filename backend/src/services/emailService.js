const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

class EmailService {
  constructor() {
    this.memoryStore = new Map();
    this.transportVerification = { status: 'not-configured' };
    this.initTransporter();
  }

  initTransporter() {
    const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
    const port = Number.parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT, 10) || 587;
    const secureSetting = process.env.SMTP_SECURE ?? process.env.EMAIL_SECURE;
    const secure = secureSetting === undefined ? port === 465 : secureSetting === 'true';

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        auth: {
          user,
          pass,
        },
      });
      this.mode = 'smtp';
      this.transportVerification = { status: 'pending' };
      console.log('📧 Email Service: SMTP configured');
    } else {
      this.transporter = null;
      this.mode = process.env.NODE_ENV === 'production' ? 'disabled' : 'console';
      this.transportVerification = { status: this.mode };
      if (this.mode === 'console') {
        console.log('📧 Email Service: Running in Development/Console Mode');
      } else {
        console.error('📧 Email Service: SMTP_HOST, SMTP_USER, and SMTP_PASS (or EMAIL_* equivalents) are required in production');
      }
    }
  }

  getFromAddress() {
    return process.env.SMTP_FROM || process.env.EMAIL_FROM ||
      process.env.SMTP_USER || process.env.EMAIL_USER || 'noreply@certicheck.com';
  }

  getStatus() {
    return {
      mode: this.mode,
      configured: this.mode === 'smtp',
      verification: this.transportVerification.status,
      errorCode: this.transportVerification.errorCode || null
    };
  }

  async verifyTransport() {
    if (this.mode !== 'smtp') return this.getStatus();

    try {
      await this.transporter.verify();
      this.transportVerification = { status: 'verified' };
      console.log('📧 Email Service: SMTP connection and authentication verified');
    } catch (error) {
      const errorCode = error.code || error.name || 'SMTP_VERIFY_FAILED';
      this.transportVerification = { status: 'failed', errorCode };
      console.error(`📧 Email Service: SMTP verification failed (${errorCode}${error.responseCode ? `, response ${error.responseCode}` : ''}): ${error.message}`);
    }
    return this.getStatus();
  }

  async sendEmail({ to, subject, html, text, attachments = [] }) {
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
        attachments,
      });
      const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
      if (accepted === 0) {
        console.error(`📧 Email rejected by SMTP server (${info.responseCode || 'no response code'}): ${info.rejected?.length ? 'recipient rejected' : 'no accepted recipient'}`);
        return false;
      }
      console.log(`✉️  SMTP accepted email for delivery: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error(`📧 Email Send Error (${error.code || error.name || 'SMTP_SEND_FAILED'}${error.responseCode ? `, response ${error.responseCode}` : ''}${error.command ? `, command ${error.command}` : ''}): ${error.message}`);
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

  async sendApplicationReceived({ to, contactName, organizationName }) {
    const safeName = escapeHtml(contactName);
    const safeOrganization = escapeHtml(organizationName);
    return this.sendEmail({
      to,
      subject: 'We received your CertiCheck issuer application',
      text: `Hello ${contactName}, we received the issuer application for ${organizationName}. Our team will review it and email you with an update.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#1e1b4b"><h1>Application received</h1><p>Hello ${safeName},</p><p>We received the issuer application for <strong>${safeOrganization}</strong>. Our team will review it and email you with an update.</p><p>Thank you,<br/>CertiCheck</p></div>`
    });
  }

  async sendApplicationApproval({ to, contactName, organizationName, activationCode, activationUrl }) {
    const safeName = escapeHtml(contactName);
    const safeOrganization = escapeHtml(organizationName);
    const safeCode = escapeHtml(activationCode);
    const safeUrl = escapeHtml(activationUrl);
    return this.sendEmail({
      to,
      subject: 'Your CertiCheck issuer application was approved',
      text: `Hello ${contactName}, the issuer application for ${organizationName} was approved. Activate your issuer account at ${activationUrl} using code ${activationCode} within 15 minutes.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#1e1b4b"><h1>Application approved</h1><p>Hello ${safeName},</p><p>The issuer application for <strong>${safeOrganization}</strong> has been approved.</p><p>Use this activation code within 15 minutes:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:18px;background:#f4f0ff;border-radius:8px">${safeCode}</p><p><a href="${safeUrl}">Activate your issuer account</a></p><p>CertiCheck will never ask you to send this code to anyone.</p></div>`
    });
  }

  async sendCertificateIssued(certificate, verificationUrl) {
    const holderName = escapeHtml(certificate.holder_name || certificate.holderName);
    const certificateType = escapeHtml(certificate.certificate_type || certificate.certificateType);
    const issuerName = escapeHtml(certificate.issuer_name || certificate.issuerName);
    const certificateId = escapeHtml(certificate.certificate_id || certificate.certificateId);
    const issuedAt = certificate.issued_at || certificate.issuedAt || new Date().toISOString();
    const ipfsCid = certificate.ipfs_cid || certificate.ipfsCid;
    const tx = certificate.blockchain_transaction_id || certificate.blockchainTransactionId;
    const details = certificate.metadata && typeof certificate.metadata === 'object'
      ? Object.entries(certificate.metadata)
          .filter(([key, value]) => key !== 'attachment' && value !== undefined && value !== null)
          .map(([key, value]) => {
            const detail = typeof value === 'string' ? value : JSON.stringify(value);
            return `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(detail.slice(0, 500))}</li>`;
          })
          .join('')
      : '';
    const ipfsLink = ipfsCid
      ? certificate.ipfs_source === 'pinata'
        ? `<p><strong>IPFS CID:</strong> <a href="https://gateway.pinata.cloud/ipfs/${encodeURIComponent(ipfsCid)}">${escapeHtml(ipfsCid)}</a></p>`
        : `<p><strong>Record ID:</strong> ${escapeHtml(ipfsCid)} (not pinned to IPFS)</p>`
      : '';
    const chainStatus = certificate.on_chain === true
      ? 'Confirmed on Solana'
      : 'Off-chain record; not confirmed on Solana';
    const cluster = encodeURIComponent(process.env.SOLANA_CLUSTER || 'devnet');
    const transactionLink = tx
      ? `<p><strong>Solana transaction:</strong> <a href="https://explorer.solana.com/tx/${encodeURIComponent(tx)}?cluster=${cluster}">${escapeHtml(tx)}</a></p>`
      : '<p><strong>Network status:</strong> Off-chain record</p>';
    const safeVerificationUrl = escapeHtml(verificationUrl);
    const qrCode = await QRCode.toBuffer(verificationUrl, { type: 'png', width: 180, margin: 1 });
    return this.sendEmail({
      to: certificate.holder_email || certificate.holderEmail,
      subject: `Your ${certificate.certificate_type || certificate.certificateType || 'certificate'} from ${certificate.issuer_name || certificate.issuerName || 'CertiCheck'}`,
      text: `Hello ${certificate.holder_name || certificate.holderName}, your ${certificate.certificate_type || certificate.certificateType} certificate (${certificate.certificate_id || certificate.certificateId}) has been issued by ${certificate.issuer_name || certificate.issuerName}. ${chainStatus}. Verify it at ${verificationUrl}.`,
      attachments: [{ filename: 'certificate-verification.png', content: qrCode, cid: 'certificate-verification-qr' }],
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px;color:#1e1b4b"><div style="border:2px solid #7c3aed;border-radius:16px;padding:24px;background:#faf8ff"><p style="color:#6d28d9;font-weight:bold;letter-spacing:2px">CERTICHECK · DIGITAL CREDENTIAL</p><h1>${certificateType}</h1><p>Presented to <strong>${holderName}</strong></p><p>Issued by ${issuerName} on ${escapeHtml(new Date(issuedAt).toLocaleDateString())}</p><p><strong>Certificate ID:</strong> ${certificateId}</p><p><strong>Issuance status:</strong> Valid</p><p><strong>On-chain status:</strong> ${chainStatus}</p>${details ? `<h2>Credential details</h2><ul>${details}</ul>` : ''}${ipfsLink}${transactionLink}<p><a href="${safeVerificationUrl}">View and verify your certificate</a></p><p><img src="cid:certificate-verification-qr" width="180" height="180" alt="QR code to verify this certificate"/></p></div></div>`
    });
  }

  // Helper method for tests only.
  getLastSentOTP(email) {
    return this.memoryStore.get(email);
  }
}

module.exports = new EmailService();

const nodemailer = require('nodemailer');

function configuredSmtpUser() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) return process.env.SMTP_USER;
  if (!process.env.SMTP_HOST && process.env.EMAIL_USER) return process.env.EMAIL_USER;
  return process.env.SMTP_USER || process.env.EMAIL_USER;
}

function configuredSmtpPassword() {
  return String(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS || '')
    .replace(/\s+/g, '');
}

function configuredSmtpPort() {
  const port = Number.parseInt(process.env.SMTP_PORT || '465', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid port number between 1 and 65535.');
  }
  return port;
}

function configuredSmtpSecure(port) {
  if (process.env.SMTP_SECURE === undefined || process.env.SMTP_SECURE.trim() === '') {
    return port === 465;
  }
  const setting = process.env.SMTP_SECURE.trim().toLowerCase();
  if (setting !== 'true' && setting !== 'false') {
    throw new Error('SMTP_SECURE must be set to true or false.');
  }
  return setting === 'true';
}

function getSmtpFailureReason(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'EMAIL_NOT_CONFIGURED') {
    return 'Email credentials are missing. Configure a provider username and password in the backend environment.';
  }
  if (code === 'EMAIL_FROM_MISMATCH') {
    return 'EMAIL_FROM must match the authenticated email account.';
  }
  if (code === 'EAUTH' || code === 'AUTHENTICATIONFAILED' || code === '534') {
    return 'The email provider rejected authentication. For Gmail, use an app password with 2-Step Verification enabled.';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'EDNS') {
    return 'The backend could not connect to the email provider. Check the provider, host, port, TLS settings, and outbound network access.';
  }
  if (code === 'EENVELOPE' || code === 'EMESSAGE') {
    return 'The provider rejected the sender or message. Check the sender account and recipient address.';
  }
  return 'Email provider verification or delivery failed. Check backend logs and provider configuration.';
}

function escapeMarkup(value) {
  return String(value ?? '—').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function buildMiniCertificateSvg({ holderName, certificateId, certificateType, issuerName, issuedAt }) {
  const holder = escapeMarkup(holderName || 'Certificate holder');
  const id = escapeMarkup(certificateId);
  const type = escapeMarkup(certificateType || 'Certificate');
  const issuer = escapeMarkup(issuerName || 'Certicheck issuer');
  const date = escapeMarkup(issuedAt ? new Date(issuedAt).toLocaleDateString('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  }) : 'Date not provided');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520" role="img" aria-labelledby="title description">
  <title id="title">Certicheck mini certificate for ${holder}</title>
  <desc id="description">${type}, issued to ${holder} by ${issuer}.</desc>
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" /><stop offset="1" stop-color="#f4f0ff" /></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7c3aed" /><stop offset="1" stop-color="#4338ca" /></linearGradient>
  </defs>
  <rect width="900" height="520" rx="32" fill="#ede9fe" />
  <rect x="18" y="18" width="864" height="484" rx="25" fill="url(#paper)" stroke="#7c3aed" stroke-width="3" />
  <path d="M52 58h796" stroke="#ddd6fe" stroke-width="2" />
  <circle cx="92" cy="100" r="31" fill="url(#accent)" />
  <path d="M78 100 88 110 107 87" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
  <text x="140" y="94" fill="#312e81" font-family="Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="3">CERTICHECK · SOLANA CREDENTIAL</text>
  <text x="450" y="190" text-anchor="middle" fill="#6d28d9" font-family="Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="5">CERTIFICATE OF ACHIEVEMENT</text>
  <text x="450" y="252" text-anchor="middle" fill="#1e1b4b" font-family="Arial,sans-serif" font-size="34" font-weight="700">${type}</text>
  <text x="450" y="302" text-anchor="middle" fill="#64748b" font-family="Arial,sans-serif" font-size="17">Proudly presented to</text>
  <text x="450" y="352" text-anchor="middle" fill="#312e81" font-family="Arial,sans-serif" font-size="30" font-weight="700">${holder}</text>
  <text x="450" y="397" text-anchor="middle" fill="#64748b" font-family="Arial,sans-serif" font-size="16">Issued by ${issuer} · ${date}</text>
  <path d="M52 434h796" stroke="#ddd6fe" stroke-width="2" />
  <text x="60" y="470" fill="#475569" font-family="monospace" font-size="15">ID: ${id}</text>
  <text x="840" y="470" text-anchor="end" fill="#059669" font-family="Arial,sans-serif" font-size="15" font-weight="700">● VALID</text>
</svg>`;
}

// Email service for sending OTPs and notification emails
class EmailService {
  static transporter = null;
  static smtpVerified = false;
  static lastVerificationIssue = null;
  static memoryStore = new Map(); // For testing and development reference

  /**
   * Validate email address syntax according to RFC standards
   * @param {string} email 
   * @returns {boolean}
   */
  static isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const clean = email.trim().toLowerCase();
    if (clean.length > 254) return false;
    const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!re.test(clean)) return false;
    const parts = clean.split('@');
    if (parts.length !== 2) return false;
    if (parts[0].length > 64 || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) return false;
    const domain = parts[1];
    if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
    return true;
  }

  static initTransporter() {
    if (this.transporter) return;

    const smtpUser = configuredSmtpUser();
    const smtpPassword = configuredSmtpPassword();
    const emailService = process.env.EMAIL_SERVICE || 'gmail';
    const smtpHost = process.env.SMTP_HOST || (emailService.toLowerCase() === 'gmail' ? 'smtp.gmail.com' : '');
    const hasCustomSmtp = Boolean(smtpHost && smtpUser && smtpPassword);
    const hasEmailService = Boolean(process.env.EMAIL_USER && smtpPassword);

    // 1. Use explicit SMTP settings for Gmail and configured SMTP providers.
    if (hasCustomSmtp) {
      const port = configuredSmtpPort();
      console.log(`✓ EmailService: Using SMTP on ${smtpHost}:${port}`);
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: configuredSmtpSecure(port),
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        auth: {
          user: smtpUser,
          pass: smtpPassword
        }
      });
      return;
    }

    // 2. Other Nodemailer well-known services.
    if (hasEmailService) {
      console.log(`✓ EmailService: Using ${emailService} transport`);
      this.transporter = nodemailer.createTransport({
        service: emailService,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        auth: {
          user: process.env.EMAIL_USER,
          pass: smtpPassword
        }
      });
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      const error = new Error('Email delivery is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS (or EMAIL_USER and EMAIL_PASSWORD).');
      error.code = 'EMAIL_NOT_CONFIGURED';
      throw error;
    }

    // Development mode - log prominently to console
    console.log('ℹ EmailService: No live SMTP credentials found; running in development console mode.');
    this.transporter = {
      sendMail: async (options) => {
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 📧 EMAIL DISPATCHED (Development / Test Mode)               │');
        console.log(`│ To:      ${options.to.padEnd(50)} │`);
        console.log(`│ Subject: ${options.subject.padEnd(50)} │`);
        if (options.otpCode) {
          console.log(`│ OTP:     ${options.otpCode.padEnd(50)} │`);
        }
        console.log('└─────────────────────────────────────────────────────────────┘\n');
        return { response: 'logged to console', messageId: `dev-${Date.now()}` };
      }
    };
  }

  static getConfigurationStatus() {
    const smtpUser = configuredSmtpUser();
    const smtpPassword = configuredSmtpPassword();
    const hasCustomSmtp = Boolean(process.env.SMTP_HOST && smtpUser && smtpPassword);
    const hasEmailService = Boolean(process.env.EMAIL_USER && smtpPassword);
    return {
      mode: hasCustomSmtp || hasEmailService ? 'smtp' : 'console',
      provider: hasCustomSmtp ? 'custom-smtp' : hasEmailService ? (process.env.EMAIL_SERVICE || 'gmail') : 'console'
    };
  }

  static assertConfigured() {
    this.initTransporter();
    if (process.env.NODE_ENV === 'production') this.getFromAddress();
  }

  static async verifyTransporter() {
    this.smtpVerified = false;
    this.lastVerificationIssue = null;
    try {
      this.initTransporter();
      if (this.getConfigurationStatus().mode !== 'smtp') return false;
      this.getFromAddress();
      await this.transporter.verify();
      this.smtpVerified = true;
      console.log('✓ EmailService: SMTP connection verified and ready to send messages.');
      return true;
    } catch (err) {
      this.lastVerificationIssue = getSmtpFailureReason(err);
      console.warn(`EmailService warning: ${this.lastVerificationIssue}`);
      return false;
    }
  }

  static getReadiness() {
    const config = this.getConfigurationStatus();
    const configured = config.mode === 'smtp';
    return {
      configured,
      verified: configured && this.smtpVerified,
      provider: config.provider,
      status: !configured ? 'not_configured' : this.smtpVerified ? 'ready' : 'not_verified',
      issue: !configured
        ? 'Email provider username and password are not configured.'
        : this.smtpVerified ? null : this.lastVerificationIssue || 'SMTP connection has not been verified.'
    };
  }

  static recordDeliveryFailure(error, context) {
    const reason = getSmtpFailureReason(error);
    this.lastVerificationIssue = reason;
    this.smtpVerified = false;
    console.error(`EmailService ${context} failed: ${reason}`);
    return reason;
  }

  static getFromAddress() {
    const smtpUser = configuredSmtpUser();
    const fromAddress = process.env.EMAIL_FROM || smtpUser || null;

    if (fromAddress && smtpUser) {
      const mailbox = fromAddress.match(/<([^<>]+)>/)?.[1] || fromAddress;
      if (mailbox.trim().toLowerCase() !== smtpUser.trim().toLowerCase()) {
        const error = new Error('EMAIL_FROM must match the configured SMTP sender account.');
        error.code = 'EMAIL_FROM_MISMATCH';
        throw error;
      }
    }

    return fromAddress;
  }

  static async sendEmail({ to, subject, html }) {
    this.initTransporter();
    const normalizedEmail = String(to || '').trim().toLowerCase();
    if (!this.isValidEmail(normalizedEmail)) {
      throw new Error('A valid recipient email address is required.');
    }
    try {
      return await this.transporter.sendMail({
        from: this.getFromAddress(),
        to: normalizedEmail,
        subject,
        html
      });
    } catch (err) {
      this.recordDeliveryFailure(err, 'message delivery');
      throw err;
    }
  }

  static async sendOTP(email, otp, otpType = 'signup') {
    this.initTransporter();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    this.memoryStore.set(normalizedEmail, { otp, type: otpType, sentAt: new Date() });

    const subject = otpType === 'forgot_password' 
      ? 'Password Reset OTP - CertiCheck' 
      : 'Email Verification OTP - CertiCheck';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f0f4f8; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0;">
          <h2 style="color: #4f46e5; margin-top: 0; margin-bottom: 16px;">
            ${otpType === 'forgot_password' ? 'Reset Your Password' : 'Verify Your Email'}
          </h2>
          
          <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">
            ${otpType === 'forgot_password' 
              ? 'We received a request to reset your password. Use the code below to proceed:' 
              : 'Welcome to CertiCheck! Please verify your email using the one-time password below to complete your registration:'}
          </p>
          
          <div style="background-color: white; padding: 24px; border-radius: 8px; margin: 24px 0; text-align: center; border: 2px solid #6366f1;">
            <p style="margin: 0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Verification Code (OTP)</p>
            <p style="margin: 12px 0 0 0; font-size: 36px; font-weight: 800; color: #1e1b4b; letter-spacing: 8px; font-family: monospace;">
              ${otp}
            </p>
          </div>
          
          <p style="color: #64748b; font-size: 13px; margin: 16px 0;">
            This code will expire in <strong>10 minutes</strong>. If you did not make this request, you can safely ignore this email.
          </p>
          
          <hr style="border: none; border-top: 1px solid #cbd5e1; margin: 20px 0;">
          
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            CertiCheck — Decentralised Academic & Professional Credentials on Solana
          </p>
        </div>
      </div>
    `;

    try {
      const info = await this.transporter.sendMail({
        from: this.getFromAddress(),
        to: normalizedEmail,
        subject,
        html,
        otpCode: otp
      });

      return { success: true, info };
    } catch (err) {
      this.recordDeliveryFailure(err, 'OTP delivery');
      throw err;
    }
  }

  static async sendWelcome(email, firstName) {
    this.initTransporter();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f0f4f8; padding: 24px; border-radius: 12px;">
          <h2 style="color: #4f46e5; margin-top: 0;">
            Welcome to CertiCheck, ${firstName || 'there'}!
          </h2>
          <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">
            Your account registration is complete and is pending admin approval. We will notify you when you can sign in.
          </p>
        </div>
      </div>
    `;

    try {
      return await this.transporter.sendMail({
        from: this.getFromAddress(),
        to: normalizedEmail,
        subject: 'Welcome to CertiCheck',
        html
      });
    } catch (err) {
      this.recordDeliveryFailure(err, 'welcome email delivery');
      throw err;
    }
  }

  static async sendApplicationReceived(email, applicantName, organizationName) {
    this.initTransporter();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#f0f4f8;padding:24px;border-radius:12px;border:1px solid #e2e8f0;">
          <h2 style="color:#4f46e5;margin-top:0;">Application received</h2>
          <p style="color:#4b5563;font-size:15px;line-height:1.6;">Hello ${applicantName || 'there'},</p>
          <p style="color:#4b5563;font-size:15px;line-height:1.6;">We received your issuer application for <strong>${organizationName || 'your institution'}</strong>.</p>
          <p style="color:#4b5563;font-size:15px;line-height:1.6;">Our team will review it and email you when a decision has been made.</p>
          <p style="color:#94a3b8;font-size:12px;">CertiCheck — Decentralised Academic &amp; Professional Credentials on Solana</p>
        </div>
      </div>
    `;

    try {
      return await this.transporter.sendMail({
        from: this.getFromAddress(),
        to: normalizedEmail,
        subject: 'We received your CertiCheck issuer application',
        html
      });
    } catch (err) {
      this.recordDeliveryFailure(err, 'application receipt delivery');
      throw err;
    }
  }

  static async sendApplicationDecision(email, applicantName, organizationName, approved, reason = '') {
    this.initTransporter();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const decision = approved ? 'approved' : 'not approved';
    const subject = approved
      ? 'Your CertiCheck issuer application was approved'
      : 'Update on your CertiCheck issuer application';
    const reasonMarkup = reason
      ? `<p style="color:#4b5563;font-size:15px;line-height:1.6;"><strong>Reason:</strong> ${String(reason)}</p>`
      : '';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#f0f4f8;padding:24px;border-radius:12px;border:1px solid #e2e8f0;">
          <h2 style="color:#4f46e5;margin-top:0;">Issuer application ${decision}</h2>
          <p style="color:#4b5563;font-size:15px;line-height:1.6;">Hello ${applicantName || 'there'},</p>
          <p style="color:#4b5563;font-size:15px;line-height:1.6;">Your issuer application for <strong>${organizationName || 'your institution'}</strong> has been <strong>${decision}</strong>.</p>
          ${reasonMarkup}
          ${approved ? '<p style="color:#4b5563;font-size:15px;line-height:1.6;">You can now sign in and access the issuer dashboard.</p>' : '<p style="color:#4b5563;font-size:15px;line-height:1.6;">You may contact the CertiCheck team if you need more information.</p>'}
          <p style="color:#94a3b8;font-size:12px;">CertiCheck — Decentralised Academic &amp; Professional Credentials on Solana</p>
        </div>
      </div>
    `;

    try {
      return await this.transporter.sendMail({
        from: this.getFromAddress(),
        to: normalizedEmail,
        subject,
        html
      });
    } catch (err) {
      this.recordDeliveryFailure(err, 'application decision delivery');
      return null;
    }
  }

  static async sendCertificateIssued({ holderEmail, holderName, certificateId, certificateType, issuerName, issuerWallet, issuedAt, ipfsCid, blockchainTransactionId, metadata = {} }) {
    const to = String(holderEmail || '').trim().toLowerCase();
    if (!this.isValidEmail(to)) return { success: false, sent: false, error: 'A valid holder email is required' };

    const escapeHtml = escapeMarkup;
    const metadataRows = Object.entries(metadata && typeof metadata === 'object' ? metadata : {})
      .filter(([key, value]) => !['attachment', 'media', 'dataUrl', 'imageData', 'generatedBy'].includes(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value)))
      .slice(0, 16)
      .map(([key, value]) => `<tr><th style="padding:7px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0">${escapeHtml(key.replace(/([A-Z])/g, ' $1'))}</th><td style="padding:7px 10px;color:#0f172a;border-bottom:1px solid #e2e8f0">${escapeHtml(value)}</td></tr>`)
      .join('');
    const supportingFile = metadata?.attachment;
    const attachmentMatch = typeof supportingFile?.dataUrl === 'string'
      ? supportingFile.dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/)
      : null;
    const attachments = attachmentMatch && supportingFile?.name
      ? [{
          filename: String(supportingFile.name).replace(/[^a-zA-Z0-9._ -]/g, '_'),
          content: Buffer.from(attachmentMatch[2], 'base64'),
          contentType: String(supportingFile.type || attachmentMatch[1]).replace(/[^a-zA-Z0-9!#$&^_.+-/]/g, '')
        }]
      : [];
    const miniCertificateSvg = buildMiniCertificateSvg({
      holderName,
      certificateId,
      certificateType,
      issuerName,
      issuedAt
    });
    attachments.push({
      filename: `certicheck-mini-certificate-${String(certificateId || 'credential').replace(/[^a-zA-Z0-9_-]/g, '_')}.svg`,
      content: Buffer.from(miniCertificateSvg),
      contentType: 'image/svg+xml'
    });
    const subject = `Certificate issued: ${String(certificateType || 'Certificate')}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;line-height:1.55">
        <div style="padding:24px;border:1px solid #dbe3ef;border-radius:14px;background:#fff">
          <h2 style="margin:0 0 8px;color:#312e81">Your certificate has been issued</h2>
          <p>Hello ${escapeHtml(holderName)},</p>
          <p>${escapeHtml(issuerName)} has issued you a ${escapeHtml(certificateType)} certificate.</p>
          <div style="margin:20px 0;padding:22px 16px;border:2px solid #7c3aed;border-radius:16px;background:linear-gradient(135deg,#fff 0%,#f4f0ff 100%);text-align:center">
            <div style="font-size:11px;font-weight:700;letter-spacing:3px;color:#6d28d9">CERTICHECK · SOLANA CREDENTIAL</div>
            <div style="margin-top:12px;font-size:21px;font-weight:700;color:#312e81">${escapeHtml(certificateType || 'Certificate')}</div>
            <div style="margin-top:6px;color:#64748b;font-size:13px">Proudly presented to</div>
            <div style="margin-top:5px;font-size:19px;font-weight:700;color:#1e1b4b">${escapeHtml(holderName)}</div>
            <div style="margin-top:13px;font-size:12px;color:#475569">${escapeHtml(issuerName)} · ${escapeHtml(issuedAt)}</div>
            <div style="margin-top:12px;padding-top:10px;border-top:1px solid #ddd6fe;font-family:monospace;font-size:12px;color:#475569">Certificate ID: ${escapeHtml(certificateId)} · <strong style="color:#059669">VALID</strong></div>
          </div>
          <p style="color:#64748b;font-size:13px">Your mini-certificate is attached as an SVG image that you can save, print, or share.</p>
          <table style="width:100%;border-collapse:collapse;margin:18px 0">
            <tr><th style="padding:7px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0">Certificate ID</th><td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(certificateId)}</td></tr>
            <tr><th style="padding:7px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0">Type</th><td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(certificateType)}</td></tr>
            <tr><th style="padding:7px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0">Issuer</th><td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(issuerName)}</td></tr>
            <tr><th style="padding:7px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0">Issued</th><td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(issuedAt)}</td></tr>
            ${issuerWallet ? `<tr><th style="padding:7px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0">Issuer wallet</th><td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(issuerWallet)}</td></tr>` : ''}
            ${ipfsCid ? `<tr><th style="padding:7px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0">IPFS record</th><td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(ipfsCid)}</td></tr>` : ''}
            ${blockchainTransactionId ? `<tr><th style="padding:7px 10px;text-align:left;color:#475569;border-bottom:1px solid #e2e8f0">Transaction</th><td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(blockchainTransactionId)}</td></tr>` : ''}
            ${metadataRows}
          </table>
          ${attachments.length ? `<p>The supporting file <strong>${escapeHtml(attachments[0].filename)}</strong> is attached to this email and included with the certificate record.</p>` : ''}
          <div style="padding:14px;background:#f1f5f9;border-radius:10px">
            <strong>Important information</strong>
            <ul style="margin:8px 0 0;padding-left:20px">
              <li>This email confirms issuance; check the certificate status on Certicheck before relying on it.</li>
              <li>The issuer may revoke a certificate. A revoked certificate will no longer show as valid.</li>
              <li>Keep the certificate ID with your records and do not alter the issued certificate or supporting file.</li>
            </ul>
          </div>
          <p style="margin:18px 0 0;color:#64748b;font-size:12px">Certicheck certificate notification</p>
        </div>
      </div>
    `;

    try {
      this.initTransporter();
      await this.transporter.sendMail({ from: this.getFromAddress(), to, subject, html, attachments });
      const mode = this.getConfigurationStatus().mode;
      return { success: true, sent: mode === 'smtp', mode };
    } catch (err) {
      const reason = this.recordDeliveryFailure(err, 'certificate notification delivery');
      return { success: false, sent: false, mode: 'error', error: reason };
    }
  }

  static getLastSentOTP(email) {
    const normalized = String(email || '').trim().toLowerCase();
    return this.memoryStore.get(normalized) || null;
  }
}

module.exports = EmailService;

const crypto = require('crypto');
const QRCode = require('qrcode');
const { google } = require('googleapis');

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
    const gmailEnvironment = {
      GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
      GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN,
      GMAIL_FROM: process.env.GMAIL_FROM
    };
    const missingGmailSettings = Object.entries(gmailEnvironment)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    const hasGmailConfig = missingGmailSettings.length < Object.keys(gmailEnvironment).length;
    this.missingGmailSettings = missingGmailSettings;
    this.oauth2Client = null;
    this.gmailApi = null;
    if (missingGmailSettings.length === 0) {
      this.oauth2Client = new google.auth.OAuth2(
        gmailEnvironment.GMAIL_CLIENT_ID,
        gmailEnvironment.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
      );
      this.oauth2Client.setCredentials({ refresh_token: gmailEnvironment.GMAIL_REFRESH_TOKEN });
      this.gmailApi = google.gmail({ version: 'v1', auth: this.oauth2Client });
      this.mode = 'gmail-api';
      this.transportVerification = { status: 'pending' };
      console.log('📧 Email Service: Gmail API configured');
      return;
    }
    if (hasGmailConfig) {
      this.mode = 'disabled';
      this.transportVerification = { status: 'failed', errorCode: 'GMAIL_OAUTH_CONFIG_INCOMPLETE' };
      console.error(`📧 Email Service: Gmail API configuration is missing ${missingGmailSettings.join(', ')}`);
      return;
    }
    this.mode = process.env.NODE_ENV === 'production' ? 'disabled' : 'console';
    this.transportVerification = { status: this.mode };
    if (this.mode === 'console') {
      console.log('📧 Email Service: Running in Development/Console Mode');
    } else {
      console.error('📧 Email Service: Gmail API OAuth settings are required in production');
    }
  }

  getFromAddress() {
    return process.env.GMAIL_FROM || 'noreply@certicheck.com';
  }

  getStatus() {
    return {
      mode: this.mode,
      configured: this.mode === 'gmail-api',
      verification: this.transportVerification.status,
      errorCode: this.transportVerification.errorCode || null,
      missingSettings: this.missingGmailSettings
    };
  }

  async verifyTransport() {
    if (this.mode === 'gmail-api') {
      try {
        const token = await this.oauth2Client.getAccessToken();
        if (!token?.token) throw new Error('Google OAuth did not return an access token');
        this.transportVerification = { status: 'authenticated' };
        console.log('📧 Email Service: Gmail API OAuth credentials verified');
      } catch (error) {
        const errorCode = error.code || error.name || 'GMAIL_OAUTH_VERIFY_FAILED';
        this.transportVerification = { status: 'failed', errorCode };
        console.error(`📧 Email Service: Gmail API authentication failed (${errorCode}): ${error.message}`);
      }
      return this.getStatus();
    }
    return this.getStatus();
  }

  buildGmailRawMessage({ to, subject, html, text, attachments }) {
    const safeHeader = value => String(value || '').replace(/[\r\n]+/g, ' ').trim();
    const encodeHeader = value => `=?UTF-8?B?${Buffer.from(safeHeader(value)).toString('base64')}?=`;
    const wrapBase64 = value => value.match(/.{1,76}/g)?.join('\r\n') || '';
    const boundaryRelated = `certicheck-related-${crypto.randomBytes(12).toString('hex')}`;
    const boundaryAlternative = `certicheck-alternative-${crypto.randomBytes(12).toString('hex')}`;
    const recipients = (Array.isArray(to) ? to : [to]).map(safeHeader).filter(Boolean);
    const lines = [
      `From: ${safeHeader(this.getFromAddress())}`,
      `To: ${recipients.join(', ')}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/related; boundary="${boundaryRelated}"`,
      '',
      `--${boundaryRelated}`,
      `Content-Type: multipart/alternative; boundary="${boundaryAlternative}"`,
      '',
      `--${boundaryAlternative}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(Buffer.from(text || '').toString('base64')),
      `--${boundaryAlternative}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(Buffer.from(html || '').toString('base64')),
      `--${boundaryAlternative}--`
    ];

    for (const attachment of attachments) {
      const content = Buffer.isBuffer(attachment.content)
        ? attachment.content
        : Buffer.from(attachment.content || '', 'base64');
      lines.push(
        `--${boundaryRelated}`,
        `Content-Type: ${safeHeader(attachment.contentType || 'application/octet-stream')}; name="${safeHeader(attachment.filename || 'attachment')}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: ${attachment.cid ? 'inline' : 'attachment'}; filename="${safeHeader(attachment.filename || 'attachment')}"`,
        ...(attachment.cid ? [`Content-ID: <${safeHeader(attachment.cid)}>`] : []),
        '',
        wrapBase64(content.toString('base64'))
      );
    }
    lines.push(`--${boundaryRelated}--`, '');
    return Buffer.from(lines.join('\r\n')).toString('base64url');
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
    if (this.mode === 'gmail-api') {
      try {
        const raw = this.buildGmailRawMessage({ to, subject, html, text, attachments });
        const response = await this.gmailApi.users.messages.send({
          userId: 'me',
          requestBody: { raw }
        });
        if (!response.data?.id) {
          console.error('📧 Gmail API send failed: response did not include a message ID');
          return false;
        }
        console.log(`✉️  Gmail API accepted email for delivery: ${response.data.id}`);
        return true;
      } catch (error) {
        const errorCode = error.code || error.response?.status || error.name || 'GMAIL_API_SEND_FAILED';
        const detail = error.response?.data?.error?.message || error.message;
        console.error(`📧 Gmail API send failed (${errorCode}): ${detail}`);
        return false;
      }
    }
    console.error('📧 Gmail API send unavailable: OAuth is not configured');
    return false;
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
    const certificateSvg = this.buildCertificateSvg(certificate, issuedAt);
    return this.sendEmail({
      to: certificate.holder_email || certificate.holderEmail,
      subject: `Your ${certificate.certificate_type || certificate.certificateType || 'certificate'} from ${certificate.issuer_name || certificate.issuerName || 'CertiCheck'}`,
      text: `Hello ${certificate.holder_name || certificate.holderName}, your ${certificate.certificate_type || certificate.certificateType} certificate (${certificate.certificate_id || certificate.certificateId}) has been issued by ${certificate.issuer_name || certificate.issuerName}. ${chainStatus}. Verify it at ${verificationUrl}.`,
      attachments: [
        { filename: 'certicheck-certificate.svg', content: Buffer.from(certificateSvg), contentType: 'image/svg+xml' },
        { filename: 'certificate-verification.png', content: qrCode, contentType: 'image/png', cid: 'certificate-verification-qr' }
      ],
      html: `<div style="font-family:Arial,sans-serif;max-width:900px;width:100%;margin:auto;padding:24px;box-sizing:border-box;color:#1e293b"><div style="box-sizing:border-box;aspect-ratio:16/9;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:5%;border:1px solid #cbd5e1;border-radius:8px;background:#fff;text-align:center"><p style="margin:0;color:#475569;font-size:12px;font-weight:bold;letter-spacing:4px">CERTIFICATE OF ACHIEVEMENT</p><h1 style="margin:0;font-size:28px;font-weight:600">${certificateType}</h1><p style="margin:0;color:#475569">Presented to <strong style="display:block;margin-top:6px;color:#0f172a;font-size:32px">${holderName}</strong></p><div style="width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:#312e81;color:#fff;font-size:23px;font-weight:bold">✓</div><strong style="color:#312e81;letter-spacing:3px">CERTICHECK</strong><p style="margin:0">Issued by ${issuerName} · ${escapeHtml(new Date(issuedAt).toLocaleDateString())}</p><p style="width:100%;box-sizing:border-box;margin:0;padding-top:12px;border-top:1px solid #e2e8f0;text-align:left"><strong>Certificate ID:</strong> ${certificateId}<span style="float:right;color:#047857"><strong>VALID</strong></span></p></div><p><strong>On-chain status:</strong> ${chainStatus}</p>${details ? `<h2>Credential details</h2><ul>${details}</ul>` : ''}${ipfsLink}${transactionLink}<p><a href="${safeVerificationUrl}">View and verify your certificate</a></p><p><img src="cid:certificate-verification-qr" width="180" height="180" alt="QR code to verify this certificate"/></p></div>`
    });
  }

  buildCertificateSvg(certificate, issuedAt) {
    const xml = value => escapeHtml(value);
    const date = new Date(issuedAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<rect width="1600" height="900" fill="#fff"/>
<rect x="40" y="40" width="1520" height="820" rx="12" fill="#fff" stroke="#cbd5e1" stroke-width="4"/>
<text x="800" y="185" text-anchor="middle" fill="#475569" font-family="Arial,sans-serif" font-size="24" font-weight="700" letter-spacing="6">CERTIFICATE OF ACHIEVEMENT</text>
<text x="800" y="260" text-anchor="middle" fill="#1e293b" font-family="Arial,sans-serif" font-size="38" font-weight="600">${xml(certificate.certificate_type || certificate.certificateType || 'Certificate')}</text>
<text x="800" y="355" text-anchor="middle" fill="#475569" font-family="Arial,sans-serif" font-size="25">Presented to</text>
<text x="800" y="430" text-anchor="middle" fill="#0f172a" font-family="Arial,sans-serif" font-size="54" font-weight="700">${xml(certificate.holder_name || certificate.holderName || 'Certificate holder')}</text>
<circle cx="800" cy="535" r="34" fill="#312e81"/><path d="m784 535 11 11 22-25" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
<text x="800" y="600" text-anchor="middle" fill="#312e81" font-family="Arial,sans-serif" font-size="24" font-weight="700" letter-spacing="4">CERTICHECK</text>
<text x="800" y="680" text-anchor="middle" fill="#334155" font-family="Arial,sans-serif" font-size="24">Issued by ${xml(certificate.issuer_name || certificate.issuerName || 'CertiCheck issuer')} · ${xml(date)}</text>
<path d="M110 740h1380" stroke="#e2e8f0" stroke-width="2"/>
<text x="120" y="790" fill="#334155" font-family="Arial,sans-serif" font-size="21">Certificate ID: ${xml(certificate.certificate_id || certificate.certificateId || '')}</text>
<text x="1480" y="790" text-anchor="end" fill="#047857" font-family="Arial,sans-serif" font-size="21" font-weight="700">VALID</text>
</svg>`;
  }

  // Helper method for tests only.
  getLastSentOTP(email) {
    return this.memoryStore.get(email);
  }
}

module.exports = new EmailService();

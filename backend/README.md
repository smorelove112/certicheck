# Certicheck Backend

Complete backend system for Certicheck certificate verification platform with user authentication, audit logging, and admin dashboard.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Authentication**: JWT + bcrypt
- **Audit Logging**: Comprehensive audit trail

## Installation

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Set Up PostgreSQL Database

Ensure PostgreSQL is installed and running. Create a new database:

```bash
createdb certicheck
```

### 3. Configure Environment

Copy `.env.example` to `.env` and update values:

```bash
cp .env.example .env
```

Edit `.env`:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_=your
DB_NAME=certicheck
JWT_SECRET=your_secret_key_here
JWT_EXPIRE=7d
ADMIN_EMAIL=admin@certicheck.com
# IPFS / Pinata
PINATA_JWT=

# Solana
SOLANA_ENABLE=true
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
CERTIFICATE_PROGRAM_ID=4aCWiNjpLPtMa1gQd3Tu5jfSpKEFDR3PbANP5br8Fmob
```

On first admin authentication, the backend seeds three individual admin accounts: `admin@certicheck.com`, `admin2@certicheck.com`, and `admin3@certicheck.com`. Their default password is `password`; change each account's password before exposing a deployment publicly. Admin names, avatars, and password changes are personal to each account.

Issuer applications send a receipt email. When approved, the applicant receives a 6-digit activation code that expires after 15 minutes and sets their own password through `/activate-account`. Certificate issuance sends the recipient a credential-rich email with a verification link and QR code. These messages require the `SMTP_*` settings in the backend environment. Supporting media remains optional.

Issuer application submissions are saved to the review queue and their audit-log writes run asynchronously.

Wallet connection is optional. Approved issuers with Phantom connected pin the complete certificate metadata and any supporting file, then sign issuance on-chain. On-chain issuance is stopped if Pinata returns a fallback hash or fails to pin; a fallback hash is never treated as an IPFS CID. The backend verifies the resulting certificate account, instruction arguments, issuer signature, and confirmed transaction before recording it. Without a connected wallet, an issuer may create an off-chain certificate record; the verification page explicitly identifies it as off-chain and does not claim that it is verified on Solana. After successful issuance, the issuer dashboard displays a celebratory mini-certificate preview and download. Never commit the JWT.

The configured devnet program ID is `4aCWiNjpLPtMa1gQd3Tu5jfSpKEFDR3PbANP5br8Fmob`. Set `SOLANA_ENABLE=true`, `SOLANA_CLUSTER=devnet`, `SOLANA_RPC_URL=https://api.devnet.solana.com`, and `CERTIFICATE_PROGRAM_ID` in the backend environment. Issuance and revocation are signed by the approved issuer wallet in the browser; the backend does not need a copy of an issuer's private key. Confirm that the program is deployed and upgraded before enabling this setting in a production backend.

When on-chain mode is enabled, public certificate verification reads the deployed Anchor account first and uses its status as authoritative. Database metadata supplements the chain record but cannot override its valid/revoked state. RPC failures are returned as verification errors; the backend does not claim a database-only record is verified on-chain.

### 4. Initialize Database

Run the SQL schema:

```bash
npm run setup-db
```

This creates all required tables with indexes for audit logging, user management, applications, and verification history.

## Running the Server

### Development (with auto-reload)

```bash
npm run dev
```

### Production

```bash
npm start
```

Server runs on `http://localhost:5000` by default.

## Testing

Run the backend unit and integration tests:

```bash
npm test
```

This runs the backend unit and integration test suite, including multi-admin profile, password recovery, and application attribution coverage.

## API Endpoints

### Authentication

- `POST /api/auth/register` - User registration with email & 
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile (requires token)
- `PUT /api/auth/profile` - Update user profile (requires token)
- `POST /api/auth/admin/login` - Sign in as an individual admin
- `GET /api/auth/admin/profile` and `PUT /api/auth/admin/profile` - Read/update the signed-in admin's display name and profile picture
- `POST /api/auth/admin/change-password` - Change the signed-in admin's password
- `GET /api/auth/admin/users/pending` - List user accounts awaiting approval
- `PUT /api/auth/admin/users/:userId/approve` - Approve a pending account; the account is activated with a hashed `password` initial password and must change it before accessing protected routes

Issuer application accounts remain inactive until the emailed activation code is confirmed and a password is set. Generic user-account approvals may continue to use the administrator-issued password workflow.

### Applications

- `POST /api/applications/submit` - Submit issuer application
- `GET /api/applications/pending` - Get pending applications (admin only)
- `GET /api/applications/rejected` - Get rejected applications (admin only)
- On-chain issuance: see [ONCHAIN_SETUP.md](ONCHAIN_SETUP.md) for steps to enable Solana payer keypair and deployment details
- `GET /api/applications` - Get all applications (admin only)
- `PUT /api/applications/:appId/approve` - Approve application (admin only)
- `PUT /api/applications/:appId/reject` - Reject application (admin only)

### Certificate Issuance and Revocation

- `POST /api/certificates/issue`, `/issue-client-signed`, and `/pin` require an authenticated, active issuer whose linked issuer profile has `approved` status.
- `GET /api/certificates/my-issued` and `PUT /api/certificates/my-issued/:certificateId/revoke` require the same approved issuer status. The legacy `PUT /api/certificates/revoke/:certificateId` path enforces the same rules. Issuer revocation is limited to the issuer that created the certificate or an approved issuer profile with the matching authority wallet.
- With Solana enabled, revocation includes its reason in the on-chain instruction and the database is updated only after that transaction succeeds; failed on-chain revocations return an error without changing the certificate's database status.
- Standard issuance saves a valid certificate record before attempting IPFS pinning; a Pinata failure leaves the DB certificate available and is returned in `warnings`. A local digest fallback is used only in demo mode, not reported as an IPFS CID in production. Public `GET /api/certificates/lookup/:certificateId` returns certificate metadata and status, or `404` with `status: "not_found"`.
- Unapproved callers receive `403 Issuer approval required`; callers without revocation authority receive `403 Not allowed to revoke this certificate`.
- Issuer status is read from server-side account/profile records. Client-supplied role headers do not grant issuer access; administrators continue to manage issuer approval through the application workflow.

### Certificate Verification

- `POST /api/verify/check` - Log certificate verification
- `GET /api/verify/history` - Get verification history (admin only)
- `GET /api/verify/my-history` - Get user's verification history
- `GET /api/verify/revoked` - Get revoked certificates (admin only)
- `PUT /api/verify/:entryId/revoke` - Revoke certificate (admin only)

### Admin Dashboard

- `GET /api/admin/dashboard` - Get dashboard stats and the first 50 pending, approved, rejected, verification, revoked, and audit entries in one response (admin only)
- `POST /api/admin/access-log` - Log admin access
- `GET /api/admin/audit-log` - Get audit log with filtering (admin only)
- `GET /api/admin/login-attempts` - Get login attempts summary (admin only)
- `GET /api/admin/failed-s` - Get failed  attempts (admin only)

## Database Schema

### Core Tables

1. **users** - User accounts with auth
2. **issuer_profiles** - Issuer organization information
3. **admins** - Admin profile and role linked to the corresponding `users` login
4. **pending_applications** - Issuer approval requests, including decision admin identity, action type, and processing time
5. **verify_history** - Certificate verification log
6. **revoked_certificates** - Revoked certificates tracking

### Audit Tables

1. **audit_log** - Complete action audit trail
2. **admin_access_log** - Admin dashboard access tracking
3. **wrong__attempts** - Failed login attempts
4. **sessions** - Active user sessions (optional)

## Audit Logging

Every action is logged with:
- User ID & action type
- Resource type & ID
- Success/failure status
- Error messages
- IP address & user agent
- Metadata (JSON)
- Timestamp

Action types tracked:
- `LOGIN` / `LOGIN_FAILED` / `LOGOUT`
- `REGISTER`
- `APPLICATION_SUBMIT` / `APPLICATION_APPROVE` / `APPLICATION_REJECT`
- `CERTIFICATE_VERIFY` / `CERTIFICATE_REVOKE`
- `ADMIN_ACCESS`
- `_CHANGE` / `PROFILE_UPDATE`

## Authentication Flow

1. User registers with email & 
2. Backend hashes  with bcrypt
3. User logs in → JWT token issued
4. Token sent in `Authorization: Bearer <token>` header
5. Protected routes verify token & extract user info
6. All actions logged to audit_log

## Integration with Frontend

Update your frontend `script.js` to use backend APIs:

```javascript
// Register
fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, , firstName, lastName })
})

// Login
fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email,  })
})

// Submit Application
fetch('/api/applications/submit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify(applicationData)
})

// Log Certificate Check
fetch('/api/verify/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ certId, status, message })
})
```

## Deployment

### Local Testing

```bash
npm run dev
```

### Production (Vercel, Railway, Render, etc.)

1. Set environment variables on hosting platform
2. Push code to Git
3. Deploy through hosting platform
4. Update CORS origin in `src/server.js`

### Docker (Optional)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["npm", "start"]
```

## Security Notes

⚠️ **For Production:**
- Change `JWT_SECRET` to strong random string
- Use HTTPS only
- Set up database backups
- Implement rate limiting
- Use environment variables for all secrets
- Consider adding 2FA for admin accounts
- Regularly audit logs for suspicious activity

## Support

For issues or questions, check the audit logs:

```bash
curl http://localhost:5000/api/admin/audit-log \
  -H "Authorization: Bearer <admin_token>"
```

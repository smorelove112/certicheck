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
SOLANA_RPC_URL=
SOLANA_KEYPAIR_PATH=~/.config/solana/id.json
SOLANA_PAYER_SECRET=
CERTIFICATE_PROGRAM_ID=
```

On first authentication, the backend seeds three admin accounts: `admin@certicheck.com`, `admin2@certicheck.com`, and `admin3@certicheck.com`. Their default password is `password`; change it before exposing a deployment publicly.

Without `PINATA_JWT`, metadata pinning uses the documented local/demo fallback and no real Pinata CID should be claimed. Without `SOLANA_ENABLE=true`, `SOLANA_KEYPAIR_PATH` or `SOLANA_PAYER_SECRET`, and a deployed `CERTIFICATE_PROGRAM_ID`, on-chain issuance is disabled and the Solana test is skipped.

If you want on-chain certificate issuance and revocation, set `SOLANA_ENABLE=true` and provide either `SOLANA_KEYPAIR_PATH` or `SOLANA_PAYER_SECRET`.

If you have deployed the Anchor certificate program, set `CERTIFICATE_PROGRAM_ID` to the deployed program ID. This value should match the `declare_id!` value in `solana-program/src/lib.rs` and is used by backend monitoring and Solana integration. When configured, certificate verification will first query the deployed Anchor program state on Solana for matching certificate accounts, then fall back to local or DB records if the on-chain lookup returns nothing.

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

This executes the certificate store unit test and the certificate API flow integration test using demo authentication.

## API Endpoints

### Authentication

- `POST /api/auth/register` - User registration with email & 
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile (requires token)
- `PUT /api/auth/profile` - Update user profile (requires token)

### Applications

- `POST /api/applications/submit` - Submit issuer application
- `GET /api/applications/pending` - Get pending applications (admin only)
- `GET /api/applications/rejected` - Get rejected applications (admin only)
- On-chain issuance: see [ONCHAIN_SETUP.md](ONCHAIN_SETUP.md) for steps to enable Solana payer keypair and deployment details
- `GET /api/applications` - Get all applications (admin only)
- `PUT /api/applications/:appId/approve` - Approve application (admin only)
- `PUT /api/applications/:appId/reject` - Reject application (admin only)

### Certificate Verification

- `POST /api/verify/check` - Log certificate verification
- `GET /api/verify/history` - Get verification history (admin only)
- `GET /api/verify/my-history` - Get user's verification history
- `GET /api/verify/revoked` - Get revoked certificates (admin only)
- `PUT /api/verify/:entryId/revoke` - Revoke certificate (admin only)

### Admin Dashboard

- `GET /api/admin/dashboard` - Get dashboard stats & recent audit log (admin only)
- `POST /api/admin/access-log` - Log admin access
- `GET /api/admin/audit-log` - Get audit log with filtering (admin only)
- `GET /api/admin/login-attempts` - Get login attempts summary (admin only)
- `GET /api/admin/failed-s` - Get failed  attempts (admin only)

## Database Schema

### Core Tables

1. **users** - User accounts with auth
2. **issuer_profiles** - Issuer organization information
3. **pending_applications** - Issuer approval requests
4. **verify_history** - Certificate verification log
5. **revoked_certificates** - Revoked certificates tracking

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

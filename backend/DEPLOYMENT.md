# Deployment Checklist

This document outlines recommended steps to deploy the Certicheck backend to production.

## Current deployment limitation

The frontend defaults to the Render API. Its `/health` endpoint returned `status: ok` during this review, but a health response does not verify application submission or on-chain issuance end to end. Production readiness still requires verified database/secrets/CORS configuration and a public smoke test of those flows.

Set `FRONTEND_URL` on Render to the exact production frontend origin (scheme and host only, no path), or set `CORS_ORIGINS` to a comma-separated list of exact frontend origins. Do not use a broad wildcard. The main site sends login and other API requests to the Render API URL configured in `script.js` by default; `window.CERTICHECK_API_BASE_URL` can override it when deploying the static frontend. The Express app trusts one proxy hop for Render's forwarded client IP headers.

1. Environment variables
   - Create a `.env` file with required values:
     - `PORT=5000`
     - `DATABASE_URL=postgres://user:pass@host:5432/dbname`
     - `JWT_SECRET` and `ADMIN_JWT_SECRET` (must be strong, different values)
     - `SOLANA_ENABLE=true` (optional)
     - `PINATA_JWT` (required for real IPFS metadata pinning before client-signed on-chain issuance)
     - `CERTIFICATE_PROGRAM_ID` (Anchor program ID)

2. Database
   - Provision a Postgres instance and run `node src/db/init.js` or set up migrations.

3. Secrets
   - Store database, JWT, and Pinata secrets in a secure secrets manager. Issuer signing keys stay in Phantom and must never be sent to the backend.

4. Process manager
   - Use `systemd`, `pm2`, or container orchestration (Docker Compose / Kubernetes) to run the app.

5. Monitoring & backups
   - Monitor application logs and Postgres metrics. Backup DB regularly.

6. CI
   - Run demo-mode tests on each PR. Run on-chain tests in a gated job that uses protected secrets.

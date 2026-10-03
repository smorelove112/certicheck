# CertiCheck Backend Setup Guide

## Prerequisites

### 1. Install PostgreSQL

**Windows:**
- Download from: https://www.postgresql.org/download/windows/
- During installation, remember the **password** for the `postgres` user
- Install pgAdmin 4 (comes with installer) for easy database management

**macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### 2. Verify PostgreSQL is Running

Open a terminal/PowerShell and test the connection:
```bash
psql -U postgres
```

If you see `postgres=#`, PostgreSQL is running. Exit with `\q`.

---

## Setup Steps

### Step 1: Install Dependencies
```bash
cd backend
npm install
```

### Step 2: Configure Environment Variables

Edit `backend/.env` and set your PostgreSQL password:
```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_postgres_password  # Change this to your actual password
DB_NAME=certicheck
PORT=5000
NODE_ENV=development
JWT_SECRET=dev_secret_key_change_in_production

# Gmail API OAuth email delivery
GMAIL_CLIENT_ID=your-google-oauth-client-id
GMAIL_CLIENT_SECRET=your-google-oauth-client-secret
GMAIL_REFRESH_TOKEN=your-google-oauth-refresh-token
GMAIL_FROM=your-full-address@gmail.com
```

Grant the refresh token the `https://www.googleapis.com/auth/gmail.send` scope.
Configure these credentials in Render for production; SMTP is not used.

### Step 3: Initialize Database

This creates the `certicheck` database and all tables:
```bash
npm run setup-db
```

Expected output:
```
✓ Database initialized successfully
✓ Tables created
```

If you get a connection error, check:
- PostgreSQL is running (`psql -U postgres` works)
- DB_PASSWORD in `.env` matches your postgres user password
- DB_HOST is `localhost` (or `127.0.0.1`)

### Step 4: Start Backend Server

```bash
npm run dev
```

Expected output:
```
✓ Certicheck backend running on http://localhost:5000
✓ Health check: http://localhost:5000/health
```

### Step 5: Test the Backend

In another terminal, test the health endpoint:
```bash
curl http://localhost:5000/health
```

You should see:
```json
{
  "status": "ok",
  "timestamp": "2026-06-23T...",
  "message": "Certicheck backend is running"
}
```

---

## Common Issues

### "Failed to fetch" Error
- **Check**: Is backend running? (`npm run dev` in backend folder)
- **Check**: Is PostgreSQL running? (`psql -U postgres` works)
- **Check**: Is API URL correct? Frontend uses `http://localhost:5000/api`

### "Database connection failed"
- **Fix**: Check DB credentials in `.env`
- **Fix**: Verify PostgreSQL is running
- **Fix**: Try creating database manually:
  ```bash
  psql -U postgres -c "CREATE DATABASE certicheck;"
  ```

### CORS Error
- Backend CORS is configured for `http://localhost:3000`, `http://localhost:5000`, and `file://`
- If you're testing from a different origin, update CORS in `backend/src/server.js`

### OTP Not Sending
- In **development mode** without Gmail API OAuth settings, reset codes are
  logged to the backend console instead of emailed.
- For production, configure `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
  `GMAIL_REFRESH_TOKEN`, and `GMAIL_FROM`, and grant the token the
  `https://www.googleapis.com/auth/gmail.send` scope.
- Check backend logs for Gmail API OAuth or send errors.

---

## Database Management

### Access Database Directly
```bash
psql -U postgres -d certicheck
```

### View Tables
```sql
\dt
```

### Check Users
```sql
SELECT id, email, first_name, created_at FROM users;
```

### Reset Database (WARNING: Deletes all data)
```bash
npm run setup-db
```

---

## Development Workflow

1. **Terminal 1** - Start Backend:
   ```bash
   cd backend && npm run dev
   ```

2. **Terminal 2** - Open frontend:
   ```bash
   Open http://localhost in your browser
   ```

3. **Test Signup Flow**:
   - Enter email and details
   - Check Terminal 1 console for OTP code
   - Enter OTP to verify
   - Account created!

---

## Next Steps

Once backend is running:
- Test signup flow with OTP
- Check admin dashboard
- Set up issuer applications
- Configure production deployment

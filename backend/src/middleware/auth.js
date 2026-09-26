const jwt = require('jsonwebtoken');
const pool = require('../db/connection');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || JWT_SECRET;

function getDemoUser(req) {
  if (process.env.DEMO_MODE === 'true' || req.headers.authorization?.split(' ')[1] === 'demo-token') {
    const userType = req.headers['x-demo-user-type'] || 'issuer';
    return {
      id: 1,
      email: 'demo@certicheck.io',
      user_type: userType,
      userType
    };
  }
  return null;
}

function verifyAdminToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  // Demo token support for admin via header
  const demoUser = getDemoUser(req);
  if (demoUser && (req.headers['x-demo-user-type'] === 'admin' || process.env.DEMO_MODE === 'true')) {
    req.user = { ...demoUser, user_type: 'admin', userType: 'admin' };
    return next();
  }

  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    const userType = decoded?.userType ?? decoded?.user_type;
    if (userType !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = { ...decoded, user_type: userType, userType };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const demoUser = getDemoUser(req);
  if (demoUser) {
    req.user = demoUser;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      ...decoded,
      first_name: decoded.first_name ?? decoded.firstName,
      last_name: decoded.last_name ?? decoded.lastName,
      user_type: decoded.user_type ?? decoded.userType
    };
    req.user.firstName = req.user.first_name;
    req.user.lastName = req.user.last_name;
    req.user.userType = req.user.user_type;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function resolveUserAccess(req) {
  if (!req.user || !req.user.id) {
    return null;
  }

  if (process.env.DEMO_MODE === 'true' || req.headers['x-demo-user-type']) {
    return {
      id: req.user.id,
      user_type: req.user.user_type || (req.headers['x-demo-user-type'] === 'admin' ? 'admin' : 'issuer'),
      is_active: true,
      issuer_status: 'approved'
    };
  }

  const result = await pool.query(
    `SELECT u.id, u.user_type, u.is_active, ip.status AS issuer_status
     FROM users u
     LEFT JOIN issuer_profiles ip ON ip.user_id = u.id
     WHERE u.id = $1 LIMIT 1`,
    [req.user.id]
  );

  if (!result.rows[0]) {
    return null;
  }

  return result.rows[0];
}

async function verifyAdmin(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const isDemoRequest = process.env.DEMO_MODE === 'true' || Boolean(req.headers['x-demo-user-type']);
    if (isDemoRequest && (req.user.user_type === 'admin' || req.headers['x-demo-user-type'] === 'admin')) {
      req.user.user_type = 'admin';
      req.user.is_active = true;
      return next();
    }

    const user = await resolveUserAccess(req);
    const tokenUserType = req.user.userType || req.user.user_type;
    const effectiveUserType = tokenUserType === 'admin'
      ? 'admin'
      : user?.user_type || tokenUserType;

    if (effectiveUserType !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user.user_type = effectiveUserType;
    req.user.userType = effectiveUserType;
    req.user.is_active = user?.is_active ?? req.user.is_active;
    next();
  } catch (err) {
    console.error('Admin verification failed:', err.message);
    return res.status(500).json({ error: 'Unable to verify admin access' });
  }
}

async function verifyIssuer(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const isDemoRequest = process.env.DEMO_MODE === 'true' || Boolean(req.headers['x-demo-user-type']);
    if (isDemoRequest && ['issuer', 'admin'].includes(req.user.user_type || req.headers['x-demo-user-type'])) {
      req.user.user_type = req.user.user_type || req.headers['x-demo-user-type'];
      req.user.is_active = true;
      return next();
    }

    const user = await resolveUserAccess(req);
    const effectiveUserType = user?.user_type || req.user.user_type;

    if (!['issuer', 'admin'].includes(effectiveUserType)) {
      return res.status(403).json({ error: 'Issuer access required' });
    }

    req.user.user_type = effectiveUserType;
    req.user.is_active = user?.is_active ?? req.user.is_active;

    if (effectiveUserType === 'issuer' && !isDemoRequest) {
      // Use the refreshed DB data first. A stale JWT may still list the user as a plain user
      // even though the database has already approved their issuer status.
      let approved = user?.issuer_status === 'approved';

      // Default seeded issuer accounts are auto-approved so they can issue immediately without a formal pending approval.
      const defaultIssuerEmail = (process.env.ISSUER_EMAIL || 'issuer@certicheck.com').toLowerCase();
      if (!approved && req.user.email && req.user.email.toLowerCase() === defaultIssuerEmail) {
        approved = true;
      }

      // Allow approval check by either the linked issuer profile OR the pending application email.
      const profileResult = await pool.query(
        'SELECT status, user_id, id AS profile_id FROM issuer_profiles WHERE user_id = $1 LIMIT 1',
        [req.user.id]
      );

      if (!approved && profileResult.rows[0] && profileResult.rows[0].status === 'approved') {
        approved = true;
      }

      if (!approved && req.user.email) {
        try {
          const emailCheck = await pool.query(
            `SELECT 1 FROM pending_applications pa
             WHERE LOWER(pa.contact_email) = LOWER($1)
               AND pa.status = 'approved'
             LIMIT 1`,
            [req.user.email]
          );
          if (emailCheck.rows[0]) {
            approved = true;
          }
        } catch (e) {
          console.warn('Email-based approval check failed:', e.message);
        }
      }

      if (!approved) {
        return res.status(403).json({ error: 'Approved issuer access required' });
      }
    }

    next();
  } catch (err) {
    console.error('Issuer verification failed:', err.message);
    return res.status(500).json({ error: 'Unable to verify issuer approval' });
  }
}

function logAudit(userId, actionType, resourceType = null, resourceId = null, status = 'success', errorMsg = null, metadata = {}) {
  return pool.query(
    `INSERT INTO audit_log (user_id, action, action_type, resource_type, resource_id, status, error_message, ip_address, user_agent, metadata, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
    [userId, actionType, actionType, resourceType, resourceId, status, errorMsg, null, null, JSON.stringify(metadata)]
  ).catch(err => console.error('Audit log error:', err));
}

module.exports = {
  verifyToken,
  verifyAdmin,
  verifyIssuer,
  logAudit,
  verifyAdminToken
};







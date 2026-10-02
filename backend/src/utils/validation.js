function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  if (clean.length > 254) return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!re.test(clean)) return false;
  const parts = clean.split('@');
  if (parts.length !== 2) return false;
  if (parts[0].length > 64 || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) return false;
  const domain = parts[1];
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

module.exports = { isValidEmail };

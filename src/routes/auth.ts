import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import User from '../models/User.js';
import { csrfGuard, generateCsrfToken, hash, maskCodePattern, sanitizeUsuario, signAccessToken, signRefreshToken, verifyHash, verifyRefreshToken, requireAdmin, requireAuth } from '../utils/auth.js';

const router = express.Router();

// Attach cookie parser with secret for signed cookies
router.use(cookieParser(process.env.COOKIE_SECRET || 'cookie-secret'));

function setCookie(res: any, name: string, value: string, options: any = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const base: any = { // 'any' para permitir a propriedade 'domain' condicionalmente
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'strict', 
    secure: isProduction,
    signed: true,
    path: '/',
  };

  // ESSENCIAL: Define o domínio pai para compartilhar cookies entre subdomínios
  if (isProduction) {
    base.domain = '.pofazze.com'; 
  }

  res.cookie(name, value, { ...base, ...options });
}

// Issue CSRF token cookie for the client to mirror in header
router.get('/auth/csrf', (_req, res) => {
  const token = generateCsrfToken();
  // Do not sign CSRF cookie; client mirrors exact value in header
  setCookie(res, 'csrf_token', token, { httpOnly: false, signed: false });
  res.json({ ok: true });
});

// Login
router.post('/auth/login', csrfGuard, async (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) return res.status(400).json({ error: 'invalid' });
  const uname = sanitizeUsuario(usuario);
  const u = await User.findOne({ user: uname }).exec();
  if (!u) return res.status(401).json({ error: 'invalid_credentials' });
  // Migrate plaintext password to hash on first successful login
  if (u.passwordHash) {
    const ok = await verifyHash(u.passwordHash, senha);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  } else if (u.password) {
    if (u.password !== senha) return res.status(401).json({ error: 'invalid_credentials' });
    u.passwordHash = await hash(String(u.password));
    u.password = null;
    await u.save();
  } else {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const claims = { sub: String(u._id), usuario: u.user, role: u.role as any, project: u.project } as const;
  const access = signAccessToken(claims);
  const refreshRaw = signRefreshToken(claims);
  // Store hash of refresh
  u.refreshTokenHash = await hash(refreshRaw);
  await u.save();
  setCookie(res, 'access_token', access, { maxAge: 15 * 60 * 1000 });
  setCookie(res, 'refresh_token', refreshRaw, { maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true });
});

// Refresh
router.post('/auth/refresh', async (req, res) => {
  const rt = (req as any).signedCookies?.refresh_token;
  if (!rt) return res.status(401).json({ error: 'unauthorized' });
  try {
    const claims = verifyRefreshToken(rt);
    const u = await User.findById(claims.sub).exec();
    if (!u || !u.refreshTokenHash) return res.status(401).json({ error: 'unauthorized' });
    const ok = await verifyHash(u.refreshTokenHash, rt);
    if (!ok) return res.status(401).json({ error: 'unauthorized' });
  const access = signAccessToken({ sub: String(u._id), usuario: u.user, role: u.role as any, project: u.project });
    setCookie(res, 'access_token', access, { maxAge: 15 * 60 * 1000 });
    res.json({ ok: true });
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
});

// Logout
router.post('/auth/logout', csrfGuard, async (req, res) => {
  const rt = (req as any).signedCookies?.refresh_token;
  if (rt) {
    try {
      const claims = verifyRefreshToken(rt);
      const u = await User.findById(claims.sub).exec();
      if (u) { u.refreshTokenHash = null; await u.save(); }
    } catch {}
  }
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  res.status(204).end();
});

// Admin: create pending user and generate masked code (A3BB- 23A3)
router.post('/auth/admin/create-user', requireAuth, requireAdmin, csrfGuard, async (req, res) => {
  const { usuario, email, nome, role } = req.body || {};
  if (!usuario || !role) return res.status(400).json({ error: 'invalid' });
  const clean = sanitizeUsuario(usuario);
  const exists = await User.findOne({ user: clean }).exec();
  if (exists) return res.status(409).json({ error: 'exists' });
  const code = genMaskedCode();
  const u = await User.create({ user: clean, email, name: nome, role: role === 'admin' ? 'admin' : 'user', verificationcode: code, vercodedate: new Date().toISOString(), password: null, passwordHash: null });
  // Return code to admin; in real world, send via secure channel
  res.json({ ok: true, userId: String(u._id), code });
});

// User completes registration with code and sets password
router.post('/auth/complete-registration', csrfGuard, async (req, res) => {
  const { usuario, code, password } = req.body || {};
  if (!usuario || !code || !password) return res.status(400).json({ error: 'invalid' });
  if (!maskCodePattern().test(code)) return res.status(400).json({ error: 'invalid_code_format' });
  const u = await User.findOne({ user: sanitizeUsuario(usuario) }).exec();
  if (!u) return res.status(400).json({ error: 'invalid' });
  if (!u.verificationcode || u.verificationcode.toUpperCase() !== String(code).toUpperCase()) return res.status(400).json({ error: 'invalid_code' });
  u.passwordHash = await hash(password);
  u.password = null;
  u.verificationcode = null;
  await u.save();
  res.json({ ok: true });
});

// Me endpoint
router.get('/auth/me', requireAuth, (_req, res) => {
  const user = ( _req as any).user;
  res.json({ id: user.sub, usuario: user.usuario, role: user.role, iat: Date.now()/1000 });
});

function genMaskedCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n: number) => Array.from({ length: n }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
  const left = pick(4);
  const right = pick(4);
  return `${left}- ${right}`;
}

export default router;

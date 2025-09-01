import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import type { Request, Response, NextFunction } from 'express';

export interface JwtClaims {
  sub: string; // user id
  usuario: string;
  role: 'admin' | 'user';
  project?: string;
}

const ACCESS_TTL = 15 * 60; // 15 minutes
const REFRESH_TTL = 7 * 24 * 60 * 60; // 7 days

export function signAccessToken(payload: JwtClaims) {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TTL });
}

export function verifyAccessToken(token: string): JwtClaims {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return jwt.verify(token, secret) as JwtClaims;
}

export function signRefreshToken(payload: JwtClaims) {
  const secret = process.env.JWT_REFRESH_SECRET || 'dev-refresh';
  return jwt.sign(payload, secret, { expiresIn: REFRESH_TTL });
}

export function verifyRefreshToken(token: string): JwtClaims {
  const secret = process.env.JWT_REFRESH_SECRET || 'dev-refresh';
  return jwt.verify(token, secret) as JwtClaims;
}

export async function hash(data: string) {
  return argon2.hash(data, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyHash(hashStr: string, plain: string) {
  try { return await argon2.verify(hashStr, plain); } catch { return false; }
}

export function generateCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function maskCodePattern() {
  // A3BB- 23A3 — pattern: [A-Z0-9]{4}-\s[0-9A-Z]{4}
  return /^[A-Z0-9]{4}-\s[0-9A-Z]{4}$/i;
}

export function sanitizeUsuario(u: string) {
  return (u || '').trim().toLowerCase();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = (req as any).signedCookies?.access_token;
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const claims = verifyAccessToken(token);
    (req as any).user = claims;
    next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).user) return res.status(401).json({ error: 'unauthorized' });
  if ((req as any).user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  const header = req.get('x-csrf-token');
  const signed = (req as any).signedCookies?.csrf_token;
  const unsigned = (req as any).cookies?.csrf_token;
  const cookie = signed || unsigned;
  if (!cookie || !header || cookie !== header) return res.status(403).json({ error: 'csrf' });
  next();
}

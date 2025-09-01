import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import argon2 from 'argon2';
import User from '../models/User.js';
import { authConnection } from '../utils/db.js';

async function main() {
  // Ensure auth connection is ready
  await new Promise<void>((resolve, reject) => {
    if ((authConnection as any).readyState === 1) return resolve();
    const onOpen = () => { cleanup(); resolve(); };
    const onErr = (e: any) => { cleanup(); reject(e); };
    const cleanup = () => { authConnection.off('connected', onOpen); authConnection.off('error', onErr); };
    authConnection.on('connected', onOpen);
    authConnection.on('error', onErr);
  });

  const desiredUser = 'igor';
  let username = desiredUser;
  const exists = await (User as any).findOne({ user: username }).lean();
  if (exists) {
    for (let i = 1; i <= 50; i++) {
      const candidate = `${desiredUser}${i}`;
      const e2 = await (User as any).findOne({ user: candidate }).lean();
      if (!e2) { username = candidate; break; }
    }
  }

  const password = 'c19h28o2';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const nowIso = new Date().toISOString();

  const doc = await (User as any).create({
    user: username,
    name: 'igor',
    email: 'a@a.com',
    password: null,
    passwordHash,
    role: 'user',
    project: 'default',
    creationdata: nowIso,
    verificationcode: null,
    lastConection: '',
  } as any);

  console.log('User created:', { username, id: String((doc as any)._id) });
  try { await authConnection.close(); } catch {}
}

main().catch(async (err) => {
  console.error('createUser error:', err);
  try { await authConnection.close(); } catch {}
  process.exit(1);
});

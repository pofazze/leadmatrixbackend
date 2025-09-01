import dotenv from 'dotenv';
dotenv.config();
import argon2 from 'argon2';
import User from '../models/User.js';
import { authConnection } from '../utils/db.js';

async function main() {
  const [, , usernameArg, passwordArg, nameArg, emailArg, roleArg] = process.argv;
  if (!usernameArg || !passwordArg) {
    console.error('Usage: tsx src/scripts/resetPassword.ts <username> <password> [name] [email] [role]');
    process.exit(1);
  }
  const usuario = String(usernameArg).trim().toLowerCase();
  const password = String(passwordArg);
  const name = nameArg || usernameArg;
  const email = emailArg || '';
  const role = (roleArg === 'admin' ? 'admin' : 'user') as 'admin'|'user';

  await new Promise<void>((resolve, reject) => {
    if ((authConnection as any).readyState === 1) return resolve();
    const onOpen = () => { cleanup(); resolve(); };
    const onErr = (e: any) => { cleanup(); reject(e); };
    const cleanup = () => { authConnection.off('connected', onOpen); authConnection.off('error', onErr); };
    authConnection.on('connected', onOpen);
    authConnection.on('error', onErr);
  });

  let user = await (User as any).findOne({ user: usuario });
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  if (!user) {
    user = await (User as any).create({ user: usuario, name, email, role, password: null, passwordHash });
    console.log('User created:', { username: usuario, id: String((user as any)._id) });
  } else {
    (user as any).password = null;
    (user as any).passwordHash = passwordHash;
    if (nameArg) (user as any).name = nameArg;
    if (emailArg) (user as any).email = emailArg;
    if (roleArg) (user as any).role = role;
    await user.save();
    console.log('Password updated for user:', { username: usuario, id: String((user as any)._id) });
  }

  try { await authConnection.close(); } catch {}
}

main().catch(async (err) => {
  console.error('resetPassword error:', err);
  try { await authConnection.close(); } catch {}
  process.exit(1);
});

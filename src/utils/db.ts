import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Dedicated connection for auth DB (separate from main app DB if desired)
const AUTH_MONGO_URI = process.env.AUTH_MONGO_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const AUTH_DB_NAME = process.env.AUTH_DB_NAME || process.env.DB_NAME || 'LeadsMatrix';

export const authConnection = mongoose.createConnection(AUTH_MONGO_URI, { dbName: AUTH_DB_NAME } as any);

authConnection.on('error', (err) => {
  console.error('Auth DB connection error:', (err as any)?.message || err);
});

authConnection.once('connected', () => {
  // console.log('Auth DB connected');
});

export default authConnection;

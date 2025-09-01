import { Schema, Document, Model } from 'mongoose';
import { authConnection } from '../utils/db.js';

export interface IUser extends Document {
  // Fields per existing collection
  user: string;                // username
  name?: string;               // full name
  email?: string;
  password?: string | null;    // legacy plaintext (will migrate)
  passwordHash?: string | null;// secure hash
  whatsapp?: string;
  birthdate?: string;
  creationdata?: string;
  gender?: string;
  verificationcode?: string | null; // masked code like A3BB- 23A3
  role: 'admin' | 'user';
  lastConection?: string;
  project?: string;
  vercodedate?: string | Date | null;
  // Security/session
  refreshTokenHash?: string | null;
  // timestamps
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  user: { type: String, required: true, unique: true, index: true },
  name: { type: String },
  email: { type: String },
  password: { type: String, default: null },
  passwordHash: { type: String, default: null },
  whatsapp: { type: String },
  birthdate: { type: String },
  creationdata: { type: String },
  gender: { type: String },
  verificationcode: { type: String, default: null },
  role: { type: String, enum: ['admin', 'user'], default: 'user', index: true },
  lastConection: { type: String },
  project: { type: String },
  vercodedate: { type: Schema.Types.Mixed, default: null },
  refreshTokenHash: { type: String, default: null },
}, { timestamps: true, collection: process.env.AUTH_USERS_COLLECTION || 'Users' });

let UserModel: Model<IUser>;
try {
  UserModel = authConnection.model<IUser>('User');
} catch {
  UserModel = authConnection.model<IUser>('User', UserSchema);
}

export default UserModel;

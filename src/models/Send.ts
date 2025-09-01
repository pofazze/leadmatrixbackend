import mongoose, { Schema, Document, Model } from 'mongoose';

export interface Timestamps {
  queuedAt?: Date;
  sendingAt?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  failedAt?: Date;
  canceledAt?: Date;
}

export interface SendDoc extends Document {
  campaignId: mongoose.Types.ObjectId;
  phone: string;
  payload?: any;
  status: 'queued'|'sending'|'sent'|'delivered'|'read'|'failed'|'canceled';
  attempts: number;
  lastError?: string;
  messageId?: string;
  zaapId?: string;
  timestamps: Timestamps;
  checksum: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const TimestampsSchema = new Schema<Timestamps>({
  queuedAt: Date,
  sendingAt: Date,
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  failedAt: Date,
  canceledAt: Date,
}, { _id: false });

const SendSchema = new Schema<SendDoc>({
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
  phone: { type: String, required: true },
  payload: { type: Object },
  status: { type: String, enum: ['queued','sending','sent','delivered','read','failed','canceled'], default: 'queued', index: true },
  attempts: { type: Number, default: 0 },
  lastError: { type: String },
  messageId: { type: String, index: true },
  zaapId: { type: String, index: true },
  timestamps: { type: TimestampsSchema, default: () => ({}) },
  checksum: { type: String, required: true, index: true },
}, { timestamps: true });

SendSchema.index({ campaignId: 1, status: 1 });
SendSchema.index({ campaignId: 1, phone: 1 });
SendSchema.index({ checksum: 1 }, { unique: true });

const Send: Model<SendDoc> = mongoose.model<SendDoc>('Send', SendSchema);
export default Send;

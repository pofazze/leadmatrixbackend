import mongoose, { Schema, Document, Model } from 'mongoose';

export interface Totals {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  canceled: number;
}

export interface Meta {
  batchSize?: number;
  throttlePerSecond?: number;
  notes?: string;
}

export interface CampaignDoc extends Document {
  name: string;
  createdBy?: mongoose.Types.ObjectId;
  status: 'draft'|'running'|'paused'|'completed'|'canceled'|'failed';
  totals: Totals;
  startedAt?: Date;
  completedAt?: Date;
  updatedAt?: Date;
  meta: Meta;
  dispatchTokenHash?: string;
  dispatchTokenExpiresAt?: Date;
  createdAt?: Date;
}

const TotalsSchema = new Schema<Totals>({
  total: { type: Number, default: 0 },
  queued: { type: Number, default: 0 },
  sending: { type: Number, default: 0 },
  sent: { type: Number, default: 0 },
  delivered: { type: Number, default: 0 },
  read: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  canceled: { type: Number, default: 0 },
}, { _id: false });

const MetaSchema = new Schema<Meta>({
  batchSize: { type: Number, default: 20 },
  throttlePerSecond: { type: Number, default: 5 },
  notes: { type: String }
}, { _id: false });

const CampaignSchema = new Schema<CampaignDoc>({
  name: { type: String, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['draft','running','paused','completed','canceled','failed'], default: 'draft' },
  totals: { type: TotalsSchema, default: () => ({}) },
  startedAt: { type: Date },
  completedAt: { type: Date },
  updatedAt: { type: Date, default: Date.now },
  meta: { type: MetaSchema, default: () => ({}) },
  dispatchTokenHash: { type: String },
  dispatchTokenExpiresAt: { type: Date }
}, { timestamps: true });

CampaignSchema.index({ status: 1 });

const Campaign: Model<CampaignDoc> = mongoose.model<CampaignDoc>('Campaign', CampaignSchema);
export default Campaign;

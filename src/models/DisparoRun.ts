import mongoose, { Schema, InferSchemaType } from 'mongoose';

const DisparoRunSchema = new Schema({
  runId: { type: String, index: true, unique: true },
  status: { type: String, enum: ['idle','running','paused','canceled','completed'], default: 'idle' },
  type: { type: String, enum: ['text','image','video'], required: true },
  instance: { type: String, required: true },
  message: { type: String, default: '' },
  mediaBase64: { type: String, default: '' },
  waitProfile: { type: String, enum: ['20-30','30-100','60-200'], default: '30-100' },
  totals: {
    queued: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    errors: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
  },
  lastLeadId: { type: Schema.Types.ObjectId, default: null },
  startedAt: { type: Date, default: null },
  startedAtBr: { type: String, default: null },
  finishedAt: { type: Date, default: null },
  finishedAtBr: { type: String, default: null },
}, { timestamps: true });

export type DisparoRun = InferSchemaType<typeof DisparoRunSchema>;
export default mongoose.model('DisparoRun', DisparoRunSchema);

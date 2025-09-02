import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import Campaign from '../models/Campaign.js';
import Send from '../models/Send.js';
import { addClient, emitEvent } from '../utils/sse.js';

const router = express.Router();

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function calcPercent(t: any) {
  const done = (t.sent || 0) + (t.delivered || 0) + (t.read || 0) + (t.failed || 0) + (t.canceled || 0);
  const total = t.total || 0;
  return total ? Math.min(100, Math.round((done / total) * 100)) : 0;
}

const throughput: Map<string, { timestamps: number[] }> = new Map();
function markThroughput(campaignId: string) {
  const now = Date.now();
  if (!throughput.has(campaignId)) throughput.set(campaignId, { timestamps: [] });
  const buf = throughput.get(campaignId)!;
  buf.timestamps.push(now);
  const oneMinuteAgo = now - 60000;
  buf.timestamps = buf.timestamps.filter(t => t >= oneMinuteAgo);
}
function getThroughput(campaignId: string) {
  const buf = throughput.get(campaignId);
  if (!buf) return 0;
  const now = Date.now();
  const oneSecondAgo = now - 1000;
  const countLastSecond = buf.timestamps.filter(t => t >= oneSecondAgo).length;
  return countLastSecond;
}
function getAvgThroughputPerSec(campaignId: string) {
  const buf = throughput.get(campaignId);
  if (!buf) return 0;
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  const count = buf.timestamps.filter(t => t >= oneMinuteAgo).length;
  return count / 60;
}

// Filtra campanhas pelo projeto do usuário logado
import { requireAuth } from '../utils/auth.js';

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userProject = (req as any).user?.project;
    if (!userProject) return res.json([]);
    const campaigns = await Campaign.find({ project: userProject }).sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar campanhas' });
  }
});

// ...existing code...
  try {
    const { name, meta, phones = [] } = (req.body as any) || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const totals = { total: (phones as any[]).length, queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, failed: 0, canceled: 0 };
    const campaign = await (Campaign as any).create({ name, status: 'draft', totals, meta });
    return res.status(201).json({ id: campaign._id, campaign });
  } catch (e) { console.error('create campaign error', e); return res.status(500).json({ error: 'server_error' }); }
});

router.post('/campaigns/:id/enqueue', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    const { sends = [] } = (req.body as any) || {};
    const campaign = await (Campaign as any).findById(id);
    if (!campaign) return res.status(404).json({ error: 'not_found' });
    let inserted = 0, duplicated = 0;
    for (const s of sends as any[]) {
      const { phone, payload } = s || {};
      if (!phone) continue;
      const checksum = crypto.createHash('sha256').update(`${id}|${phone}|${JSON.stringify(payload||{})}`).digest('hex');
      try {
        await (Send as any).create({ campaignId: id, phone: String(phone).replace(/\D/g, ''), payload: payload || {}, status: 'queued', attempts: 0, timestamps: { queuedAt: new Date() }, checksum });
        inserted++;
      } catch (err: any) { if (err.code === 11000) duplicated++; else throw err; }
    }
    await (Campaign as any).findByIdAndUpdate(id, { $inc: { 'totals.total': inserted, 'totals.queued': inserted }, $set: { updatedAt: new Date() } });
    return res.json({ inserted, duplicated });
  } catch (e) { console.error('enqueue error', e); return res.status(500).json({ error: 'server_error' }); }
});

router.post('/campaigns/:id/start', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    const campaign = await (Campaign as any).findByIdAndUpdate(id, { $set: { status: 'running', startedAt: new Date(), updatedAt: new Date() } }, { new: true });
    if (!campaign) return res.status(404).json({ error: 'not_found' });
    const token = uuidv4();
    const hash = hashToken(token);
    const expires = new Date(Date.now() + 6 * 60 * 60 * 1000);
    (campaign as any).dispatchTokenHash = hash;
    (campaign as any).dispatchTokenExpiresAt = expires;
    await (campaign as any).save();
    const noToken = req.header('x-no-token') === '1';
    const base = { campaign: { id: (campaign as any)._id, status: (campaign as any).status, startedAt: (campaign as any).startedAt } };
    return res.json(noToken ? base : { ...base, dispatchToken: token });
  } catch (e) { console.error('start error', e); return res.status(500).json({ error: 'server_error' }); }
});

router.post('/campaigns/:id/pause', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    const c = await (Campaign as any).findByIdAndUpdate(id, { $set: { status: 'paused', updatedAt: new Date() } }, { new: true });
    if (!c) return res.status(404).json({ error: 'not_found' });
    emitEvent(id, 'summary', { campaignId: id, status: (c as any).status });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

router.post('/campaigns/:id/resume', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    const c = await (Campaign as any).findById(id);
    if (!c) return res.status(404).json({ error: 'not_found' });
    (c as any).status = 'running';
    (c as any).updatedAt = new Date();
    const token = uuidv4();
    (c as any).dispatchTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    (c as any).dispatchTokenExpiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
    await (c as any).save();
    emitEvent(id, 'summary', { campaignId: id, status: (c as any).status });
    const noToken = req.header('x-no-token') === '1';
    res.json(noToken ? { ok: true } : { ok: true, dispatchToken: token });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

router.post('/campaigns/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    const session = await (Send as any).startSession();
    session.startTransaction();
    await (Campaign as any).findByIdAndUpdate(id, { $set: { status: 'canceled', updatedAt: new Date() } }, { session });
    const result = await (Send as any).updateMany({ campaignId: id, status: { $in: ['queued','sending'] } }, { $set: { status: 'canceled', 'timestamps.canceledAt': new Date() } }, { session });
    await (Campaign as any).findByIdAndUpdate(id, { $inc: { 'totals.canceled': (result as any).modifiedCount, 'totals.queued': -(result as any).modifiedCount }, $set: { updatedAt: new Date() } }, { session });
    await session.commitTransaction();
    session.endSession();
    emitEvent(id, 'summary', { campaignId: id });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

router.get('/campaigns/:id/summary', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    const c = await (Campaign as any).findById(id).lean();
    if (!c) return res.status(404).json({ error: 'not_found' });
    const percent = calcPercent((c as any).totals || {});
    const tput = getThroughput(String(id));
    const avgTps = getAvgThroughputPerSec(String(id));
    const t = (c as any).totals || {};
    const done = (t.sent||0)+(t.delivered||0)+(t.read||0)+(t.failed||0)+(t.canceled||0);
    const remaining = Math.max(0, (t.total||0) - done);
    const etaSeconds = avgTps > 0 ? Math.ceil(remaining / avgTps) : null;
    res.json({ campaignId: id, status: (c as any).status, totals: (c as any).totals, startedAt: (c as any).startedAt, completedAt: (c as any).completedAt, percent, throughput: tput, avgThroughput: avgTps, etaSeconds });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

router.get('/campaigns/:id/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  (res as any).flushHeaders?.();
  const { id } = req.params as any;
  addClient(id, res);
  res.write(`event: hello\ndata: {"ok":true}\n\n`);
  const tick = setInterval(async () => {
    try {
      const c = await (Campaign as any).findById(id).lean();
      if (!c) return;
      const percent = calcPercent((c as any).totals || {});
      const tput = getThroughput(String(id));
      const avgTps = getAvgThroughputPerSec(String(id));
      const t = (c as any).totals || {};
      const done = (t.sent||0)+(t.delivered||0)+(t.read||0)+(t.failed||0)+(t.canceled||0);
      const remaining = Math.max(0, (t.total||0) - done);
      const etaSeconds = avgTps > 0 ? Math.ceil(remaining / avgTps) : null;
      const payload = { campaignId: id, status: (c as any).status, totals: (c as any).totals, startedAt: (c as any).startedAt, completedAt: (c as any).completedAt, percent, throughput: tput, avgThroughput: avgTps, etaSeconds };
      res.write(`event: summary\ndata: ${JSON.stringify(payload)}\n\n`);
      res.write(`: ping\n\n`);
    } catch {}
  }, 2000);
  req.on('close', () => clearInterval(tick));
});

router.get('/campaigns/:id/sends', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    const { status, page = 1, pageSize = 20 } = req.query as any;
    const q: any = { campaignId: id };
    if (status) q.status = status;
    const docs = await (Send as any).find(q).select('phone status updatedAt lastError').sort({ updatedAt: -1 }).skip((Number(page)-1)*Number(pageSize)).limit(Number(pageSize)).lean();
    res.json({ items: docs });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

router.post('/campaigns/:id/claim', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    const limit = Math.min(Number((req.query as any).limit || 20), 500);
    const now = new Date();
    const queued = await (Send as any).find({ campaignId: id, status: 'queued' }).sort({ createdAt: 1 }).limit(limit).lean();
    if (!queued.length) return res.json({ items: [] });
    const ids = queued.map((d: any) => d._id);
    const result = await (Send as any).updateMany({ _id: { $in: ids }, status: 'queued' }, { $set: { status: 'sending', updatedAt: now, 'timestamps.sendingAt': now } });
    await (Campaign as any).updateOne({ _id: id }, { $inc: { 'totals.queued': -result.modifiedCount, 'totals.sending': result.modifiedCount }, $set: { updatedAt: now } });
    const items = await (Send as any).find({ _id: { $in: ids } }).lean();
    res.json({ items });
  } catch (e) { console.error('claim error', e); res.status(500).json({ error: 'server_error' }); }
});

router.get('/campaigns/:id/queued', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    const limit = Math.min(Number((req.query as any).limit || 50), 1000);
    const docs = await (Send as any).find({ campaignId: id, status: 'queued' }).sort({ createdAt: 1 }).limit(limit).lean();
    res.json({ items: docs });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

router.post('/campaigns/:id/report', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as any;
    const tokenHeader = req.header('x-dispatch-token');
    const { dispatchToken: tokenBody, phone, stage, messageId, zaapId, error } = (req.body as any) || {};
    const dispatchToken = tokenHeader || tokenBody;
    if (!dispatchToken) return res.status(401).json({ error: 'missing_token' });
    const c = await (Campaign as any).findById(id);
    if (!c) return res.status(404).json({ error: 'not_found' });
    if (!(c as any).dispatchTokenHash || !(c as any).dispatchTokenExpiresAt || (c as any).dispatchTokenExpiresAt < new Date()) {
      return res.status(401).json({ error: 'token_expired' });
    }
    const hash = hashToken(dispatchToken);
    if (hash !== (c as any).dispatchTokenHash) return res.status(403).json({ error: 'invalid_token' });
    const send = await (Send as any).findOne({ campaignId: id, phone: String(phone).replace(/\D/g,'') });
    if (!send) return res.status(404).json({ error: 'send_not_found' });
    const now = new Date();
    const transitions: any = {
      sending: { from: ['queued'], to: 'sending', timeField: 'timestamps.sendingAt' },
      sent: { from: ['sending','queued'], to: 'sent', timeField: 'timestamps.sentAt' },
      delivered: { from: ['sent','sending'], to: 'delivered', timeField: 'timestamps.deliveredAt' },
      read: { from: ['delivered','sent'], to: 'read', timeField: 'timestamps.readAt' },
      failed: { from: ['queued','sending','sent'], to: 'failed', timeField: 'timestamps.failedAt' },
      canceled: { from: ['queued','sending'], to: 'canceled', timeField: 'timestamps.canceledAt' },
    };
    const rule = transitions[stage as string];
    if (!rule) return res.status(400).json({ error: 'invalid_stage' });
    if (!rule.from.includes((send as any).status)) {
      return res.json({ skipped: true, reason: `invalid_transition from ${(send as any).status} to ${stage}` });
    }
    const updateSend: any = { $set: { status: rule.to, updatedAt: now } };
    if (messageId) updateSend.$set.messageId = messageId;
    if (zaapId) updateSend.$set.zaapId = zaapId;
    if (error) updateSend.$set.lastError = error;
    updateSend.$set[rule.timeField] = now;
    await (Send as any).updateOne({ _id: (send as any)._id, status: (send as any).status }, updateSend);
    const from = (send as any).status;
    const to = rule.to;
    const inc: Record<string, number> = {};
    const bucket = (s: string) => `totals.${s}`;
    if (['queued','sending','sent','delivered'].includes(from)) {
      inc[bucket(from)] = (inc[bucket(from)] || 0) - 1;
    }
    if (['sending','sent','delivered','read','failed','canceled'].includes(to)) {
      inc[bucket(to)] = (inc[bucket(to)] || 0) + 1;
    }
    await (Campaign as any).updateOne({ _id: id }, { $inc: inc, $set: { updatedAt: now } });
    if (['sent','delivered','read'].includes(stage)) markThroughput(String(id));
    emitEvent(id, 'send_update', { phone, stage, messageId, zaapId, t: now });
    const c2 = await (Campaign as any).findById(id).lean();
    if (c2) {
      const t = (c2 as any).totals || {};
      const done = (t.sent||0)+(t.delivered||0)+(t.read||0)+(t.failed||0)+(t.canceled||0);
      if ((c2 as any).status === 'running' && t.total && done >= t.total) {
        await (Campaign as any).updateOne({ _id: id }, { $set: { status: 'completed', completedAt: now, updatedAt: now } });
      }
    }
    emitEvent(id, 'summary', { campaignId: id });
    res.json({ ok: true });
  } catch (e) { console.error('report error', e); res.status(500).json({ error: 'server_error' }); }
});

export default router;

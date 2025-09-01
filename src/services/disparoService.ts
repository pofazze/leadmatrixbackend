import mongoose from 'mongoose';
import DisparoRunModel from '../models/DisparoRun.js';
import { WaitProfile, getDelayRange, randomMsBetween, wait } from '../utils/wait.js';
import { ZapiInstance, sendText, sendImage, sendVideo, phoneExists, getDevicePhoneNumber } from '../utils/zapi.js';
import { normalizeBrazilPhone } from '../utils/phone.js';
import type { Server } from 'socket.io';

export type DisparoPayload = {
  runId: string;
  instance: ZapiInstance;
  type: 'text' | 'image' | 'video';
  message: string;
  mediaBase64?: string;
  waitProfile: WaitProfile;
  query?: any; // optional mongo filters
  userName?: string; // optional user identifier
  skipAlreadySent?: boolean; // if true, don't send to leads that already have lastDisparoAt
  collection?: string; // coleção dinâmica para disparo
};

export class DisparoService {
  private io: Server;
  private states: Record<ZapiInstance, { cancel: boolean; pause: boolean; runId: string | null }> = {
    whatsapp1: { cancel: false, pause: false, runId: null },
    whatsapp2: { cancel: false, pause: false, runId: null },
  };

  constructor(io: Server) {
    this.io = io;
  }

  get status() {
    // Legacy getter not used anymore; kept for compatibility
    return { status: 'idle' } as const;
  }

  // Detailed status with DB totals for persistence/rehydration
  async getStatus(instance: ZapiInstance) {
    const state = this.states[instance];
    if (!state.runId) {
      // Allow rehydration on refresh: return DB run only if recently updated to avoid stale states
      const last = await DisparoRunModel.findOne({ instance, status: { $in: ['running', 'paused'] } }).sort({ startedAt: -1 }).lean();
      const updatedAt = (last as any)?.updatedAt ? new Date((last as any).updatedAt).getTime() : 0;
      const fresh = updatedAt && (Date.now() - updatedAt) < 300_000; // 5 min freshness window
      if (!last || !fresh) return { status: 'idle', instance } as const;
      return {
        status: (last as any).status,
        runId: (last as any).runId,
        totals: (last as any).totals || {},
        type: (last as any).type,
        instance,
      } as const;
    }
    const doc = await DisparoRunModel.findOne({ runId: state.runId }).lean();
    return {
      status: state.pause ? 'paused' : state.cancel ? 'canceled' : 'running',
      runId: state.runId,
      totals: (doc as any)?.totals || {},
      type: (doc as any)?.type,
      instance,
    } as const;
  }

  async start(payload: DisparoPayload) {
  console.log('[DISPARO][start] Payload recebido:', JSON.stringify(payload, null, 2));
  const st = this.states[payload.instance];
  if (st.runId && !st.cancel) throw new Error('run_in_progress');
  st.cancel = false;
  st.pause = false;
  st.runId = payload.runId;

  await DisparoRunModel.findOneAndUpdate(
      { runId: payload.runId },
      { $set: {
        runId: payload.runId,
        status: 'running',
        type: payload.type,
        instance: payload.instance,
        message: payload.message,
        mediaBase64: payload.mediaBase64 || '',
        waitProfile: payload.waitProfile,
        userName: payload.userName || null,
    startedAt: new Date(),
    startedAtBr: nowBrIsoLike(),
      } },
      { upsert: true }
    );

    this.loop(payload).catch(err => {
      console.error('disparo loop error', err);
    });

    return { ok: true };
  }

  async pauseRun(instance: ZapiInstance) { this.states[instance].pause = true; return { ok: true }; }
  async resumeRun(instance: ZapiInstance) { this.states[instance].pause = false; return { ok: true }; }
  async cancelRun(instance: ZapiInstance) { this.states[instance].cancel = true; return { ok: true }; }

  private async loop(payload: DisparoPayload) {
    const db = mongoose.connection.db;
    if (!db) throw new Error('db_unavailable');
    // Use a coleção enviada pelo frontend, se fornecida
    const collName = payload.collection || (payload.instance === 'whatsapp2'
      ? (process.env.DISPARO_COLLECTION2 || process.env.DISPARO_COLLECTION || process.env.LEADS_COLLECTION || 'm15leads')
      : (process.env.DISPARO_COLLECTION || process.env.LEADS_COLLECTION || 'm15leads'));
    console.log('[DISPARO] Coleção usada no serviço:', collName);
    const coll = db.collection(collName);

    // Build filter with optional exclusion of already sent leads
    const baseFilter = payload.query || {};
    const filter = payload.skipAlreadySent
      ? { ...baseFilter, lastDisparoAt: { $exists: false } }
      : baseFilter;

    // Count total upfront using countDocuments with the final filter
    const total = await coll.countDocuments(filter);

    await DisparoRunModel.updateOne({ runId: payload.runId }, { $set: { 'totals.queued': total } });

    let processed = 0, sent = 0, errors = 0;
    const [minS, maxS] = getDelayRange(payload.waitProfile);

    const st = this.states[payload.instance];

    // Iterate in small batches to avoid long-lived cursors timing out (CursorNotFound)
    const batchLimit = Number(process.env.DISPARO_BATCH_LIMIT || 100);
    let lastId: any = null;

    batch_loop: while (true) {
      if (st.cancel) break;
      // Fetch next batch using _id cursor pagination
      const batchQuery = lastId ? { ...filter, _id: { $gt: lastId } } : filter;
      const docs = await coll.find(batchQuery).sort({ _id: 1 }).limit(batchLimit).toArray();
      if (!docs.length) break;

      for (const doc of docs) {
        if (st.cancel) break batch_loop;
        while (st.pause && !st.cancel) { await wait(400); }
        lastId = doc._id;

        const rawPhone = String(
          doc.whatsappNumber || doc.whatsapp || doc.phone || doc.telefone || ''
        );
        const phone = normalizeBrazilPhone(rawPhone) || '';
        const name = (doc.nome || doc.name || doc.Nome || doc.NOME || '').toString();

        let ok = false; let errMsg = '';
        let lastMessageSent: string | null = null;
        let sendWebhookUrl: string | null = null;
        let sendWebhookStatus: number | null = null;
        let sendWebhookBody: any = null;
        let sendWebhookOk: boolean | null = null;
        let sendWebhookHeaders: Record<string,string> | null = null;
        try {
          if (!phone || phone.length < 13) {
            throw new Error('invalid_phone');
          }
          // Check if phone exists on WhatsApp
          const exists = await phoneExists(payload.instance, phone);
          if (!exists) {
            throw new Error('phone_not_exists');
          }
          // Optional paraphrasing placeholder (will require OPENAI_API_KEY)
          let finalMessage = payload.message
            .replaceAll('{{name}}', name)
            .replaceAll('{{nome}}', name)
            // Support [nome] placeholder variants
            .replaceAll('[nome]', name)
            .replaceAll('[Nome]', name)
            .replaceAll('[NOME]', name);
          try {
            const useParaphrase = String(process.env.OPENAI_PARAPHRASE || 'false').toLowerCase() === 'true';
            if (useParaphrase && process.env.OPENAI_API_KEY) {
              finalMessage = await paraphrasePt(finalMessage);
            }
          } catch (e) {
            // ignore paraphrasing errors
          }
          if (payload.type === 'text') {
            const r = await sendText(payload.instance, phone, finalMessage);
            sendWebhookUrl = r.url; sendWebhookStatus = r.status; sendWebhookOk = r.ok; sendWebhookBody = r.data ?? r.text ?? null; sendWebhookHeaders = r.headers || null;
            lastMessageSent = finalMessage;
          } else if (payload.type === 'image') {
            const r = await sendImage(payload.instance, phone, finalMessage, payload.mediaBase64 || '');
            sendWebhookUrl = r.url; sendWebhookStatus = r.status; sendWebhookOk = r.ok; sendWebhookBody = r.data ?? r.text ?? null; sendWebhookHeaders = r.headers || null;
            lastMessageSent = finalMessage;
          } else {
            const r = await sendVideo(payload.instance, phone, finalMessage, payload.mediaBase64 || '');
            sendWebhookUrl = r.url; sendWebhookStatus = r.status; sendWebhookOk = r.ok; sendWebhookBody = r.data ?? r.text ?? null; sendWebhookHeaders = r.headers || null;
            lastMessageSent = finalMessage;
          }
          ok = true; sent++;
        } catch (e: any) {
          errors++; errMsg = e?.message || String(e);
        }

        processed++;
        await DisparoRunModel.updateOne({ runId: payload.runId }, { $set: { 'totals.sent': sent, 'totals.errors': errors, 'totals.processed': processed } });

        // Per-lead audit logging back into the lead document
    try {
          const deviceNumber = await getDevicePhoneNumber(payload.instance);
          const audit: any = {
            lastDisparoAt: new Date(),
      lastDisparoAtBr: nowBrIsoLike(),
            lastDisparoOk: ok,
            lastDisparoError: ok ? '' : errMsg,
            lastDisparoInstance: payload.instance,
            lastDisparoConnectedNumber: deviceNumber || null,
            lastDisparoType: payload.type,
            lastDisparoWebhookUrl: sendWebhookUrl,
            lastDisparoWebhookStatus: sendWebhookStatus,
            lastDisparoWebhookOk: sendWebhookOk,
            lastDisparoWebhookBody: sendWebhookBody,
          };
          if (payload.userName) (audit as any).lastDisparoUser = payload.userName;
          if (payload.type === 'text') (audit as any).lastDisparoMessage = (lastMessageSent || payload.message || '').toString();
          if (payload.type !== 'text') {
            (audit as any).lastDisparoCaption = (lastMessageSent || payload.message || '').toString();
            (audit as any).lastDisparoMedia = !!payload.mediaBase64;
          }
          await coll.updateOne({ _id: doc._id }, { $set: audit });
        } catch {}

        this.io.of('/disparo').emit('disparo:progress', {
          runId: payload.runId,
          processed, sent, errors, total,
          last: {
            id: doc._id,
            error: errMsg,
            user: payload.userName || null,
            webhook: {
              url: sendWebhookUrl,
              status: sendWebhookStatus,
              ok: sendWebhookOk,
              body: sendWebhookBody,
            },
          }
        });

        // Only wait between messages that were successfully sent.
        // For errors (including phone invalid/not exists), skip the delay to speed up processing.
        if (ok) {
          const delay = randomMsBetween(minS, maxS);
          // announce wait countdown to clients; client will render countdown locally from until
          this.io.of('/disparo').emit('disparo:wait', { runId: payload.runId, seconds: Math.round(delay/1000), until: Date.now() + delay });
          await wait(delay);
        }
        // else, proceed immediately
      }
    }

  const finishedAt = new Date();
    let status: 'completed' | 'canceled' = st.cancel ? 'canceled' : 'completed';
  await DisparoRunModel.updateOne({ runId: payload.runId }, { $set: { status, finishedAt, finishedAtBr: nowBrIsoLike() } });
    this.io.of('/disparo').emit('disparo:done', { runId: payload.runId, status });
    // Reset instance state
    this.states[payload.instance] = { cancel: false, pause: false, runId: null };
  }
}

// Lightweight paraphrasing using OpenAI (text-only). Keeps context and size similar.
async function paraphrasePt(input: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return input;
  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Você é um assistente que reescreve mensagens comerciais em português mantendo todo o contexto, sem adicionar ou remover informações. Produza uma versão natural e concisa com o mesmo tamanho aproximado.' },
      { role: 'user', content: `Crie uma versão diferente desta mensagem, mas mantendo todo o contexto e sem alterar e nem adicionar nada do tamanho texto:\n\n${input}` }
    ],
    temperature: 0.7,
  } as any;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return input;
    const data: any = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    if (text && text.trim().length > 0) return text.trim();
    return input;
  } catch {
    return input;
  }
}

// Format current time in America/Sao_Paulo as ISO-like string "YYYY-MM-DD HH:mm:ss"
function nowBrIsoLike(date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  // sv-SE already produces "YYYY-MM-DD HH:mm:ss"
  return fmt.format(date);
}

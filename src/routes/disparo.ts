import express from 'express';
import crypto from 'node:crypto';
import type { Server } from 'socket.io';
import { DisparoService } from '../services/disparoService.js';
import { requireAuth } from '../utils/auth.js';

const router = express.Router();

export default function createDisparoRouter(io: Server) {
  const service = new DisparoService(io);
  router.use(requireAuth);

  router.post('/disparo/start', async (req, res) => {
    try {
      const runId = req.body.runId || crypto.randomUUID();
      const { instance, type, message, mediaBase64, waitProfile, query, userName, skipAlreadySent, collection } = req.body || {};
      console.log('[DISPARO] Coleção recebida na rota:', collection);
      if (!instance || !type || !message || !waitProfile) {
        return res.status(400).json({ error: 'missing_fields' });
      }
      await service.start({ runId, instance, type, message, mediaBase64, waitProfile, query, userName, skipAlreadySent, collection });
      return res.json({ ok: true, runId });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || 'server_error' });
    }
  });

  router.post('/disparo/pause', async (req, res) => {
    const { instance } = req.body || {};
    if (!instance) return res.status(400).json({ error: 'instance_required' });
    return res.json(await service.pauseRun(instance));
  });
  router.post('/disparo/resume', async (req, res) => {
    const { instance } = req.body || {};
    if (!instance) return res.status(400).json({ error: 'instance_required' });
    return res.json(await service.resumeRun(instance));
  });
  router.post('/disparo/cancel', async (req, res) => {
    const { instance } = req.body || {};
    if (!instance) return res.status(400).json({ error: 'instance_required' });
    return res.json(await service.cancelRun(instance));
  });
  router.get('/disparo/status', async (req, res) => {
    const instance = (req.query.instance as any) || 'whatsapp1';
    return res.json(await service.getStatus(instance));
  });

  return router;
}

import express from 'express';
import axios from 'axios';

const router = express.Router();
const BASE = (process.env.CHAT_SERVER_BASE || '').replace(/\/$/, '');

function noBase(res: any) {
  return res.status(501).json({ error: 'chat_server_unconfigured' });
}

router.get('/webhook/get-conversations', async (_req, res) => {
  if (!BASE) return res.json([]);
  try { const r = await axios.get(`${BASE}/webhook/get-conversations`); return res.json(r.data); } catch (e: any) { return res.status(e.response?.status || 502).json(e.response?.data || { error: 'proxy_failed' }); }
});

router.get('/webhook/get-chat-history', async (req, res) => {
  if (!BASE) return res.json([]);
  try { const r = await axios.get(`${BASE}/webhook/get-chat-history`, { params: req.query }); return res.json(r.data); } catch (e: any) { return res.status(e.response?.status || 502).json(e.response?.data || { error: 'proxy_failed' }); }
});

router.post('/webhook/mark-as-read', async (req, res) => {
  if (!BASE) return noBase(res);
  try { const r = await axios.post(`${BASE}/webhook/mark-as-read`, req.body); return res.json(r.data); } catch (e: any) { return res.status(e.response?.status || 502).json(e.response?.data || { error: 'proxy_failed' }); }
});

router.post('/webhook/send-text-message', async (req, res) => {
  if (!BASE) return noBase(res);
  try { const r = await axios.post(`${BASE}/webhook/send-text-message`, req.body); return res.json(r.data); } catch (e: any) { return res.status(e.response?.status || 502).json(e.response?.data || { error: 'proxy_failed' }); }
});

router.post('/webhook/send-media-message', async (req, res) => {
  if (!BASE) return noBase(res);
  try { const r = await axios.post(`${BASE}/webhook/send-media-message`, req.body); return res.json(r.data); } catch (e: any) { return res.status(e.response?.status || 502).json(e.response?.data || { error: 'proxy_failed' }); }
});

export default router;

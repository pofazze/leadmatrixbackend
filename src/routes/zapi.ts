import express, { Request, Response } from 'express';
import { requireAuth } from '../utils/auth.js';
import axios from 'axios';
import Campaign from '../models/Campaign.js';
import Send from '../models/Send.js';
import { emitEvent } from '../utils/sse.js';

const router = express.Router();

router.post('/zapi/webhook/messages', async (req: Request, res: Response) => {
  try {
    const secret = req.header('x-webhook-secret');
    if (!process.env.ZAPI_WEBHOOK_SECRET || secret !== process.env.ZAPI_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { messageId, zaapId, stage } = (req.body as any) || {};
    if (!messageId && !zaapId) return res.status(400).json({ error: 'missing_ids' });

    const send = await (Send as any).findOne({ $or: [{ messageId }, { zaapId }] });
    if (!send) return res.json({ ok: true, skipped: true });

    const id = String((send as any).campaignId);
    const now = new Date();
    let inc: Record<string, number> = {}, set: Record<string, any> = {}; let timeField: string | null = null;
    if (stage === 'delivered' && (send as any).status !== 'delivered') {
      set.status = 'delivered'; timeField = 'timestamps.deliveredAt'; inc['totals.delivered'] = 1;
    } else if (stage === 'read' && (send as any).status !== 'read') {
      set.status = 'read'; timeField = 'timestamps.readAt'; inc['totals.read'] = 1;
    } else {
      return res.json({ ok: true, skipped: true });
    }

    if (timeField) set[timeField] = now;

    await (Send as any).updateOne({ _id: (send as any)._id }, { $set: set });
    await (Campaign as any).updateOne({ _id: id }, { $inc: inc, $set: { updatedAt: now } });

    emitEvent(id, 'send_update', { phone: (send as any).phone, stage, t: now });
    emitEvent(id, 'summary', { campaignId: id });
    res.json({ ok: true });
  } catch (e) {
    console.error('zapi webhook error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Require auth for the rest of ZAPI routes
router.use(requireAuth);

export default router;

// Extra routes for restart/disconnect/phone-code using same env credentials
function cred(instance: string) {
  const key = String(instance || '').toLowerCase();
  const id = key === 'whatsapp1' ? process.env.ZAPI_INSTANCE1_ID : process.env.ZAPI_INSTANCE2_ID;
  const token = key === 'whatsapp1' ? process.env.ZAPI_INSTANCE1_TOKEN : process.env.ZAPI_INSTANCE2_TOKEN;
  if (!id || !token) return { id: null, token: null } as const;
  return { id, token } as const;
}
function bases() {
  return (process.env.ZAPI_BASE_URLS || process.env.ZAPI_BASE_URL || 'https://api.z-api.io,https://api.z-api.com.br')
    .split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\/$/, ''));
}
function authHeaders(id: string, token: string) {
  const headers: Record<string,string> = { Accept: 'application/json' };
  if (process.env.ZAPI_CLIENT_TOKEN) {
    const t = String(process.env.ZAPI_CLIENT_TOKEN).replace(/^['"]|['"]$/g, '');
    if (t) headers['Client-Token'] = t;
  }
  return headers;
}

router.post('/zapi/:instance/restart', async (req: Request, res: Response) => {
  const { instance } = req.params as any;
  const { id, token } = cred(instance);
  if (!id || !token) return res.status(400).json({ error: 'invalid_instance' });
  const hdrs = { headers: authHeaders(id, token) };
  const errs: any[] = [];
  for (const b of bases()) {
    try { const r = await axios.get(`${b}/instances/${id}/token/${token}/restart`, hdrs); return res.json(r.data); } catch (e: any) { errs.push(e.response?.status); }
  }
  return res.status(502).json({ error: 'restart_failed', details: errs });
});

router.post('/zapi/:instance/disconnect', async (req: Request, res: Response) => {
  const { instance } = req.params as any;
  const { id, token } = cred(instance);
  if (!id || !token) return res.status(400).json({ error: 'invalid_instance' });
  const hdrs = { headers: authHeaders(id, token) };
  const errs: any[] = [];
  for (const b of bases()) {
    try { const r = await axios.get(`${b}/instances/${id}/token/${token}/disconnect`, hdrs); return res.json(r.data); } catch (e: any) { errs.push(e.response?.status); }
  }
  return res.status(502).json({ error: 'disconnect_failed', details: errs });
});

router.get('/zapi/:instance/phone-code/:phone', async (req: Request, res: Response) => {
  const { instance, phone } = req.params as any;
  const { id, token } = cred(instance);
  if (!id || !token) return res.status(400).json({ error: 'invalid_instance' });
  const hdrs = { headers: authHeaders(id, token) };
  const errs: any[] = [];
  for (const b of bases()) {
    try { const r = await axios.get(`${b}/instances/${id}/token/${token}/phone-code/${encodeURIComponent(phone)}`, hdrs); return res.json(r.data); } catch (e: any) { errs.push(e.response?.status); }
  }
  return res.status(502).json({ error: 'phone_code_failed', details: errs });
});

function getInstanceCreds(instanceKey?: string) {
  const key = String(instanceKey || '').toLowerCase();
  if (key === 'whatsapp1') {
    return { id: process.env.ZAPI_INSTANCE1_ID, token: process.env.ZAPI_INSTANCE1_TOKEN } as const;
  }
  if (key === 'whatsapp2') {
    return { id: process.env.ZAPI_INSTANCE2_ID, token: process.env.ZAPI_INSTANCE2_TOKEN } as const;
  }
  return { id: null, token: null } as const;
}

function zapiBases() {
  const list = (process.env.ZAPI_BASE_URLS || process.env.ZAPI_BASE_URL || 'https://api.z-api.io,https://api.z-api.com.br')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/\/$/, ''));
  return list.length ? list : ['https://api.z-api.io','https://api.z-api.com.br'];
}

function toSuffixList(envVar: string, fallback: string[]) {
  const raw = (process.env[envVar] || '').split(',').map(s => s.trim()).filter(Boolean);
  return raw.length ? raw : fallback;
}

function buildAuthHeaders(id: string, token: string) {
  const headers: Record<string, string> = {};
  if (String(process.env.ZAPI_BEARER_AUTH || '').toLowerCase() === 'true') {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (process.env.ZAPI_CLIENT_TOKEN) {
  const t = String(process.env.ZAPI_CLIENT_TOKEN).replace(/^['"]|['"]$/g, '');
  if (t) headers['Client-Token'] = t;
  }
  const hdrList = (process.env.ZAPI_HEADERS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  for (const pair of hdrList) {
    const [name, ...rest] = pair.split('=');
    if (!name || !rest.length) continue;
    const valueTpl = rest.join('=');
    const value = valueTpl.replace('{id}', id).replace('{token}', token);
    headers[name] = value;
  }
  return headers;
}

function appendQuery(url: string, id: string, token: string) {
  const qpList = (process.env.ZAPI_QUERY_PARAMS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (!qpList.length) return url;
  const params = qpList.map(pair => {
    const [k, ...vr] = pair.split('=');
    const vtpl = vr.join('=');
    const v = vtpl.replace('{id}', id).replace('{token}', token);
    return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  }).join('&');
  return url + (url.includes('?') ? '&' : '?') + params;
}

router.get('/zapi/:instance/qr', async (req: Request, res: Response) => {
  try {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
    const { instance } = req.params as any;
    const { id, token } = getInstanceCreds(instance);
    if (!id || !token) return res.status(400).json({ error: 'invalid_instance' });
    const bases = zapiBases();

    const qrSuffixes = toSuffixList('ZAPI_QR_SUFFIXES', [
      'qr-code/image',
      'qr-code',
    ]);
    const qrTemplates = (process.env.ZAPI_QR_TEMPLATES || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const attempts: Array<{ url: string; type: 'image'|'json'|'json-b64' }> = [];
    if (qrTemplates.length) {
      for (const b of bases) {
        for (const tpl of qrTemplates) {
          const url = `${b}${tpl}`
            .replace('{id}', encodeURIComponent(id))
            .replace('{token}', encodeURIComponent(token));
          let type: 'image'|'json'|'json-b64' = 'json';
          if (tpl.includes('/qr-code/image') || tpl.includes('qrcode/image') || tpl.includes('qrcode-base64')) type = 'json-b64';
          else if (tpl.includes('/qr-code') || tpl.endsWith('/qr') || tpl.endsWith('/qrcode')) type = 'image';
          attempts.push({ url, type });
        }
      }
    } else {
      for (const b of bases) {
        for (const sfx of qrSuffixes) {
          let type: 'image'|'json'|'json-b64' = sfx.includes('qr-code/image') ? 'json-b64' : 'image';
          attempts.push({ url: `${b}/instances/${id}/token/${token}/${sfx}`, type });
        }
      }
    }
    const defaultQrTemplates = [
      '/v2/instances/{id}/token/{token}/qrcode-base64',
      '/v2/instances/{id}/token/{token}/qr-code/image',
      '/v2/instances/{id}/token/{token}/qrcode/image',
      '/v1/instances/{id}/token/{token}/qrcode-base64',
      '/v1/instances/{id}/token/{token}/qr-code/image',
      '/v1/instances/{id}/token/{token}/qrcode/image',
    ];
    for (const b of bases) {
      for (const tpl of defaultQrTemplates) {
        const url = `${b}${tpl}`
          .replace('{id}', encodeURIComponent(id))
          .replace('{token}', encodeURIComponent(token));
        const type: 'image'|'json'|'json-b64' = /image(\?|$)|\.png$/.test(tpl) ? 'image' : (tpl.includes('base64') ? 'json-b64' : 'json');
        attempts.push({ url, type });
      }
    }
    const errors: any[] = [];
    const headers = buildAuthHeaders(id, token);
    for (const a of attempts) {
      try {
        const url = appendQuery(a.url, id, token);
        if (a.type === 'image') {
          const r = await axios.get(url, { responseType: 'arraybuffer', headers: { ...headers, Accept: 'image/*,application/json' } });
          const ct = String((r as any).headers['content-type'] || '').toLowerCase();
          if (ct.includes('application/json') || ct.includes('text/')) {
            const txt = Buffer.from(r.data).toString('utf8');
            try {
              const jd = JSON.parse(txt);
              if (jd && (jd.connected === true || jd.data?.connected === true)) {
                return res.json({ instance, connected: true, source: a.url });
              }
              if (jd && jd.error) {
                errors.push({ url: a.url, status: 200, data: jd });
                continue;
              }
            } catch {}
            errors.push({ url: a.url, status: 200, data: txt.slice(0,200) });
            continue;
          }
          const b64 = Buffer.from(r.data as any, 'binary').toString('base64');
          return res.json({ instance, imageBase64: `data:image/png;base64,${b64}` });
        }
        const r = await axios.get(url, { headers: { ...headers, Accept: 'application/json' } });
        const d = (r as any).data || {};
        if (d && (d.connected === true || d.data?.connected === true)) {
          return res.json({ instance, connected: true, source: a.url });
        }
        if (d && d.error) {
          errors.push({ url: a.url, status: (r as any).status, data: d });
          continue;
        }
        const candidates = [d.value, d.qrCodeBase64, d.qrcodeBase64, d.base64, d.imageBase64, d.qrCode, d.qrcode];
        const found = candidates.find((v: any) => typeof v === 'string' && v.length > 100);
        if (a.type === 'json-b64' && found) {
          const img = (found as string).startsWith('data:') ? found : `data:image/png;base64,${found}`;
          return res.json({ instance, imageBase64: img });
        }
        if (d.imageBase64 || (typeof d === 'string' && d.startsWith('data:'))) {
          return res.json({ instance, imageBase64: d.imageBase64 || d });
        }
        if (typeof d === 'string' && d.length > 100 && /^[A-Za-z0-9+/=]+$/.test(d)) {
          return res.json({ instance, imageBase64: `data:image/png;base64,${d}` });
        }
        errors.push({ url: a.url, status: (r as any).status, data: d });
        continue;
      } catch (e: any) {
        errors.push({ url: a.url, status: e.response?.status, data: e.response?.data });
      }
    }
    console.error('QR fetch error - attempts failed', errors);
    return res.status(502).json({ error: 'qr_unavailable', tried: attempts.map(a => a.url), details: errors.map(e => ({ url: e.url, status: e.status, data: typeof e.data === 'string' ? e.data.slice(0,200) : e.data })) });
  } catch (e) {
    console.error('qr route error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/zapi/:instance/session', async (req: Request, res: Response) => {
  try {
    const { instance } = req.params as any;
    const { id, token } = getInstanceCreds(instance);
    if (!id || !token) return res.status(400).json({ error: 'invalid_instance' });
    const bases = zapiBases();
    const statusSuffixes = toSuffixList('ZAPI_STATUS_SUFFIXES', [
      'status', 'session', 'state', 'connection-state', 'connectionState', 'auth/status', 'device/connection-state', 'device/status', 'whatsapp/status', 'instance/status', 'session/status',
    ]);
    const statusTemplates = (process.env.ZAPI_STATUS_TEMPLATES || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const urls: string[] = [];
    if (statusTemplates.length) {
      for (const b of bases) {
        for (const tpl of statusTemplates) {
          const url = `${b}${tpl}`
            .replace('{id}', encodeURIComponent(id))
            .replace('{token}', encodeURIComponent(token));
          urls.push(url);
        }
      }
    } else {
      for (const b of bases) {
        for (const sfx of statusSuffixes) {
          urls.push(`${b}/instances/${id}/${sfx}`);
          urls.push(`${b}/instances/${id}/token/${token}/${sfx}`);
        }
      }
    }
    const defaultStatusTemplates = [
      '/v2/instances/{id}/token/{token}/status',
      '/v1/instances/{id}/token/{token}/status',
      '/v2/instances/{id}/token/{token}/session',
      '/v1/instances/{id}/token/{token}/session',
    ];
    for (const b of bases) {
      for (const tpl of defaultStatusTemplates) {
        const url = `${b}${tpl}`
          .replace('{id}', encodeURIComponent(id))
          .replace('{token}', encodeURIComponent(token));
        urls.push(url);
      }
    }
    const errors: any[] = [];
    const headers = buildAuthHeaders(id, token);
    for (let url of urls) {
      try {
        url = appendQuery(url, id, token);
        const r = await axios.get(url, { headers });
        return res.json({ instance, tried: urls, ...(r as any).data });
      } catch (e: any) {
        errors.push({ url, status: e.response?.status, data: e.response?.data });
      }
    }
    return res.status(502).json({ error: 'status_unavailable', tried: urls, details: errors.map(e => ({ url: e.url, status: e.status, data: typeof e.data === 'string' ? e.data.slice(0,200) : e.data })) });
  } catch (e) {
    console.error('session route error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/zapi/:instance/device', async (req: Request, res: Response) => {
  try {
    const { instance } = req.params as any;
    const { id, token } = getInstanceCreds(instance);
    if (!id || !token) return res.status(400).json({ error: 'invalid_instance' });
    const bases = zapiBases();
    const urls: string[] = [];
    for (const b of bases) {
      urls.push(`${b}/instances/${id}/device`);
      urls.push(`${b}/instances/${id}/token/${token}/device`);
      urls.push(`${b}/v2/instances/${id}/device`);
      urls.push(`${b}/v1/instances/${id}/device`);
    }
    const headers = buildAuthHeaders(id, token);
    const errors: any[] = [];
    for (let url of urls) {
      try {
        url = appendQuery(url, id, token);
        const r = await axios.get(url, { headers });
        const data = (r as any).data || {};
        let phoneNumber: string | null = null;
        if (typeof data.phone === 'string') phoneNumber = data.phone;
        if (!phoneNumber && typeof data.phoneNumber === 'string') phoneNumber = data.phoneNumber;
        if (!phoneNumber && data.me && typeof data.me.phoneNumber === 'string') phoneNumber = data.me.phoneNumber;
        if (!phoneNumber && data.device && typeof data.device.phoneNumber === 'string') phoneNumber = data.device.phoneNumber;
        if (!phoneNumber && data.result && typeof data.result.phoneNumber === 'string') phoneNumber = data.result.phoneNumber;
        return res.json({ instance, tried: urls, phoneNumber, ...data });
      } catch (e: any) {
        errors.push({ url, status: e.response?.status, data: e.response?.data });
      }
    }
    res.status(502).json({ error: 'device_unavailable', tried: urls, details: errors });
  } catch (e) {
    console.error('device route error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/zapi/:instance/me', async (req: Request, res: Response) => {
  try {
    const { instance } = req.params as any;
    const { id, token } = getInstanceCreds(instance);
    if (!id || !token) return res.status(400).json({ error: 'invalid_instance' });
    const bases = zapiBases();
    const urls: string[] = [];
    for (const b of bases) {
      urls.push(`${b}/instances/${id}/me`);
      urls.push(`${b}/instances/${id}/token/${token}/me`);
      urls.push(`${b}/v2/instances/${id}/me`);
      urls.push(`${b}/v1/instances/${id}/me`);
    }
    const headers = buildAuthHeaders(id, token);
    const errors: any[] = [];
    for (let url of urls) {
      try {
        url = appendQuery(url, id, token);
        const r = await axios.get(url, { headers });
        return res.json({ instance, tried: urls, ...(r as any).data });
      } catch (e: any) {
        errors.push({ url, status: e.response?.status, data: e.response?.data });
      }
    }
    res.status(502).json({ error: 'me_unavailable', tried: urls, details: errors });
  } catch (e) {
    console.error('me route error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Simple normalized status for UI gating
router.get('/zapi/:instance/status', async (req: Request, res: Response) => {
  try {
    const { instance } = req.params as any;
    const { id, token } = getInstanceCreds(instance);
    if (!id || !token) return res.status(400).json({ error: 'invalid_instance' });
    const bases = zapiBases();
    const headers = buildAuthHeaders(id, token);
    const statusUrls: string[] = [];
    for (const b of bases) {
      statusUrls.push(`${b}/instances/${id}/token/${token}/status`);
      statusUrls.push(`${b}/v2/instances/${id}/token/${token}/status`);
      statusUrls.push(`${b}/v1/instances/${id}/token/${token}/status`);
    }
    let connected = false;
    for (let url of statusUrls) {
      try { url = appendQuery(url, id, token); const r = await axios.get(url, { headers }); const d = (r as any).data || {}; connected = !!(d.connected === true || d.data?.connected === true); if (connected) break; } catch {}
    }
    let phoneNumber: string | null = null;
    if (connected) {
      const deviceUrls: string[] = [];
      for (const b of bases) {
        deviceUrls.push(`${b}/instances/${id}/token/${token}/device`);
        deviceUrls.push(`${b}/v2/instances/${id}/token/${token}/device`);
        deviceUrls.push(`${b}/v1/instances/${id}/token/${token}/device`);
      }
      for (let url of deviceUrls) {
        try { url = appendQuery(url, id, token); const r = await axios.get(url, { headers }); const d = (r as any).data || {}; phoneNumber = d.phone || d.phoneNumber || d?.device?.phoneNumber || d?.me?.phoneNumber || null; if (phoneNumber) break; } catch {}
      }
    }
    return res.json({ instance, connected, phoneNumber });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

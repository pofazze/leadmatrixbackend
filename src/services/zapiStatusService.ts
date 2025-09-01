import axios from 'axios';
import type { Server as IOServer } from 'socket.io';

export type InstanceKey = 'whatsapp1' | 'whatsapp2';

function getCred(instance: InstanceKey) {
  const id = instance === 'whatsapp1' ? process.env.ZAPI_INSTANCE1_ID : process.env.ZAPI_INSTANCE2_ID;
  const token = instance === 'whatsapp1' ? process.env.ZAPI_INSTANCE1_TOKEN : process.env.ZAPI_INSTANCE2_TOKEN;
  if (!id || !token) throw new Error('invalid_instance');
  return { id, token } as const;
}

function getBases() {
  const raw = (process.env.ZAPI_BASE_URLS || process.env.ZAPI_BASE_URL || 'https://api.z-api.io,https://api.z-api.com.br')
    .split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\/$/, ''));
  return raw.length ? raw : ['https://api.z-api.io'];
}

function headers() {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (process.env.ZAPI_CLIENT_TOKEN) {
    const t = String(process.env.ZAPI_CLIENT_TOKEN).replace(/^['"]|['"]$/g, '');
    if (t) h['Client-Token'] = t;
  }
  return h;
}

async function tryGet(urls: string[]) {
  const hdrs = { headers: headers() };
  const errors: any[] = [];
  for (const url of urls) {
    try { const r = await axios.get(url, hdrs); return r.data; } catch (e: any) { errors.push({ url, status: e.response?.status }); }
  }
  throw Object.assign(new Error('all_attempts_failed'), { errors });
}

export default class ZapiStatusService {
  private io: IOServer;
  private timer: NodeJS.Timeout | null = null;
  private cache = new Map<InstanceKey, any>();

  constructor(io: IOServer) { this.io = io; }

  start(intervalMs = 10000) {
    const tick = async () => {
      for (const inst of ['whatsapp1','whatsapp2'] as InstanceKey[]) {
        try {
          const { id, token } = getCred(inst);
          const bases = getBases();
          const statusUrls: string[] = [];
          for (const b of bases) {
            statusUrls.push(`${b}/instances/${id}/token/${token}/status`);
            statusUrls.push(`${b}/v2/instances/${id}/token/${token}/status`);
            statusUrls.push(`${b}/v1/instances/${id}/token/${token}/status`);
          }
          const s = await tryGet(statusUrls).catch(() => ({}));
          let phoneNumber: string | null = null;
          if (s?.connected === true) {
            const deviceUrls: string[] = [];
            for (const b of bases) {
              deviceUrls.push(`${b}/instances/${id}/token/${token}/device`);
              deviceUrls.push(`${b}/v2/instances/${id}/token/${token}/device`);
              deviceUrls.push(`${b}/v1/instances/${id}/token/${token}/device`);
            }
            const d = await tryGet(deviceUrls).catch(() => null);
            phoneNumber = d?.phone || d?.phoneNumber || d?.device?.phoneNumber || d?.me?.phoneNumber || null;
          }
          const next = { instance: inst, connected: !!s?.connected, smartphoneConnected: !!s?.smartphoneConnected, phoneNumber };
          const prev = this.cache.get(inst);
          if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
            this.cache.set(inst, next);
            this.io.of('/zapi').emit('zapi:status', next);
          }
        } catch (e) {
          const next = { instance: inst, connected: false, smartphoneConnected: false, phoneNumber: null };
          const prev = this.cache.get(inst);
          if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
            this.cache.set(inst, next);
            this.io.of('/zapi').emit('zapi:status', next);
          }
        }
      }
    };
    if (this.timer) clearInterval(this.timer);
    tick().catch(()=>{});
    this.timer = setInterval(tick, intervalMs);
  }

  snapshot(): Array<{ instance: InstanceKey; connected: boolean; smartphoneConnected?: boolean; phoneNumber?: string | null }> {
    const out: Array<{ instance: InstanceKey; connected: boolean; smartphoneConnected?: boolean; phoneNumber?: string | null }> = [];
    for (const inst of ['whatsapp1','whatsapp2'] as InstanceKey[]) {
      const v = this.cache.get(inst) || { instance: inst, connected: false, smartphoneConnected: false, phoneNumber: null };
      out.push(v);
    }
    return out;
  }
}

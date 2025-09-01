export type ZapiInstance = 'whatsapp1' | 'whatsapp2';

function getZapiBase(_instance: ZapiInstance) {
  const list = (process.env.ZAPI_BASE_URLS || process.env.ZAPI_BASE_URL || 'https://api.z-api.io,https://api.z-api.com.br')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/\/$/, ''));
  return list[0] || 'https://api.z-api.io';
}

function getClientToken() {
  let token = process.env.ZAPI_CLIENT_TOKEN || '';
  token = token.replace(/^['"]|['"]$/g, '');
  if (!token) throw new Error('Missing ZAPI_CLIENT_TOKEN');
  return token;
}

function getInstanceCreds(instance: ZapiInstance) {
  const id = instance === 'whatsapp1' ? process.env.ZAPI_INSTANCE1_ID : process.env.ZAPI_INSTANCE2_ID;
  const token = instance === 'whatsapp1' ? process.env.ZAPI_INSTANCE1_TOKEN : process.env.ZAPI_INSTANCE2_TOKEN;
  if (!id || !token) throw new Error('Missing Z-API instance credentials');
  return { id, token } as const;
}

export type ZapiSendResult = { url: string; status: number; ok: boolean; data?: any; text?: string; headers?: Record<string,string> };

function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return token[0] + '***' + token[token.length - 1];
  return token.slice(0, 4) + '***' + token.slice(-4);
}

export async function sendText(instance: ZapiInstance, phone: string, message: string): Promise<ZapiSendResult> {
  const { id, token } = getInstanceCreds(instance);
  const base = getZapiBase(instance);
  const url = `${base}/instances/${id}/token/${token}/send-text/`;
  const reqHeaders: Record<string,string> = {
    'Content-Type': 'application/json',
    'Client-Token': getClientToken(),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify({ phone, message })
  });
  const status = res.status; const ok = res.ok;
  const txt = await res.text();
  let data: any = undefined;
  try { data = JSON.parse(txt); } catch {}
  if (!ok) throw new Error(`ZAPI text failed: ${status} ${txt?.slice(0,500)}`);
  return { url, status, ok, data, text: data ? undefined : txt, headers: { 'Content-Type': 'application/json', 'Client-Token': maskToken(reqHeaders['Client-Token']) } };
}

export async function sendImage(instance: ZapiInstance, phone: string, message: string, base64: string): Promise<ZapiSendResult> {
  const { id, token } = getInstanceCreds(instance);
  const base = getZapiBase(instance);
  const url = `${base}/instances/${id}/token/${token}/send-image/`;
  const reqHeaders: Record<string,string> = {
    'Content-Type': 'application/json',
    'Client-Token': getClientToken(),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify({ phone, caption: message, image: base64 })
  });
  const status = res.status; const ok = res.ok;
  const txt = await res.text();
  let data: any = undefined;
  try { data = JSON.parse(txt); } catch {}
  if (!ok) throw new Error(`ZAPI image failed: ${status} ${txt?.slice(0,500)}`);
  return { url, status, ok, data, text: data ? undefined : txt, headers: { 'Content-Type': 'application/json', 'Client-Token': maskToken(reqHeaders['Client-Token']) } };
}

export async function sendVideo(instance: ZapiInstance, phone: string, message: string, base64: string): Promise<ZapiSendResult> {
  const { id, token } = getInstanceCreds(instance);
  const base = getZapiBase(instance);
  const url = `${base}/instances/${id}/token/${token}/send-video/`;
  const reqHeaders: Record<string,string> = {
    'Content-Type': 'application/json',
    'Client-Token': getClientToken(),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify({ phone, caption: message, video: base64 })
  });
  const status = res.status; const ok = res.ok;
  const txt = await res.text();
  let data: any = undefined;
  try { data = JSON.parse(txt); } catch {}
  if (!ok) throw new Error(`ZAPI video failed: ${status} ${txt?.slice(0,500)}`);
  return { url, status, ok, data, text: data ? undefined : txt, headers: { 'Content-Type': 'application/json', 'Client-Token': maskToken(reqHeaders['Client-Token']) } };
}

export async function phoneExists(instance: ZapiInstance, phone: string): Promise<boolean> {
  const { id, token } = getInstanceCreds(instance);
  const base = getZapiBase(instance);
  const url = `${base}/instances/${id}/token/${token}/phone-exists/${encodeURIComponent(phone)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Client-Token': getClientToken(),
    },
  });
  if (!res.ok) {
    // If the endpoint is not available, default to true to avoid false negatives
    return true;
  }
  try {
    const data = await res.json();
    // Z-API often returns { exists: boolean } or { result: { exists: boolean } }
    const exists = (data && (data.exists === true || data.valid === true || data.result?.exists === true));
    return !!exists;
  } catch {
    return true;
  }
}

export async function getDevicePhoneNumber(instance: ZapiInstance): Promise<string | null> {
  const { id, token } = getInstanceCreds(instance);
  const base = getZapiBase(instance);
  const candidates = [
    `${base}/instances/${id}/token/${token}/device`,
    `${base}/instances/${id}/device`,
    `${base}/v2/instances/${id}/device`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json', 'Client-Token': getClientToken() } as any });
      if (!res.ok) continue;
      const d: any = await res.json();
      const pn = d?.phone || d?.phoneNumber || d?.device?.phoneNumber || d?.me?.phoneNumber || d?.result?.phoneNumber;
      if (pn) return String(pn);
    } catch {}
  }
  return null;
}

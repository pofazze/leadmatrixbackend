import { Response } from 'express';

// Simple SSE hub per campaign
const connections: Map<string, Set<Response>> = new Map();

export function addClient(campaignId: string, res: Response) {
  if (!connections.has(campaignId)) connections.set(campaignId, new Set());
  connections.get(campaignId)!.add(res);
  res.on('close', () => {
    removeClient(campaignId, res);
  });
}

export function removeClient(campaignId: string, res: Response) {
  const set = connections.get(campaignId);
  if (set) {
    set.delete(res);
    if (set.size === 0) connections.delete(campaignId);
  }
}

export function emitEvent(campaignId: string, type: string, data: any) {
  const set = connections.get(campaignId);
  if (!set) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of set) r.write(payload);
}

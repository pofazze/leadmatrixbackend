import multer from 'multer';
import XLSX from 'xlsx';
import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../utils/auth.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // até 10MB
const router = express.Router();
router.use(requireAuth);

// Rota de upload/importação de leads (apenas manager mkt)
router.post('/collections/import', upload.single('file'), async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!canManageCollections(user)) return res.status(403).json({ error: 'forbidden' });
  if (!req.file) return res.status(400).json({ error: 'missing_file' });
  const db = mongoose.connection.db;
  if (!db) return res.status(503).json({ error: 'db_unavailable' });
  try {
    // Detecta extensão e lê arquivo
    const buffer = req.file.buffer;
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!Array.isArray(data) || !data.length) return res.status(400).json({ error: 'empty_file' });
    // Nome sugerido: timestamp_nome
    const baseName = req.body.collectionName || 'imported';
    const safeName = `${baseName.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 32)}_${Date.now()}`;
    await db.createCollection(safeName);
    const coll = db.collection(safeName);
    await coll.insertMany(data as any[]);
    res.json({ ok: true, collection: safeName, count: data.length });
  } catch (err) {
    res.status(500).json({ error: 'import_failed', details: String(err) });
  }
});

// Rota para deletar coleção (apenas manager mkt, exceto protegidas)
router.delete('/collections/:name', async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!canManageCollections(user)) return res.status(403).json({ error: 'forbidden' });
  const name = String(req.params.name);
  // Protege coleções especiais
  const protectedCollections = ['m15leads'];
  if (protectedCollections.includes(name)) return res.status(403).json({ error: 'protected_collection' });
  const db = mongoose.connection.db;
  if (!db) return res.status(503).json({ error: 'db_unavailable' });
  try {
    await db.dropCollection(name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'delete_failed', details: String(err) });
  }
});



function parseLimit(v: any, def = 200, max = 2000) {
  const n = Math.max(1, Math.min(Number(v) || def, max));
  return n;
}

// Helper: checa permissão de visualização e upload/delete
function canManageCollections(user: any) {
  return user?.project === 'mkt' && user?.role === 'manager';
}
function canViewAllCollections(user: any) {
  return user?.project === 'mkt';
}
function isM15(user: any) {
  return user?.project === 'm15';
}

// Listar todas as coleções do banco allLeads
router.get('/collections', async (req: Request, res: Response) => {
  try {
    const db = mongoose.connection.db;
    if (!db) return res.status(503).json({ error: 'db_unavailable' });
    const collections = await db.listCollections().toArray();
    let visible = collections.filter(col => !col.name.startsWith('system.')).map(col => col.name);
    // Usuário m15 só pode ver m15leads
    const user = (req as any).user;
    console.log('[collections] user:', user, 'todas coleções:', visible);
    if (isM15(user)) visible = visible.filter(name => name === 'm15leads');
    console.log('[collections] coleções visíveis para este usuário:', visible);
    res.json({ collections: visible });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar coleções' });
  }
});

// Buscar leads de uma coleção específica
router.get('/leads', async (req: Request, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const db = mongoose.connection.db;
    if (!db) return res.status(503).json({ error: 'db_unavailable' });
    const limit = parseLimit((req.query as any).limit);
    let collName = String((req.query as any).collection || process.env.LEADS_COLLECTION || 'm15leads');
    const user = (req as any).user;
    console.log('[leads] user:', user, 'collection:', collName);
    // Permissão: m15 só pode ver m15leads
    if (isM15(user) && collName !== 'm15leads') {
      return res.status(403).json({ error: 'forbidden' });
    }
    // Usuário mkt user/manager pode ver todas
    if (!canViewAllCollections(user) && collName !== 'm15leads') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const coll = db.collection(collName);
    const cursor = coll.find({}, { projection: {} }).sort({ _id: -1 }).limit(limit);
    const items = await cursor.toArray();
    return res.json({ items });
  } catch (e: any) {
    console.error('leads list error', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;

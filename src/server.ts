import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import campaignsRouter from './routes/campaigns.js';
import zapiRouter from './routes/zapi.js';
import leadsRouter from './routes/leads.js';
import ZapiStatusService from './services/zapiStatusService.js';
import createDisparoRouter from './routes/disparo.js';
import webhookRouter from './routes/webhook.js';
import http from 'http';
import { Server as IOServer, Socket } from 'socket.io';
import authRouter from './routes/auth.js';
import { verifyAccessToken } from './utils/auth.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Security & parsing
app.use(helmet({
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'cookie-secret'));

// CORS restricted by env
let allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!allowedOrigins.length) {
	// Default dev frontend
	allowedOrigins = ['http://localhost:5173'];
}
app.use(cors({
	origin: allowedOrigins.length ? allowedOrigins : true,
	credentials: true,
}));

// Logging
app.use(morgan('dev'));

// Basic rate limit for public endpoints
const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(['/api/campaigns/:id/summary', '/api/campaigns/:id/stream'], publicLimiter);

// Routes
app.use('/api', authRouter);
app.use('/api', campaignsRouter);
app.use('/api', zapiRouter);
app.use('/api', leadsRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

// Socket.IO (CORS aligned with HTTP CORS)
const io = new IOServer(server, {
	path: process.env.SOCKET_IO_PATH || '/socket.io',
	cors: {
		origin: allowedOrigins.length ? allowedOrigins : true,
		credentials: true,
	},
});

io.on('connection', (socket: Socket) => {
	// Optional room join for generic updates
	socket.on('join', ({ room }: { room?: string }) => {
		if (room) socket.join(String(room));
	});
});

// Namespaced Socket.IO for disparo progress
io.of('/disparo').use((socket, next) => {
	try {
		const raw = socket.request.headers.cookie || '';
		const token = parseCookie(raw)['access_token'];
		if (!token) return next(new Error('unauthorized'));
		verifyAccessToken(token);
		next();
	} catch { next(new Error('unauthorized')); }
}).on('connection', (_socket: Socket) => {
	// events emitted by services
});

// Namespaced Socket.IO for Z-API live status
let zapiStatus: ZapiStatusService | null = null;
io.of('/zapi').use((socket, next) => {
	try {
		const raw = socket.request.headers.cookie || '';
		const token = parseCookie(raw)['access_token'];
		if (!token) return next(new Error('unauthorized'));
		verifyAccessToken(token);
		next();
	} catch { next(new Error('unauthorized')); }
}).on('connection', (socket: Socket) => {
	// Send immediate snapshot so UI can unlock without waiting for next tick
	try {
		const snap = zapiStatus?.snapshot() || [];
		for (const s of snap) io.of('/zapi').to(socket.id).emit('zapi:status', s);
	} catch {}
});

// Mount disparo router with access to io
app.use('/api', createDisparoRouter(io));
app.use('/', webhookRouter);

// Mongo connect and start
const PORT = Number(process.env.PORT || 4000);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'LeadsMatrix';

server.listen(PORT, () => console.log(`API listening on :${PORT}`));

mongoose.connect(MONGO_URI, { dbName: DB_NAME } as any)
	.then(() => {
		console.log('Mongo connected');
	// Start Z-API status watcher
	zapiStatus = new ZapiStatusService(io);
	zapiStatus.start(10_000);
		// Start change stream if available; fallback to polling
		try {
			const coll = mongoose.connection.db!.collection(process.env.LEADS_COLLECTION || 'm15leads');
			const changeStream = (coll as any).watch([], { fullDocument: 'updateLookup' });
			changeStream.on('change', async (change: any) => {
				let payload: any = null;
				if (change.operationType === 'insert' || change.operationType === 'replace') {
					payload = { op: 'insert', doc: change.fullDocument };
				} else if (change.operationType === 'update') {
					// Fetch the updated doc if not provided
					const doc = change.fullDocument || (await coll.findOne({ _id: change.documentKey._id }));
					payload = { op: 'update', doc };
				} else if (change.operationType === 'delete') {
					payload = { op: 'delete', doc: { _id: change.documentKey._id } };
				}
				if (payload) io.to('leads').emit('leads:update', payload);
			});
			changeStream.on('error', (err: any) => {
				console.warn('Change stream error; falling back to polling', err?.message || err);
				startPolling(io);
			});
		} catch (e) {
			console.warn('Change stream unsupported; fallback to polling');
			startPolling(io);
		}
	})
	.catch(err => {
		console.error('Mongo connection error (continuing without DB)', err.message);
	});

let pollTimer: any = null;
function startPolling(ioInst: typeof io) {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      if (!mongoose.connection.db) return;
	const coll = mongoose.connection.db.collection(process.env.LEADS_COLLECTION || 'm15leads');
      const items = await coll.find({}).sort({ _id: -1 }).limit(200).toArray();
      ioInst.to('leads').emit('leads:update', { items });
    } catch {}
  }, 5000);
}

function parseCookie(str: string): Record<string, string> {
	const out: Record<string, string> = {};
	str.split(';').forEach(kv => {
		const [k, ...v] = kv.split('=');
		if (!k) return;
		let val = decodeURIComponent(v.join('=') || '');
		// Unsigned value from cookie-parser signed format: s:<value>.<sig>
		if (val.startsWith('s:')) {
			const rest = val.slice(2);
			const dot = rest.indexOf('.');
			if (dot > 0) val = rest.slice(0, dot);
		}
		out[k.trim()] = val;
	});
	return out;
}

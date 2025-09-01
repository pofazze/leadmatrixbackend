# LeadMatrix Backend

Express + Mongo backend to manage WhatsApp campaigns with real-time progress via SSE.

## Setup

1. Copy `.env.example` to `.env` and adjust values.
2. Install deps and run:

```
npm install
npm run dev
```

## API (high-level)

- POST /api/campaigns
- POST /api/campaigns/:id/enqueue
- POST /api/campaigns/:id/start
- POST /api/campaigns/:id/pause | /resume | /cancel
- POST /api/campaigns/:id/report
- POST /api/campaigns/:id/claim
- GET  /api/campaigns/:id/summary | /stream | /sends | /queued

SSE emits events: `summary` and `send_update`.

Use `dispatchToken` returned by `/start` when calling `/report` from n8n.

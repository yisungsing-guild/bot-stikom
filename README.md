# WhatsApp Bot System (Local / Free Mode)

This repo contains a local-first WhatsApp bot backend scaffold written in Node.js. It uses a mock WhatsApp provider by default so you can run without paid APIs.

Key ideas:
- Adapter pattern for WhatsApp provider (mock -> official)
- Rule-based reply engine
- Simple FSM menu
- Admin REST endpoints to manage keywords, settings, menu, broadcasts

Quick start

1. Install dependencies

```bash
npm install
```

2. Generate Prisma client and migrate

```bash
npm run prisma:generate
npm run migrate
```

3. Start server

```bash
npm run dev
```

4. Simulate an incoming message (dev)

```bash
curl -X POST http://localhost:4000/_simulate -H "Content-Type: application/json" -d '{"chatId":"user1","text":"hello"}'
```

Production (domain-ready)

- See `PRODUCTION_SETUP.md` for an end-to-end checklist:
	- HTTPS reverse proxy
	- WATI/Meta webhook
	- RAG/training (optional)
	- Admin upload images -> public `/media/*` URLs

Files of interest:
- `src/providers/whatsappProvider.js` - provider interface and mock adapter
- `src/engine/replyEngine.js` - rule-based reply engine
- `src/engine/fsm.js` - small menu FSM
- `src/routes/admin.js` - admin CRUD APIs
- `src/routes/provider.js` - incoming message processing

Next steps (optional): scaffold React admin panel, implement broadcast worker with batching, implement file text extraction for training, add Redis for sessions, and swap provider to official WhatsApp Business API adapter.

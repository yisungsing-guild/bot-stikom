const express = require('express');
const prisma = require('../db');
const logger = require('../logger');
const { logAdminAction } = require('../middleware/adminAudit');
const { 
  upload, 
  uploadBulk,
  validateUploadRequest, 
  handleUploadResponse, 
  handleUploadResponseMultiple,
  handleMulterError, 
  cleanupUploadedFile,
  MAX_FILE_SIZE
} = require('../middleware/uploadSecurity');
const { FileParser } = require('../engine/fileParser');
const { AnalyticsEngine } = require('../engine/analyticsEngine');
const { ingestTrainingData } = require('../engine/ragEngine');
const path = require('path');
const { appendChatMessage, getChatMessages } = require('../engine/chatLog');
const crypto = require('crypto');
const fs = require('fs/promises');

// Helper: validasi field wajib
function validateRequired(data, fields) {
  for (const field of fields) {
    if (typeof data[field] === 'undefined' || data[field] === null || data[field] === '') {
      return { valid: false, error: `Field '${field}' wajib diisi` };
    }
  }
  return { valid: true };
}

function csvEscape(value) {
  if (value === null || typeof value === 'undefined') return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = function (provider) {
  const router = express.Router();

  async function resolveUploaderId(req) {
    try {
      const adminIdCandidate = req && req.user && req.user.adminId ? String(req.user.adminId).trim() : '';
      const username = req && req.user && req.user.username ? String(req.user.username).trim() : '';

      if (!adminIdCandidate && !username) return null;

      const or = [];
      if (adminIdCandidate) or.push({ id: adminIdCandidate });
      if (username) or.push({ username });

      const u = await prisma.adminUser
        .findFirst({ where: { OR: or }, select: { id: true } })
        .catch(() => null);

      return u ? u.id : null;
    } catch {
      return null;
    }
  }

  function normalizeAdminRole(role) {
    const r = String(role || '').toLowerCase().trim();
    if (r === 'superadmin' || r === 'super_admin' || r === 'super-admin') return 'superadmin';
    return r;
  }

  function isAdminRole(role) {
    const r = normalizeAdminRole(role);
    // Treat only 'superadmin' as full admin for server-side RBAC
    return r === 'superadmin';
  }

  function isSuperAdminRole(role) {
    const r = normalizeAdminRole(role);
    return r === 'superadmin';
  }

  function isMarketingRole(role) {
    const r = normalizeAdminRole(role);
    return r === 'marketing';
  }

  function canManageFeatureFlags(role) {
    return isAdminRole(role) || isMarketingRole(role);
  }

  function parseBooleanSetting(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value === null || typeof value === 'undefined') return fallback;
    const s = String(value).trim().toLowerCase();
    if (!s) return fallback;
    return s === '1' || s === 'true' || s === 'yes' || s === 'on' || s === 'enabled';
  }

  function roleToDivisionKey(role) {
    const r = normalizeAdminRole(role);
    if (!r || isAdminRole(r)) return null;

    // Alias: marketing team uses PMB bucket.
    if (r === 'marketing') return 'pmb';

    // Aliases for directorate roles (keep keys simple and consistent).
    if (r === 'dir_kemahasiswaan' || r === 'kemahasiswaan') return 'kemahasiswaan';
    if (r === 'dir_kerjasama' || r === 'kerjasama' || r === 'inkubator') return 'kerjasama';
    if (r === 'dir_international' || r === 'international' || r === 'urusan_international') return 'international';

    const allowed = new Set([
      'akademik',
      'keuangan',
      'pmb',
      'prodi',
      'beasiswa',
      'lainnya',
      'kemahasiswaan',
      'kerjasama',
      'international'
    ]);
    return allowed.has(r) ? r : null;
  }

  function normalizeDivisionKey(raw) {
    const k = String(raw || '').toLowerCase().trim();
    if (!k) return null;
    const allowed = new Set([
      'akademik',
      'keuangan',
      'pmb',
      'prodi',
      'beasiswa',
      'lainnya',
      'kemahasiswaan',
      'kerjasama',
      'international'
    ]);
    return allowed.has(k) ? k : null;
  }

  function isTrainingOptionalFieldUnavailableError(err) {
    const msg = err && err.message ? String(err.message) : String(err || '');
    const code = err && err.code ? String(err.code) : '';
    return (
      code === 'P2022' ||
      /Unknown field|Unknown arg|Unknown argument/i.test(msg) ||
      /column .*does not exist/i.test(msg) ||
      /ragIngest|uploadedById|uploadedBy|divisionKey/i.test(msg)
    );
  }

  // RBAC: non-admin roles only have access to Dashboard + Training Data
  router.use((req, res, next) => {
    try {
      if (req.method === 'OPTIONS') return next();

      const role = req.user && req.user.role;
      if (isAdminRole(role)) return next();

      const path = req.path || '';
      const method = String(req.method || 'GET').toUpperCase();

      const allowed =
        (method === 'GET' && path === '/me') ||
        (method === 'GET' && path === '/stats') ||
        (method === 'GET' && path === '/docs') ||
        (method === 'GET' && path === '/chats') ||
        (method === 'GET' && /^\/chats\/[^/]+\/messages$/.test(path)) ||
        (method === 'GET' && /^\/chats\/[^/]+\/recap$/.test(path)) ||
        // Allow non-superadmin roles to access Live Chat browsing and agent actions
        (method === 'GET' && path === '/live-chats') ||
        (method === 'GET' && /^\/live-chats\/[^/]+\/messages$/.test(path)) ||
        (method === 'POST' && /^\/live-chats\/[^/]+\/reply$/.test(path)) ||
        (method === 'POST' && /^\/live-chats\/[^/]+\/handover$/.test(path)) ||
        (method === 'POST' && /^\/live-chats\/[^/]+\/end-handover$/.test(path)) ||
        (method === 'GET' && path === '/analytics/engagement') ||
        (method === 'GET' && path === '/analytics/handover') ||
        (method === 'GET' && path === '/analytics/questions-recap') ||
        (method === 'GET' && path === '/feature-flags/validation-file') ||
        (method === 'PUT' && path === '/feature-flags/validation-file') ||
        (method === 'GET' && (path === '/training' || /^\/training\//.test(path))) ||
        (method === 'POST' && (path === '/training/upload')) ||
        (method === 'POST' && (path === '/training/upload-bulk')) ||
        (method === 'POST' && (path === '/training/validation/upload')) ||
        (method === 'POST' && (path === '/media/upload')) ||
        (method === 'POST' && (path === '/training/manual')) ||
        (method === 'POST' && (path === '/training/url')) ||
        (method === 'POST' && (path === '/rag/query'));

      if (allowed) return next();

      return res.status(403).send({
        error: 'Forbidden: role not allowed for this action',
        role: role || null
      });
    } catch (err) {
      return next(err);
    }
  });

  // Current admin identity (from JWT)
  router.get('/me', async (req, res) => {
    const u = req.user || {};
    const role = u.role ? String(u.role) : null;
    const divisionKey = roleToDivisionKey(role);

    res.send({
      ok: true,
      user: {
        adminId: u.adminId || null,
        username: u.username || null,
        displayName: u.displayName || null,
        role,
        divisionKey
      }
    });
  });

  // Feature flags (persistent via Setting)
  const VALIDATION_FILE_FLAG_KEY = 'feature.validationFileUpload.enabled';

  router.get('/feature-flags/validation-file', async (req, res, next) => {
    try {
      const s = await prisma.setting.findUnique({ where: { key: VALIDATION_FILE_FLAG_KEY } }).catch(() => null);
      const enabled = parseBooleanSetting(s && s.value, false);
      res.send({ ok: true, key: VALIDATION_FILE_FLAG_KEY, enabled });
    } catch (err) {
      next(err);
    }
  });

  router.put('/feature-flags/validation-file', async (req, res, next) => {
    try {
      const role = req.user && req.user.role ? String(req.user.role) : null;
      if (!canManageFeatureFlags(role)) {
        return res.status(403).send({
          error: 'Forbidden: role not allowed to manage feature flags',
          role: role || null,
        });
      }

      const enabledRaw = req && req.body ? req.body.enabled : undefined;
      if (typeof enabledRaw === 'undefined') {
        return res.status(400).send({ error: "Field 'enabled' wajib diisi" });
      }

      const enabled = parseBooleanSetting(enabledRaw, false);

      const s = await prisma.setting.upsert({
        where: { key: VALIDATION_FILE_FLAG_KEY },
        create: { key: VALIDATION_FILE_FLAG_KEY, value: enabled ? 'true' : 'false' },
        update: { value: enabled ? 'true' : 'false' },
      });

      await logAdminAction(req, 'set_feature_flag_validation_file', 'Setting', {
        key: VALIDATION_FILE_FLAG_KEY,
        enabled,
        settingId: s.id,
      });

      res.send({ ok: true, key: VALIDATION_FILE_FLAG_KEY, enabled });
    } catch (err) {
      next(err);
    }
  });

  async function isValidationFileUploadEnabled() {
    const s = await prisma.setting.findUnique({ where: { key: VALIDATION_FILE_FLAG_KEY } }).catch(() => null);
    return parseBooleanSetting(s && s.value, false);
  }

  // Admin docs (markdown)
  // - Whitelisted, not user-controlled paths (avoid leaking secrets)
  // - Served as text/markdown for the admin panel Docs tab
  router.get('/docs', async (req, res, next) => {
    try {
      const projectRoot = path.join(__dirname, '..', '..');
      const docPath = path.join(projectRoot, 'README_ADMIN.md');
      const content = await fs.readFile(docPath, 'utf8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.send(content);
    } catch (err) {
      logger.error({ err: err && err.message ? err.message : String(err) }, '[GET /admin/docs] Error');
      next(err);
    }
  });

  router.get('/stats', async (req, res, next) => {
    try {
      const dbUrlRaw = process.env.DATABASE_URL ? String(process.env.DATABASE_URL) : '';
      const dbUrlHash = dbUrlRaw
        ? crypto.createHash('sha256').update(dbUrlRaw).digest('hex').slice(0, 12)
        : null;

      let dbInfo = null;
      if (dbUrlRaw) {
        try {
          const u = new URL(dbUrlRaw);
          dbInfo = {
            protocol: (u.protocol || '').replace(':', ''),
            host: u.hostname || null,
            port: u.port ? Number(u.port) : null,
            database: u.pathname ? u.pathname.replace(/^\//, '') : null
          };
        } catch {
          dbInfo = { protocol: null, host: null, port: null, database: null };
        }
      }

      const [trainingData, sessions, chats, broadcasts] = await Promise.all([
        prisma.trainingData.count().catch(() => null),
        prisma.session.count().catch(() => null),
        prisma.chat.count().catch(() => null),
        prisma.broadcast.count().catch(() => null)
      ]);

      const latestSession = await prisma.session.findFirst({
        orderBy: { updatedAt: 'desc' },
        select: { chatId: true, updatedAt: true, state: true, data: true }
      }).catch(() => null);

      const messagesCount = latestSession && latestSession.data && Array.isArray(latestSession.data.messages)
        ? latestSession.data.messages.length
        : 0;

      res.send({
        ok: true,
        env: process.env.NODE_ENV || 'development',
        upload: {
          maxFileSizeBytes: MAX_FILE_SIZE,
          maxFileSizeMB: Number.isFinite(MAX_FILE_SIZE) ? Number((MAX_FILE_SIZE / 1024 / 1024).toFixed(2)) : null
        },
        databaseUrlPresent: !!dbUrlRaw,
        databaseUrlHash: dbUrlHash,
        database: dbInfo,
        counts: {
          trainingData,
          sessions,
          chats,
          broadcasts
        },
        latestSession: latestSession
          ? { chatId: latestSession.chatId, updatedAt: latestSession.updatedAt, state: latestSession.state, messagesCount }
          : null
      });
    } catch (err) {
      next(err);
    }
  });

  // Keywords CRUD
  router.get('/keywords', async (req, res, next) => {
  try {
    logger.info('[GET /admin/keywords] Mengambil daftar keyword...');
    const query = (req.query.q || '').toString().trim().toLowerCase();
    let items = await prisma.keywordReply.findMany();
    if (query) {
      items = items.filter(item => {
        const keyword = (item.keyword || '').toLowerCase();
        const response = (item.response || '').toLowerCase();
        const matchType = (item.matchType || '').toLowerCase();
        return keyword.includes(query) || response.includes(query) || matchType.includes(query);
      });
    }
    logger.info({ count: items.length }, '[GET /admin/keywords] Berhasil mengambil keyword');
    res.send(items);
  } catch (err) {
    logger.error({ err: err.message }, '[GET /admin/keywords] Error');
    next(err);
  }
  });

  router.post('/keywords', async (req, res, next) => {
  try {
    logger.info('[POST /admin/keywords] Body diterima');
    const { keyword, matchType, response, priority } = req.body;
    
    // Validasi input
    const validation = validateRequired({ keyword, matchType, response }, ['keyword', 'matchType', 'response']);
    if (!validation.valid) {
      return res.status(400).send({ error: validation.error });
    }
    
    const item = await prisma.keywordReply.create({
      data: { keyword, matchType, response, priority: priority || 0 }
    });
    await logAdminAction(req, 'create_keyword', 'KeywordReply', { id: item.id, keyword });
    logger.info({ id: item.id }, '[POST /admin/keywords] Keyword berhasil dibuat');
    res.status(201).send(item);
  } catch (err) {
    logger.error({ err: err.message }, '[POST /admin/keywords] Error');
    next(err);
  }
  });

  router.put('/keywords/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { keyword, matchType, response, priority } = req.body;
    
    const validation = validateRequired({ keyword, matchType, response }, ['keyword', 'matchType', 'response']);
    if (!validation.valid) {
      return res.status(400).send({ error: validation.error });
    }
    
    const item = await prisma.keywordReply.update({ 
      where: { id }, 
      data: { keyword, matchType, response, priority: priority || 0 }
    });
    await logAdminAction(req, 'update_keyword', 'KeywordReply', { id });
    logger.info({ id }, '[PUT /admin/keywords/:id] Keyword berhasil diupdate');
    res.send(item);
  } catch (err) {
    logger.error({ err: err.message }, '[PUT /admin/keywords/:id] Error');
    next(err);
  }
  });

  router.delete('/keywords/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    await prisma.keywordReply.delete({ where: { id } });
    await logAdminAction(req, 'delete_keyword', 'KeywordReply', { id });
    logger.info({ id }, '[DELETE /admin/keywords/:id] Keyword berhasil dihapus');
    res.send({ ok: true });
  } catch (err) {
    logger.error({ err: err.message }, '[DELETE /admin/keywords/:id] Error');
    next(err);
  }
  });

  // Settings
  router.get('/settings', async (req, res, next) => {
  try {
    console.log('[GET /admin/settings] Mengambil settings...');
    const items = await prisma.setting.findMany();
    console.log(`[GET /admin/settings] Berhasil mengambil ${items.length} setting`);
    res.send(items);
  } catch (err) {
    console.error('[GET /admin/settings] Error:', err.message);
    next(err);
  }
  });

  router.post('/settings', async (req, res, next) => {
  try {
    logger.info('[POST /admin/settings] Body diterima');
    const { key, value } = req.body;
    
    const validation = validateRequired({ key, value }, ['key', 'value']);
    if (!validation.valid) {
      return res.status(400).send({ error: validation.error });
    }
    
    const s = await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await logAdminAction(req, 'upsert_setting', 'Setting', { key });
    logger.info({ key }, '[POST /admin/settings] Setting berhasil disimpan');
    res.status(201).send(s);
  } catch (err) {
    logger.error({ err: err.message }, '[POST /admin/settings] Error');
    next(err);
  }
  });

  router.delete('/settings/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    logger.info({ id }, '[DELETE /admin/settings/:id] Menghapus setting');
    await prisma.setting.delete({ where: { id } });
    await logAdminAction(req, 'delete_setting', 'Setting', { id });
    logger.info({ id }, '[DELETE /admin/settings/:id] Setting berhasil dihapus');
    res.send({ ok: true });
  } catch (err) {
    logger.error({ err: err.message }, '[DELETE /admin/settings/:id] Error');
    next(err);
  }
  });

  // Menu CRUD
  router.get('/menu', async (req, res, next) => {
  try {
    console.log('[GET /admin/menu] Mengambil menu items...');
    const items = await prisma.menuItem.findMany({ orderBy: { order: 'asc' } });
    console.log(`[GET /admin/menu] Berhasil mengambil ${items.length} menu item`);
    res.send(items);
  } catch (err) {
    console.error('[GET /admin/menu] Error:', err.message);
    next(err);
  }
  });

  router.put('/menu/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const body = req && req.body ? req.body : {};
    const keyRaw = typeof body.key === 'string' ? body.key : undefined;
    const textRaw = typeof body.text === 'string' ? body.text : undefined;
    const parentIdRaw = Object.prototype.hasOwnProperty.call(body, 'parentId') ? body.parentId : undefined;
    const orderRaw = Object.prototype.hasOwnProperty.call(body, 'order') ? body.order : undefined;
    const followupPromptRaw = typeof body.followupPrompt === 'string' ? body.followupPrompt : undefined;

    logger.info({ id }, '[PUT /admin/menu/:id] Update menu');

    const existing = await prisma.menuItem.findUnique({ where: { id }, select: { id: true, parentId: true, order: true } });
    if (!existing) {
      return res.status(404).send({ error: 'Menu item not found' });
    }

    const data = {};

    if (typeof keyRaw !== 'undefined') {
      const key = String(keyRaw).trim();
      if (!key) return res.status(400).send({ error: 'Field key wajib diisi' });
      data.key = key;
    }

    if (typeof textRaw !== 'undefined') {
      const text = String(textRaw).trim();
      if (!text) return res.status(400).send({ error: 'Field text wajib diisi' });
      data.text = text;
    }

    if (typeof followupPromptRaw !== 'undefined') {
      const prompt = String(followupPromptRaw).trim();
      data.followupPrompt = prompt === '' ? null : prompt;
    }

    let nextParentId = existing.parentId;
    const parentProvided = typeof parentIdRaw !== 'undefined';
    if (parentProvided) {
      const normalizedParentId = parentIdRaw === '' || parentIdRaw === null ? null : String(parentIdRaw);
      nextParentId = normalizedParentId;
      data.parentId = normalizedParentId;
    }

    const orderProvided = typeof orderRaw !== 'undefined';
    if (orderProvided) {
      const str = orderRaw === null ? '' : String(orderRaw).trim();
      if (str === '') {
        // Keep existing order if client sends empty.
        data.order = existing.order || 0;
      } else {
        const parsed = Number.parseInt(str, 10);
        if (!Number.isFinite(parsed)) return res.status(400).send({ error: 'Order harus berupa angka' });
        if (parsed < 0) return res.status(400).send({ error: 'Order tidak boleh negatif' });
        data.order = parsed;
      }
    } else {
      // If parent changes and order is not provided, auto place at end in the new parent group.
      const parentChanged = parentProvided && (String(existing.parentId || '') !== String(nextParentId || ''));
      if (parentChanged) {
        const agg = await prisma.menuItem.aggregate({
          where: { parentId: nextParentId },
          _max: { order: true },
        });
        const maxOrder = agg && agg._max && typeof agg._max.order === 'number' ? agg._max.order : 0;
        data.order = (maxOrder || 0) + 1;
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).send({ error: 'Tidak ada field untuk di-update' });
    }

    const updated = await prisma.menuItem.update({ where: { id }, data });
    await logAdminAction(req, 'update_menu_item', 'MenuItem', { id });
    res.send(updated);
  } catch (err) {
    logger.error({ err: err.message }, '[PUT /admin/menu/:id] Error');
    next(err);
  }
  });

  router.post('/menu', async (req, res, next) => {
  try {
    logger.info('[POST /admin/menu] Body diterima');
    const { key, text, parentId, order, followupPrompt } = req.body;
    
    const validation = validateRequired({ key, text }, ['key', 'text']);
    if (!validation.valid) {
      return res.status(400).send({ error: validation.error });
    }

    const normalizedParentId = parentId === '' || typeof parentId === 'undefined' ? null : parentId;
    const parsedOrder = Number.parseInt(String(order ?? ''), 10);

    let nextOrder = Number.isFinite(parsedOrder) ? parsedOrder : 0;
    if (!Number.isFinite(nextOrder) || nextOrder <= 0) {
      const agg = await prisma.menuItem.aggregate({
        where: { parentId: normalizedParentId },
        _max: { order: true },
      });
      const maxOrder = agg && agg._max && typeof agg._max.order === 'number' ? agg._max.order : 0;
      nextOrder = (maxOrder || 0) + 1;
    }

    const followupPromptNorm = typeof followupPrompt === 'string' ? String(followupPrompt).trim() : '';
    const createData = {
      key,
      text,
      parentId: normalizedParentId,
      order: nextOrder
    };
    if (followupPromptNorm !== '') createData.followupPrompt = followupPromptNorm;

    const m = await prisma.menuItem.create({ data: createData });
    await logAdminAction(req, 'create_menu_item', 'MenuItem', { id: m.id, key });
    logger.info({ id: m.id }, '[POST /admin/menu] Menu item berhasil dibuat');
    res.status(201).send(m);
  } catch (err) {
    logger.error({ err: err.message }, '[POST /admin/menu] Error');
    next(err);
  }
  });

  router.delete('/menu/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    logger.info({ id }, '[DELETE /admin/menu/:id] Menghapus menu');

    const root = await prisma.menuItem.findUnique({ where: { id }, select: { id: true } });
    if (!root) return res.status(404).send({ error: 'Menu item not found' });

    // Delete descendants as well to avoid orphan submenus.
    const toVisit = [id];
    const allIds = [];
    while (toVisit.length) {
      const current = toVisit.pop();
      if (!current) continue;
      allIds.push(current);
      const children = await prisma.menuItem.findMany({ where: { parentId: current }, select: { id: true } });
      for (const c of children) {
        if (c && c.id) toVisit.push(c.id);
      }
    }

    await prisma.menuItem.deleteMany({ where: { id: { in: allIds } } });
    await logAdminAction(req, 'delete_menu_item', 'MenuItem', { id, deletedCount: allIds.length });
    logger.info({ id, deletedCount: allIds.length }, '[DELETE /admin/menu/:id] Menu berhasil dihapus');
    res.send({ ok: true, deletedCount: allIds.length });
  } catch (err) {
    logger.error({ err: err.message }, '[DELETE /admin/menu/:id] Error');
    next(err);
  }
  });

  // === BROADCAST MANAGEMENT (dengan scheduling) ===

  // Create broadcast dengan opsi scheduling
  router.post('/broadcast', async (req, res, next) => {
  try {
    console.log('[POST /admin/broadcast] Body diterima:', req.body);
    const { title, body, scheduledAt, recipientList, segment } = req.body;
    
    const validation = validateRequired({ title, body }, ['title', 'body']);
    if (!validation.valid) {
      return res.status(400).send({ error: validation.error });
    }

    // Security: batasan ukuran pesan & jumlah penerima
    const MAX_BROADCAST_RECIPIENTS = parseInt(process.env.MAX_BROADCAST_RECIPIENTS || '5000', 10);
    const MAX_BROADCAST_BODY_LENGTH = parseInt(process.env.MAX_BROADCAST_BODY_LENGTH || '2000', 10);

    if (typeof body === 'string' && body.length > MAX_BROADCAST_BODY_LENGTH) {
      return res.status(400).send({ error: `Body terlalu panjang (max ${MAX_BROADCAST_BODY_LENGTH} chars)` });
    }

    // Segment-based targeting (optional)
    // Use existing Chat fields only: optIn/status/lastSeenAt
    // If segment is provided, it takes precedence over recipientList.
    let processedRecipientList = recipientList;
    if (segment && typeof segment === 'object' && !Array.isArray(segment)) {
      const optInRaw = (segment.optIn ?? 'true').toString().trim().toLowerCase();
      const optIn = optInRaw === 'true' || optInRaw === '1' || optInRaw === 'yes';

      const statusRaw = (segment.status || '').toString().trim().toUpperCase();
      const status = statusRaw === 'BOT' || statusRaw === 'HUMAN' ? statusRaw : null;

      const activeDays = segment.activeDays ? parseInt(String(segment.activeDays), 10) : null;
      const inactiveDays = segment.inactiveDays ? parseInt(String(segment.inactiveDays), 10) : null;

      const where = { optIn };
      if (status) where.status = status;

      const now = new Date();
      if (Number.isFinite(activeDays) && activeDays > 0) {
        const since = new Date(now);
        since.setDate(since.getDate() - activeDays);
        where.lastSeenAt = { ...(where.lastSeenAt || {}), gte: since };
      }
      if (Number.isFinite(inactiveDays) && inactiveDays > 0) {
        const before = new Date(now);
        before.setDate(before.getDate() - inactiveDays);
        where.lastSeenAt = { ...(where.lastSeenAt || {}), lte: before };
      }

      const candidates = await prisma.chat.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        take: MAX_BROADCAST_RECIPIENTS + 1,
        select: { chatId: true }
      });

      if ((candidates || []).length > MAX_BROADCAST_RECIPIENTS) {
        return res.status(400).send({
          error: `Segment terlalu besar (>${MAX_BROADCAST_RECIPIENTS} penerima). Persempit segment atau gunakan recipientList='all_opted_in'.`
        });
      }

      processedRecipientList = (candidates || []).map(c => c.chatId);
    }

    // Parse recipientList jika ada dan validasi
    if (recipientList && typeof recipientList !== 'string') {
      if (!Array.isArray(recipientList)) {
        return res.status(400).send({ error: 'recipientList harus berupa array chatId atau string "all_opted_in"' });
      }

      if (recipientList.length > MAX_BROADCAST_RECIPIENTS) {
        return res.status(400).send({ error: `Jumlah penerima terlalu banyak (max ${MAX_BROADCAST_RECIPIENTS})` });
      }

      // Pastikan semua chatId adalah string sederhana
      for (const id of recipientList) {
        if (typeof id !== 'string' || id.trim() === '') {
          return res.status(400).send({ error: 'recipientList berisi chatId yang tidak valid' });
        }
      }

      // Store as JSON array (Prisma Json) for type-correctness.
      processedRecipientList = recipientList;
    }

    const b = await prisma.broadcast.create({
      data: {
        title,
        body,
        recipientList: processedRecipientList || 'all_opted_in',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
        status: scheduledAt ? 'scheduled' : 'queued'
      }
    });
    console.log('[POST /admin/broadcast] Broadcast berhasil dibuat:', b.id);
    res.status(201).send(b);
  } catch (err) {
    console.error('[POST /admin/broadcast] Error:', err.message);
    next(err);
  }
  });

  // Get broadcasts
  router.get('/broadcast', async (req, res, next) => {
  try {
    console.log('[GET /admin/broadcast] Mengambil list broadcast...');
    const items = await prisma.broadcast.findMany({
      orderBy: { createdAt: 'desc' },
      include: { logs: false }
    });
    console.log(`[GET /admin/broadcast] Berhasil mengambil ${items.length} broadcast`);
    res.send(items);
  } catch (err) {
    console.error('[GET /admin/broadcast] Error:', err.message);
    next(err);
  }
  });

    // Get broadcast detail dengan logs
    router.get('/broadcast/:id', async (req, res, next) => {
  try {
    const broadcast = await prisma.broadcast.findUnique({
      where: { id: req.params.id },
      include: { logs: true }
    });
    if (!broadcast) {
      return res.status(404).send({ error: 'Broadcast tidak ditemukan' });
    }
    res.send(broadcast);
  } catch (err) {
    console.error('[GET /admin/broadcast/:id] Error:', err.message);
    next(err);
  }
  });

  // Export broadcast logs as CSV (for reporting)
  router.get('/broadcast/:id/export/csv', async (req, res, next) => {
    try {
      const id = req.params.id;
      const broadcast = await prisma.broadcast.findUnique({ where: { id } });
      if (!broadcast) return res.status(404).send({ error: 'Broadcast tidak ditemukan' });

      const logs = await prisma.broadcastLog.findMany({
        where: { broadcastId: id },
        orderBy: { createdAt: 'asc' }
      });

      const filenameSafe = `broadcast-${id}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameSafe}"`);

      const lines = [];
      lines.push([
        'broadcastId',
        'broadcastTitle',
        'broadcastStatus',
        'scheduledAt',
        'createdAt',
        'completedAt',
        'chatId',
        'logStatus',
        'error',
        'sentAt',
        'logCreatedAt'
      ].join(','));

      for (const l of (logs || [])) {
        lines.push([
          csvEscape(broadcast.id),
          csvEscape(broadcast.title),
          csvEscape(broadcast.status),
          csvEscape(broadcast.scheduledAt ? broadcast.scheduledAt.toISOString() : ''),
          csvEscape(broadcast.createdAt ? broadcast.createdAt.toISOString() : ''),
          csvEscape(broadcast.completedAt ? broadcast.completedAt.toISOString() : ''),
          csvEscape(l.chatId),
          csvEscape(l.status),
          csvEscape(l.error || ''),
          csvEscape(l.sentAt ? l.sentAt.toISOString() : ''),
          csvEscape(l.createdAt ? l.createdAt.toISOString() : '')
        ].join(','));
      }

      res.send(lines.join('\n'));
    } catch (err) {
      console.error('[GET /admin/broadcast/:id/export/csv] Error:', err.message);
      next(err);
    }
  });

  // Retry failed recipients by creating a new broadcast (queued)
  router.post('/broadcast/:id/retry-failed', async (req, res, next) => {
    try {
      const id = req.params.id;
      const original = await prisma.broadcast.findUnique({ where: { id } });
      if (!original) return res.status(404).send({ error: 'Broadcast tidak ditemukan' });

      const failedLogs = await prisma.broadcastLog.findMany({
        where: { broadcastId: id, status: 'failed' },
        select: { chatId: true }
      });
      const sentLogs = await prisma.broadcastLog.findMany({
        where: { broadcastId: id, status: 'sent' },
        select: { chatId: true }
      });

      const sent = new Set((sentLogs || []).map(x => x.chatId));
      const retrySet = new Set();
      for (const l of (failedLogs || [])) {
        if (!l || !l.chatId) continue;
        if (sent.has(l.chatId)) continue;
        retrySet.add(l.chatId);
      }
      const recipients = Array.from(retrySet);

      if (recipients.length === 0) {
        return res.status(400).send({ error: 'Tidak ada recipient failed yang perlu di-retry' });
      }

      const MAX_BROADCAST_RECIPIENTS = parseInt(process.env.MAX_BROADCAST_RECIPIENTS || '5000', 10);
      if (recipients.length > MAX_BROADCAST_RECIPIENTS) {
        return res.status(400).send({ error: `Jumlah retry terlalu banyak (max ${MAX_BROADCAST_RECIPIENTS})` });
      }

      const retryTitle = `Retry: ${original.title}`;
      const b = await prisma.broadcast.create({
        data: {
          title: retryTitle,
          body: original.body,
          recipientList: recipients,
          scheduledAt: new Date(),
          status: 'queued'
        }
      });

      res.status(201).send({ ok: true, createdBroadcastId: b.id, retryCount: recipients.length });
    } catch (err) {
      console.error('[POST /admin/broadcast/:id/retry-failed] Error:', err.message);
      next(err);
    }
  });

  // Segment preview for broadcast targeting (no schema change)
  // Query params:
  // - optIn=true|false (default true)
  // - status=BOT|HUMAN (optional)
  // - activeDays=N (optional) -> lastSeenAt >= now - N days
  // - inactiveDays=N (optional) -> lastSeenAt <= now - N days
  // - limit=1..50 sample chatIds
  router.get('/broadcast/recipients/preview', async (req, res, next) => {
    try {
      const optInRaw = (req.query.optIn ?? 'true').toString().trim().toLowerCase();
      const optIn = optInRaw === 'true' || optInRaw === '1' || optInRaw === 'yes';

      const statusRaw = (req.query.status || '').toString().trim().toUpperCase();
      const status = statusRaw === 'BOT' || statusRaw === 'HUMAN' ? statusRaw : null;

      const activeDays = req.query.activeDays ? parseInt(String(req.query.activeDays), 10) : null;
      const inactiveDays = req.query.inactiveDays ? parseInt(String(req.query.inactiveDays), 10) : null;

      const limitRaw = (req.query.limit || '').toString().trim();
      const limit = Math.min(Math.max(parseInt(limitRaw || '20', 10) || 20, 1), 50);

      const where = { optIn };
      if (status) where.status = status;

      const now = new Date();
      if (Number.isFinite(activeDays) && activeDays > 0) {
        const since = new Date(now);
        since.setDate(since.getDate() - activeDays);
        where.lastSeenAt = { ...(where.lastSeenAt || {}), gte: since };
      }
      if (Number.isFinite(inactiveDays) && inactiveDays > 0) {
        const before = new Date(now);
        before.setDate(before.getDate() - inactiveDays);
        where.lastSeenAt = { ...(where.lastSeenAt || {}), lte: before };
      }

      const [count, sample] = await Promise.all([
        prisma.chat.count({ where }),
        prisma.chat.findMany({
          where,
          orderBy: { lastSeenAt: 'desc' },
          take: limit,
          select: { chatId: true, lastSeenAt: true, status: true, optIn: true }
        })
      ]);

      res.send({ ok: true, count, sample, where });
    } catch (err) {
      console.error('[GET /admin/broadcast/recipients/preview] Error:', err.message);
      next(err);
    }
  });

// Update broadcast (hanya jika belum diproses)
router.put('/broadcast/:id', async (req, res, next) => {
  try {
    const { title, body, scheduledAt, recipientList } = req.body;
    const broadcast = await prisma.broadcast.findUnique({ where: { id: req.params.id } });
    
    if (!broadcast) {
      return res.status(404).send({ error: 'Broadcast tidak ditemukan' });
    }
    
    if (broadcast.status !== 'queued' && broadcast.status !== 'scheduled') {
      return res.status(400).send({ error: 'Hanya broadcast yang queued/scheduled yang bisa diupdate' });
    }

    // Validate body length and recipientList size when updating
    const MAX_BROADCAST_RECIPIENTS = parseInt(process.env.MAX_BROADCAST_RECIPIENTS || '5000', 10);
    const MAX_BROADCAST_BODY_LENGTH = parseInt(process.env.MAX_BROADCAST_BODY_LENGTH || '2000', 10);

    if (typeof body === 'string' && body.length > MAX_BROADCAST_BODY_LENGTH) {
      return res.status(400).send({ error: `Body terlalu panjang (max ${MAX_BROADCAST_BODY_LENGTH} chars)` });
    }

    if (recipientList && typeof recipientList !== 'string') {
      if (!Array.isArray(recipientList)) {
        return res.status(400).send({ error: 'recipientList harus berupa array chatId atau string "all_opted_in"' });
      }

      if (recipientList.length > MAX_BROADCAST_RECIPIENTS) {
        return res.status(400).send({ error: `Jumlah penerima terlalu banyak (max ${MAX_BROADCAST_RECIPIENTS})` });
      }
    }

    // Store arrays as Prisma Json array (avoid JSON.stringify so scheduler/admin UI stays consistent)
    const processedRecipientList = Array.isArray(recipientList)
      ? recipientList
      : recipientList;

    const updated = await prisma.broadcast.update({
      where: { id: req.params.id },
      data: {
        title: title || broadcast.title,
        body: body || broadcast.body,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : broadcast.scheduledAt,
        recipientList: processedRecipientList || broadcast.recipientList
      }
    });
    
    res.send(updated);
  } catch (err) {
    console.error('[PUT /admin/broadcast/:id] Error:', err.message);
    next(err);
  }
});

// Delete broadcast (hanya jika belum diproses)
router.delete('/broadcast/:id', async (req, res, next) => {
  try {
    const broadcast = await prisma.broadcast.findUnique({ where: { id: req.params.id } });
    
    if (!broadcast) {
      return res.status(404).send({ error: 'Broadcast tidak ditemukan' });
    }
    
    if (broadcast.status !== 'queued' && broadcast.status !== 'scheduled') {
      return res.status(400).send({ error: 'Hanya broadcast yang queued/scheduled yang bisa dihapus' });
    }

    await prisma.broadcast.delete({ where: { id: req.params.id } });
    res.send({ ok: true });
  } catch (err) {
    console.error('[DELETE /admin/broadcast/:id] Error:', err.message);
    next(err);
  }
});

function extractVisualTrainingContext(req) {
  const body = req && req.body ? req.body : {};
  const raw = body.visualContext || body.caption || body.description || body.context || '';
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
}
// === TRAINING DATA MANAGEMENT ===

// Upload dan parse training file
// Middleware stack: upload.single -> handleUploadResponse
router.post(
  '/training/upload', 
  validateUploadRequest,
  upload.single('file'),
  handleMulterError,
  handleUploadResponse,
  async (req, res, next) => {
    let uploadedPath = null;
    try {
      console.log('[POST /admin/training/upload] File diterima:', req.uploadInfo?.originalname);
      
      if (!req.uploadInfo) {
        return res.status(400).send({ error: 'File wajib diunggah' });
      }

      uploadedPath = req.uploadInfo.path;

      // Division: use role-based default; allow admin to override via query param.
      let divisionKey = roleToDivisionKey(req.user && req.user.role);
      if (!divisionKey) {
        divisionKey = normalizeDivisionKey(req.query && req.query.divisionKey);
      }

      const uploaderId = await resolveUploaderId(req);
      const visualContext = extractVisualTrainingContext(req);

      // Parse file
      const result = await FileParser.parseAndStoreFile(
        uploadedPath,
        req.uploadInfo.originalname,
        uploaderId,
        divisionKey,
        req.uploadInfo.filename,
        { visualContext }
      );
      
      if (!result.success) {
        // Cleanup file jika parsing gagal
        await cleanupUploadedFile(uploadedPath);
        
        // Improved error response dengan suggestions
        const errorResponse = {
          error: result.error,
          errorCode: result.errorCode || 'PARSE_ERROR',
          suggestions: []
        };
        
        // Add helpful suggestions based on error type
        if (result.errorCode === 'OCR_FAILED_LOW_QUALITY') {
          errorResponse.suggestions = [
            '📝 Gunakan form "Input Manual Teks" untuk paste text hasil scan',
            '📄 Convert PDF ke DOCX/TXT gunakan aplikasi lain terlebih dulu',
            '🔄 Coba gunakan PDF berkualitas lebih tinggi (res lebih tinggi)'
          ];
          errorResponse.showManualInput = true;
        } else if (result.errorCode === 'OCR_DISABLED_FOR_SCAN') {
          errorResponse.suggestions = [
            '⚙️ OCR perlu di-enable di .env (ENABLE_OCR=true)',
            '📝 Atau gunakan form "Input Manual Teks"'
          ];
        } else if (result.errorCode === 'OCR_DEPS_MISSING') {
          errorResponse.suggestions = [
            '🧩 Pastikan dependency OCR ter-install di server: ImageMagick/GraphicsMagick + Ghostscript + tesseract',
            '🐳 Jika pakai Docker: rebuild image lalu redeploy (pastikan package OS untuk ghostscript terpasang)',
            '📝 Alternatif cepat: gunakan form "Input Manual Teks" atau convert ke TXT/DOCX lalu upload'
          ];
          errorResponse.showManualInput = true;
        } else if (result.errorCode === 'OCR_LANG_DATA_MISSING') {
          errorResponse.suggestions = [
            '📦 Pastikan file `eng.traineddata` dan `ind.traineddata` ada di server',
            '⚙️ Set `OCR_LANG_PATH` ke folder yang berisi `.traineddata` (mis. `/app` di Docker)',
            '📝 Alternatif: convert dokumen ke TXT/DOCX lalu upload'
          ];
          errorResponse.showManualInput = true;
        } else if (result.errorCode === 'OCR_LANG_DOWNLOAD_FAILED') {
          errorResponse.suggestions = [
            '🌐 Server tidak bisa download language data OCR dari internet/CDN',
            '⚙️ Solusi: taruh `.traineddata` lokal dan set `OCR_LANG_PATH`',
            '📝 Alternatif: upload TXT/DOCX atau paste ke Input Manual Teks'
          ];
          errorResponse.showManualInput = true;
        } else if (result.errorCode === 'DB_TEXT_ENCODING' || result.errorCode === 'DB_WRITE_FAILED') {
          errorResponse.suggestions = [
            '📄 Coba export ulang file (save as) lalu upload ulang',
            '🧾 Jika dari PDF scan/hasil copy-paste: convert dulu ke TXT',
            '✂️ Jika dokumen sangat panjang: pecah jadi beberapa file'
          ];
        }
        
        return res.status(400).send({
          ...errorResponse,
          requestId: req.requestId,
          prismaCode: result && Object.prototype.hasOwnProperty.call(result, 'prismaCode') ? (result.prismaCode || null) : null,
        });
      }

      console.log('[POST /admin/training/upload] File successfully processed:', result.trainingDataId);
      
      res.status(201).send({
        ok: true,
        trainingDataId: result.trainingDataId,
        filename: req.uploadInfo.originalname,
        fileSize: req.uploadInfo.size,
        contentPreview: result.content.substring(0, 200) + '...',
        wasTruncated: !!result.wasTruncated
      });

      // Trigger RAG ingestion in background (do not block response)
      setImmediate(async () => {
        try {
          logger.info({
            trainingDataId: result.trainingDataId,
            filename: req.uploadInfo.originalname,
            source: 'upload',
            divisionKey
          }, '[TRACE_BEFORE_INGEST]');
          console.log('[RAG] Starting ingestion for training:', result.trainingDataId);
          const ing = await ingestTrainingData(result.trainingDataId, result.content, 'upload', {
            divisionKey,
            filename: req.uploadInfo.originalname,
            uploadedById: uploaderId
          });
          console.log('[RAG] Ingestion result:', ing);
        } catch (err) {
          console.error('[RAG] Ingestion failed:', err.message);
        }
      });
    } catch (err) {
      // Cleanup file jika ada error
      if (uploadedPath) {
        await cleanupUploadedFile(uploadedPath);
      }
      const rawMessage = err && err.message ? String(err.message) : String(err);
      const looksLikeInvocationDump =
        rawMessage.includes('Invalid `prisma.') ||
        rawMessage.includes('Invalid prisma.') ||
        rawMessage.includes('prisma.trainingData.create');
      const publicMessage = looksLikeInvocationDump
        ? 'Terjadi error saat menyimpan training data. Coba upload ulang atau convert file ke TXT/CSV.'
        : (rawMessage.length > 400 ? rawMessage.slice(0, 400) + '…' : rawMessage);

      console.error('[POST /admin/training/upload] Error:', publicMessage);
      res.status(500).send({
        error: publicMessage,
        errorCode: (err && err.code) ? String(err.code) : 'UNKNOWN_ERROR',
        requestId: req.requestId,
        suggestions: [
          '📝 Coba gunakan form "Input Manual Teks" sebagai alternatif',
          '💡 Atau hubungi administrator untuk bantuan'
        ]
      });
    }
  }
);

// Upload validation file (controlled via feature flag)
router.post(
  '/training/validation/upload',
  validateUploadRequest,
  upload.single('file'),
  handleMulterError,
  handleUploadResponse,
  async (req, res, next) => {
    let uploadedPath = null;
    try {
      const enabled = await isValidationFileUploadEnabled();
      if (!enabled) {
        if (req.uploadInfo && req.uploadInfo.path) {
          await cleanupUploadedFile(req.uploadInfo.path);
        }
        return res.status(409).send({ error: 'Validation file upload is disabled by feature flag' });
      }

      if (!req.uploadInfo) {
        return res.status(400).send({ error: 'File wajib diunggah' });
      }

      uploadedPath = req.uploadInfo.path;

      const uploaderId = await resolveUploaderId(req);

      const uploaderRole = req.user && req.user.role ? String(req.user.role) : null;
      const uploaderDivisionKey = roleToDivisionKey(uploaderRole);

      // Move file into uploads/validation/ for easier management
      const projectRoot = path.join(__dirname, '..', '..');
      const validationDir = path.join(projectRoot, 'uploads', 'validation');
      await fs.mkdir(validationDir, { recursive: true });

      const destPath = path.join(validationDir, req.uploadInfo.filename);
      try {
        await fs.rename(uploadedPath, destPath);
        uploadedPath = destPath;
      } catch {
        // If move fails, keep original path
      }

      const storedUnder = uploadedPath && uploadedPath.includes(path.join('uploads', 'validation'))
        ? 'uploads/validation'
        : (uploadedPath && uploadedPath.includes(path.join('uploads')) ? 'uploads' : null);

      await logAdminAction(req, 'upload_validation_file', 'ValidationFile', {
        originalname: req.uploadInfo.originalname,
        filename: req.uploadInfo.filename,
        size: req.uploadInfo.size,
        mimetype: req.uploadInfo.mimetype,
        uploadedById: uploaderId,
        uploadedByUsername: req.user && req.user.username ? String(req.user.username) : null,
        uploadedByRole: uploaderRole,
        divisionKey: uploaderDivisionKey,
        storedUnder,
      });

      res.status(201).send({
        ok: true,
        filename: req.uploadInfo.originalname,
        storedAs: req.uploadInfo.filename,
        fileSize: req.uploadInfo.size,
        mimetype: req.uploadInfo.mimetype,
      });
    } catch (err) {
      if (uploadedPath) {
        await cleanupUploadedFile(uploadedPath);
      }
      next(err);
    }
  }
);

  function isSafeStoredFilename(input) {
    const s = String(input || '').trim();
    if (!s) return false;
    if (s.includes('..')) return false;
    if (s.includes('/') || s.includes('\\')) return false;
    if (path.basename(s) !== s) return false;
    return s.length <= 255;
  }

  function sanitizeDownloadName(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    return s
      .replace(/\\/g, '')
      .replace(/\//g, '')
      .replace(/\.\./g, '')
      .replace(/[<>:"|?*\x00-\x1f]/g, '')
      .substring(0, 255);
  }

  async function resolveValidationFilePath(storedAs) {
    if (!isSafeStoredFilename(storedAs)) return null;
    const projectRoot = path.join(__dirname, '..', '..');
    const candidates = [
      path.join(projectRoot, 'uploads', 'validation', storedAs),
      path.join(projectRoot, 'uploads', storedAs),
    ];

    for (const p of candidates) {
      try {
        await fs.stat(p);
        return p;
      } catch {
        // ignore
      }
    }
    return null;
  }

  async function resolveOriginalTrainingFilePath(training) {
    if (!training) return null;
    const projectRoot = path.join(__dirname, '..', '..');
    const searchDirs = [
      path.join(projectRoot, 'uploads', 'validation'),
      path.join(projectRoot, 'uploads', 'public-media'),
      path.join(projectRoot, 'uploads')
    ];

    const stored = training.storedFilename ? String(training.storedFilename) : '';
    if (stored && isSafeStoredFilename(stored)) {
      for (const dir of searchDirs) {
        const candidate = path.join(dir, stored);
        try {
          await fs.stat(candidate);
          return { path: candidate, storedFilename: stored };
        } catch {
          // try next
        }
      }
    }

    const origFilename = String(training.filename || '');
    const ext = path.extname(origFilename).toLowerCase();
    const base = path.basename(origFilename, ext).toLowerCase();
    const candidates = [];

    for (const dir of searchDirs) {
      try {
        const names = await fs.readdir(dir);
        for (const name of names) {
          const lower = String(name || '').toLowerCase();
          if (!lower) continue;
          if (ext && lower.endsWith(ext) && (lower.startsWith(base + '-') || lower.startsWith(base + '_') || lower === base + ext)) {
            candidates.push({ dir, name });
            continue;
          }
          if (base && lower.includes(base) && (!ext || lower.endsWith(ext))) {
            candidates.push({ dir, name });
          }
        }
      } catch {
        // ignore missing directories
      }
    }

    let best = null;
    for (const candidate of candidates) {
      try {
        const absPath = path.join(candidate.dir, candidate.name);
        const stat = await fs.stat(absPath);
        const item = { path: absPath, storedFilename: candidate.name, mtime: stat.mtimeMs || 0 };
        if (!best || item.mtime > best.mtime) best = item;
      } catch {
        // ignore vanished files
      }
    }

    return best ? { path: best.path, storedFilename: best.storedFilename } : null;
  }
  // Super Admin: list uploaded validation files (sourced from audit logs)
  router.get('/training/validation', async (req, res, next) => {
    try {
      const role = req.user && req.user.role ? String(req.user.role) : null;
      if (!isSuperAdminRole(role)) {
        return res.status(403).send({ error: 'Forbidden: only Super Admin can view validation files' });
      }

      const limitRaw = req.query && req.query.limit ? Number(req.query.limit) : 50;
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 200) : 50;

      const logs = await prisma.adminAuditLog.findMany({
        where: { action: 'upload_validation_file' },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      const usernames = Array.from(
        new Set(
          logs
            .map((l) => (l && l.username ? String(l.username) : ''))
            .map((u) => u.trim())
            .filter(Boolean)
        )
      );

      const users = usernames.length
        ? await prisma.adminUser.findMany({
            where: { username: { in: usernames } },
            select: { id: true, username: true, displayName: true, role: true },
          })
        : [];
      const userByUsername = new Map(users.map((u) => [u.username, u]));

      const items = await Promise.all(
        logs.map(async (l) => {
          const details = (l && l.details) ? l.details : null;
          const originalname = details && typeof details.originalname === 'string' ? details.originalname : null;
          const storedAs = details && typeof details.filename === 'string' ? details.filename : null;
          const size = details && typeof details.size === 'number' ? details.size : null;
          const mimetype = details && typeof details.mimetype === 'string' ? details.mimetype : null;

          const uploaderUsername = l && l.username ? String(l.username) : null;
          const uploader = uploaderUsername ? (userByUsername.get(uploaderUsername) || null) : null;
          const uploaderRole = uploader && uploader.role ? String(uploader.role) : (details && typeof details.uploadedByRole === 'string' ? details.uploadedByRole : null);
          const divisionKey = uploaderRole ? roleToDivisionKey(uploaderRole) : (details && typeof details.divisionKey === 'string' ? details.divisionKey : null);

          let exists = false;
          let storedUnder = details && typeof details.storedUnder === 'string' ? details.storedUnder : null;
          if (storedAs && isSafeStoredFilename(storedAs)) {
            const resolved = await resolveValidationFilePath(storedAs);
            if (resolved) {
              exists = true;
              storedUnder = storedUnder || (resolved.includes(path.join('uploads', 'validation')) ? 'uploads/validation' : 'uploads');
            }
          }

          return {
            id: l.id,
            createdAt: l.createdAt,
            originalname,
            storedAs,
            size,
            mimetype,
            exists,
            storedUnder,
            uploader: uploader
              ? {
                  id: uploader.id,
                  username: uploader.username,
                  displayName: uploader.displayName || null,
                  role: uploader.role || null,
                  divisionKey,
                }
              : {
                  id: null,
                  username: uploaderUsername,
                  displayName: null,
                  role: uploaderRole,
                  divisionKey,
                },
          };
        })
      );

      res.send({ ok: true, items });
    } catch (err) {
      next(err);
    }
  });

  // Super Admin: download a stored validation file
  router.get('/training/validation/download/:storedAs', async (req, res, next) => {
    try {
      const role = req.user && req.user.role ? String(req.user.role) : null;
      if (!isSuperAdminRole(role)) {
        return res.status(403).send({ error: 'Forbidden: only Super Admin can download validation files' });
      }

      const storedAs = req.params && req.params.storedAs ? String(req.params.storedAs) : '';
      if (!isSafeStoredFilename(storedAs)) {
        return res.status(400).send({ error: 'Invalid stored filename' });
      }

      const filePath = await resolveValidationFilePath(storedAs);
      if (!filePath) {
        return res.status(404).send({ error: 'File not found' });
      }

      const requestedName = req.query && typeof req.query.name === 'string' ? req.query.name : null;
      const safeName = sanitizeDownloadName(requestedName) || storedAs;

      res.download(filePath, safeName);
    } catch (err) {
      next(err);
    }
  });

// Bulk upload: multiple files in one request
// Field name: files
router.post(
  '/training/upload-bulk',
  validateUploadRequest,
  uploadBulk.array('files'),
  handleMulterError,
  handleUploadResponseMultiple,
  async (req, res) => {
    const uploadInfos = Array.isArray(req.uploadInfos) ? req.uploadInfos : [];
    if (!uploadInfos.length) return res.status(400).send({ error: 'Files wajib diunggah' });

    // Division: use role-based default; allow admin to override via query param.
    let divisionKey = roleToDivisionKey(req.user && req.user.role);
    if (!divisionKey) {
      divisionKey = normalizeDivisionKey(req.query && req.query.divisionKey);
    }

    const uploaderId = await resolveUploaderId(req);
    const visualContext = extractVisualTrainingContext(req);

    const results = [];

    for (const info of uploadInfos) {
      const uploadedPath = info && info.path ? info.path : null;
      try {
        if (!uploadedPath) {
          results.push({ ok: false, filename: info && info.originalname ? info.originalname : null, error: 'Missing uploaded file path' });
          continue;
        }

        const parsed = await FileParser.parseAndStoreFile(
          uploadedPath,
          info.originalname,
          uploaderId,
          divisionKey,
          info.filename,
          { visualContext }
        );

        if (!parsed.success) {
          await cleanupUploadedFile(uploadedPath);
          results.push({
            ok: false,
            filename: info.originalname,
            error: parsed.error,
            errorCode: parsed.errorCode || 'PARSE_ERROR',
            prismaCode: parsed && Object.prototype.hasOwnProperty.call(parsed, 'prismaCode') ? (parsed.prismaCode || null) : null,
            requestId: req.requestId,
          });
          continue;
        }

        results.push({
          ok: true,
          trainingDataId: parsed.trainingDataId,
          filename: info.originalname,
          fileSize: info.size,
          contentPreview: parsed.content.substring(0, 200) + '...',
          wasTruncated: !!parsed.wasTruncated,
        });

        // Trigger RAG ingestion in background (do not block response)
        setImmediate(async () => {
          try {
            logger.info({
              trainingDataId: parsed.trainingDataId,
              filename: info.originalname,
              source: 'upload',
              divisionKey
            }, '[TRACE_BEFORE_INGEST]');
            await ingestTrainingData(parsed.trainingDataId, parsed.content, 'upload', {
              divisionKey,
              filename: info.originalname,
              uploadedById: uploaderId,
            });
          } catch (err) {
            console.error('[RAG] Ingestion failed (bulk):', err && err.message ? err.message : String(err));
          }
        });
      } catch (err) {
        if (uploadedPath) await cleanupUploadedFile(uploadedPath);
        const rawMessage = err && err.message ? String(err.message) : String(err);
        const looksLikeInvocationDump =
          rawMessage.includes('Invalid `prisma.') ||
          rawMessage.includes('Invalid prisma.') ||
          rawMessage.includes('prisma.trainingData.create');
        const publicMessage = looksLikeInvocationDump
          ? 'Terjadi error saat menyimpan training data. Coba upload ulang atau convert file ke TXT/CSV.'
          : (rawMessage.length > 400 ? rawMessage.slice(0, 400) + '…' : rawMessage);
        results.push({
          ok: false,
          filename: info && info.originalname ? info.originalname : null,
          error: publicMessage,
          errorCode: err && err.code ? String(err.code) : 'UNKNOWN_ERROR',
          requestId: req.requestId,
        });
      }
    }

    const okCount = results.filter((r) => r && r.ok).length;
    res.status(okCount ? 201 : 400).send({
      ok: okCount > 0,
      count: results.length,
      okCount,
      results,
    });
  }
);

// Manual text input untuk training (fallback kalau OCR gagal)
router.post('/training/manual', async (req, res, next) => {
  try {
    console.log('[POST /admin/training/manual] Received manual text input');
    const { text, title, source, divisionKey: divisionKeyRaw } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).send({ error: 'Text content required' });
    }
    
    if (text.trim().length < 10) {
      return res.status(400).send({ error: 'Text too short (minimum 10 characters)' });
    }
    
    // Create training data dari manual text
    const uploaderId = await resolveUploaderId(req);

    let divisionKey = roleToDivisionKey(req.user && req.user.role);
    if (!divisionKey) divisionKey = normalizeDivisionKey(divisionKeyRaw);

    const normalized = FileParser.sanitizeTextForStorage(text.trim());
    const maxStoredBytes = parseInt(process.env.MAX_TRAINING_CONTENT_BYTES || String(15 * 1024 * 1024), 10);
    const limited = FileParser.limitTextToUtf8Bytes(normalized, maxStoredBytes);

    let training;
    try {
      training = await prisma.trainingData.create({
        data: {
          filename: title || `manual-${new Date().toISOString()}`,
          content: limited.text,
          source: source || 'manual',
          active: true,
          uploadedById: uploaderId,
          divisionKey
        }
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : '';
      const missingOptionalFields =
        /column\s+"?(uploadedById|divisionKey)"?\s+does\s+not\s+exist/i.test(msg) ||
        /Unknown column\s+'(uploadedById|divisionKey)'/i.test(msg);
      if (!missingOptionalFields) throw e;
      training = await prisma.trainingData.create({
        data: {
          filename: title || `manual-${new Date().toISOString()}`,
          content: limited.text,
          source: source || 'manual',
          active: true,
        }
      });
    }
    
    console.log('[POST /admin/training/manual] Training created:', training.id);
    
    res.status(201).send({
      ok: true,
      trainingDataId: training.id,
      filename: training.filename,
      contentLength: training.content.length,
      wasTruncated: limited.wasTruncated
    });
    
    // Trigger RAG ingestion in background
    setImmediate(async () => {
      try {
        console.log('[RAG] Starting ingestion for manual training:', training.id);
          const ing = await ingestTrainingData(training.id, training.content, 'manual', {
          divisionKey,
          filename: training.filename,
          uploadedById: uploaderId
        });
        console.log('[RAG] Ingestion result:', ing);
      } catch (err) {
        console.error('[RAG] Ingestion failed:', err.message);
      }
    });
  } catch (err) {
    console.error('[POST /admin/training/manual] Error:', err.message);
    res.status(500).send({ error: 'Failed to create training data' });
  }
});

// URL ingest untuk training (ambil teks dari halaman web publik)
router.post('/training/url', async (req, res, next) => {
  try {
    const { url, mode, maxPages, divisionKey: divisionKeyRaw } = req.body || {};
    const {
      normalizeUrl,
      hostAllowed,
      checkAiInputAllowed,
      fetchHtml,
      htmlToText,
      extractTitle,
      parseSitemapXml,
      discoverSitemap,
      shouldKeepUrl
    } = require('../engine/webIngest');

    const parsed = normalizeUrl(url);
    if (!hostAllowed(parsed)) {
      return res.status(400).send({
        error: 'URL host not allowed',
        hint: 'Set TRAINING_URL_ALLOWLIST to allow specific domains (comma-separated).'
      });
    }

    // Respect robots.txt Content-Signal policy for AI input.
    const policy = await checkAiInputAllowed(parsed);
    if (!policy.allowed) {
      return res.status(403).send({
        error: 'Website does not allow AI ingestion (ai-input)',
        reason: policy.reason,
        contentSignal: policy.contentSignal,
        hint: 'Alternatif: gunakan upload dokumen resmi (PDF/DOCX) atau paste teks via /admin/training/manual.'
      });
    }

    const requestedMode = String(mode || '').toLowerCase();
    const isSitemapMode = requestedMode === 'sitemap' || String(parsed.pathname || '').toLowerCase().includes('sitemap');

    const created = [];
    const uploaderId = await resolveUploaderId(req);

    let divisionKey = roleToDivisionKey(req.user && req.user.role);
    if (!divisionKey) divisionKey = normalizeDivisionKey(divisionKeyRaw);
    const maxPagesSafe = Math.min(
      parseInt(maxPages || process.env.URL_INGEST_MAX_PAGES || '5', 10) || 5,
      parseInt(process.env.URL_INGEST_MAX_PAGES_HARD || '25', 10)
    );

    if (!isSitemapMode) {
      const html = await fetchHtml(parsed);
      const title = extractTitle(html);
      const text = htmlToText(html);

      if (!text || text.trim().length < 200) {
        return res.status(400).send({ error: 'Extracted text too short. The page may be mostly dynamic or blocked.' });
      }

      const normalized = FileParser.sanitizeTextForStorage(text.trim());
      const maxStoredBytes = parseInt(process.env.MAX_TRAINING_CONTENT_BYTES || String(15 * 1024 * 1024), 10);
      const limited = FileParser.limitTextToUtf8Bytes(normalized, maxStoredBytes);

      let training;
      try {
        training = await prisma.trainingData.create({
          data: {
            filename: title ? `${title} (${parsed.toString()})` : parsed.toString(),
            content: limited.text,
            source: 'url',
            active: true,
            uploadedById: uploaderId,
            divisionKey
          }
        });
      } catch (e) {
        const msg = e && e.message ? String(e.message) : '';
        const missingOptionalFields =
          /column\s+"?(uploadedById|divisionKey)"?\s+does\s+not\s+exist/i.test(msg) ||
          /Unknown column\s+'(uploadedById|divisionKey)'/i.test(msg);
        if (!missingOptionalFields) throw e;
        training = await prisma.trainingData.create({
          data: {
            filename: title ? `${title} (${parsed.toString()})` : parsed.toString(),
            content: limited.text,
            source: 'url',
            active: true,
          }
        });
      }

      created.push({ id: training.id, url: parsed.toString(), title });

      res.status(201).send({ ok: true, mode: 'single', created });

      setImmediate(async () => {
        try {
          console.log('[RAG] Starting ingestion for URL training:', training.id);
          const ing = await ingestTrainingData(training.id, training.content, 'url', {
            divisionKey,
            filename: training.filename,
            uploadedById: uploaderId
          });
          console.log('[RAG] Ingestion result:', ing);
        } catch (err) {
          console.error('[RAG] URL ingestion failed:', err.message);
        }
      });

      return;
    }

    // Sitemap mode: discover sitemap and ingest up to maxPagesSafe pages
    const { sitemapUrl, xml } = await discoverSitemap(parsed.toString());
    const locs = parseSitemapXml(xml);
    const baseHost = parsed.hostname;

    const urls = [];
    for (const loc of locs) {
      try {
        const u = normalizeUrl(loc);
        if (!hostAllowed(u)) continue;
        if (!shouldKeepUrl(u, baseHost)) continue;
        urls.push(u.toString());
        if (urls.length >= maxPagesSafe) break;
      } catch (e) {
        // ignore invalid URLs
      }
    }

    if (urls.length === 0) {
      return res.status(400).send({
        error: 'No ingestable URLs found from sitemap',
        sitemapUrl,
        hint: 'Try setting URL_INGEST_PATH_PREFIX="/" if the site does not use /id/ paths.'
      });
    }

    // Create TrainingData records first; ingest in background afterwards.
    for (const u of urls) {
      try {
        const html = await fetchHtml(normalizeUrl(u));
        const title = extractTitle(html);
        const text = htmlToText(html);
        if (!text || text.trim().length < 200) continue;

        const normalized = FileParser.sanitizeTextForStorage(text.trim());
        const maxStoredBytes = parseInt(process.env.MAX_TRAINING_CONTENT_BYTES || String(15 * 1024 * 1024), 10);
        const limited = FileParser.limitTextToUtf8Bytes(normalized, maxStoredBytes);

        let training;
        try {
          training = await prisma.trainingData.create({
            data: {
              filename: title ? `${title} (${u})` : u,
              content: limited.text,
              source: 'url',
              active: true,
              uploadedById: uploaderId,
              divisionKey
            }
          });
        } catch (e) {
          const msg = e && e.message ? String(e.message) : '';
          const missingOptionalFields =
            /column\s+"?(uploadedById|divisionKey)"?\s+does\s+not\s+exist/i.test(msg) ||
            /Unknown column\s+'(uploadedById|divisionKey)'/i.test(msg);
          if (!missingOptionalFields) throw e;
          training = await prisma.trainingData.create({
            data: {
              filename: title ? `${title} (${u})` : u,
              content: limited.text,
              source: 'url',
              active: true,
            }
          });
        }
        created.push({ id: training.id, url: u, title });

        setImmediate(async () => {
          try {
            console.log('[RAG] Starting ingestion for sitemap URL training:', training.id);
            const ing = await ingestTrainingData(training.id, training.content, 'url', {
              divisionKey,
              filename: training.filename,
              uploadedById: uploaderId
            });
            console.log('[RAG] Ingestion result:', ing);
          } catch (err) {
            console.error('[RAG] Sitemap URL ingestion failed:', err.message);
          }
        });

        const delayMs = parseInt(process.env.URL_INGEST_DELAY_MS || '200', 10);
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      } catch (e) {
        console.warn('[URL Ingest] Failed to ingest url:', u, e.message);
      }
    }

    res.status(201).send({
      ok: true,
      mode: 'sitemap',
      sitemapUrl,
      requested: urls.length,
      createdCount: created.length,
      created
    });
  } catch (err) {
    console.error('[POST /admin/training/url] Error:', err.message);
    res.status(500).send({ error: err.message || 'Failed to ingest URL' });
  }
});
  
  // RAG: query endpoint
  router.post('/rag/query', async (req, res, next) => {
    try {
      const { question, topK, divisionKey: divisionKeyRaw, includeGlobal } = req.body;
      if (!question) return res.status(400).send({ error: 'question required' });

      const { query: ragQuery } = require('../engine/ragEngine');

      let divisionKey = roleToDivisionKey(req.user && req.user.role);
      if (!divisionKey) divisionKey = normalizeDivisionKey(divisionKeyRaw);

      const result = await ragQuery(question, parseInt(topK || '3', 10), {
        divisionKey,
        includeGlobal: includeGlobal === undefined ? true : !!includeGlobal,
        answerQuestion: question
      });
      res.send(result);
    } catch (err) {
      console.error('[POST /admin/rag/query] Error:', err.message);
      next(err);
    }
  });

  // RAG: reprocess original upload when available, then ingest from current content.
  router.post('/rag/ingest/:id', async (req, res, next) => {
    try {
      const trainingId = req.params.id;
      const training = await prisma.trainingData.findUnique({ where: { id: trainingId } });
      if (!training) return res.status(404).send({ error: 'Training data not found' });

      let contentForIngest = training.content || '';
      let reprocessed = false;
      let reprocessStoredFilename = training.storedFilename || null;
      const source = String(training.source || '').toLowerCase();

      if (source === 'upload') {
        const original = await resolveOriginalTrainingFilePath(training);
        if (!original || !original.path) {
          return res.status(404).send({
            success: false,
            status: 'failed',
            code: 'ORIGINAL_FILE_NOT_FOUND',
            error: 'File asli tidak ditemukan di server storage. Upload ulang file diperlukan untuk reprocess.',
            filename: training.filename || null,
            storedFilename: training.storedFilename || null
          });
        }

        const visualContext = extractVisualTrainingContext(req);
        const reparsed = await FileParser.parseFileContentAsync(original.path, training.filename, { visualContext });
        const sanitized = FileParser.sanitizeTextForStorage(reparsed);
        if (!sanitized || sanitized.trim().length === 0) {
          return res.status(400).send({
            success: false,
            status: 'failed',
            code: 'REPROCESS_EMPTY_CONTENT',
            error: 'File asli berhasil ditemukan, tetapi hasil parse/OCR kosong.'
          });
        }

        const maxStoredBytes = parseInt(process.env.MAX_TRAINING_CONTENT_BYTES || String(15 * 1024 * 1024), 10);
        const limited = FileParser.limitTextToUtf8Bytes(sanitized, maxStoredBytes);
        contentForIngest = limited.text;
        reprocessed = true;
        reprocessStoredFilename = original.storedFilename || reprocessStoredFilename;

        await prisma.trainingData.update({
          where: { id: trainingId },
          data: {
            content: contentForIngest,
            storedFilename: reprocessStoredFilename || training.storedFilename || null,
            ragIngestStatus: 'unknown',
            ragIngestError: null,
            ragChunkCount: null,
            ragIngestedAt: null
          }
        });
      }

      const { ingestTrainingData: ragIngest } = require('../engine/ragEngine');
      const result = await ragIngest(trainingId, contentForIngest, training.source, {
        divisionKey: training.divisionKey || null,
        filename: training.filename,
        sourceFile: training.filename,
        uploadedById: training.uploadedById || null
      });
      res.send({ ...result, reprocessed, storedFilename: reprocessStoredFilename || null });
    } catch (err) {
      console.error('[POST /admin/rag/ingest/:id] Error:', err.message);
      next(err);
    }
  });

  // RAG: status endpoint - index overview and training counts
  router.get('/training/rag-status', async (req, res, next) => {
    try {
      const { loadIndex, getIndexPath } = require('../engine/ragEngine');
      const indexPath = getIndexPath();
      let index = [];
      try {
        index = Array.isArray(await loadIndex()) ? await loadIndex() : [];
      } catch (e) {
        index = [];
      }

      const indexCount = Array.isArray(index) ? index.length : 0;
      const sampleFiles = Array.from(new Set((index || []).map(i => i && i.filename ? i.filename : null).filter(Boolean))).slice(0, 20);

      let stat = null;
      try {
        stat = await fs.stat(indexPath);
      } catch (e) {
        stat = null;
      }

      const totalCount = await prisma.trainingData.count().catch(() => 0);
      const activeCount = await prisma.trainingData.count({ where: { active: true } }).catch(() => 0);

      res.send({
        ok: true,
        indexPath,
        indexCount,
        indexSizeBytes: stat ? stat.size : null,
        sampleFiles,
        trainingTotal: totalCount,
        trainingActive: activeCount
      });
    } catch (err) {
      console.error('[GET /admin/training/rag-status] Error:', err && err.message ? err.message : err);
      next(err);
    }
  });

  // RAG: evaluation queue (low-confidence / no-match questions)
  router.get('/rag/eval', async (req, res, next) => {
    try {
      if (!prisma || !prisma.ragEvalItem || typeof prisma.ragEvalItem.findMany !== 'function') {
        return res.status(501).send({ error: 'RagEvalItem model not available (run migrations + prisma generate)' });
      }

      const resolvedRaw = String((req.query && req.query.resolved) || '').toLowerCase().trim();
      const resolved = resolvedRaw === '1' || resolvedRaw === 'true' || resolvedRaw === 'yes';
      const divisionKey = normalizeDivisionKey(req.query && req.query.divisionKey);
      const limit = Math.min(parseInt((req.query && req.query.limit) || '200', 10) || 200, 500);

      const where = {
        ...(divisionKey ? { divisionKey } : {}),
        ...(resolved ? { resolvedAt: { not: null } } : { resolvedAt: null })
      };

      const items = await prisma.ragEvalItem.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          key: true,
          question: true,
          normalized: true,
          divisionKey: true,
          reason: true,
          minScore: true,
          topScore: true,
          occurrences: true,
          contexts: true,
          resolvedAt: true,
          resolvedById: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.send({ ok: true, count: items.length, where, items });
    } catch (err) {
      console.error('[GET /admin/rag/eval] Error:', err.message);
      next(err);
    }
  });

  router.post('/rag/eval/:id/resolve', async (req, res, next) => {
    try {
      if (!prisma || !prisma.ragEvalItem || typeof prisma.ragEvalItem.update !== 'function') {
        return res.status(501).send({ error: 'RagEvalItem model not available (run migrations + prisma generate)' });
      }

      const id = req.params.id;
      const adminId = await resolveUploaderId(req);

      const item = await prisma.ragEvalItem.update({
        where: { id },
        data: {
          resolvedAt: new Date(),
          resolvedById: adminId || null
        }
      });
      res.send({ ok: true, item });
    } catch (err) {
      console.error('[POST /admin/rag/eval/:id/resolve] Error:', err.message);
      next(err);
    }
  });
 

// List training data
router.get('/training', async (req, res, next) => {
  try {
    console.log('[GET /admin/training] Mengambil training data...');
    const role = req.user && req.user.role;
    if (isAdminRole(role)) {
      // Prefer DB ordering for consistency: newest first.
      try {
        const items = await prisma.trainingData.findMany({
          select: {
            id: true,
            filename: true,
            divisionKey: true,
            ragIngestStatus: true,
            ragIngestError: true,
            ragIngestedAt: true,
            ragChunkCount: true,
            active: true,
            createdAt: true,
            source: true,
            uploadedById: true,
            uploadedBy: { select: { id: true, username: true, displayName: true, role: true } }
          },
          orderBy: [{ active: 'desc' }, { createdAt: 'desc' }]
        });
        return res.send(items);
      } catch (e) {
        const msg = (e && e.message) ? String(e.message) : '';
        if (isTrainingOptionalFieldUnavailableError(e)) {
          const items = await FileParser.listTrainingData();
          return res.send(items);
        }
        throw e;
      }
    }

    // Non-admin roles: only see training they uploaded.
    const uploaderId = await resolveUploaderId(req);
    if (!uploaderId) {
      return res.send([]);
    }

    // Query directly to enforce access control even if FileParser behavior changes.
    let items = [];
    try {
      items = await prisma.trainingData.findMany({
        where: { uploadedById: uploaderId },
        select: {
          id: true,
          filename: true,
          divisionKey: true,
          ragIngestStatus: true,
          ragIngestError: true,
          ragIngestedAt: true,
          ragChunkCount: true,
          active: true,
          createdAt: true,
          source: true,
          uploadedById: true,
          uploadedBy: { select: { id: true, username: true, displayName: true, role: true } }
        },
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }]
      });
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : '';
      if (isTrainingOptionalFieldUnavailableError(e)) {
        // Legacy schema/client: deny list for non-admin to avoid leaking training data.
        return res.send([]);
      }
      throw e;
    }

    return res.send(items);
  } catch (err) {
    console.error('[GET /admin/training] Error:', err.message);
    next(err);
  }
});

// Preview training data content (for OCR/debug)
router.get('/training/:id/preview', async (req, res, next) => {
  try {
    const trainingId = req.params.id;
    let training;
    try {
      training = await prisma.trainingData.findUnique({
        where: { id: trainingId },
        select: {
          id: true,
          filename: true,
          content: true,
          source: true,
          divisionKey: true,
          ragIngestStatus: true,
          ragIngestError: true,
          ragIngestedAt: true,
          ragChunkCount: true,
          createdAt: true,
          uploadedById: true,
          uploadedBy: { select: { id: true, username: true, displayName: true, role: true } }
        }
      });
    } catch (e) {
      // Backward compatibility: older Prisma client/schema may not have uploadedById yet.
      const msg = (e && e.message) ? String(e.message) : '';
      if (isTrainingOptionalFieldUnavailableError(e)) {
        training = await prisma.trainingData.findUnique({
          where: { id: trainingId },
          select: {
            id: true,
            filename: true,
            content: true,
            source: true,
            createdAt: true
          }
        });
      } else {
        throw e;
      }
    }
    if (!training) {
      return res.status(404).send({ error: 'Training data not found' });
    }

    // Access control: non-admin roles can only preview their own uploaded training.
    const role = req.user && req.user.role;
    if (!isAdminRole(role)) {
      const uploaderId = await resolveUploaderId(req);
      // If training has no uploader info (legacy), deny preview for non-admin.
      if (!uploaderId || !training.uploadedById || training.uploadedById !== uploaderId) {
        return res.status(403).send({ error: 'Forbidden: you can only preview training you uploaded' });
      }
    }

    const full = (req.query.full || '').toString().toLowerCase();
    const wantFull = full === '1' || full === 'true' || full === 'yes';

    const rawContent = training.content || '';
    const totalLength = rawContent.length;

    let preview = rawContent;
    let truncated = false;

    if (!wantFull) {
      const previewLength = parseInt(process.env.TRAINING_PREVIEW_LENGTH || '2000', 10);
      preview = rawContent.substring(0, previewLength);
      truncated = preview.length < totalLength;
    }

    res.send({
      id: training.id,
      filename: training.filename,
      source: training.source,
      divisionKey: training.divisionKey || null,
      ragIngestStatus: training.ragIngestStatus || null,
      ragIngestError: training.ragIngestError || null,
      ragIngestedAt: training.ragIngestedAt || null,
      ragChunkCount: typeof training.ragChunkCount === 'number' ? training.ragChunkCount : null,
      createdAt: training.createdAt,
      uploadedById: training.uploadedById || null,
      uploadedBy: training.uploadedBy || null,
      preview,
      length: totalLength,
      truncated
    });
  } catch (err) {
    console.error('[GET /admin/training/:id/preview] Error:', err.message);
    next(err);
  }
});

// Download original uploaded training file when available (superadmin only). Manual/URL data falls back to parsed text.
router.get('/training/:id/download', async (req, res, next) => {
  try {
    const trainingId = req.params.id;
    let training;
    try {
      training = await prisma.trainingData.findUnique({
        where: { id: trainingId },
        select: {
          id: true,
          filename: true,
          storedFilename: true,
          content: true,
          source: true,
          divisionKey: true,
          createdAt: true,
          uploadedById: true,
          uploadedBy: { select: { id: true, username: true, displayName: true, role: true } }
        }
      });
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : '';
      if (msg.includes('Unknown field') && (msg.includes('uploadedById') || msg.includes('uploadedBy') || msg.includes('divisionKey'))) {
        training = await prisma.trainingData.findUnique({
          where: { id: trainingId },
          select: { id: true, filename: true, storedFilename: true, content: true, source: true, createdAt: true }
        });
      } else {
        throw e;
      }
    }

    if (!training) {
      return res.status(404).send({ error: 'Training data not found' });
    }

    // Only superadmin may download raw dataset content
    const role = req.user && req.user.role;
    if (!isSuperAdminRole(role)) {
      return res.status(403).send({ error: 'Forbidden: only superadmin can download dataset files' });
    }

    const rawContent = training.content || '';

      // If we have a storedFilename, try to stream that exact file first
      try {
        const sf = training.storedFilename ? String(training.storedFilename) : '';
        if (sf && isSafeStoredFilename(sf)) {
          const projectRoot = path.join(__dirname, '..', '..');
          const candidates = [
            path.join(projectRoot, 'uploads', 'validation', sf),
            path.join(projectRoot, 'uploads', 'public-media', sf),
            path.join(projectRoot, 'uploads', sf),
          ];
          for (const p of candidates) {
            try {
              await fs.stat(p);
              const downloadName = sanitizeDownloadName(training.filename) || sf;
              res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
              return res.sendFile(p, (err) => { if (err) return next(err); });
            } catch {
              // not found, try next
            }
          }
        }
      } catch (e) {
        // ignore and fallthrough to heuristic/text fallback
        console.warn('[GET /admin/training/:id/download] storedFilename lookup failed:', e && e.message ? e.message : String(e));
      }

    // Try to locate original stored file on disk. Multer stores files under
    // uploads/ with name: <sanitized-base>-<timestamp><ext>
    try {
      const projectRoot = path.join(__dirname, '..', '..');
      const searchDirs = [
        path.join(projectRoot, 'uploads', 'validation'),
        path.join(projectRoot, 'uploads', 'public-media'),
        path.join(projectRoot, 'uploads'),
      ];

      const origFilename = training.filename || '';
      const ext = path.extname(origFilename || '').toLowerCase();
      const base = path.basename(origFilename || '', ext).toLowerCase();

      const candidates = [];
      for (const d of searchDirs) {
        try {
          const names = await fs.readdir(d);
          for (const n of names) {
            const lower = String(n || '').toLowerCase();
            if (!lower) continue;

            // Common stored pattern: <base>-<timestamp><ext>
            if (ext && lower.endsWith(ext) && (lower.startsWith(base + '-') || lower.startsWith(base + '_') || lower === (base + ext))) {
              candidates.push({ dir: d, name: n });
              continue;
            }

            // Fallback: file contains base and has same extension (loose match)
            if (base && lower.includes(base) && (!ext || lower.endsWith(ext))) {
              candidates.push({ dir: d, name: n });
            }
          }
        } catch (e) {
          // ignore missing dirs
        }
      }

      if (candidates.length > 0) {
        // Pick most recently modified candidate
        let best = null;
        for (const c of candidates) {
          try {
            const st = await fs.stat(path.join(c.dir, c.name));
            c.mtime = st.mtimeMs || 0;
          } catch {
            c.mtime = 0;
          }
          if (!best || c.mtime > best.mtime) best = c;
        }

        if (best) {
          const absPath = path.join(best.dir, best.name);
          const downloadName = sanitizeDownloadName(training.filename) || `training-${training.id}${ext || ''}`;
          res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
          return res.sendFile(absPath, (err) => {
            if (err) return next(err);
          });
        }
      }
    } catch (e) {
      // ignore file-system lookup errors and fallthrough to text download
      console.warn('[GET /admin/training/:id/download] file lookup failed:', e && e.message ? e.message : String(e));
    }

    if (String(training.source || '').toLowerCase() === 'upload') {
      return res.status(404).send({
        error: 'Original uploaded file not found on server storage',
        code: 'ORIGINAL_FILE_NOT_FOUND',
        filename: training.filename || null,
        storedFilename: training.storedFilename || null
      });
    }
    // Fallback: manual/URL training data has no original uploaded file, so return parsed text as .txt
    const parsedBase = path.parse(String(training.filename || `training-${training.id}`)).name || `training-${training.id}`;
    const safeBase = sanitizeDownloadName(parsedBase) || `training-${training.id}`;
    const downloadName = `${safeBase}.txt`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    return res.send(rawContent);
  } catch (err) {
    console.error('[GET /admin/training/:id/download] Error:', err && err.message ? err.message : String(err));
    next(err);
  }
});

// Serve original stored file inline (for previewing images/docs) or fallback to parsed text
router.get('/training/:id/raw', async (req, res, next) => {
  try {
    const trainingId = req.params.id;
    let training;
    try {
      training = await prisma.trainingData.findUnique({
        where: { id: trainingId },
        select: { id: true, filename: true, storedFilename: true, content: true, source: true, createdAt: true }
      });
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : '';
      if (msg.includes('Unknown field')) {
        training = await prisma.trainingData.findUnique({ where: { id: trainingId }, select: { id: true, filename: true, content: true } });
      } else {
        throw e;
      }
    }

    if (!training) {
      return res.status(404).send({ error: 'Training data not found' });
    }

    // Require authenticated admin (any role) to view preview
    if (!req.user || !req.user.username) {
      return res.status(403).send({ error: 'Forbidden' });
    }

      const origFilename = String(training.filename || '');
    const ext = path.extname(origFilename || '').toLowerCase();
    const base = path.basename(origFilename || '', ext).toLowerCase();

    const projectRoot = path.join(__dirname, '..', '..');
    const searchDirs = [
      path.join(projectRoot, 'uploads', 'validation'),
      path.join(projectRoot, 'uploads', 'public-media'),
      path.join(projectRoot, 'uploads')
    ];

    // Prefer storedFilename if available
    try {
      const sf = training.storedFilename ? String(training.storedFilename) : '';
      if (sf && isSafeStoredFilename(sf)) {
        const projectRoot = path.join(__dirname, '..', '..');
        const possible = [
          path.join(projectRoot, 'uploads', 'validation', sf),
          path.join(projectRoot, 'uploads', 'public-media', sf),
          path.join(projectRoot, 'uploads', sf)
        ];
        for (const p of possible) {
          try {
            await fs.stat(p);
            const ctypeMap = {
              '.pdf': 'application/pdf',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.webp': 'image/webp',
              '.gif': 'image/gif',
              '.svg': 'image/svg+xml',
            };
            const ctype = ctypeMap[path.extname(sf).toLowerCase()] || 'application/octet-stream';
            res.setHeader('Content-Type', ctype);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.sendFile(p, (err) => { if (err) return next(err); });
          } catch {
            // try next
          }
        }
      }
    } catch (e) {
      // ignore and fall through to heuristic search
    }

    const candidates = [];
    for (const d of searchDirs) {
      try {
        const names = await fs.readdir(d);
        for (const n of names) {
          const lower = String(n || '').toLowerCase();
          if (!lower) continue;
          if (ext && lower.endsWith(ext) && (lower.startsWith(base + '-') || lower.startsWith(base + '_') || lower === (base + ext))) {
            candidates.push({ dir: d, name: n });
            continue;
          }
          if (base && lower.includes(base) && (!ext || lower.endsWith(ext))) {
            candidates.push({ dir: d, name: n });
          }
        }
      } catch (e) {
        // ignore missing dirs
      }
    }

    if (candidates.length > 0) {
      let best = null;
      for (const c of candidates) {
        try {
          const st = await fs.stat(path.join(c.dir, c.name));
          c.mtime = st.mtimeMs || 0;
        } catch {
          c.mtime = 0;
        }
        if (!best || c.mtime > best.mtime) best = c;
      }

      if (best) {
        const absPath = path.join(best.dir, best.name);
        const contentTypeMap = {
          '.pdf': 'application/pdf',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.xls': 'application/vnd.ms-excel',
          '.csv': 'text/csv',
          '.txt': 'text/plain; charset=utf-8'
        };
        const ctype = contentTypeMap[path.extname(best.name).toLowerCase()] || 'application/octet-stream';
        res.setHeader('Content-Type', ctype);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendFile(absPath, (err) => {
          if (err) return next(err);
        });
      }
    }

    // Fallback: send parsed text content
    if (training.content) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(training.content);
    }

    return res.status(404).send({ error: 'Original file not found' });
  } catch (err) {
    console.error('[GET /admin/training/:id/raw] Error:', err && err.message ? err.message : String(err));
    next(err);
  }
});

// Delete training data
router.delete('/training/:id', async (req, res, next) => {
  try {
    const result = await FileParser.deactivateTrainingData(req.params.id);
    if (!result.success) {
      return res.status(400).send(result);
    }
    res.send({ ok: true });
  } catch (err) {
    console.error('[DELETE /admin/training/:id] Error:', err.message);
    next(err);
  }
});

// Old upload endpoint (deprecated, kept for backward compatibility)
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    console.log('[POST /admin/upload] File diterima:', req.file?.originalname);
    if (!req.file) {
      return res.status(400).send({ error: 'File wajib diunggah' });
    }
    res.send({ ok: true, path: req.file.path, filename: req.file.originalname });
  } catch (err) {
    console.error('[POST /admin/upload] Error:', err.message);
    next(err);
  }
});

// === PUBLIC MEDIA (OUTBOUND IMAGE ASSETS) ===
// Upload an image and make it accessible via a public URL at /media/<storedAs>.
// This is meant for WhatsApp outbound images, so we restrict to image extensions.
router.post(
  '/media/upload',
  validateUploadRequest,
  upload.single('file'),
  handleMulterError,
  handleUploadResponse,
  async (req, res) => {
    let uploadedPath = null;
    try {
      if (!req.uploadInfo) {
        return res.status(400).send({ error: 'File wajib diunggah' });
      }

      uploadedPath = req.uploadInfo.path;

      const ext = path.extname(req.uploadInfo.originalname || req.uploadInfo.filename || '').toLowerCase();
      const allowed = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
      if (!allowed.has(ext)) {
        if (uploadedPath) await cleanupUploadedFile(uploadedPath);
        return res.status(400).send({
          error: `File harus gambar (${Array.from(allowed).join(', ')})`
        });
      }

      const projectRoot = path.join(__dirname, '..', '..');
      const publicDir = path.join(projectRoot, 'uploads', 'public-media');
      await fs.mkdir(publicDir, { recursive: true });

      const storedAs = req.uploadInfo.filename;
      const destPath = path.join(publicDir, storedAs);

      // Move the uploaded file into the public-media directory.
      try {
        await fs.rename(uploadedPath, destPath);
        uploadedPath = destPath;
      } catch (e) {
        // If rename fails (rare), keep original and return error.
        if (uploadedPath) await cleanupUploadedFile(uploadedPath);
        return res.status(500).send({ error: 'Failed to store media file' });
      }

      const captionRaw = (req.body && (req.body.caption || req.body.title || req.body.name))
        ? String(req.body.caption || req.body.title || req.body.name)
        : '';
      const caption = captionRaw.trim().slice(0, 200);

      const baseEnv = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
      const forwardedProto = (req.headers && req.headers['x-forwarded-proto'])
        ? String(req.headers['x-forwarded-proto']).split(',')[0].trim()
        : '';
      const proto = forwardedProto || req.protocol;
      const host = req.get('host');
      const baseUrl = baseEnv || (host ? `${proto}://${host}` : '');

      const url = baseUrl
        ? `${baseUrl}/media/${encodeURIComponent(storedAs)}`
        : `/media/${encodeURIComponent(storedAs)}`;

      const marker = caption
        ? `[[image:${url}|${caption}]]`
        : `[[image:${url}]]`;

      res.status(201).send({
        ok: true,
        url,
        marker,
        storedAs,
        originalname: req.uploadInfo.originalname,
        size: req.uploadInfo.size,
        mimetype: req.uploadInfo.mimetype
      });
    } catch (err) {
      if (uploadedPath) {
        try { await cleanupUploadedFile(uploadedPath); } catch (e) { /* ignore */ }
      }
      const msg = err && err.message ? String(err.message) : String(err);
      console.error('[POST /admin/media/upload] Error:', msg);
      res.status(500).send({ error: 'Failed to upload media' });
    }
  }
);

  // ============ LIVE CHAT (HUMAN HANDOVER) ============

  // List active human-handover chats
  router.get('/live-chats', async (req, res, next) => {
    try {
      const chats = await prisma.chat.findMany({
        where: { status: 'HUMAN' },
        orderBy: { lastSeenAt: 'desc' }
      });

      if (!chats || chats.length === 0) {
        return res.send([]);
      }

      const chatIds = chats.map(c => c.chatId);

      // IMPORTANT: avoid selecting Session.data in bulk.
      // Large/malformed JSON or DB-provider differences can cause 500s.
      const sessions = await prisma.session.findMany({
        where: { chatId: { in: chatIds } },
        select: { chatId: true, updatedAt: true }
      }).catch(() => []);

      const sessionUpdatedAtMap = new Map();
      (sessions || []).forEach(s => sessionUpdatedAtMap.set(s.chatId, s.updatedAt));

      const lastMessagePairs = await Promise.all(
        chatIds.map(async (chatId) => {
          try {
            const messages = await getChatMessages(chatId);
            const lastMessage = Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null;
            return [chatId, lastMessage];
          } catch {
            return [chatId, null];
          }
        })
      );
      const lastMessageMap = new Map(lastMessagePairs);

      const result = chats.map(chat => {
        const updatedAt = sessionUpdatedAtMap.get(chat.chatId) || chat.lastSeenAt;
        return {
          chatId: chat.chatId,
          status: chat.status,
          updatedAt,
          lastSeenAt: chat.lastSeenAt,
          optIn: chat.optIn,
          lastMessage: lastMessageMap.get(chat.chatId) || null
        };
      });

      res.send(result);
    } catch (err) {
      console.error('[GET /admin/live-chats] Error:', err.message);
      next(err);
    }
  });

  // ============ DATA ERASURE / PRIVACY ============

  // List chats that have history (sessions) so admin can browse without knowing chatId.
  // Returns most recently active first.
  router.get('/chats', async (req, res, next) => {
    try {
      const limitRaw = (req.query.limit || '').toString().trim();
      const limit = Math.min(Math.max(parseInt(limitRaw || '200', 10) || 200, 1), 1000);

      // IMPORTANT: avoid selecting Session.data in bulk.
      // In production, large/malformed JSON or DB provider differences can cause 500s.
      // We only need chatId + updatedAt here; lastMessage is fetched per-chat below.
      let sessions = null;
      try {
        sessions = await prisma.session.findMany({
          orderBy: { updatedAt: 'desc' },
          take: limit,
          select: { chatId: true, updatedAt: true }
        });
      } catch (e) {
        console.error('[GET /admin/chats] Session query failed; falling back to Chat table:', e && e.message ? e.message : String(e));
        sessions = null;
      }

      // Fallback: if Session query fails, still return chats from Chat table (no lastMessage).
      if (!sessions) {
        const chats = await prisma.chat.findMany({
          orderBy: { lastSeenAt: 'desc' },
          take: limit,
          select: { chatId: true, status: true, lastSeenAt: true, optIn: true }
        }).catch(() => []);

        const result = (chats || []).map(c => ({
          chatId: c.chatId,
          updatedAt: c.lastSeenAt,
          status: c.status || 'UNKNOWN',
          lastSeenAt: c.lastSeenAt || null,
          optIn: typeof c.optIn === 'boolean' ? c.optIn : null,
          lastMessage: null
        }));
        return res.send(result);
      }

      if (!sessions || sessions.length === 0) {
        return res.send([]);
      }

      const chatIds = sessions.map(s => s.chatId);
      const chats = await prisma.chat.findMany({
        where: { chatId: { in: chatIds } },
        select: { chatId: true, status: true, lastSeenAt: true, optIn: true }
      }).catch(() => []);

      const chatMap = new Map();
      (chats || []).forEach(c => chatMap.set(c.chatId, c));

      // Fetch last message per chat using the same helper used elsewhere.
      // This isolates any per-chat data issue and prevents the whole endpoint from failing.
      const lastMessagePairs = await Promise.all(
        chatIds.map(async (chatId) => {
          try {
            const messages = await getChatMessages(chatId);
            const lastMessage = Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null;
            return [chatId, lastMessage];
          } catch {
            return [chatId, null];
          }
        })
      );
      const lastMessageMap = new Map(lastMessagePairs);

      const result = sessions.map(s => {
        const chat = chatMap.get(s.chatId);
        return {
          chatId: s.chatId,
          updatedAt: s.updatedAt,
          status: chat ? chat.status : 'UNKNOWN',
          lastSeenAt: chat ? chat.lastSeenAt : null,
          optIn: chat ? chat.optIn : null,
          lastMessage: lastMessageMap.get(s.chatId) || null
        };
      });

      res.send(result);
    } catch (err) {
      console.error('[GET /admin/chats] Error:', err.message);
      next(err);
    }
  });

  // Delete all data related to a chatId (chat, session, messages-in-session)
  router.delete('/chats/:chatId', async (req, res, next) => {
    try {
      const { chatId } = req.params;
      if (!chatId) {
        return res.status(400).send({ error: 'chatId required' });
      }

      logger.info({ chatId }, '[DELETE /admin/chats/:chatId] Erasing user data');

      // Delete Session (which also holds message history in data.messages)
      await prisma.session.deleteMany({ where: { chatId } });

      // Delete Chat row itself
      await prisma.chat.deleteMany({ where: { chatId } });

      // Note: broadcast logs are kept for system reporting; if full erasure
      // is required, an additional deleteMany on BroadcastLog by chatId
      // could be added here.

      res.send({ ok: true });
    } catch (err) {
      logger.error({ err: err.message }, '[DELETE /admin/chats/:chatId] Error');
      next(err);
    }
  });

  // Get full message history for any chat (BOT/HUMAN)
  router.get('/chats/:chatId/messages', async (req, res, next) => {
    try {
      const chatId = req.params.chatId;
      if (!chatId) {
        return res.status(400).send({ error: 'chatId required' });
      }

      const messages = await getChatMessages(chatId);
      res.send(messages);
    } catch (err) {
      console.error('[GET /admin/chats/:chatId/messages] Error:', err.message);
      next(err);
    }
  });

  // Get persisted per-chat recap (top questions rollup).
  router.get('/chats/:chatId/recap', async (req, res, next) => {
    try {
      const chatId = req.params.chatId;
      if (!chatId) {
        return res.status(400).send({ error: 'chatId required' });
      }

      const topRaw = (req.query.top || '').toString().trim();
      const top = Math.min(Math.max(parseInt(topRaw || '10', 10) || 10, 1), 50);

      const session = await prisma.session.findUnique({ where: { chatId } }).catch(() => null);
      const data = session && session.data ? session.data : {};
      const questionCounts = (data && typeof data === 'object' && data.questionCounts && typeof data.questionCounts === 'object')
        ? data.questionCounts
        : {};

      const entries = Object.entries(questionCounts || {})
        .map(([question, count]) => ({
          question,
          count: Number(count || 0)
        }))
        .filter((x) => x.question && Number.isFinite(x.count) && x.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, top);

      res.send({ chatId, top: entries });
    } catch (err) {
      console.error('[GET /admin/chats/:chatId/recap] Error:', err.message);
      next(err);
    }
  });

  // Get full message history for a chat
  router.get('/live-chats/:chatId/messages', async (req, res, next) => {
    try {
      const chatId = req.params.chatId;
      if (!chatId) {
        return res.status(400).send({ error: 'chatId required' });
      }

      const messages = await getChatMessages(chatId);
      res.send(messages);
    } catch (err) {
      console.error('[GET /admin/live-chats/:chatId/messages] Error:', err.message);
      next(err);
    }
  });

  // Manual trigger: start handover for a chat
  router.post('/live-chats/:chatId/handover', async (req, res, next) => {
    try {
      const chatId = req.params.chatId;
      if (!chatId) {
        return res.status(400).send({ error: 'chatId required' });
      }

      const now = new Date();
      const chat = await prisma.chat.upsert({
        where: { chatId },
        create: { chatId, status: 'HUMAN', lastSeenAt: now },
        update: { status: 'HUMAN', lastSeenAt: now }
      });

      await appendChatMessage(chatId, 'system', 'Handover dimulai oleh admin.');

      res.send({ ok: true, chat });
    } catch (err) {
      console.error('[POST /admin/live-chats/:chatId/handover] Error:', err.message);
      next(err);
    }
  });

  // Manual end handover: back to BOT mode
  router.post('/live-chats/:chatId/end-handover', async (req, res, next) => {
    try {
      const chatId = req.params.chatId;
      if (!chatId) {
        return res.status(400).send({ error: 'chatId required' });
      }

      let chat;
      try {
        chat = await prisma.chat.update({
          where: { chatId },
          data: { status: 'BOT' }
        });
      } catch (err) {
        if (err.code === 'P2025') {
          return res.status(404).send({ error: 'Chat tidak ditemukan' });
        }
        throw err;
      }

      await appendChatMessage(chatId, 'system', 'Handover diakhiri oleh admin.');

      res.send({ ok: true, chat });
    } catch (err) {
      console.error('[POST /admin/live-chats/:chatId/end-handover] Error:', err.message);
      next(err);
    }
  });

  // Agent reply to user via WhatsApp
  router.post('/live-chats/:chatId/reply', async (req, res, next) => {
    try {
      const chatId = req.params.chatId;
      const { message } = req.body || {};

      if (!chatId) {
        return res.status(400).send({ error: 'chatId required' });
      }
      if (!message || !message.trim()) {
        return res.status(400).send({ error: 'message required' });
      }

      const text = message.trim();
      const now = new Date();

      // Pastikan chat tercatat dan status di-set ke HUMAN
      await prisma.chat.upsert({
        where: { chatId },
        create: { chatId, status: 'HUMAN', lastSeenAt: now },
        update: { status: 'HUMAN', lastSeenAt: now }
      });

      if (!provider || typeof provider.sendMessage !== 'function') {
        console.error('[POST /admin/live-chats/:chatId/reply] Provider not available');
        return res.status(500).send({ error: 'Provider not available to send message' });
      }

      await provider.sendMessage(chatId, text);
      await appendChatMessage(chatId, 'agent', text);

      res.send({ ok: true });
    } catch (err) {
      console.error('[POST /admin/live-chats/:chatId/reply] Error:', err.message);
      next(err);
    }
  });

  // === ANALYTICS ENDPOINTS ===

// Get retention rate
router.get('/analytics/retention', async (req, res, next) => {
  try {
    const retention = await AnalyticsEngine.getRetentionRate();
    res.send(retention);
  } catch (err) {
    console.error('[GET /admin/analytics/retention] Error:', err.message);
    next(err);
  }
});

// Get cohort analysis
router.get('/analytics/cohort', async (req, res, next) => {
  try {
    const cohort = await AnalyticsEngine.getCohortAnalysis();
    res.send(cohort);
  } catch (err) {
    console.error('[GET /admin/analytics/cohort] Error:', err.message);
    next(err);
  }
});

// Get engagement summary
router.get('/analytics/engagement', async (req, res, next) => {
  try {
    const summary = await AnalyticsEngine.getEngagementSummary();
    res.send(summary);
  } catch (err) {
    console.error('[GET /admin/analytics/engagement] Error:', err.message);
    next(err);
  }
});

// Get handover rate
router.get('/analytics/handover', async (req, res, next) => {
  try {
    const handover = await AnalyticsEngine.getHandoverRate();
    res.send(handover);
  } catch (err) {
    console.error('[GET /admin/analytics/handover] Error:', err.message);
    next(err);
  }
});

// Get popular topics
router.get('/analytics/topics', async (req, res, next) => {
  try {
    const topics = await AnalyticsEngine.getPopularTopics();
    res.send(topics);
  } catch (err) {
    console.error('[GET /admin/analytics/topics] Error:', err.message);
    next(err);
  }
});

// Get active heatmap
router.get('/analytics/heatmap', async (req, res, next) => {
  try {
    const heatmap = await AnalyticsEngine.getActiveHeatmap();
    res.send(heatmap);
  } catch (err) {
    console.error('[GET /admin/analytics/heatmap] Error:', err.message);
    next(err);
  }
});

// Get global frequently asked questions recap
router.get('/analytics/questions-recap', async (req, res, next) => {
  try {
    const topRaw = (req.query.top || req.query.limit || '').toString().trim();
    const sessionsRaw = (req.query.sessions || req.query.sessionLimit || '').toString().trim();

    const top = Math.min(Math.max(parseInt(topRaw || '12', 10) || 12, 1), 50);
    const limitSessions = Math.min(Math.max(parseInt(sessionsRaw || '5000', 10) || 5000, 1), 20000);

    const recap = await AnalyticsEngine.getGlobalQuestionRecap({ top, limitSessions });

    const role = req.user && req.user.role ? String(req.user.role) : '';
    if (!isAdminRole(role)) {
      const divisionKey = roleToDivisionKey(role);

      if (!divisionKey) {
        return res.send({
          ...recap,
          top: [],
          byDivision: {}
        });
      }

      const byDivision = (recap && recap.byDivision && typeof recap.byDivision === 'object') ? recap.byDivision : {};
      const onlyDivision = Object.prototype.hasOwnProperty.call(byDivision, divisionKey)
        ? { [divisionKey]: byDivision[divisionKey] }
        : {};

      const onlyTop = onlyDivision[divisionKey] && Array.isArray(onlyDivision[divisionKey].top)
        ? onlyDivision[divisionKey].top
        : [];

      return res.send({
        ...recap,
        top: onlyTop,
        byDivision: onlyDivision
      });
    }

    return res.send(recap);
  } catch (err) {
    console.error('[GET /admin/analytics/questions-recap] Error:', err.message);
    next(err);
  }
});

// Export analytics as CSV
router.get('/analytics/export/csv', async (req, res, next) => {
  try {
    const csv = await AnalyticsEngine.exportToCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="analytics-report.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[GET /admin/analytics/export/csv] Error:', err.message);
    next(err);
  }
});

// ============ WHATSAPP BUSINESS API CONFIG ============

/**
 * GET /admin/whatsapp/config
 * Retrieve current WhatsApp configuration (without sensitive data)
 */
router.get('/whatsapp/config', async (req, res, next) => {
  try {
    console.log('[GET /admin/whatsapp/config] Mengambil konfigurasi WhatsApp...');

    const isWatiMode = (process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase().includes('wati') ||
      String(process.env.WHATSAPP_PROVIDER || '').toLowerCase() === 'wati';
    const isFonnteMode = (process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase().includes('fonnte.com') ||
      String(process.env.WHATSAPP_PROVIDER || '').toLowerCase() === 'fonnte';
    
    const config = {
      provider: process.env.WHATSAPP_PROVIDER || 'mock',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ? '***' + process.env.WHATSAPP_PHONE_NUMBER_ID.slice(-6) : '',
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ? '***' + process.env.WHATSAPP_BUSINESS_ACCOUNT_ID.slice(-6) : '',
      webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
      webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || '',
      isConfigured: isWatiMode || isFonnteMode
        ? Boolean(process.env.WHATSAPP_API_KEY)
        : Boolean(process.env.WHATSAPP_API_KEY && process.env.WHATSAPP_PHONE_NUMBER_ID),
      isWatiMode,
      isFonnteMode
    };

    res.send(config);
  } catch (err) {
    console.error('[GET /admin/whatsapp/config] Error:', err.message);
    next(err);
  }
});

/**
 * GET /admin/whatsapp/webhook-diagnostics
 * Lightweight diagnostics to confirm whether inbound WATI webhook is hitting this server.
 * Values are stored as Setting rows (no secrets are stored).
 */
router.get('/whatsapp/webhook-diagnostics', async (req, res, next) => {
  try {
    const keys = [
      'wati_last_webhook_accepted_at',
      'wati_last_webhook_rejected_at',
      'wati_last_webhook_rejected_meta',
      'wati_last_webhook_ignored_at',
      'wati_last_webhook_ignored_reason',
      'wati_last_webhook_payload_shape',
      'wati_last_webhook_extracted',
      'wati_last_webhook_forwarded_at',
      'wati_last_webhook_forward_result'
    ];

    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } }).catch(() => []);
    const map = {};
    for (const r of rows) map[r.key] = r.value;

    res.send({
      keys,
      values: map
    });
  } catch (err) {
    console.error('[GET /admin/whatsapp/webhook-diagnostics] Error:', err.message);
    next(err);
  }
});

/**
 * POST /admin/whatsapp/config
 * Update WhatsApp configuration (update .env simulation - dalam production gunakan config management service)
 */
router.post('/whatsapp/config', async (req, res, next) => {
  try {
    console.log('[POST /admin/whatsapp/config] Updating WhatsApp config...');

    const { apiKey, phoneNumberId, businessAccountId, webhookVerifyToken, provider } = req.body;

    // Validasi
    if (provider === 'business' && (!apiKey || !phoneNumberId)) {
      return res.status(400).send({ 
        error: 'API Key dan Phone Number ID wajib untuk Business provider' 
      });
    }

    if ((provider === 'wati' || provider === 'fonnte') && !apiKey) {
      return res.status(400).send({
        error: 'API Key wajib untuk WATI/Fonnte provider'
      });
    }

    // Dalam production, simpan ke secure config service (AWS Secrets Manager, Vault, dll)
    // Untuk development, update process.env sementara
    if (apiKey) process.env.WHATSAPP_API_KEY = apiKey;
    if (phoneNumberId) process.env.WHATSAPP_PHONE_NUMBER_ID = phoneNumberId;
    if (businessAccountId) process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = businessAccountId;
    if (webhookVerifyToken) process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = webhookVerifyToken;
    if (provider) process.env.WHATSAPP_PROVIDER = provider;

    // Simpan ke database sebagai settings
    await prisma.setting.upsert({
      where: { key: 'whatsapp_provider' },
      create: { key: 'whatsapp_provider', value: provider || 'mock' },
      update: { value: provider || 'mock' }
    });

    console.log('[POST /admin/whatsapp/config] ✓ Configuration updated');
    
    res.send({ 
      success: true, 
      message: 'WhatsApp configuration updated (perlu restart server untuk apply)',
      config: {
        provider: process.env.WHATSAPP_PROVIDER,
        phoneNumberId: '***' + (phoneNumberId || '').slice(-6),
        isConfigured: provider === 'business' ? !!(apiKey && phoneNumberId) : !!apiKey
      }
    });
  } catch (err) {
    console.error('[POST /admin/whatsapp/config] Error:', err.message);
    next(err);
  }
});

/**
 * POST /admin/whatsapp/health
 * Test WhatsApp Business API connection
 */
router.post('/whatsapp/health', async (req, res, next) => {
  try {
    console.log('[POST /admin/whatsapp/health] Testing WhatsApp connection...');

    if (!['business', 'wati', 'fonnte'].includes(String(process.env.WHATSAPP_PROVIDER || '').toLowerCase())) {
      return res.send({ 
        healthy: false, 
        error: 'WhatsApp Business API tidak diaktifkan. Provider saat ini: ' + process.env.WHATSAPP_PROVIDER 
      });
    }

    // Cek credentials tersedia
    if (!process.env.WHATSAPP_API_KEY || (process.env.WHATSAPP_PROVIDER === 'business' && !process.env.WHATSAPP_PHONE_NUMBER_ID)) {
      return res.send({ 
        healthy: false, 
        error: 'WhatsApp credentials belum dikonfigurasi lengkap' 
      });
    }

    // Test dengan memanggil WhatsApp API
    // Import provider untuk test
    const { WhatsAppBusinessProvider } = require('../providers/whatsappBusinessProvider');
    const testProvider = new WhatsAppBusinessProvider(
      process.env.WHATSAPP_API_KEY,
      process.env.WHATSAPP_PHONE_NUMBER_ID,
      process.env.WHATSAPP_BUSINESS_ACCOUNT_ID
    );

    const healthCheck = await testProvider.healthCheck();
    
    if (healthCheck.healthy) {
      console.log('[POST /admin/whatsapp/health] ✓ Connection successful');
      res.send(healthCheck);
    } else {
      console.error('[POST /admin/whatsapp/health] ✗ Connection failed:', healthCheck.error);
      res.status(400).send(healthCheck);
    }
  } catch (err) {
    console.error('[POST /admin/whatsapp/health] Error:', err.message);
    res.status(400).send({ 
      healthy: false, 
      error: err.message 
    });
  }
});

/**
 * GET /admin/whatsapp/webhook-setup
 * Dapatkan instruksi setup webhook
 */
router.get('/whatsapp/webhook-setup', async (req, res, next) => {
  try {
    const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL || 'https://your-domain.com/webhook';
    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'your_verify_token_here';

    const isWatiMode = (process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase().includes('wati') ||
      String(process.env.WHATSAPP_PROVIDER || '').toLowerCase() === 'wati';

    // Best-effort suggestion for the correct callback URL.
    // - Meta Cloud API expects `/webhook`
    // - WATI should point to `/wati/webhook` (we also accept `/webhook` for compatibility)
    let suggestedWebhookUrl = webhookUrl;
    try {
      const u = new URL(webhookUrl);
      // Normalize path before appending
      const basePath = String(u.pathname || '/').replace(/\/+$/, '');
      const base = basePath.replace(/\/(wati\/webhook|webhook)$/i, '');
      u.pathname = isWatiMode ? `${base}/wati/webhook` : `${base}/webhook`;

      // WATI often doesn't support a separate token/secret field.
      // In production, if verifyToken is configured and token requirement is not explicitly disabled,
      // include the token in the URL query so requests can be authenticated.
      const watiRequireTokenRaw = String(process.env.WATI_WEBHOOK_REQUIRE_TOKEN || '').toLowerCase().trim();
      const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
      const hasVerifyToken = Boolean(String(verifyToken || '').trim());
      const requireWatiToken =
        watiRequireTokenRaw === 'true' ? true :
        watiRequireTokenRaw === 'false' ? false :
        (isProduction && hasVerifyToken);
      if (isWatiMode && requireWatiToken && hasVerifyToken) {
        if (!u.searchParams.has('token') && !u.searchParams.has('verify_token')) {
          u.searchParams.set('token', verifyToken);
        }
      }

      suggestedWebhookUrl = u.toString();
    } catch (e) {
      // keep as-is if invalid URL
    }

    res.send({
      instructions: {
        step1: isWatiMode
          ? 'Login ke WATI Dashboard dan buka pengaturan Webhook'
          : 'Login ke Facebook Developers (https://developers.facebook.com)',
        step2: isWatiMode
          ? 'Atur webhook untuk event pesan masuk (incoming messages)'
          : 'Buka WhatsApp Business App > Settings > Webhooks',
        step3: `Atur URL callback: ${suggestedWebhookUrl}`,
        step4: `Atur Verify Token/Token: ${verifyToken}`,
        step5: isWatiMode
          ? 'Pastikan event inbound message aktif (nama event tergantung WATI)'
          : 'Subscribe ke events: messages, message_status',
        step6: 'Save konfigurasi'
      },
      currentConfig: {
        webhookUrl,
        suggestedWebhookUrl,
        verifyToken,
        environment: process.env.NODE_ENV || 'development',
        note: isWatiMode
          ? 'Mode WATI terdeteksi. Gunakan /wati/webhook. Jika server mewajibkan token (umumnya production), dan WATI tidak punya field token/secret, tambahkan ?token=<verifyToken> di URL. Server juga menerima /webhook sebagai alias. Untuk development, gunakan ngrok untuk expose server lokal.'
          : 'Untuk development, gunakan ngrok: https://ngrok.com untuk expose server lokal'
      }
    });
  } catch (err) {
    console.error('[GET /admin/whatsapp/webhook-setup] Error:', err.message);
    next(err);
  }
});

// ============ WHATSAPP TESTING ============

/**
 * GET /admin/test/sample-messages
 * Dapatkan sample messages untuk testing
 */
router.get('/test/sample-messages', async (req, res, next) => {
  try {
    console.log('[GET /admin/test/sample-messages] Retrieving sample messages...');
    
    const samples = [
      { chatId: '628123456789', text: 'halo', label: 'Test Keyword Match' },
      { chatId: '628987654321', text: 'Halo admin saya punya pertanyaan', label: 'Test Welcome + Fallback' },
      { chatId: '628111111111', text: 'admin', label: 'Test Exact Match Trigger Handover' },
      { chatId: '628222222222', text: 'saya ingin komplain', label: 'Test Handover Trigger' },
      { chatId: '628333333333', text: 'info produk', label: 'Test Menu/FSM' },
      { chatId: '628444444444', text: 'random question untuk AI', label: 'Test AI Reply (if enabled)' }
    ];

    res.send(samples);
  } catch (err) {
    console.error('[GET /admin/test/sample-messages] Error:', err.message);
    next(err);
  }
});

/**
 * POST /admin/test/simulate-message
 * Simulate incoming WhatsApp message untuk testing bot flow
 * 
 * Body: { chatId, text, contact? }
 * Response: { ok, botReply, processingFlow }
 */
router.post('/test/simulate-message', async (req, res, next) => {
  try {
    const { chatId, text, contact } = req.body;
    
    console.log(`[POST /admin/test/simulate-message] Simulating message from ${chatId}: "${text}"`);

    // Validasi input
    if (!chatId || !text) {
      return res.status(400).send({ error: 'chatId dan text required' });
    }
    const now = new Date();

    // Helper untuk menggabungkan welcome_message dengan reply utama
    const combineReplies = (welcomeMsg, mainMsg) => {
      const w = (welcomeMsg || '').trim();
      const m = (mainMsg || '').trim();
      if (w && m) return `${w}\n\n${m}`;
      if (w) return w;
      return m;
    };

    // Ambil data chat SEBELUM di-update untuk simulasi welcome
    const existingChat = await prisma.chat.findUnique({ where: { chatId } });

    let flow = [];
    let botReply = null;
    let handoverTriggered = false;
    let welcomeToSend = null;

    // === STEP 1: Check Welcome Message ===
    flow.push({ step: 1, action: 'check_welcome', status: 'running' });
    const welcomeSetting = await prisma.setting.findUnique({ where: { key: 'welcome_message' } });
    
    if (welcomeSetting) {
      const thresholdHours = parseInt(process.env.WELCOME_THRESHOLD_HOURS || '24', 10);
      let needWelcome = false;
      let hoursSinceLastSeen = null;
      let isFirstChat = false;

      if (!existingChat) {
        // First-time chat
        needWelcome = true;
        isFirstChat = true;
      } else {
        hoursSinceLastSeen = (now - new Date(existingChat.lastSeenAt)) / (1000 * 60 * 60);
        needWelcome = hoursSinceLastSeen > thresholdHours;
      }

      flow[0].result = {
        needWelcome,
        isFirstChat,
        hoursSinceLastSeen: hoursSinceLastSeen !== null ? hoursSinceLastSeen.toFixed(2) : null,
        welcomeMessage: welcomeSetting.value
      };

      if (needWelcome) {
        flow[0].note = 'Welcome message would be sent';
        welcomeToSend = welcomeSetting.value;
      }
    } else {
      flow[0].result = {
        needWelcome: false,
        isFirstChat: !existingChat,
        hoursSinceLastSeen: null,
        welcomeMessage: null
      };
    }
    flow[0].status = 'completed';

    // Simulasikan update lastSeenAt seperti di webhook provider
    const chat = await prisma.chat.upsert({
      where: { chatId },
      create: { chatId, lastSeenAt: now },
      update: { lastSeenAt: now }
    });

    // === STEP 2: Check Handover Status ===
    flow.push({ step: 2, action: 'check_handover', status: 'running' });
    
    flow[1].result = { currentStatus: chat.status };
    if (chat.status === 'HUMAN') {
      flow[1].note = 'Chat in human handover mode - no auto-reply';
      flow[1].status = 'completed';
      botReply = 'Chat dalam mode human handover. Pesan akan diteruskan ke agent.';
      botReply = combineReplies(welcomeToSend, botReply);
      return res.send({ ok: true, botReply, processingFlow: flow, handover: true });
    }
    flow[1].status = 'completed';

    // === STEP 3: Try FSM (Menu Flow) ===
    flow.push({ step: 3, action: 'try_fsm', status: 'running' });
    const { handleFSM } = require('../engine/fsm');
    const fsmReply = await handleFSM(chatId, text);
    
    flow[2].result = { fsmMatched: !!fsmReply };
    if (fsmReply) {
      flow[2].note = 'FSM menu matched';
      flow[2].status = 'completed';
      botReply = fsmReply;
      botReply = combineReplies(welcomeToSend, botReply);
      return res.send({ ok: true, botReply, processingFlow: flow, source: 'fsm' });
    }
    flow[2].status = 'completed';

    // === STEP 4: Detect Handover Keywords ===
    // Keep this independent from keyword rules so simulate flow matches production behavior.
    flow.push({ step: 4, action: 'detect_handover', status: 'running' });
    if (/\b(admin|cs|complain|komplain)\b/i.test(text)) {
      await prisma.chat.update({ where: { chatId }, data: { status: 'HUMAN' } });
      flow[3].result = { triggered: true };
      flow[3].note = 'Handover keyword detected';
      flow[3].status = 'completed';
      botReply = 'Anda akan disambungkan ke agent manusia.';
      botReply = combineReplies(welcomeToSend, botReply);
      return res.send({ ok: true, botReply, processingFlow: flow, source: 'handover', handover: true });
    }
    flow[3].result = { triggered: false };
    flow[3].status = 'completed';

    // === STEP 5: Try Rule-Based Reply ===
    flow.push({ step: 5, action: 'try_keywords', status: 'running' });
    const { findReplyByRules } = require('../engine/replyEngine');
    const reply = await findReplyByRules(text);
    
    flow[4].result = { keywordMatched: !!reply, reply: reply?.substring(0, 50) };
    if (reply) {
      flow[4].note = 'Keyword rule matched';
      flow[4].status = 'completed';
      botReply = reply;
      
      botReply = combineReplies(welcomeToSend, botReply);
      return res.send({ ok: true, botReply, processingFlow: flow, source: 'keywords', handover: false });
    }
    flow[4].status = 'completed';

    // === STEP 6: Try RAG Reply ===
    flow.push({ step: 6, action: 'try_rag', status: 'running' });
    if (process.env.ENABLE_RAG === 'true') {
      const trainingCount = await prisma.trainingData.count();
      if (trainingCount > 0) {
        const { query: ragQuery } = require('../engine/ragEngine');
        const topK = parseInt(process.env.RAG_TOP_K || '3', 10);
        const ragResult = await ragQuery(text, topK);
        flow[5].result = { ragEnabled: true, ragReplied: ragResult.success && !!ragResult.answer };
        if (ragResult.success && ragResult.answer) {
          flow[5].note = 'RAG engine replied';
          flow[5].status = 'completed';
          botReply = ragResult.answer;
          botReply = combineReplies(welcomeToSend, botReply);
          return res.send({ ok: true, botReply, processingFlow: flow, source: 'rag' });
        }
      } else {
        flow[5].result = { ragEnabled: true, ragReplied: false, reason: 'no_training_data' };
      }
    } else {
      flow[5].result = { ragEnabled: false };
      flow[5].note = 'RAG disabled';
    }
    flow[5].status = 'completed';

    // === STEP 7: Try AI Reply ===
    flow.push({ step: 7, action: 'try_ai', status: 'running' });
    if (process.env.ENABLE_AI === 'true') {
      const { AIReplyEngine, MockAIReplyEngine } = require('../engine/aiEngine');
      let aiEngine = null;
      
      if (process.env.AI_PROVIDER === 'openai') {
        aiEngine = new AIReplyEngine(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL);
      } else {
        aiEngine = new MockAIReplyEngine();
      }
      
      const trainingData = await prisma.setting.findUnique({ where: { key: 'training_data' } });
      const aiResult = await aiEngine.getReply(text, trainingData?.value || '');
      
      flow[5].result = { aiEnabled: true, aiReplied: aiResult.success && !!aiResult.reply };
      
      if (aiResult.success && aiResult.reply) {
        flow[5].note = 'AI engine replied';
        flow[5].status = 'completed';
        botReply = aiResult.reply;
        botReply = combineReplies(welcomeToSend, botReply);
        return res.send({ ok: true, botReply, processingFlow: flow, source: 'ai' });
      }
    } else {
      flow[5].result = { aiEnabled: false };
      flow[5].note = 'AI engine disabled';
    }
    flow[5].status = 'completed';

    // === STEP 7: Fallback Reply ===
    flow.push({ step: 7, action: 'fallback', status: 'running' });
    const fallback = await prisma.setting.findUnique({ where: { key: 'fallback_message' } });
    
    flow[6].result = { fallbackUsed: true, fallbackMessage: fallback?.value };
    flow[6].status = 'completed';
    botReply = fallback?.value || 'Maaf, saya tidak mengerti. Coba tanya hal lain.';

    botReply = combineReplies(welcomeToSend, botReply);

    res.send({ 
      ok: true, 
      botReply, 
      processingFlow: flow,
      source: 'fallback'
    });

  } catch (err) {
    console.error('[POST /admin/test/simulate-message] Exception:', err.message);
    next(err);
  }
});

/**
 * GET /admin/test/status
 * Check bot status & configuration
 */
router.get('/test/status', async (req, res, next) => {
  try {
    console.log('[GET /admin/test/status] Checking bot status...');
    
    const keywordCount = await prisma.keywordReply.count();
    const menuitems = await prisma.menuItem.count();
    const broadcastCount = await prisma.broadcast.count();
    const trainingCount = await prisma.trainingData.count();
    const chatCount = await prisma.chat.count();

    // Check provider status
    const providerStatus = process.env.WHATSAPP_PROVIDER;
    const isBusinessConfigured = !!(process.env.WHATSAPP_API_KEY && process.env.WHATSAPP_PHONE_NUMBER_ID);

    // Check AI status
    const aiEnabled = process.env.ENABLE_AI === 'true';
    const aiProvider = process.env.AI_PROVIDER || 'mock';

    res.send({
      status: 'online',
      timestamp: new Date().toISOString(),
      database: {
        keywords: keywordCount,
        menuItems: menuitems,
        broadcasts: broadcastCount,
        trainingData: trainingCount,
        chats: chatCount
      },
      provider: {
        type: providerStatus,
        businessConfigured: isBusinessConfigured,
        environment: process.env.NODE_ENV || 'development'
      },
      config: {
        dotenvConfigPath: process.env.DOTENV_CONFIG_PATH || null,
        botTone: process.env.BOT_TONE || null,
        botFriendlyTone: process.env.BOT_FRIENDLY_TONE || null,
        botAutoTone: process.env.BOT_AUTO_TONE || null,
        botFriendlyOpening: process.env.BOT_FRIENDLY_OPENING || null,
        botFriendlyClosing: process.env.BOT_FRIENDLY_CLOSING || null
      },
      ai: {
        enabled: aiEnabled,
        provider: aiProvider
      },
      features: {
        welcome: !!await prisma.setting.findUnique({ where: { key: 'welcome_message' } }),
        fallback: !!await prisma.setting.findUnique({ where: { key: 'fallback_message' } }),
        training: trainingCount > 0
      }
    });
  } catch (err) {
    console.error('[GET /admin/test/status] Error:', err.message);
    next(err);
  }
});
  // Admin documentation endpoint (serves README_ADMIN.md)
  router.get('/docs', async (req, res, next) => {
    try {
      const fs = require('fs').promises;
      const mdPath = path.join(__dirname, '..', '..', 'README_ADMIN.md');
      const md = await fs.readFile(mdPath, 'utf8');
      res.setHeader('Content-Type', 'text/markdown');
      res.send(md);
    } catch (err) {
      console.error('[GET /admin/docs] Error reading docs:', err.message);
      next(err);
    }
  });

  return router;
};

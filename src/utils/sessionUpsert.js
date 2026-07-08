async function safeSessionUpsert(prisma, arg1, arg2, arg3) {
  let chatId = null;
  let newData = null;
  let state = null;

  if (arg1 && typeof arg1 === 'object' && arg1.where) {
    chatId = arg1.where && arg1.where.chatId ? String(arg1.where.chatId) : '';
    state = (arg1.update && arg1.update.state) || (arg1.create && arg1.create.state) || 'root';
    newData = (arg1.update && arg1.update.data) || (arg1.create && arg1.create.data) || {};
  } else {
    chatId = String(arg1 || '');
    newData = arg2 || {};
    state = arg3 || 'root';
  }

  console.log('[safeSessionUpsert] called', {
    chatId,
    arg1Type: typeof arg1,
    arg2Type: typeof arg2,
    arg3Type: typeof arg3,
    state: state || 'root'
  });
  const existing = await prisma.session.findUnique({ where: { chatId } });
  const existingData = (existing && existing.data) ? existing.data : {};
  const merged = { ...existingData, ...(newData || {}) };
  const s = state || (existing && existing.state) || 'root';
  const sessionUpsertDebug = String(process.env.SESSION_UPSERT_DEBUG || '').toLowerCase() === 'true' || process.env.NODE_ENV === 'test';
  if (sessionUpsertDebug) {
    console.log('[SESSION UPSERT]', {
      chatId,
      state: s,
      dataKeys: Object.keys(merged || {}).slice(0, 30),
      arg1Type: typeof arg1,
      arg2Type: typeof arg2,
      arg3Type: typeof arg3,
      existingState: existing && existing.state ? existing.state : null,
      existingDataKeys: existingData ? Object.keys(existingData).slice(0, 30) : null
    });
  }
  try {
    return await prisma.session.upsert({ where: { chatId }, create: { chatId, state: s, data: merged }, update: { state: s, data: merged } });
  } catch (err) {
    console.error('[SESSION UPSERT ERROR]', {
      chatId,
      state: s,
      error: err && err.message ? String(err.message) : String(err),
      stack: err && err.stack ? String(err.stack) : undefined
    });
    throw err;
  }
}

module.exports = { safeSessionUpsert };

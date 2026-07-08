#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');

(async function main(){
  const prisma = new PrismaClient();
  try {
    const argv = process.argv.slice(2);
    const apply = argv.includes('--apply');
    const limitFlag = argv.find(a => a.startsWith('--limit='));
    const limit = limitFlag ? parseInt(limitFlag.split('=')[1], 10) : 1000;

    const keys = [
      'pendingFollowupChoice','pendingProgramSelection','pendingMenuCost','pendingFeeBreakdownOffer',
      'pendingProgramInfoMenu','pendingFeeDetail','pendingScholarshipChoice','pendingTotalCost',
      'pendingScheduleWave','nonMarketingMenuActive','lastProgramHint'
    ];

    console.log('Scanning up to', limit, 'sessions for ephemeral pending keys...');
    const rows = await prisma.session.findMany({ take: limit, select: { chatId: true, data: true, state: true, updatedAt: true } });

    const targets = [];
    for (const s of rows) {
      const d = s && s.data ? s.data : {};
      const found = keys.filter(k => Object.prototype.hasOwnProperty.call(d, k));
      if (found.length) targets.push({ chatId: s.chatId, state: s.state || 'root', updatedAt: s.updatedAt, keys: found });
    }

    console.log('FOUND', targets.length, 'sessions with ephemeral keys.');
    if (targets.length === 0) {
      await prisma.$disconnect();
      process.exit(0);
    }

    console.log(JSON.stringify(targets.slice(0,200), null, 2));

    if (!apply) {
      console.log('\nDry-run only. To actually clear these flags, re-run with --apply');
      await prisma.$disconnect();
      process.exit(0);
    }

    console.log('\nApplying cleanup to found sessions...');
    let done = 0;
    for (const t of targets) {
      try {
        const s = await prisma.session.findUnique({ where: { chatId: t.chatId } });
        const prevData = (s && s.data) ? s.data : {};
        const newData = { ...prevData };
        for (const k of keys) {
          if (Object.prototype.hasOwnProperty.call(newData, k)) delete newData[k];
        }
        const state = s && s.state ? s.state : (t.state || 'root');
        await prisma.session.upsert({ where: { chatId: t.chatId }, create: { chatId: t.chatId, state, data: newData }, update: { state, data: newData } });
        done += 1;
        console.log('Cleared', t.chatId, 'removedKeys=', t.keys.join(','));
      } catch (e) {
        console.error('Failed to clear', t.chatId, e && e.message ? e.message : e);
      }
    }

    console.log('\nDone. Cleared', done, 'sessions.');
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error', err && err.message ? err.message : err);
    try { await prisma.$disconnect(); } catch(e){}
    process.exit(1);
  }
})();

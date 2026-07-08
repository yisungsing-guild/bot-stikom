/*
Usage:
  node scripts/clear_session_pending_flags.js --chatId CHAT_ID [--dry-run]

This script removes common ephemeral/pending keys from a session's `data`
object to un-stick context (e.g. pending menu selections, lastProgramHint).
*/

const dotenv = require('dotenv');
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    ((String(process.env.NODE_ENV || '').toLowerCase() === 'production') ? '.env.production' : '.env')
});

const prisma = require('../src/db');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

function usageAndExit() {
  console.log('Usage: node scripts/clear_session_pending_flags.js --chatId CHAT_ID [--dry-run]');
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv);
  const chatId = args.chatId || process.env.CHAT_ID;
  const dryRun = !!args['dry-run'];

  if (!chatId) usageAndExit();

  const session = await prisma.session.findUnique({ where: { chatId } });
  if (!session) {
    console.error('Session not found for chatId:', chatId);
    process.exit(1);
  }

  const data = (session && session.data) ? { ...session.data } : {};
  const keysToRemove = [
    'pendingFeeBreakdownOffer',
    'pendingProgramSelection',
    'pendingFeeDetail',
    'pendingRegistrationCostOffer',
    'pendingMenuCost',
    'pendingPmbMenu',
    'pendingFollowupChoice',
    'pendingScholarshipChoice',
    'pendingAdmissionApplicantType',
    'pendingProgramInfoMenu',
    'pendingTotalCost',
    'pendingScheduleWave',
    'pendingWaveClarification',
    'pendingNonMarketingDeptContact',
    'nonMarketingMenuActive',
    'nonMarketingMenuShownAt',
    'lastProgramHint',
    'handoverOffered',
    'handoverAccepted'
  ];

  const before = JSON.stringify(data, null, 2);

  let removedAny = false;
  for (const k of keysToRemove) {
    if (Object.prototype.hasOwnProperty.call(data, k)) {
      removedAny = true;
      delete data[k];
    }
  }

  console.log('Session chatId:', chatId);
  console.log('Before (truncated 400 chars):', before.slice(0, 400));
  console.log('Removed keys:', keysToRemove.filter(k => !Object.prototype.hasOwnProperty.call(session.data || {}, k) ? false : true));

  if (!removedAny) {
    console.log('No configured pending keys present; nothing to update.');
    process.exit(0);
  }

  if (dryRun) {
    console.log('Dry-run: not applying changes.');
    process.exit(0);
  }

  const updated = await prisma.session.update({
    where: { chatId },
    data: { data },
    select: { chatId: true, data: true, updatedAt: true }
  });

  console.log('Updated session. New data (truncated 400 chars):', JSON.stringify(updated.data || {}, null, 2).slice(0, 400));
}

main()
  .catch((e) => {
    console.error('ERROR', e && e.message ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await prisma.$disconnect(); } catch (e) { /* ignore */ }
  });

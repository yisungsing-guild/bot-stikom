#!/usr/bin/env node
/**
 * Automated setup untuk bot + ngrok + webhook
 * Jalankan script ini dan ikuti instruksi
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function checkNgrokInstalled() {
  try {
    execSync('ngrok --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('\n' + '╔' + '═'.repeat(58) + '╗');
  console.log('║  FONNTE BOT - AUTOMATED SETUP                         ║');
  console.log('║  (Opens terminals automatically)                      ║');
  console.log('╚' + '═'.repeat(58) + '╝\n');

  // Check ngrok
  console.log('🔍 Checking ngrok installation...\n');
  const hasNgrok = await checkNgrokInstalled();
  
  if (!hasNgrok) {
    console.log('❌ ngrok not found!\n');
    console.log('Download from: https://ngrok.com/download\n');
    console.log('Then add to PATH and try again.\n');
    process.exit(1);
  }

  console.log('✓ ngrok found\n');

  console.log('═'.repeat(60));
  console.log('\n📋 SETUP INSTRUCTIONS:\n');
  console.log('This script will open terminals for:\n');
  console.log('1. ngrok (creates internet tunnel)');
  console.log('2. Bot server (npm run dev)');
  console.log('3. Webhook URL display\n');

  console.log('⏭️  NEXT STEPS:\n');
  console.log('1. Terminals akan terbuka otomatis');
  console.log('2. Biarkan running (jangan close!)');
  console.log('3. Buka file SETUP_COMPLETE_FONNTE.md untuk instruksi lengkap');
  console.log('4. Go to Fonnte dashboard dan configure webhook URL\n');

  // PowerShell untuk buka terminals di Windows
  if (process.platform === 'win32') {
    console.log('🚀 Starting terminals...\n');
    
    try {
      // Terminal 1: ngrok
      execSync(
        `Start-Process PowerShell -ArgumentList "-NoExit -Command 'cd "${process.cwd()}" && ngrok http 4000'"`,
        { stdio: 'inherit', shell: 'powershell.exe' }
      );
      console.log('✓ ngrok terminal opened\n');

      // Wait 2 seconds
      await new Promise(r => setTimeout(r, 2000));

      // Terminal 2: Bot server
      execSync(
        `Start-Process PowerShell -ArgumentList "-NoExit -Command 'cd "${process.cwd()}" && npm run dev'"`,
        { stdio: 'inherit', shell: 'powershell.exe' }
      );
      console.log('✓ Bot server terminal opened\n');

      // Wait 3 seconds for server to start
      await new Promise(r => setTimeout(r, 3000));

      // Terminal 3: Check URL
      execSync(
        `Start-Process PowerShell -ArgumentList "-NoExit -Command 'cd "${process.cwd()}" && node check-webhook-url.js'"`,
        { stdio: 'inherit', shell: 'powershell.exe' }
      );
      console.log('✓ Webhook URL check terminal opened\n');

    } catch (e) {
      console.error('❌ Error opening terminals:', e.message);
      console.log('\nManual setup instead:');
      console.log('1. Open Terminal and run: ngrok http 4000');
      console.log('2. Open Terminal and run: npm run dev');
      console.log('3. Open Terminal and run: node check-webhook-url.js');
    }
  } else {
    // Linux/Mac
    console.log('On Linux/Mac, run these in separate terminals:\n');
    console.log('Terminal 1:');
    console.log('  ngrok http 4000\n');
    console.log('Terminal 2:');
    console.log('  npm run dev\n');
    console.log('Terminal 3:');
    console.log('  node check-webhook-url.js\n');
  }

  console.log('═'.repeat(60));
  console.log('\n📖 Documentation:\n');
  console.log('Open file: SETUP_COMPLETE_FONNTE.md\n');
  console.log('For detailed configuration instructions.\n');
}

main().catch(console.error);

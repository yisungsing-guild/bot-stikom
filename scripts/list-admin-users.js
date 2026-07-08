#!/usr/bin/env node
// List admin users helper (useful for PowerShell where -e quoting is flaky)
const { PrismaClient } = require('@prisma/client');

(async function main(){
  const prisma = new PrismaClient();
  try{
    const users = await prisma.adminUser.findMany();
    if(!users || users.length===0){
      console.log('No admin users found');
      return;
    }
    console.log('Admin users:', users.map(u=>({id:u.id,username:u.username,role:u.role,displayName:u.displayName,createdAt:u.createdAt})));
  }catch(e){
    console.error('Failed to query adminUser:', e && e.message ? e.message : e);
    process.exitCode = 2;
  }finally{
    await prisma.$disconnect();
  }
})();

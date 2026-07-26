const express = require('express');
const request = require('supertest');
process.env.ENABLE_RAG='true';
process.env.SEMANTIC_RAG_FIRST='true';
process.env.FORCE_BUNDLED_INDEX='true';
process.env.PROVIDER_WEBHOOK_TOKEN='';
process.env.OPENAI_API_KEY='';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS='0';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS='false';
process.env.BOT_NATURAL_ANSWER_FRAME='true';
process.env.SEMANTIC_RAG_TODAY_YMD='2026-07-26';
function mockSend(){ const calls=[]; const fn=async (chatId,msg,opt)=>{calls.push([chatId,msg,opt]);}; fn.mock={calls}; fn.mockClear=()=>{calls.length=0}; return fn; }
(async()=>{
 const sessionStore=new Map(); const chatStore=new Map(); const prisma=require('../src/db');
 prisma.chat={findUnique:async()=>null,upsert:async({where})=>({chatId:where.chatId,status:'BOT'})}; prisma.keywordReply={findMany:async()=>[]}; prisma.setting={findUnique:async()=>null}; prisma.trainingData={count:async()=>0,findFirst:async()=>null,findMany:async()=>[]}; prisma.menuItem={findFirst:async()=>null,findMany:async()=>[]};
 prisma.session={findUnique:async({where})=>sessionStore.get(String(where.chatId))||null,upsert:async({where,create,update})=>{const id=String(where.chatId); const ex=sessionStore.get(id)||{...(create||{chatId:id,state:'root',data:{}})}; const next={...ex,...(update||{})}; sessionStore.set(id,next); return next;}};
 const chatLog=require('../src/engine/chatLog'); chatLog.appendChatMessage=async(chatId,direction,message)=>{const id=String(chatId); const entry={direction,message:String(message||'')}; const arr=chatStore.get(id)||[]; arr.push(entry); chatStore.set(id,arr); const ex=sessionStore.get(id)||{chatId:id,state:'root',data:{}}; const data=ex.data&&typeof ex.data==='object'?ex.data:{}; const messages=Array.isArray(data.messages)?data.messages.slice(-20):[]; messages.push(entry); sessionStore.set(id,{...ex,data:{...data,messages}});}; chatLog.getChatMessages=async(chatId)=>chatStore.get(String(chatId))||[];
 const provider={sendMessage:mockSend(),sendImage:async()=>{}}; const app=express(); app.use(express.json()); app.use('/provider',require('../src/routes/provider')(provider));
 const qs=['Apakah masih menerima mahasiswa baru?','Apa itu UKM KSL?','Kegiatan UKM KSL apa saja?','Apa isi dokumen Profil UKM KSL?','JCOS bergerak di bidang apa?'];
 const out=[]; for(const q of qs){provider.sendMessage.mockClear(); const res=await request(app).post('/provider/webhook').send({chatId:'verify-ukm-schedule',text:q}); const bot=provider.sendMessage.mock.calls.map(c=>String(c[1]||'')).join('\n---\n')||'[NO MESSAGE SENT]'; out.push({user:q,bot,source:res.body&&res.body.source});}
 for(const r of out){console.log('user:'); console.log(r.user); console.log('bot:'); console.log(r.bot.replace(/\r/g,'').trim()); console.log('source:',r.source); console.log('---');}
})().catch(e=>{console.error(e);process.exit(1)});

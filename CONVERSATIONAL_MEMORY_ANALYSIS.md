# Conversational Memory & Context Retention System Analysis

## Overview
This system maintains multi-turn conversation context through a multi-layered approach combining database session storage, FSM state management, and RAG-aware context building. Context flows between turns via **Session**, **ChatLog**, and **Topic Resolver** layers.

---

## 1. SESSION DATA FLOW ARCHITECTURE

### 1.1 Session Loading in Webhook Handler
**File:** [src/routes/provider.js](src/routes/provider.js#L6500-L6510)

```javascript
// Line 6500: Load session AFTER appending chat log (session data is fresh)
const session = await withTimeout(
  prisma.session.findUnique({ where: { chatId } }),
  PROVIDER_DB_TIMEOUT_MS,
  'Session lookup timed out'
);

// Extract session data object
let sessionData = (session && session.data) ? session.data : {};
```

**Key Points:**
- Session lookup happens **after** chat message is appended (via `appendChatMessage`)
- `sessionData` is extracted from `session.data` field in database
- If no session exists, defaults to empty object `{}`
- This ensures Session.data.messages reflects the current inbound message

### 1.2 Session Data Structure
Session stores:
```javascript
{
  chatId,
  state,                           // FSM state (e.g., 'root', 'root.1.2')
  data: {
    messages: [...],              // Chat history
    lastProgramHint,              // Last program mentioned (for context reuse)
    pendingFeeDetail,             // Pending context from follow-up flows
    pendingFeeBreakdownOffer,     // Menu state
    pendingTotalCost,             // Awaiting user selection
    pendingScheduleWave,          // Registration wave selection
    handoverOffered,              // Human handover state
    introSent,                    // Welcome message tracking
    questionCounts,               // Question rollup stats
    questionLastAt,               // Last question timing
    // ... other ephemeral flags
  }
}
```

### 1.3 Session Persistence
**File:** [src/engine/fsm.js](src/engine/fsm.js#L100-120)

```javascript
async function upsertSession(chatId, state, data) {
  // IMPORTANT: don't overwrite Session.data unless caller provides it
  const hasData = data !== undefined;

  const createPayload = hasData ? { chatId, state, data } : { chatId, state };
  const updatePayload = hasData ? { state, data } : { state };

  await safeSessionUpsert(prisma, {
    where: { chatId },
    create: createPayload,
    update: updatePayload
  });
}
```

**Key Points:**
- Session updated via **upsert** (create or update atomically)
- Only overwrites data if explicitly provided (protects data integrity)
- FSM state is updated whenever navigation occurs

---

## 2. CHAT MESSAGE HISTORY RETRIEVAL

### 2.1 Chat Message Storage
**File:** [src/engine/chatLog.js](src/engine/chatLog.js#L1-50)

```javascript
async function appendChatMessage(chatId, direction, message) {
  // direction: 'user' | 'bot' | 'agent' | 'system'
  
  const session = await prisma.session.findUnique({ where: { chatId } });
  const prevData = (session && session.data) ? session.data : {};
  const prevMessages = Array.isArray(prevData.messages) ? prevData.messages : [];

  const newMessagesAll = [
    ...prevMessages,
    {
      direction: direction || 'system',
      message: message || '',
      at: now
    }
  ];

  // Keep only last N messages (configurable via CHAT_LOG_MAX_MESSAGES)
  const maxMessages = getMaxMessages();
  const newMessages = (Number.isFinite(maxMessages) && maxMessages > 0)
    ? newMessagesAll.slice(-maxMessages)
    : newMessagesAll;

  // Save back to Session.data.messages
  await prisma.session.update({
    where: { chatId },
    data: { data: newData }
  });
}
```

### 2.2 Message History Retrieval
**File:** [src/engine/chatLog.js](src/engine/chatLog.js#L200-250)

```javascript
async function getChatMessages(chatId) {
  // Fetch from both database and in-memory cache
  const messages = [];
  
  // 1. In-memory cache (process-local, survives DB failures)
  const inMem = inMemoryMessagesByChat.get(chatId);
  if (inMem && Array.isArray(inMem)) {
    messages.push(...inMem);
  }
  
  // 2. Fetch from database as primary source
  const session = await prisma.session.findUnique({ where: { chatId } });
  const dbMessages = (session && session.data && Array.isArray(session.data.messages))
    ? session.data.messages
    : [];
  
  // Merge and deduplicate
  return [...messages, ...dbMessages];
}
```

**Key Points:**
- Dual-layer retrieval: in-memory cache + database
- In-memory cache ensures follow-ups work even if DB fails
- Default max messages: **60** (configurable via `CHAT_LOG_MAX_MESSAGES`)
- Oldest messages are culled to manage Session.data size

### 2.3 Last Bot Message Retrieval
**File:** [src/routes/provider.js](src/routes/provider.js#L3791-L3820)

```javascript
function getLastBotMessageFromSessionData(sessionData) {
  const messages = sessionData && Array.isArray(sessionData.messages) 
    ? sessionData.messages : [];
  
  // Iterate backwards to find last bot message
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.direction === 'bot' && String(m.message || '').trim()) {
      return String(m.message || '').trim();
    }
  }
  return '';
}
```

Used to:
- Detect whether last bot message asked a follow-up question
- Prevent duplicate "processing" messages
- Extract menu context for follow-up handling

---

## 3. CONTEXTUAL RAG QUERY BUILDING

### 3.1 Building Multi-Turn Context
**File:** [src/routes/provider.js](src/routes/provider.js#L5870-L5930)

```javascript
async function buildContextualRagQuery(chatId, currentText) {
  try {
    const messages = await getChatMessages(chatId);
    if (!Array.isArray(messages) || messages.length < 2) return null;

    // Find last bot message
    let lastBotIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.direction === 'bot' && String(messages[i]?.message || '').trim()) {
        lastBotIndex = i;
        break;
      }
    }
    const lastBot = lastBotIndex >= 0 ? String(messages[lastBotIndex].message || '').trim() : '';

    // Find last meaningful user question (skip greetings/affirmations)
    let lastUser = '';
    const searchEnd = lastBotIndex >= 0 ? lastBotIndex : messages.length;
    for (let i = searchEnd - 1; i >= 0; i--) {
      if (messages[i]?.direction !== 'user') continue;
      const msg = String(messages[i]?.message || '').trim();
      if (!msg) continue;
      if (/^\d+$/.test(msg)) continue;                    // Skip menu selections
      if (isSimpleGreeting(msg)) continue;                // Skip greetings
      if (isShortAffirmation(msg) || isShortNegation(msg)) continue;  // Skip yes/no
      if (msg.length >= 10) {
        lastUser = msg;
        break;
      }
    }

    // Build composite query with context markers
    const parts = [];
    if (lastUser) 
      parts.push(`Pertanyaan sebelumnya dari user: "${lastUser}"`);
    if (lastBot) 
      parts.push(`Balasan terakhir dari bot: "${lastBot}"`);
    parts.push(`Balasan user saat ini: "${String(currentText || '').trim()}"`);
    parts.push('Tolong jawab lanjutan secara spesifik berdasarkan konteks di atas.');

    const combined = parts.join('\n');
    return combined.length > 1500 ? combined.slice(0, 1500) : combined;
  } catch (e) {
    logger.warn({ err: e.message }, '[Provider] Failed to build contextual RAG query');
    return null;
  }
}
```

### 3.2 RAG Context Parameters
**File:** [src/routes/provider.js](src/routes/provider.js#L695-720)

```javascript
// Build RAG query options with conversation context
const merged = {
  ...opts,
  conversationContext: buildContextualRagQuery(chatId, text),  // Multi-turn context
  divisionKey: divisionKey || null,
  includeGlobal: opts.includeGlobal === undefined ? true : !!opts.includeGlobal
};

// Pass to RAG engine
const ragResult = await ragQuery(effectiveQuestion, topK, merged);
```

**Context Parameters Passed to RAG:**
- `opts.conversationContext` - Previous question/answer pairs formatted as prompt context
- `opts.lastProgramHint` - Program mentioned in current/recent turns
- `opts.pendingTotalCost` - Pending cost context from menu flow
- `opts.divisionKey` - Inferred topic/division (TI, SI, BD, SK)

---

## 4. PROGRAM TOPIC MANAGEMENT

### 4.1 Program Hint Persistence
**File:** [src/routes/provider.js](src/routes/provider.js#L6620-L6670)

```javascript
// If user explicitly mentioned a program in this inbound message
try {
  const explicitProgramHint = extractSpecificProgramHint(text);
  if (explicitProgramHint) {
    console.log('[DEBUG] persistProgramHint early', chatId, explicitProgramHint);
    
    // Update in-memory sessionData immediately so later upserts merge the hint
    if (!sessionData) sessionData = {};
    if (String(sessionData.lastProgramHint || '') !== String(explicitProgramHint)) {
      sessionData.lastProgramHint = explicitProgramHint;
    }
    
    // Persist to database
    const currentState = session ? session.state : 'root';
    const newData = { ...prev };  // preserves lastProgramHint
    await prisma.session.upsert({
      where: { chatId },
      create: { chatId, state: currentState, data: newData },
      update: { state: currentState, data: newData }
    });
  }
} catch (e) {
  logger.warn({ err: e.message }, '[Provider] Failed to persist lastProgramHint (early)');
}
```

### 4.2 Program Hint Fallback for Short Follow-ups
**File:** [src/routes/provider.js](src/routes/provider.js#L700-710)

```javascript
// If program not explicit in current question, try session hint
if (!programHintDet && sessionData && sessionData.lastProgramHint) {
  programHintDet = sessionData.lastProgramHint;
  console.log('[DEBUG] Using lastProgramHint fallback', { chatId, programHintDet });
}

// If still no program, try previous bot message
if (!programHintDet) {
  const lastBot = (typeof getLastBotMessageFromSessionData === 'function')
    ? getLastBotMessageFromSessionData(sessionData)
    : null;
  if (lastBot) {
    const parsed = (typeof parseGelombang === 'function')
      ? parseGelombang(lastBot)
      : null;
    if (parsed) programHintDet = parsed;
  }
}
```

**Flow:**
1. Try to extract program from current message
2. Fallback to `sessionData.lastProgramHint` if not found
3. Fallback to parsing last bot message if hint missing

---

## 5. CONVERSATION TOPIC RESOLUTION

### 5.1 Topic Lifecycle Management
**File:** [src/engine/conversationTopicResolver.js](src/engine/conversationTopicResolver.js#L80-150)

```javascript
class ConversationTopicResolver {
  resolveConversationTopic(session, message, opts = {}) {
    // Step 1: Check for hard reset command (e.g., "menu", "start", "0")
    const resetRequested = this.isHardResetCommand(message);
    if (resetRequested) {
      return { activeTopic: null, resetRequested: true, source: 'reset' };
    }

    // Step 2: Check for explicit program mention in current message
    const explicitTopic = this.extractExplicitTopic(message);
    if (explicitTopic) {
      return { activeTopic: explicitTopic, isExplicit: true, source: 'explicit' };
    }

    // Step 3: Lightweight greeting preserves topic
    if (this.isLightweightGreeting(message)) {
      const sessionTopic = this.getSessionTopic(session);
      const isFresh = this.checkTopicFreshness(session);
      if (!isFresh) {
        return { activeTopic: sessionTopic, isStale: true, source: 'stale' };
      }
      return { activeTopic: sessionTopic, isReused: !!sessionTopic, source: 'greeting_preserve' };
    }

    // Step 4: Check for semantic follow-up (short contextual question)
    const isFollowup = this.isContextualFollowup(message, session);
    if (isFollowup) {
      const sessionTopic = this.getSessionTopic(session);
      if (sessionTopic) {
        const isFresh = this.checkTopicFreshness(session);
        if (!isFresh) {
          return { activeTopic: null, isStale: true, source: 'stale' };
        }
        return { activeTopic: sessionTopic, isReused: true, source: 'reused' };
      }
    }

    // Step 5: No reuse candidate
    return { activeTopic: null, source: 'none' };
  }

  isLightweightGreeting(message) {
    const t = String(message || '').trim().toLowerCase();
    const lightGreetings = /^(ok|oke|oky|yok|sip|siap|baik|ya|iya|yes|thanks|makasi|lanjut|tanya)$/i;
    return lightGreetings.test(t);
  }

  isContextualFollowup(message, session) {
    const t = String(message || '').trim();
    const words = t.split(/\s+/).filter(Boolean);
    const isShort = t.length <= 60 || words.length <= 3;
    const hasNoExplicitProgram = !this.extractExplicitTopic(t);
    const notNumeric = !/^\d+$/.test(t);
    const notAdminMsg = !/\b(admin|cs|komplain)\b/i.test(t);
    
    return isShort && hasNoExplicitProgram && notNumeric && notAdminMsg;
  }
}
```

**Resolution Priority:**
1. **Hard Reset** (user wants menu) → Clear topic
2. **Explicit Topic** (user mentions program) → Use explicit
3. **Lightweight Greeting** (ok/siap/lanjut) → Preserve cached topic
4. **Contextual Follow-up** (short question, no program mentioned) → Reuse cached topic
5. **New Query** → No topic carryover

### 5.2 Staleness Check
```javascript
checkTopicFreshness(session) {
  if (!session || !session.data) return false;
  
  const lastTopicAt = session.data.lastTopicAt;
  if (!lastTopicAt) return false;
  
  const lastTime = new Date(lastTopicAt).getTime();
  const nowTime = Date.now();
  const staleMinutes = this.programHintStaleMinutes || 120;  // Default 2 hours
  
  return (nowTime - lastTime) <= (staleMinutes * 60 * 1000);
}
```

---

## 6. EPHEMERAL STATE MANAGEMENT

### 6.1 Pending Flags
**File:** [src/routes/provider.js](src/routes/provider.js#L60-100)

```javascript
function clearEphemeralSessionFlagsInPlace(sessionData, opts) {
  const sd = (sessionData && typeof sessionData === 'object') ? sessionData : null;
  if (!sd) return sd;

  const keys = [
    // Follow-up / pending states (cleared when not followed up)
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
    // Menu-ish sticky states
    'nonMarketingMenuActive',
    'nonMarketingMenuShownAt'
  ];

  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(sd, k)) delete sd[k];
  }

  if (opts.resetRegistrationFlow) {
    delete sd.registrationFlow;
  }

  if (opts.resetProgramHints) {
    delete sd.lastProgramHint;
  }

  return sd;
}
```

### 6.2 Auto-Clear Ephemeral Flags Logic
**File:** [src/routes/provider.js](src/routes/provider.js#L6515-L6580)

```javascript
// Auto-clear ephemeral pending flags when message is NOT a follow-up
const hasEphemeral = ephemeralKeys.some(k => sessionData && Object.prototype.hasOwnProperty.call(sessionData, k));

if (hasEphemeral) {
  const lastBot = getLastBotMessageFromSessionData(sessionData);
  const askedFollowup = lastBotLikelyAskedForFollowup(lastBot);
  const isFollowup = isLikelyFollowupQuestion(text) && askedFollowup;
  const explicitProgramInText = extractSpecificProgramHint(text) || null;
  const numericSelection = getNumericMenuSelection(text);

  // Preserve ephemeral flags for expected follow-up shapes
  const keepEphemeralBecauseFollowupShape =
    (hasPendingProgramSelection && looksLikeProgramPick) ||
    (hasPendingScheduleWave && (looksLikeScheduleWavePick || looksLikeBareWavePick)) ||
    (hasPendingTotalCost && (parseGelombang(text) || looksLikeBareWavePick)) ||
    (hasPendingFeeDetail && looksLikeFeeChoicePick);

  // Clear if not a follow-up shape
  if (!isFollowup && !explicitProgramInText && !numericSelection && !keepEphemeralBecauseFollowupShape) {
    try {
      const currentState = session ? session.state : 'root';
      const clearedData = { ...(sessionData || {}) };
      for (const k of ephemeralKeys) delete clearedData[k];
      await prisma.session.upsert({
        where: { chatId },
        create: { chatId, state: currentState, data: clearedData },
        update: { state: currentState, data: clearedData }
      });
      sessionData = clearedData;
    } catch (e) {
      logger.warn({ err: e.message }, '[Provider] Failed to clear ephemeral pending flags');
    }
  }
}
```

---

## 7. FSM STATE MANAGEMENT

### 7.1 Menu Navigation State
**File:** [src/engine/fsm.js](src/engine/fsm.js#L10-80)

```javascript
async function handleFSM(chatId, text) {
  const session = await prisma.session.findUnique({ where: { chatId } });
  let state = session ? session.state : 'root';

  // Menu reset commands
  const wantMenu = /^(menu|menu\s+utama|help|bantuan|start)$/i.test(trimmed);
  if (wantMenu) {
    await upsertSession(chatId, 'root');
    state = 'root';
    // Return menu items
    return menuItemsText;
  }

  // Numeric selection: form key like 'root.1' or 'root.1.2'
  if (/^\d+$/.test(trimmed)) {
    const key = `${state}.${trimmed}`;
    const menu = await prisma.menuItem.findFirst({ where: { key } });
    if (menu) {
      // Update state to new menu location
      await upsertSession(chatId, key);
      
      // Return menu text + optional followup prompt
      let reply = menu.text || '';
      if (menu.followupPrompt) {
        reply = reply.trim() + '\n\n' + String(menu.followupPrompt).trim();
      }
      return reply;
    }
  }

  return null;  // No FSM match, let other engines handle
}
```

**State Hierarchy:**
- `root` - Main menu
- `root.1` - Submenu 1
- `root.1.2` - Sub-submenu
- etc.

---

## 8. CONTEXT RETENTION LIFECYCLE (COMPLETE FLOW)

### Turn 1: Initial Question
```
1. User: "Berapa biaya SI?"
   ↓
2. appendChatMessage(chatId, 'user', 'Berapa biaya SI?')
   - Chat history: [{ direction: 'user', message: 'Berapa biaya SI?', at: now }]
   ↓
3. Load session.data (empty)
4. extractSpecificProgramHint('Berapa biaya SI?') → 'SI'
5. persistProgramHint → sessionData.lastProgramHint = 'SI'
6. RAG query with conversationContext = null (no prior messages)
7. Response: "Biaya SI: ..."
8. appendChatMessage(chatId, 'bot', 'Biaya SI: ...')
   - Chat history: [user, bot]
9. Save sessionData with lastProgramHint = 'SI'
```

### Turn 2: Short Follow-up
```
1. User: "Berapa DPP nya?"
   ↓
2. appendChatMessage(chatId, 'user', 'Berapa DPP nya?')
   - Chat history: [user1, bot1, user2_DPP]
   ↓
3. Load session.data
   - lastProgramHint = 'SI' ✓
   - sessionData.messages has 3 entries
   ↓
4. extractSpecificProgramHint('Berapa DPP nya?') → null (no program mentioned)
5. buildContextualRagQuery(chatId, 'Berapa DPP nya?')
   - lastUser = 'Berapa biaya SI?'
   - lastBot = 'Biaya SI: ...'
   - Returns: "Pertanyaan sebelumnya: Berapa biaya SI?\nBalasan terakhir: Biaya SI: ...\nTanya user: Berapa DPP nya?"
   ↓
6. RAG query with:
   - conversationContext = [above composite query]
   - lastProgramHint = 'SI' (from sessionData.lastProgramHint)
   ↓
7. Response scoped to SI based on context
8. Save response to chat history
```

### Turn 3: Program Switch
```
1. User: "Gimana biaya TI?"
   ↓
2. appendChatMessage(chatId, 'user', 'Gimana biaya TI?')
   ↓
3. extractSpecificProgramHint('Gimana biaya TI?') → 'TI'
4. persistProgramHint → sessionData.lastProgramHint = 'TI' (override SI)
5. buildContextualRagQuery detects new program context
6. RAG query scoped to TI
7. Response for TI fees
```

---

## 9. KEY FUNCTIONS SUMMARY

| Function | Location | Purpose |
|----------|----------|---------|
| `appendChatMessage()` | `src/engine/chatLog.js` | Store user/bot message in Session.data.messages + in-memory cache |
| `getChatMessages()` | `src/engine/chatLog.js` | Retrieve all messages for chatId (DB + in-memory) |
| `getLastBotMessageFromSessionData()` | `src/routes/provider.js#L3791` | Extract last bot response from session history |
| `buildContextualRagQuery()` | `src/routes/provider.js#L5870` | Build multi-turn context for RAG (prior question/answer) |
| `upsertSession()` | `src/engine/fsm.js#L100` | Create/update session with state and data |
| `handleFSM()` | `src/engine/fsm.js#L20` | Process menu navigation state transitions |
| `ConversationTopicResolver.resolveConversationTopic()` | `src/engine/conversationTopicResolver.js#L80` | Determine active topic (program) based on message type |
| `clearEphemeralSessionFlagsInPlace()` | `src/routes/provider.js#L60` | Clear pending menu states when message is not a follow-up |
| `extractSpecificProgramHint()` | `src/routes/provider.js` | Parse program mention from text (SI/TI/BD/SK) |
| `normalizeScheduleWaveKey()` | `src/engine/ragEngine.js` | Parse wave selection (I, II, III, IV, Khusus) |

---

## 10. PERSISTENCE GUARANTEES

| Layer | Durability | Fallback |
|-------|-----------|----------|
| **Database (Prisma Session)** | Persistent across restarts | Primary source of truth |
| **In-Memory Cache** | Process-local, survives DB errors | Temporary during request |
| **Chat History** | Last 60 messages (configurable) | Old messages culled |
| **Program Hint** | Cached up to 120 min (staleness check) | Falls back to message parsing |
| **Menu State (FSM)** | Saved in session.state | Explicit navigation only |
| **Ephemeral Flags** | Auto-cleared on non-follow-up | Prevents sticky states |

---

## 11. CONTEXT SCOPE DIAGRAM

```
Turn N:
  User Input
    ↓
  ┌─────────────────────────────────────┐
  │ 1. Append to chat history           │
  │    (sessionData.messages)           │
  │    + in-memory cache                │
  └─────────────────────────────────────┘
    ↓
  ┌─────────────────────────────────────┐
  │ 2. Load session (FSM state + data)  │
  │    - Get lastProgramHint            │
  │    - Get pending ephemeral flags    │
  │    - Get chat messages (60 max)     │
  └─────────────────────────────────────┘
    ↓
  ┌─────────────────────────────────────┐
  │ 3. Resolve topic/context            │
  │    - Extract explicit program       │
  │    - Check for greeting/follow-up   │
  │    - Check staleness (120 min)      │
  └─────────────────────────────────────┘
    ↓
  ┌─────────────────────────────────────┐
  │ 4. Build RAG context                │
  │    - Last user question             │
  │    - Last bot answer                │
  │    - Current user message           │
  │    - Program hint (SI/TI/BD/SK)     │
  │    - Pending context (fee/wave)     │
  └─────────────────────────────────────┘
    ↓
  ┌─────────────────────────────────────┐
  │ 5. Query RAG with context           │
  │    opts.conversationContext         │
  │    opts.lastProgramHint             │
  │    opts.divisionKey                 │
  └─────────────────────────────────────┘
    ↓
  Bot Response → Append to history → Update session → Return to user
```

---

## 12. CONFIGURATION & TUNING

| Env Var | Default | Purpose |
|---------|---------|---------|
| `CHAT_LOG_MAX_MESSAGES` | 60 | Max messages per chat |
| `CHAT_LOG_MAX_QUESTION_KEYS` | 200 | Max unique questions tracked |
| `CHAT_LOG_INMEM_MAX_CHATS` | 5000 | Max chats in memory |
| `RAG_HOBY_LINE_MIN_COVERAGE` | 0.18 | Token overlap threshold for hobby matching |
| `RAG_HOBY_LINE_MIN_MARGIN` | 0.08 | Score margin between top 2 hobby matches |
| `RAG_STALE_CHUNK_DAYS` | 365 | Age threshold for stale chunks |
| `BOT_REPLY_TIMEOUT_MS` | 3000 | Timeout before sending "processing" message |
| `PROVIDER_DB_LOOKUP_TIMEOUT_MS` | 1500 | Database lookup timeout |

---

## 13. CONTEXT CAVEATS & LIMITATIONS

1. **Chat History Culling**: Only last 60 messages retained (can cause context loss in very long conversations)
2. **Program Hint Staleness**: After 120 minutes, program hint becomes "stale" and won't auto-reuse
3. **Single-Turn RAG Context**: Contextual prompt includes only immediate prior exchange (not full history)
4. **Ephemeral State Clearing**: Menu pending states auto-clear if message doesn't match expected follow-up shape
5. **FSM State Persistence**: Only explicit numeric/menu navigation updates FSM state; other messages don't change state
6. **In-Memory Cache Loss**: Process restart loses in-memory message cache (fallback to DB)

---

## 14. DEBUGGING CONTEXT FLOWS

**Enable Debug Logging:**
```bash
RAG_DEBUG_LOGS=true      # RAG selection debug
DEBUG_BOT_REPLY_STEPS=1  # Bot reply flow debug
DEBUG_CONTEXT=1          # Context building debug
```

**Key Debug Outputs:**
- `[Provider] RAG selection debug` - RAG context, detected intent, selected chunks
- `[DEBUG] inbound_pendingFeeDetail` - Session data state at inbound
- `[buildContextualRagQuery]` - Composite query construction
- `[ConversationTopicResolver]` - Topic resolution lifecycle


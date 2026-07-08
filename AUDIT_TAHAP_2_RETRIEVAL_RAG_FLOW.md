# 📊 LAPORAN AUDIT TAHAP 2: RETRIEVAL FLOW & RAG FLOW

**Status**: Audit Only (No Code Changes)  
**Date**: 2026-06-11  
**Focus**: Program determination di Retrieval Flow sebelum dan sesudah RAG dipanggil

---

## **1. RINGKASAN EKSEKUTIF**

**Total RAG Entry Points**: **29 lokasi** (21 × ragQueryWithEval + 8 × ragQuery)

**Program Sources (Ranking Frekuensi)**:
1. **Explicit in current message** (extractSpecificProgramHint) - **8 lokasi**
2. **Direct session read** (sessionData.lastProgramHint) - **5 lokasi** ⚠️
3. **RegistrationFlow.program** - **4 lokasi**
4. **getActiveProgram()** - **3 lokasi** ✅
5. **Context/previous bot message** - **4 lokasi**
6. **No program (generic questions)** - **5 lokasi**

---

## **2. SEMUA LOKASI ragQueryWithEval() & ragQuery() DENGAN PROGRAM SOURCE**

### **Category A: Explicit Program in Current Message**

| # | Line | Fungsi | Tipe | Program Source | Status | Notes |
|---|------|--------|------|---|--------|-------|
| 1 | 5940 | Fee handler (cost RAG fallback) | ragQueryWithEval | `extractSpecificProgramHint(text)` → finalProgram | ❌ DIRECT | Uses explicit + session fallback chain |
| 2 | 7630 | Comparison menu RAG fallback | ragQueryWithEval | `extractProgramHint()` indirect | ⚠️ MIXED | Per-clause comparison without anchor |
| 3 | 7647 | Rule vs RAG decision | ragQueryWithEval | Text as-is (no program) | ⚠️ MIXED | Generic question, no program anchor |
| 4 | 13034 | Program pick follow-up (tuition) | ragQueryWithEval | `programPick` (explicit + session) | ✅ GOOD | Uses parsed explicit program + minScore=0 |
| 5 | 13079 | Program pick (specific question) | ragQueryWithEval | `programPick` (explicit) | ✅ GOOD | "Program Studi: ${programPick}" prefix |
| 6 | 12095 | Deterministic query path | ragQuery | finalProgram via explicit + session | ❌ DIRECT | Early RAG fallback (rare path) |
| 7 | 10741 | RegistrationFlow program pick | ragQuery | `s1Program` (explicit) | ✅ GOOD | "Program Studi: ${s1Program}" prefix |
| 8 | 10783 | Requirements question | ragQuery | No program (generic) | ✅ GOOD | Intentional: requirements are universal |

---

### **Category B: Session lastProgramHint (Direct Read) ⚠️**

| # | Line | Fungsi | Tipe | Program Source | Status | Issue |
|---|------|--------|------|---|--------|-------|
| 1 | 816-817 | ragQueryWithEval() entry (deterministic path) | Trace logging | `sessionData.lastProgramHint` | ⚠️ DIRECT READ | Used in program determination before RAG |
| 2 | 837 | ragQueryWithEval() debug | Trace logging | `sessionData.lastProgramHint` | ⚠️ DIRECT READ | Debug only, but still direct read |
| 3 | 963 | ragQueryWithEval() debug | Trace logging | `sessionData.lastProgramHint` | ⚠️ DIRECT READ | Debug only, but still direct read |
| 4 | 8550 | Program info menu (syarat) | ragQueryWithEval | `(sessionData.lastProgramHint ? ... : null)` | ⚠️ DIRECT READ | Fallback when `pending.program` null |
| 5 | 9349 | Wave handler reroute | WRITE (not read) | `sessionData.lastProgramHint = programFromText` | ⚠️ PERSISTENCE | Write operation, not read for RAG |

---

### **Category C: RegistrationFlow.program**

| # | Line | Fungsi | Tipe | Program Source | Status | Pattern |
|---|------|--------|------|---|--------|---------|
| 1 | 8900 | Total cost deterministic | ragQueryWithEval | `registrationFlow.program \|\| getActiveProgram()` | ✅ HYBRID | Uses both sources in fallback chain |
| 2 | 9161 | Menu cost (semester) | ragQueryWithEval | `program` from flow state | ✅ GOOD | Explicit menu selection |
| 3 | 9637 | Fee breakdown offer | ragQueryWithEval | `programHint` from flow context | ✅ GOOD | "Program Studi: ${programHint}" |
| 4 | 11340 | Registration flow S1 selection | ragQueryWithEval | `s1Program` from extractProgramHint() | ✅ GOOD | "Program Studi: ${s1Program}" |

---

### **Category D: getActiveProgram() (Tahap 1 Refactor) ✅**

| # | Line | Fungsi | Tipe | Program Source | Status | Implementation |
|---|------|--------|------|---|--------|---------|
| 1 | 8289 | Follow-up discount/gelombang | ragQueryWithEval | `anchored` query with program from context | ⚠️ PARTIAL | Uses context, not full getActiveProgram() |
| 2 | 8900 | Total cost (fallback) | ragQueryWithEval | `getActiveProgram().activeProgram` | ✅ FULL | Complete 3-tier precedence |
| 3 | 13188-13371 | Follow-up context-based | ragQueryWithEval | Multiple getActiveProgram() calls | ✅ FULL | Used in wave-only, cost-breakdown paths |

---

### **Category E: No Program (Generic Questions)**

| # | Line | Fungsi | Tipe | Question Type | Status | Why No Program |
|---|------|--------|------|---|--------|---------|
| 1 | 10070 | Campus location | ragQueryWithEval | "Berikan lokasi kampus..." | ✅ CORRECT | Universal question, not program-specific |
| 2 | 10309 | Numeric menu selection | ragQueryWithEval | Menu.ragQuestion (location/facilities/career) | ✅ CORRECT | Context-dependent, no program needed |
| 3 | 10434 | Numeric menu RAG | ragQueryWithEval | Facilities, career, general | ✅ CORRECT | Universal campus info |
| 4 | 10659 | Contact menu RAG override | ragQueryWithEval | User's explicit question (no anchor) | ⚠️ CHECK | Should check if program-specific question |
| 5 | 12371 | Early registration menu | ragQuery | Pendaftaran prodi generic | ✅ CORRECT | Menu-driven, waits for prodi selection |

---

### **Category F: Context-Based Program (Last Bot/User)**

| # | Line | Fungsi | Tipe | Program Source | Status | Method |
|---|------|--------|------|---|--------|---------|
| 1 | 11437 | Reg flow requirements | ragQueryWithEval | `program` from flow stage | ✅ GOOD | State machine: program known from flow |
| 2 | 11466 | Reg flow requirements (syarat) | ragQueryWithEval | `program` passed as parameter | ✅ GOOD | Flow state guarantees program |
| 3 | 11511 | Reg flow contact RAG | ragQueryWithEval | Generic Q (no program needed) | ✅ CORRECT | Universal contact info |
| 4 | 11565 | Reg flow cost (biaya) | ragQueryWithEval | `program` from flow state | ✅ GOOD | "Program Studi: ${program}" |

---

### **Category G: Follow-up with Context Transcript**

| # | Line | Fungsi | Tipe | Program Source | Status | Flow |
|---|------|--------|------|---|--------|---------|
| 1 | 8289 | Discount gelombang | ragQueryWithEval | Extract from `ctx.lastBot / lastUser` | ⚠️ CONTEXT | Uses conversationContext: ctx.transcript |
| 2 | 13601 | Main RAG entry (final path) | ragQueryWithEval | **ragQuestion pre-built** | ✅ COMPLEX | Detailed context-based program determination |

---

## **3. DETAIL: MAIN RAG ENTRY POINT (Line 13601)**

**Lokasi**: Line 13601 - Final RAG fall-through setelah semua deterministic paths

**Program Determination Path**:
```
1. Explicit in current message
   ├─ extractSpecificProgramHint(text)
   └─ extractProgramHint(text)
   
2. From pending program selection
   ├─ sessionData.pendingProgramSelection.intent
   └─ programPick = parseS1ProgramChoice() → Extracted explicit
   
3. From conversation context (follow-ups)
   ├─ extractProgramHint(ctx.lastBot)
   ├─ extractProgramHint(ctx.lastUser)
   └─ getActiveProgram({ chatId, userText, sessionData }).activeProgram
   
4. Fallback: None (generic question flow)
```

**Key Code Segment** (Line 13201-13371):
```javascript
const programHintFromText = extractSpecificProgramHint(text);
const programFromContext = extractProgramHint(ctx.lastBot) || extractProgramHint(ctx.lastUser);
const programFromSession = !programFromContext && shouldUseSessionProgramHintForFollowup(ctx)
  ? getActiveProgram({ chatId, userText: currentUserMessage || '', sessionData }).activeProgram
  : null;
const program = programFromContext || programFromSession;
```

**Issues Found**:
- ⚠️ Line 8550: Direct read `sessionData.lastProgramHint` (Program Info Menu path)
- ✅ Line 13257, 13340, 13371: Using `getActiveProgram()` ✅
- ⚠️ Line 13201: Only uses session fallback for `!programFromContext` cases
- ❌ Line 13079: Program pick path doesn't use getActiveProgram() for context extraction

---

## **4. PROGRAM DETECTION UTILITIES (Used Across RAG Flow)**

| Utility | Purpose | Status | Used In |
|---------|---------|--------|---------|
| `extractSpecificProgramHint()` | Exact program name match (SI, TI, SK, BD, D3, S2, UTB, DNUI, HELP) | ✅ RELIABLE | 8+ locations |
| `extractProgramHint()` | Broader extraction (supports abbreviations) | ⚠️ LENIENT | 4+ locations |
| `parseS1ProgramChoice()` | Short code to S1 program mapping (SI→Sistem Informasi) | ✅ RELIABLE | 3+ locations |
| `extractNonS1ProgramHint()` | D3 and S2 specific | ✅ RELIABLE | 2+ locations |
| `extractDualDegreeHint()` | UTB, DNUI, HELP detection | ✅ RELIABLE | 2+ locations |
| `detectProgram()` | Generic program detection | ⚠️ GENERAL | Audit/logging only |
| `canonicalizeProgram()` | Normalize program string | ✅ UTILITY | Audit/logging only |
| `getActiveProgram()` | **NEW (Tahap 1)** - 3-tier precedence | ✅ BEST | 3 locations so far |

---

## **5. DIAGRAM: CURRENT ALUR (Sebelum Tahap 2)**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER MESSAGE (WhatsApp)                        │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ INTENT DETECT   │
                    │ (isRagEnabled?) │
                    └────────┬────────┘
                             │
                             ▼
         ┌───────────────────────────────────────┐
         │ PROGRAM DETERMINATION (Multiple Paths)│
         └───────────────────────────────────────┘
              ├─ Explicit: extractSpecificProgramHint(text) ✅
              ├─ Session: sessionData.lastProgramHint ⚠️ DIRECT READ
              ├─ Flow: registrationFlow.program ✅
              ├─ Context: extractProgramHint(ctx.lastBot/User) ⚠️ CONTEXT
              └─ New (Tahap 1): getActiveProgram() ✅ (Only 3 locations)
                             │
                             ▼
         ┌──────────────────────────────────────┐
         │ DETERMINISTIC PATHS (Fast-Fee, etc) │
         │ ✅ bundledIndex (3ms response)      │
         └──────────────────┬───────────────────┘
              │             │
    ✅ Match  │             │ ✗ No Match
              ▼             ▼
         ┌─────────────┐  ┌────────────────────────────┐
         │ Return Fast │  │ RAG QUERY WITH EVAL        │
         │ Fee Answer  │  │ ragQueryWithEval(chatId,   │
         └─────────────┘  │   ragQuestion, topK,       │
                          │   ragOptions)              │
                          │                            │
                          │ [RETRIEVAL]                │
                          │ ├─ Vector search           │
                          │ ├─ Chunk selection         │
                          │ └─ Context scoring         │
                          │                            │
                          │ [ANSWER GENERATION]        │
                          │ └─ OpenAI/LLM call         │
                          └────────────┬───────────────┘
                                       │
                                       ▼
                          ┌──────────────────────┐
                          │ FORMATTER            │
                          │ whatsappFormatter    │
                          │ (NO CHANGES Tahap 1) │
                          └────────────┬─────────┘
                                       │
                                       ▼
                          ┌──────────────────────┐
                          │ sendBotMessage(chatId│
                          │ WhatsApp Reply)      │
                          └──────────────────────┘
```

---

## **6. DIAGRAM: IDEAL ALUR (Tahap 2 Target)**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER MESSAGE (WhatsApp)                        │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ INTENT DETECT   │
                    │ (isRagEnabled?) │
                    └────────┬────────┘
                             │
                             ▼
         ┌──────────────────────────────────────────┐
         │ getActiveProgram()                       │
         │ ├─ Explicit in message ✅               │
         │ ├─ Persisted explicit (latestExplicit..)│
         │ └─ Session fallback (lastProgramHint)   │
         │                                          │
         │ Returns: {                               │
         │   activeProgram: string,                │
         │   source: 'explicit_in_text' |          │
         │           'latest_explicit_program' |  │
         │           'session_lastProgramHint' |  │
         │           null,                        │
         │   explicitInText: string | null,       │
         │   persistedExplicit: string | null,    │
         │   sessionProgram: string | null        │
         │ }                                        │
         └────────────┬───────────────────────────┘
                      │
                      ▼
         ┌──────────────────────────────────┐
         │ DETERMINISTIC PATHS              │
         │ (Fast-Fee, etc)                  │
         │ Uses: activeProgram              │
         │ ✅ bundledIndex (3ms response)   │
         └──────────────┬────────────────────┘
              │         │
    ✅ Match  │         │ ✗ No Match
              ▼         ▼
         ┌──────────┐  ┌──────────────────────────────┐
         │ Return   │  │ BUILD RAG QUERY              │
         │ Fast Fee │  │ Anchor: "Program Studi: X"   │
         └──────────┘  │ Question: refined text       │
                       │                              │
                       │ Options: {                   │
                       │   answerQuestion,            │
                       │   conversationContext,       │
                       │   minScore,                  │
                       │   strict                     │
                       │ }                            │
                       └────────────┬─────────────────┘
                                    │
                                    ▼
                       ┌──────────────────────────┐
                       │ RETRIEVAL FLOW           │
                       │                          │
                       │ 1. Vector Embedding      │
                       │    ├─ Query → embedding  │
                       │    └─ Score vs chunks    │
                       │                          │
                       │ 2. Chunk Selection       │
                       │    ├─ Top-K by similarity│
                       │    ├─ Filter by intent   │
                       │    └─ Filter by docCat   │
                       │                          │
                       │ 3. Context Ranking       │
                       │    ├─ Validate relevance │
                       │    ├─ Chunk overlap      │
                       │    └─ Evidence scoring   │
                       │                          │
                       │ 4. Final Chunk Set       │
                       │    └─ Top contexts (K)   │
                       └────────────┬─────────────┘
                                    │
                                    ▼
                       ┌──────────────────────────┐
                       │ ANSWER GENERATION        │
                       │                          │
                       │ 1. LLM Call (OpenAI)    │
                       │    ├─ System prompt      │
                       │    ├─ Top contexts       │
                       │    ├─ Question           │
                       │    └─ Answer question    │
                       │                          │
                       │ 2. Answer Validation     │
                       │    ├─ Evidence check     │
                       │    ├─ Intent alignment   │
                       │    └─ Score calculation  │
                       │                          │
                       │ 3. Format Normalization  │
                       │    └─ Text cleanup       │
                       └────────────┬─────────────┘
                                    │
                                    ▼
                       ┌──────────────────────────┐
                       │ HUMANIZER                │
                       │ (Recommendation Logic)   │
                       │                          │
                       │ 1. Detect Program       │
                       │ 2. Suggest Offer        │
                       │ 3. Persist State        │
                       │ 4. Build Interactive Tx │
                       └────────────┬─────────────┘
                                    │
                                    ▼
                       ┌──────────────────────────┐
                       │ FORMAT FOR WHATSAPP      │
                       │ whatsappFormatter        │
                       │                          │
                       │ ├─ Preserve newlines     │
                       │ ├─ Respect cost tables   │
                       │ └─ Sanitize for WA       │
                       └────────────┬─────────────┘
                                    │
                                    ▼
                       ┌──────────────────────────┐
                       │ sendBotMessage(chatId,   │
                       │ formatted message)       │
                       │ WhatsApp Reply           │
                       └──────────────────────────┘
```

---

## **7. ANALISIS: PROGRAM DETERMINATION SEBELUM RAG DIPANGGIL**

### **7.1 Saat RAG TIDAK Dipanggil** (Deterministic Fast Paths)

**Lokasi**: Line 12070-13000 (Cost/Fee Flow deterministic region)

| Path | Program Source | Uses getActiveProgram? | Status |
|------|---|---|---|
| Fast-fee pre-keyword (line 12174) | `getActiveProgram().activeProgram` | ✅ YES | **TAHAP 1 ✅** |
| Early fee+gelombang (line 12314) | `getActiveProgram().activeProgram` | ✅ YES | **TAHAP 1 ✅** |
| Deterministic total (line 8843, 8891) | `getActiveProgram().activeProgram` | ✅ YES | **TAHAP 1 ✅** |
| Registration flow (line 10979) | `getActiveProgram().activeProgram` | ✅ YES | **TAHAP 1 ✅** |

**Summary**: Cost/Fee Fast Paths sudah refactored Tahap 1 ✅

---

### **7.2 Saat RAG DIPANGGIL** (Retrieval Flow)

#### **7.2.1 Program Anchoring in ragQuestion**

**Pattern Umum**:
```javascript
// GOOD: Explicit anchor
const q = `Program Studi: ${program}\n${userQuestion}`;
await ragQueryWithEval(chatId, q, topK, ...);

// WARNING: No anchor (generic question, but usually intentional)
const q = userQuestion; // Only for universal questions
await ragQueryWithEval(chatId, q, topK, ...);
```

#### **7.2.2 Program Sources Before RAG Call**

| Source | Lokasi | Pattern | Reliability |
|--------|--------|---------|-------------|
| **Explicit in text** | 13079, 13034, 10741 | `extractSpecificProgramHint(text)` → `"Program Studi: " + program` | ✅ HIGH |
| **Session (DIRECT READ)** | 816-817, 8550, 837, 963 | `sessionData.lastProgramHint` | ⚠️ MEDIUM (No precedence check) |
| **RegistrationFlow** | 9637, 11565, 11437 | `registrationFlow.program` (flow-guaranteed) | ✅ HIGH |
| **Context-based** | 8289, 13200+ | `extractProgramHint(ctx.lastBot/User)` | ⚠️ MEDIUM (Noisy if old chat) |
| **getActiveProgram()** | 8900, 13257, 13340 | Full 3-tier precedence | ✅ HIGHEST |
| **None (Generic)** | 10070, 10434, 11511 | Intentional (universal question) | ✅ CORRECT |

---

## **8. DIRECT SESSION READS YANG MASIH ADA** ⚠️

**Location List** (Need Tahap 2 refactor):

| # | Line | Context | Code | Problem | Solution |
|---|------|---------|------|---------|----------|
| 1 | 816-817 | ragQueryWithEval entry (deterministic query) | `programHintDet = sessionData.lastProgramHint` | No precedence check with explicit | Replace with `getActiveProgram()` |
| 2 | 837 | ragQueryWithEval debug trace | `sessionProgram = sessionData.lastProgramHint` | Debug only, but still direct | Replace with `getActiveProgram()` |
| 3 | 963 | ragQueryWithEval debug trace | `sessionProgram = sessionData.lastProgramHint` | Debug only, but still direct | Replace with `getActiveProgram()` |
| 4 | 8550 | Program Info Menu (syarat handler) | `(sessionData.lastProgramHint ? ... : null)` | Fallback when pending.program null | Replace with `getActiveProgram()` |
| 5 | 7240 | Early explicit hint persist | `sessionData.lastProgramHint = explicitProgramHint` | WRITE not READ, but initialization | Check for Tahap 2 |

---

## **9. RAG FLOW REGIONS & THEIR PROGRAM HANDLING**

### **9.1 Region 1: Deterministic Query Path (Line 810-900)**

**Purpose**: Fast RAG fallback untuk cost questions sebelum main RAG flow  
**Program Handling**: ⚠️ MIXED (Session reads at line 816-837)  
**Status**: Needs Tahap 2 refactor

```javascript
// Current (problematic):
const programHintDet = sessionData.lastProgramHint;  // Direct read, no precedence
const ragResult = await ragQuery(effectiveQuestion, topK, merged);

// Should be (Tahap 2):
const { activeProgram: programHintDet } = getActiveProgram({ chatId, userText, sessionData });
const ragResult = await ragQuery(effectiveQuestion, topK, merged);
```

---

### **9.2 Region 2: Cost/Fee Deterministic Region (Line 12070-13000)**

**Purpose**: Fast-path fee answers tanpa RAG  
**Program Handling**: ✅ GOOD (All use getActiveProgram() from Tahap 1)  
**Status**: Tahap 1 Complete ✅

---

### **9.3 Region 3: Follow-up Handler (Line 13100-13400)**

**Purpose**: Context-aware short replies (program pick, "ya", wave-only, etc)  
**Program Handling**: ✅ MIXED (Uses getActiveProgram() in cost follow-ups)  
**Status**: Tahap 1 Partial, needs Tahap 2 for consistency

```javascript
// GOOD (Lines 13257, 13340, 13371):
const programFromSession = getActiveProgram({ chatId, userText, sessionData }).activeProgram;

// WARNING (Line 8550):
const program = (pending && pending.program) || 
                (sessionData && sessionData.lastProgramHint) ||  // ⚠️ DIRECT READ
                null;
```

---

### **9.4 Region 4: Main RAG Entry (Line 13400-13615)**

**Purpose**: Final RAG fallback setelah semua deterministic paths gagal  
**Program Handling**: ⚠️ MIXED (Uses getActiveProgram() for some paths, context for others)  
**Status**: Tahap 2 needed for consistency

```javascript
// Line 13201:
const programFromContext = extractProgramHint(ctx.lastBot) || extractProgramHint(ctx.lastUser);
const programFromSession = !programFromContext && shouldUseSessionProgramHintForFollowup(ctx)
  ? getActiveProgram({ chatId, userText, sessionData }).activeProgram  // ✅ Uses getActiveProgram()
  : null;

// Could be improved: use getActiveProgram() for all cases
```

---

## **10. VECTOR SEARCH & CHUNK SELECTION LOGIC**

**File**: `src/engine/ragEngine.js`  
**Functions**:
- `ragQuery()` - Basic retrieval
- `ragQueryWithEval()` - With answer generation + validation

### **10.1 Vector Search Process**

```
1. Input: question (string)
   └─ Normalize & tokenize
   
2. Vector Embedding
   ├─ OpenAI embeddings API
   └─ Convert text → 1536-dim vector
   
3. Similarity Scoring
   ├─ Cosine similarity vs all chunks
   ├─ Score each chunk (0-1)
   └─ Sort by score descending
   
4. Top-K Selection
   ├─ Take top K chunks (default K=6)
   ├─ Filter by minScore (default 0.6)
   └─ Return contexts array
```

### **10.2 Chunk Selection Filters** (ragEngine.js)

| Filter | Purpose | Tahap 2 Relevance |
|--------|---------|---|
| `intentClassifier.shouldIncludeChunkForIntent()` | Filter by detected intent (cost, schedule, etc) | ⚠️ Needs program context |
| `docCategoryClassifier.enrichChunkWithCategory()` | Add docCategory metadata | ✅ Independent of program |
| `evidenceValidator.validateChunkForAnswer()` | Score chunk relevance | ⚠️ Better with explicit program |
| `evidenceValidator.validateChunkEvidence()` | Confirm answer backed by chunks | ✅ Independent of program |

---

## **11. KESIMPULAN: TAHAP 2 SCOPE**

### **11.1 Lokasi yang PASTI perlu Tahap 2**

| # | Priority | Line | Issue | Fix |
|---|----------|------|-------|-----|
| 1 | 🔴 HIGH | 816-817 | Direct session read di deterministic RAG path | Replace with `getActiveProgram()` |
| 2 | 🔴 HIGH | 8550 | Direct session read di Program Info Menu | Replace with `getActiveProgram()` |
| 3 | 🟡 MEDIUM | 837, 963 | Debug traces dengan direct read | Update debug output to use `getActiveProgram()` |
| 4 | 🟡 MEDIUM | 8289 | Context-based program (no explicit anchor check) | Verify or enhance with explicit check |
| 5 | 🟡 MEDIUM | 13079 | Program pick path without full getActiveProgram() | Consider adding getActiveProgram() for consistency |

### **11.2 Optimal Refactor Pattern (untuk Tahap 2)**

```javascript
// SEBELUM (problematic):
const program = sessionData.lastProgramHint || extractProgramHint(text);
const ragQuestion = `${text}`;
const ragResult = await ragQueryWithEval(chatId, ragQuestion, topK, options);

// SESUDAH (ideal Tahap 2):
const { activeProgram, source } = getActiveProgram({ chatId, userText: text, sessionData });
const ragQuestion = activeProgram ? `Program Studi: ${activeProgram}\n${text}` : text;
const ragOptions = { ...options, programSource: source, minScore: source === 'explicit_in_text' ? 0.5 : 0.6 };
const ragResult = await ragQueryWithEval(chatId, ragQuestion, topK, ragOptions);
```

---

## **12. METRICS SUMMARY**

| Metric | Value | Status |
|--------|-------|--------|
| Total RAG entry points | 29 (21 ragQueryWithEval + 8 ragQuery) | Comprehensive coverage |
| Using getActiveProgram() | 3 + (multiple in follow-up) | ✅ Good but incomplete |
| Direct session reads | 5 locations | ⚠️ Needs Tahap 2 |
| No program anchoring (intentional) | 5 locations | ✅ Correct |
| Program source types | 6 different patterns | ⚠️ Inconsistent |
| Cost/Fee Fast Paths refactored | 12/12 (100%) | ✅ Tahap 1 complete |
| Retrieval Flow refactored | 3/29 (10%) | ⚠️ Tahap 2 needed |

---

## **13. NEXT STEPS (Tahap 2 Proposal)**

**Phase 2a - Quick Wins** (2-3 hours)
1. Replace 5 direct session reads (lines 816, 8550, 837, 963) with `getActiveProgram()`
2. Update debug traces to use `getActiveProgram()` source info
3. Verify minScore thresholds for different program sources

**Phase 2b - Consistency Pass** (4-6 hours)
1. Standardize all ragQueryWithEval() calls to use explicit program anchoring
2. Add `programSource` metadata to ragOptions for better answer generation
3. Enhance chunk selection filters to use program context

**Phase 2c - Validation & Testing** (2-3 hours)
1. Test all 29 RAG entry points with explicit → session fallback transitions
2. Verify stale program propagation is eliminated
3. Smoke test cost/fee/schedule/requirements flows

---

**Laporan Audit Selesai - Ready for User Review** ✅

Menunggu feedback user sebelum memulai Tahap 2 implementation.

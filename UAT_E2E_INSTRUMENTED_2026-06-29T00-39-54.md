# UAT END-TO-END PRODUCTION FLOW AUDIT REPORT

**Generated:** 2026-06-29T00:39:54.272Z  
**Total Tests:** 42

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Tests | 42 |
| Passed | 26 (61.90%) |
| Failed | 16 |
| Errors | 0 |
| Status | ❌ NEEDS FIXING |

---

## Results by Scenario


### Scenario A: Menu & Greeting
**Result:** 2/2 (100%)

| Test # | Question | Expected | Detected | Status | Source |
|--------|----------|----------|----------|--------|--------|
| 1 | Halo | GREETING | GREETING | ✅ | GENERIC |
| 2 | Menu | MENU | MENU | ✅ | RULE_ENGINE |


### Scenario B: Program Definition (SI, TI, SK, BD, MI)
**Result:** 3/5 (60%)

| Test # | Question | Expected | Detected | Status | Source |
|--------|----------|----------|----------|--------|--------|
| 3 | Apa itu SI? | ACADEMIC_PROGRAM | ACADEMIC_PROGRAM | ✅ | RAG |
| 4 | Definisi TI | ACADEMIC_PROGRAM | ACADEMIC_PROGRAM | ✅ | RAG |
| 5 | Jelaskan BD | ACADEMIC_PROGRAM | ACADEMIC_PROGRAM | ✅ | RAG |
| 6 | SK apa? | ACADEMIC_PROGRAM | GREETING | ❌ | GENERIC |
| 7 | Program MI? | ACADEMIC_PROGRAM | GREETING | ❌ | GENERIC |


### Scenario C: Program & Prospect
**Result:** 4/5 (80%)

| Test # | Question | Expected | Detected | Status | Source |
|--------|----------|----------|----------|--------|--------|
| 8 | SI prospek? | ACADEMIC_PROGRAM | ACADEMIC_PROGRAM | ✅ | RAG |
| 9 | TI karir? | ACADEMIC_PROGRAM | ACADEMIC_PROGRAM | ✅ | RAG |
| 10 | BD jenjang? | ACADEMIC_PROGRAM | ACADEMIC_PROGRAM | ✅ | RAG |
| 11 | SK peluang? | ACADEMIC_PROGRAM | COST | ❌ | RAG |
| 12 | MI arah? | ACADEMIC_PROGRAM | ACADEMIC_PROGRAM | ✅ | RAG |


### Scenario D: Fee Inquiry All Waves
**Result:** 4/8 (50%)

| Test # | Question | Expected | Detected | Status | Source |
|--------|----------|----------|----------|--------|--------|
| 13 | Biaya TI 1A? | COST | COST | ✅ | RAG |
| 14 | SI 2C? | COST | GREETING | ❌ | GENERIC |
| 15 | SK 1B? | COST | GREETING | ❌ | GENERIC |
| 16 | MI 3? | COST | GREETING | ❌ | GENERIC |
| 17 | BD Khusus? | COST | GREETING | ❌ | GENERIC |
| 18 | Biaya masuk TI? | COST | COST | ✅ | RAG |
| 19 | DPP SI? | COST | COST | ✅ | RAG |
| 20 | Uang kuliah BD? | COST | COST | ✅ | RAG |


### Scenario E: Fee Breakdown Detail
**Result:** 5/8 (63%)

| Test # | Question | Expected | Detected | Status | Source |
|--------|----------|----------|----------|--------|--------|
| 21 | Rincian TI 1A? | COST | COST | ✅ | RAG |
| 22 | Detail SI 2C? | COST | GREETING | ❌ | GENERIC |
| 23 | Breakdown SK? | COST | GREETING | ❌ | GENERIC |
| 24 | MI komposisi? | COST | COST | ✅ | RAG |
| 25 | BD rincian? | COST | COST | ✅ | RAG |
| 26 | TI DPP detail? | COST | COST | ✅ | RAG |
| 27 | SI biaya apa? | COST | COST | ✅ | RAG |
| 28 | SK cicilan? | COST | GREETING | ❌ | GENERIC |


### Scenario F: Multi-turn Conversation
**Result:** 3/4 (75%)

| Test # | Question | Expected | Detected | Status | Source |
|--------|----------|----------|----------|--------|--------|
| 29 | TI apa? | ACADEMIC_PROGRAM | GREETING | ❌ | GENERIC |
| 30 | Prospek? | ACADEMIC_PROGRAM | ACADEMIC_PROGRAM | ✅ | RAG |
| 31 | Biaya? | COST | COST | ✅ | RAG |
| 32 | Rincian? | COST | COST | ✅ | RAG |


### Scenario G: Program Switching
**Result:** 1/6 (17%)

| Test # | Question | Expected | Detected | Status | Source |
|--------|----------|----------|----------|--------|--------|
| 33 | TI vs SI? | ACADEMIC_PROGRAM | GREETING | ❌ | GENERIC |
| 34 | BD biaya | COST | COST | ✅ | RAG |
| 35 | SK | ACADEMIC_PROGRAM | GREETING | ❌ | GENERIC |
| 36 | SI 1A | COST | GREETING | ❌ | GENERIC |
| 37 | TI 2C | COST | GREETING | ❌ | GENERIC |
| 38 | MI juga | COST | GREETING | ❌ | GENERIC |


### Scenario H: Edge Cases
**Result:** 4/4 (100%)

| Test # | Question | Expected | Detected | Status | Source |
|--------|----------|----------|----------|--------|--------|
| 39 | Berapa? | ANY | GREETING | ✅ | GENERIC |
| 40 | Apa? | ANY | GREETING | ✅ | GENERIC |
| 41 | Gimana? | ANY | GREETING | ✅ | GENERIC |
| 42 | Bisa? | ANY | GREETING | ✅ | GENERIC |


---

## Failures & Issues (16)


### Test #6: "SK apa?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** ACADEMIC_PROGRAM  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #7: "Program MI?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** ACADEMIC_PROGRAM  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #11: "SK peluang?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** ACADEMIC_PROGRAM  
- **Detected:** COST  
- **Message:** Baik, untuk biaya:

Informasi tentang "SK peluang?" untuk COST: [RAG Answer]. Informasi ini diambil ...


### Test #14: "SI 2C?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** COST  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #15: "SK 1B?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** COST  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #16: "MI 3?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** COST  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #17: "BD Khusus?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** COST  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #22: "Detail SI 2C?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** COST  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #23: "Breakdown SK?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** COST  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #28: "SK cicilan?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** COST  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #29: "TI apa?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** ACADEMIC_PROGRAM  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #33: "TI vs SI?"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** ACADEMIC_PROGRAM  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #35: "SK"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** ACADEMIC_PROGRAM  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #36: "SI 1A"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** COST  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #37: "TI 2C"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** COST  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


### Test #38: "MI juga"
- **Status:** FAIL  
- **Reason:** INTENT_MISMATCH  
- **Expected:** COST  
- **Detected:** GREETING  
- **Message:** Halo! Selamat datang di sistem informasi PMB kami....


---

## Processing Pipeline Distribution

- **RAG Queries:** 21 (50.0%)
- **Rule Engine:** 1 (2.4%)
- **Generic:** 20 (47.6%)

**Average RAG Score:** 0.809


---

## Raw Test Results

```json
[
  {
    "testNo": 1,
    "question": "Halo",
    "expectedIntent": "GREETING",
    "detectedIntent": "GREETING",
    "status": "PASS",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 1,
    "flow": {
      "testId": 1,
      "question": "Halo",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693591867,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693591868,
      "duration": 1,
      "status": "PASS"
    },
    "scenario": "A",
    "scenarioName": "Menu & Greeting"
  },
  {
    "testNo": 2,
    "question": "Menu",
    "expectedIntent": "MENU",
    "detectedIntent": "MENU",
    "status": "PASS",
    "source": "RULE_ENGINE",
    "ragScore": null,
    "finalMessage": "Pilih topik:\n1. Program Studi\n2. Biaya\n3. Jadwal\n4. Syarat Daftar",
    "duration": 0,
    "flow": {
      "testId": 2,
      "question": "Menu",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693591930,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "MENU"
        },
        {
          "type": "RULE_MATCHED",
          "rule": "main_menu"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "MENU",
      "ruleMatched": "main_menu",
      "answer": "Pilih topik:\n1. Program Studi\n2. Biaya\n3. Jadwal\n4. Syarat Daftar",
      "finalMessage": "Pilih topik:\n1. Program Studi\n2. Biaya\n3. Jadwal\n4. Syarat Daftar",
      "endTime": 1782693591930,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "A",
    "scenarioName": "Menu & Greeting"
  },
  {
    "testNo": 3,
    "question": "Apa itu SI?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "ACADEMIC_PROGRAM",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.79,
    "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Apa itu SI?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
    "duration": 1,
    "flow": {
      "testId": 3,
      "question": "Apa itu SI?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693591996,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "ACADEMIC_PROGRAM"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.79,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "ACADEMIC_PROGRAM",
      "ragUsed": true,
      "ragScore": 0.79,
      "answer": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Apa itu SI?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "humanized": true,
      "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Apa itu SI?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "endTime": 1782693591997,
      "duration": 1,
      "status": "PASS"
    },
    "scenario": "B",
    "scenarioName": "Program Definition (SI, TI, SK, BD, MI)"
  },
  {
    "testNo": 4,
    "question": "Definisi TI",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "ACADEMIC_PROGRAM",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.79,
    "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Definisi TI\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
    "duration": 0,
    "flow": {
      "testId": 4,
      "question": "Definisi TI",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592047,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "ACADEMIC_PROGRAM"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.79,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "ACADEMIC_PROGRAM",
      "ragUsed": true,
      "ragScore": 0.79,
      "answer": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Definisi TI\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "humanized": true,
      "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Definisi TI\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "endTime": 1782693592047,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "B",
    "scenarioName": "Program Definition (SI, TI, SK, BD, MI)"
  },
  {
    "testNo": 5,
    "question": "Jelaskan BD",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "ACADEMIC_PROGRAM",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.79,
    "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Jelaskan BD\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
    "duration": 0,
    "flow": {
      "testId": 5,
      "question": "Jelaskan BD",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592098,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "ACADEMIC_PROGRAM"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.79,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "ACADEMIC_PROGRAM",
      "ragUsed": true,
      "ragScore": 0.79,
      "answer": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Jelaskan BD\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "humanized": true,
      "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Jelaskan BD\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "endTime": 1782693592098,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "B",
    "scenarioName": "Program Definition (SI, TI, SK, BD, MI)"
  },
  {
    "testNo": 6,
    "question": "SK apa?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 6,
      "question": "SK apa?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592163,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693592163,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "B",
    "scenarioName": "Program Definition (SI, TI, SK, BD, MI)"
  },
  {
    "testNo": 7,
    "question": "Program MI?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 7,
      "question": "Program MI?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592214,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693592214,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "B",
    "scenarioName": "Program Definition (SI, TI, SK, BD, MI)"
  },
  {
    "testNo": 8,
    "question": "SI prospek?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "ACADEMIC_PROGRAM",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.79,
    "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"SI prospek?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
    "duration": 0,
    "flow": {
      "testId": 8,
      "question": "SI prospek?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592280,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "ACADEMIC_PROGRAM"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.79,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "ACADEMIC_PROGRAM",
      "ragUsed": true,
      "ragScore": 0.79,
      "answer": "Tentu! Mengenai program ini:\n\nInformasi tentang \"SI prospek?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "humanized": true,
      "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"SI prospek?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "endTime": 1782693592280,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "C",
    "scenarioName": "Program & Prospect"
  },
  {
    "testNo": 9,
    "question": "TI karir?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "ACADEMIC_PROGRAM",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.79,
    "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"TI karir?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
    "duration": 0,
    "flow": {
      "testId": 9,
      "question": "TI karir?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592331,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "ACADEMIC_PROGRAM"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.79,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "ACADEMIC_PROGRAM",
      "ragUsed": true,
      "ragScore": 0.79,
      "answer": "Tentu! Mengenai program ini:\n\nInformasi tentang \"TI karir?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "humanized": true,
      "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"TI karir?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "endTime": 1782693592331,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "C",
    "scenarioName": "Program & Prospect"
  },
  {
    "testNo": 10,
    "question": "BD jenjang?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "ACADEMIC_PROGRAM",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.79,
    "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"BD jenjang?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
    "duration": 0,
    "flow": {
      "testId": 10,
      "question": "BD jenjang?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592383,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "ACADEMIC_PROGRAM"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.79,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "ACADEMIC_PROGRAM",
      "ragUsed": true,
      "ragScore": 0.79,
      "answer": "Tentu! Mengenai program ini:\n\nInformasi tentang \"BD jenjang?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "humanized": true,
      "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"BD jenjang?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "endTime": 1782693592383,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "C",
    "scenarioName": "Program & Prospect"
  },
  {
    "testNo": 11,
    "question": "SK peluang?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "COST",
    "status": "FAIL",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"SK peluang?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 11,
      "question": "SK peluang?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592446,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"SK peluang?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"SK peluang?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693592446,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "C",
    "scenarioName": "Program & Prospect"
  },
  {
    "testNo": 12,
    "question": "MI arah?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "ACADEMIC_PROGRAM",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.79,
    "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"MI arah?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
    "duration": 0,
    "flow": {
      "testId": 12,
      "question": "MI arah?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592496,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "ACADEMIC_PROGRAM"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.79,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "ACADEMIC_PROGRAM",
      "ragUsed": true,
      "ragScore": 0.79,
      "answer": "Tentu! Mengenai program ini:\n\nInformasi tentang \"MI arah?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "humanized": true,
      "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"MI arah?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "endTime": 1782693592496,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "C",
    "scenarioName": "Program & Prospect"
  },
  {
    "testNo": 13,
    "question": "Biaya TI 1A?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Biaya TI 1A?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 13,
      "question": "Biaya TI 1A?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592547,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"Biaya TI 1A?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Biaya TI 1A?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693592547,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "D",
    "scenarioName": "Fee Inquiry All Waves"
  },
  {
    "testNo": 14,
    "question": "SI 2C?",
    "expectedIntent": "COST",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 14,
      "question": "SI 2C?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592613,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693592613,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "D",
    "scenarioName": "Fee Inquiry All Waves"
  },
  {
    "testNo": 15,
    "question": "SK 1B?",
    "expectedIntent": "COST",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 15,
      "question": "SK 1B?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592664,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693592664,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "D",
    "scenarioName": "Fee Inquiry All Waves"
  },
  {
    "testNo": 16,
    "question": "MI 3?",
    "expectedIntent": "COST",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 16,
      "question": "MI 3?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592729,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693592729,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "D",
    "scenarioName": "Fee Inquiry All Waves"
  },
  {
    "testNo": 17,
    "question": "BD Khusus?",
    "expectedIntent": "COST",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 17,
      "question": "BD Khusus?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592796,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693592796,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "D",
    "scenarioName": "Fee Inquiry All Waves"
  },
  {
    "testNo": 18,
    "question": "Biaya masuk TI?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Biaya masuk TI?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 18,
      "question": "Biaya masuk TI?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592847,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"Biaya masuk TI?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Biaya masuk TI?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693592847,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "D",
    "scenarioName": "Fee Inquiry All Waves"
  },
  {
    "testNo": 19,
    "question": "DPP SI?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"*DPP* SI?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 19,
      "question": "DPP SI?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592913,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        },
        {
          "type": "FORMATTER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"DPP SI?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "formatted": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"*DPP* SI?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693592913,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "D",
    "scenarioName": "Fee Inquiry All Waves"
  },
  {
    "testNo": 20,
    "question": "Uang kuliah BD?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Uang kuliah BD?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 20,
      "question": "Uang kuliah BD?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693592971,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"Uang kuliah BD?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Uang kuliah BD?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693592971,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "D",
    "scenarioName": "Fee Inquiry All Waves"
  },
  {
    "testNo": 21,
    "question": "Rincian TI 1A?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Rincian TI 1A?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 21,
      "question": "Rincian TI 1A?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593029,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"Rincian TI 1A?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Rincian TI 1A?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693593029,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "E",
    "scenarioName": "Fee Breakdown Detail"
  },
  {
    "testNo": 22,
    "question": "Detail SI 2C?",
    "expectedIntent": "COST",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 22,
      "question": "Detail SI 2C?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593079,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693593079,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "E",
    "scenarioName": "Fee Breakdown Detail"
  },
  {
    "testNo": 23,
    "question": "Breakdown SK?",
    "expectedIntent": "COST",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 23,
      "question": "Breakdown SK?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593130,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693593130,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "E",
    "scenarioName": "Fee Breakdown Detail"
  },
  {
    "testNo": 24,
    "question": "MI komposisi?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"MI komposisi?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 24,
      "question": "MI komposisi?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593196,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"MI komposisi?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"MI komposisi?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693593196,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "E",
    "scenarioName": "Fee Breakdown Detail"
  },
  {
    "testNo": 25,
    "question": "BD rincian?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"BD rincian?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 25,
      "question": "BD rincian?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593262,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"BD rincian?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"BD rincian?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693593262,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "E",
    "scenarioName": "Fee Breakdown Detail"
  },
  {
    "testNo": 26,
    "question": "TI DPP detail?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"TI *DPP* detail?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 26,
      "question": "TI DPP detail?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593314,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        },
        {
          "type": "FORMATTER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"TI DPP detail?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "formatted": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"TI *DPP* detail?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693593314,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "E",
    "scenarioName": "Fee Breakdown Detail"
  },
  {
    "testNo": 27,
    "question": "SI biaya apa?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"SI biaya apa?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 27,
      "question": "SI biaya apa?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593379,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"SI biaya apa?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"SI biaya apa?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693593379,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "E",
    "scenarioName": "Fee Breakdown Detail"
  },
  {
    "testNo": 28,
    "question": "SK cicilan?",
    "expectedIntent": "COST",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 28,
      "question": "SK cicilan?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593430,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693593430,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "E",
    "scenarioName": "Fee Breakdown Detail"
  },
  {
    "testNo": 29,
    "question": "TI apa?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 29,
      "question": "TI apa?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593481,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693593481,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "F",
    "scenarioName": "Multi-turn Conversation"
  },
  {
    "testNo": 30,
    "question": "Prospek?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "ACADEMIC_PROGRAM",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.79,
    "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Prospek?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
    "duration": 0,
    "flow": {
      "testId": 30,
      "question": "Prospek?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593546,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "ACADEMIC_PROGRAM"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.79,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "ACADEMIC_PROGRAM",
      "ragUsed": true,
      "ragScore": 0.79,
      "answer": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Prospek?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "humanized": true,
      "finalMessage": "Tentu! Mengenai program ini:\n\nInformasi tentang \"Prospek?\" untuk ACADEMIC_PROGRAM: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nIngin tahu lebih lanjut?",
      "endTime": 1782693593546,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "F",
    "scenarioName": "Multi-turn Conversation"
  },
  {
    "testNo": 31,
    "question": "Biaya?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Biaya?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 31,
      "question": "Biaya?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593596,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"Biaya?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Biaya?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693593596,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "F",
    "scenarioName": "Multi-turn Conversation"
  },
  {
    "testNo": 32,
    "question": "Rincian?",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Rincian?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 32,
      "question": "Rincian?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593647,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"Rincian?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"Rincian?\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693593647,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "F",
    "scenarioName": "Multi-turn Conversation"
  },
  {
    "testNo": 33,
    "question": "TI vs SI?",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 33,
      "question": "TI vs SI?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593698,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693593698,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "G",
    "scenarioName": "Program Switching"
  },
  {
    "testNo": 34,
    "question": "BD biaya",
    "expectedIntent": "COST",
    "detectedIntent": "COST",
    "status": "PASS",
    "source": "RAG",
    "ragScore": 0.82,
    "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"BD biaya\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
    "duration": 0,
    "flow": {
      "testId": 34,
      "question": "BD biaya",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593762,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "COST"
        },
        {
          "type": "RAG_QUERY",
          "score": 0.82,
          "success": true
        },
        {
          "type": "HUMANIZER_APPLIED"
        }
      ],
      "intent": "COST",
      "ragUsed": true,
      "ragScore": 0.82,
      "answer": "Baik, untuk biaya:\n\nInformasi tentang \"BD biaya\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "humanized": true,
      "finalMessage": "Baik, untuk biaya:\n\nInformasi tentang \"BD biaya\" untuk COST: [RAG Answer]. Informasi ini diambil dari knowledge base kami.\n\nAda pertanyaan lain?",
      "endTime": 1782693593762,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "G",
    "scenarioName": "Program Switching"
  },
  {
    "testNo": 35,
    "question": "SK",
    "expectedIntent": "ACADEMIC_PROGRAM",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 35,
      "question": "SK",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593812,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693593812,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "G",
    "scenarioName": "Program Switching"
  },
  {
    "testNo": 36,
    "question": "SI 1A",
    "expectedIntent": "COST",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 36,
      "question": "SI 1A",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593863,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693593863,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "G",
    "scenarioName": "Program Switching"
  },
  {
    "testNo": 37,
    "question": "TI 2C",
    "expectedIntent": "COST",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 37,
      "question": "TI 2C",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593915,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693593915,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "G",
    "scenarioName": "Program Switching"
  },
  {
    "testNo": 38,
    "question": "MI juga",
    "expectedIntent": "COST",
    "detectedIntent": "GREETING",
    "status": "FAIL",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 38,
      "question": "MI juga",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693593979,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693593979,
      "duration": 0,
      "status": "PASS"
    },
    "failReason": "INTENT_MISMATCH",
    "scenario": "G",
    "scenarioName": "Program Switching"
  },
  {
    "testNo": 39,
    "question": "Berapa?",
    "expectedIntent": "ANY",
    "detectedIntent": "GREETING",
    "status": "PASS",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 39,
      "question": "Berapa?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693594046,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693594046,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "H",
    "scenarioName": "Edge Cases"
  },
  {
    "testNo": 40,
    "question": "Apa?",
    "expectedIntent": "ANY",
    "detectedIntent": "GREETING",
    "status": "PASS",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 40,
      "question": "Apa?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693594097,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693594097,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "H",
    "scenarioName": "Edge Cases"
  },
  {
    "testNo": 41,
    "question": "Gimana?",
    "expectedIntent": "ANY",
    "detectedIntent": "GREETING",
    "status": "PASS",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 41,
      "question": "Gimana?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693594163,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693594163,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "H",
    "scenarioName": "Edge Cases"
  },
  {
    "testNo": 42,
    "question": "Bisa?",
    "expectedIntent": "ANY",
    "detectedIntent": "GREETING",
    "status": "PASS",
    "source": "GENERIC",
    "ragScore": null,
    "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
    "duration": 0,
    "flow": {
      "testId": 42,
      "question": "Bisa?",
      "chatId": "uat-ca5b871d-d1a1-448e-a60b-7704ebd6571d",
      "startTime": 1782693594214,
      "events": [
        {
          "type": "INTENT_DETECTED",
          "intent": "GREETING"
        },
        {
          "type": "GENERIC_ANSWER"
        }
      ],
      "intent": "GREETING",
      "answer": "Halo! Selamat datang di sistem informasi PMB kami.",
      "finalMessage": "Halo! Selamat datang di sistem informasi PMB kami.",
      "endTime": 1782693594214,
      "duration": 0,
      "status": "PASS"
    },
    "scenario": "H",
    "scenarioName": "Edge Cases"
  }
]
```

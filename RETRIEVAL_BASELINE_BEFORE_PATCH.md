# RETRIEVAL BASELINE BEFORE PATCH

## Context

- Dataset: existing `.tmp_retrieval_results.json` baseline audit for 4 academic queries.
- Current scoring formula is the production formula before patch.
- Patch candidate: increase semantic contribution from `0.10` to `0.25` while leaving metadata boosts unchanged.

## Current Scoring Formula (baseline)

- `semanticBoost = semantic * 0.10`
- `evidenceScore = keywordScore * 0.18`
- `attributeScore = exactBoost`
- `metadataBoost` is calculated from program match, academic year, wave, partner, campus, program mode, fee type, category match, intent-category boosts, and program-related metadata signals.
- `otherBoosts` includes chunk type signal, category signal, trust boost, penalties, and intent-specific quality adjustments.
- `rawScore = semanticBoost + evidenceScore + attributeScore + metadataBoost + otherBoosts`; `finalScore` is clamped to [-1,1].

## Baseline Candidate A

- Minimal targeted patch: change only the semantic weight from `0.10` to `0.25`.
- Rationale: preserve metadata-based program/intent boosts while making semantic similarity more influential.
- This is the lowest-risk formula change to correct cases where strong semantic matches are underweighted.

## Query: Apa itu Sistem Informasi?

- Retrieval query: `apa itu sistem informasi`
- Detected intent: `ACADEMIC_PROGRAM`
- User intent: `DEFINISI_PRODI`

### Top 1 candidate

- Rank 1: Penjelasan Prodi dan Karier Masa Depan (1).xlsx (KURIKULUM / PROGRAM)
- Raw score: 4.4607
- Semantic: 0.4468
- Semantic boost: 0.0447
- Keyword/evidence: 0.1800
- Metadata boost: 3.4700
- Exact/attribute: 1.0000
- Other boosts/penalties: -0.2340

- Highest semantic candidate rank: 4
- Highest semantic score: 0.5848
- Candidate: Penjelasan Semua Program Studi.pdf (KURIKULUM / N/A)

### Top 10 candidates

| Rank | Candidate | Doc Category | Chunk Type | Score | Semantic | Metadata | Exact | Other |
|---|---|---|---|---|---|---|---|---|
| 1 | Penjelasan Prodi dan Karier Masa Depan (1).xlsx (KURIKULUM / PROGRAM) | KURIKULUM | PROGRAM | 4.4607 | 0.4468 | 3.4700 | 1.0000 | -0.2340 |
| 2 | CHATBOT - Double Degree (1).docx (PROGRAM_KHUSUS / N/A) | PROGRAM_KHUSUS | N/A | 4.2000 | 0.0000 | 2.9000 | 1.0000 | 0.1200 |
| 3 | CHATBOT - Double Degree (1).docx (PROGRAM_KHUSUS / N/A) | PROGRAM_KHUSUS | N/A | 4.2000 | 0.0000 | 2.9000 | 1.0000 | 0.1200 |
| 4 | Penjelasan Semua Program Studi.pdf (KURIKULUM / N/A) | KURIKULUM | N/A | 3.8785 | 0.5848 | 3.4700 | 1.0000 | -0.8300 |
| 5 | hobi_prodi_lengkap (1).xlsx (UNKNOWN / GENERAL) | UNKNOWN | GENERAL | 3.4159 | 0.5390 | 2.4500 | 1.0000 | -0.2680 |
| 6 | smoke-sectiontitle-ok-1779082103888 (BIAYA / GENERAL) | BIAYA | GENERAL | 3.3692 | 0.3724 | 2.1200 | 1.0000 | 0.0320 |
| 7 | HOBY.pdf (UNKNOWN / GENERAL) | UNKNOWN | GENERAL | 3.3150 | 0.5298 | 2.0000 | 1.0000 | 0.0820 |
| 8 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.2841 | 0.5006 | 2.1200 | 1.0000 | -0.0660 |
| 9 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.2835 | 0.4950 | 2.1200 | 1.0000 | -0.0660 |
| 10 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.2813 | 0.4726 | 2.1200 | 1.0000 | -0.0660 |

## Query: Apa prospek kerja Sistem Informasi?

- Retrieval query: `apa prospek kerja sistem informasi`
- Detected intent: `ACADEMIC_PROGRAM`
- User intent: `PROSPEK_KERJA`

### Top 1 candidate

- Rank 1: Penjelasan Prodi dan Karier Masa Depan (1).xlsx (KURIKULUM / PROGRAM)
- Raw score: 4.2464
- Semantic: 0.5545
- Semantic boost: 0.0554
- Keyword/evidence: 0.1350
- Metadata boost: 3.2900
- Exact/attribute: 1.0000
- Other boosts/penalties: -0.2340

- Highest semantic candidate rank: 4
- Highest semantic score: 0.6428
- Candidate: Penjelasan Semua Program Studi.pdf (KURIKULUM / N/A)

### Top 10 candidates

| Rank | Candidate | Doc Category | Chunk Type | Score | Semantic | Metadata | Exact | Other |
|---|---|---|---|---|---|---|---|---|
| 1 | Penjelasan Prodi dan Karier Masa Depan (1).xlsx (KURIKULUM / PROGRAM) | KURIKULUM | PROGRAM | 4.2464 | 0.5545 | 3.2900 | 1.0000 | -0.2340 |
| 2 | CHATBOT - Double Degree (1).docx (PROGRAM_KHUSUS / N/A) | PROGRAM_KHUSUS | N/A | 3.9750 | 0.0000 | 2.7200 | 1.0000 | 0.1200 |
| 3 | CHATBOT - Double Degree (1).docx (PROGRAM_KHUSUS / N/A) | PROGRAM_KHUSUS | N/A | 3.9300 | 0.0000 | 2.7200 | 1.0000 | 0.1200 |
| 4 | Penjelasan Semua Program Studi.pdf (KURIKULUM / N/A) | KURIKULUM | N/A | 3.6143 | 0.6428 | 3.2900 | 1.0000 | -0.8300 |
| 5 | hobi_prodi_lengkap (1).xlsx (UNKNOWN / GENERAL) | UNKNOWN | GENERAL | 3.1466 | 0.5464 | 2.2700 | 1.0000 | -0.2680 |
| 6 | smoke-sectiontitle-ok-1779082103888 (BIAYA / GENERAL) | BIAYA | GENERAL | 3.1014 | 0.3944 | 1.9400 | 1.0000 | 0.0320 |
| 7 | HOBY.pdf (UNKNOWN / GENERAL) | UNKNOWN | GENERAL | 3.0458 | 0.5378 | 1.8200 | 1.0000 | 0.0820 |
| 8 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.0100 | 0.4598 | 1.9400 | 1.0000 | -0.0660 |
| 9 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.0090 | 0.4505 | 1.9400 | 1.0000 | -0.0660 |
| 10 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.0090 | 0.4502 | 1.9400 | 1.0000 | -0.0660 |

## Query: Apa yang dipelajari di Sistem Informasi?

- Retrieval query: `apa yang dipelajari di sistem informasi`
- Detected intent: `ACADEMIC_PROGRAM`
- User intent: `KURIKULUM_PEMBELAJARAN`

### Top 1 candidate

- Rank 1: Penjelasan Prodi dan Karier Masa Depan (1).xlsx (KURIKULUM / PROGRAM)
- Raw score: 4.4006
- Semantic: 0.4464
- Semantic boost: 0.0446
- Keyword/evidence: 0.1200
- Metadata boost: 3.4700
- Exact/attribute: 1.0000
- Other boosts/penalties: -0.2340

- Highest semantic candidate rank: 4
- Highest semantic score: 0.5755
- Candidate: Penjelasan Semua Program Studi.pdf (KURIKULUM / N/A)

### Top 10 candidates

| Rank | Candidate | Doc Category | Chunk Type | Score | Semantic | Metadata | Exact | Other |
|---|---|---|---|---|---|---|---|---|
| 1 | Penjelasan Prodi dan Karier Masa Depan (1).xlsx (KURIKULUM / PROGRAM) | KURIKULUM | PROGRAM | 4.4006 | 0.4464 | 3.4700 | 1.0000 | -0.2340 |
| 2 | CHATBOT - Double Degree (1).docx (PROGRAM_KHUSUS / N/A) | PROGRAM_KHUSUS | N/A | 4.1400 | 0.0000 | 2.9000 | 1.0000 | 0.1200 |
| 3 | CHATBOT - Double Degree (1).docx (PROGRAM_KHUSUS / N/A) | PROGRAM_KHUSUS | N/A | 4.1400 | 0.0000 | 2.9000 | 1.0000 | 0.1200 |
| 4 | Penjelasan Semua Program Studi.pdf (KURIKULUM / N/A) | KURIKULUM | N/A | 3.8175 | 0.5755 | 3.4700 | 1.0000 | -0.8300 |
| 5 | hobi_prodi_lengkap (1).xlsx (UNKNOWN / GENERAL) | UNKNOWN | GENERAL | 3.3573 | 0.5530 | 2.4500 | 1.0000 | -0.2680 |
| 6 | smoke-sectiontitle-ok-1779082103888 (BIAYA / GENERAL) | BIAYA | GENERAL | 3.3103 | 0.3832 | 2.1200 | 1.0000 | 0.0320 |
| 7 | HOBY.pdf (UNKNOWN / GENERAL) | UNKNOWN | GENERAL | 3.2565 | 0.5447 | 2.0000 | 1.0000 | 0.0820 |
| 8 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.2238 | 0.4977 | 2.1200 | 1.0000 | -0.0660 |
| 9 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.2231 | 0.4909 | 2.1200 | 1.0000 | -0.0660 |
| 10 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.2209 | 0.4692 | 2.1200 | 1.0000 | -0.0660 |

## Query: Apa keunggulan Sistem Informasi?

- Retrieval query: `apa keunggulan sistem informasi`
- Detected intent: `PROGRAM`
- User intent: `GENERAL`

### Top 1 candidate

- Rank 1: CHATBOT - Double Degree (1).docx (PROGRAM_KHUSUS / N/A)
- Raw score: 3.3000
- Semantic: 0.0000
- Semantic boost: 0.0000
- Keyword/evidence: 0.1800
- Metadata boost: 2.0000
- Exact/attribute: 1.0000
- Other boosts/penalties: 0.1200

- Highest semantic candidate rank: 18
- Highest semantic score: 0.5369
- Candidate: hobi_prodi_lengkap (1).xlsx (UNKNOWN / GENERAL)

### Top 10 candidates

| Rank | Candidate | Doc Category | Chunk Type | Score | Semantic | Metadata | Exact | Other |
|---|---|---|---|---|---|---|---|---|
| 1 | CHATBOT - Double Degree (1).docx (PROGRAM_KHUSUS / N/A) | PROGRAM_KHUSUS | N/A | 3.3000 | 0.0000 | 2.0000 | 1.0000 | 0.1200 |
| 2 | HOBY.pdf (UNKNOWN / GENERAL) | UNKNOWN | GENERAL | 3.2548 | 0.5278 | 2.0000 | 1.0000 | 0.0820 |
| 3 | CHATBOT - Double Degree (1).docx (PROGRAM_KHUSUS / N/A) | PROGRAM_KHUSUS | N/A | 3.2400 | 0.0000 | 2.0000 | 1.0000 | 0.1200 |
| 4 | smoke-sectiontitle-ok-1779082103888 (BIAYA / GENERAL) | BIAYA | GENERAL | 3.1933 | 0.4129 | 2.0000 | 1.0000 | 0.0320 |
| 5 | Kalender Pendaftaran.xlsx (JADWAL / N/A) | JADWAL | N/A | 3.1441 | 0.2409 | 2.0000 | 1.0000 | 0.1200 |
| 6 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.1016 | 0.4763 | 2.0000 | 1.0000 | -0.0660 |
| 7 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.1011 | 0.4711 | 2.0000 | 1.0000 | -0.0660 |
| 8 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.1002 | 0.4622 | 2.0000 | 1.0000 | -0.0660 |
| 9 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.0988 | 0.4479 | 2.0000 | 1.0000 | -0.0660 |
| 10 | smoke-sectiontitle-ok-1779082103888 (BIAYA / COST) | BIAYA | COST | 3.0985 | 0.4449 | 2.0000 | 1.0000 | -0.0660 |

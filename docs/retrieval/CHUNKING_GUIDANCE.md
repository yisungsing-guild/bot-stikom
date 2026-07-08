Chunking guidance (300–800 chars)

Goal:
- Create chunks sized 300–800 characters focused on a single topic and intent.
- Avoid mixing categories (scholarship, tuition, majors, exchange, curriculum) in one chunk.

Rules:
- Target chunk length: 300–800 characters (approx. 50–140 words).
- Cut on natural boundaries: headings, paragraphs, list items.
- Preserve question–answer pairs together where possible.
- Split large sections (e.g., full program brochure) into per-topic files: curriculum, fees, admission requirements.

Chunk by:
- topic (e.g., "tuition - per semester fees")
- question scope (e.g., "what is double degree?" vs "how to apply for double degree")
- program type (e.g., "S1 Sistem Informasi", "D3 Manajemen Informatika")

Do NOT combine:
- scholarship + tuition + majors + exchange + curriculum in same chunk.

Practical tips:
- For PDFs: extract text and then chunk per section headings.
- For long HTML pages: prefer semantic sections (article, section, h2/h3) to cut points.
- Add metadata per chunk using METADATA_SCHEMA.md

Why this helps:
- Smaller, focused chunks increase retrieval precision and reduce cross-topic noise.
- Enables scoped retrieval by category and topic.

Metadata schema for RAG indexing

Target metadata fields:

- `category` (string): primary domain/category. Examples: "scholarship", "double_degree", "international_program", "tuition", "curriculum", "career_path", "student_life".
- `topic` (string): more specific topic within category. Examples: "international_program", "partner_university", "scholarship_deadlines".
- `audience` (string): intended audience. Examples: "student", "prospective_student", "staff".
- `tags` (array[string]): freeform tags to aid filtering. Examples: ["overseas","partnership","fee","ukm"]

Example metadata block:

{
  "category": "double_degree",
  "topic": "international_program",
  "audience": "student",
  "tags": ["overseas","partnership"]
}

Guidance:
- Aim to assign one `category` per document or chunk. Do not mix scholarship + curriculum + tuition in one chunk.
- `topic` should describe the focused sub-topic for the chunk.
- `audience` helps prioritize retrieval (e.g., student vs staff).
- `tags` are for narrow filters and quick exclusion/inclusion.

Indexing notes:
- When ingesting PDFs or long documents, split into coherent chunks and attach same metadata where appropriate.
- If a chunk contains content from multiple categories, split it into separate chunks with separate metadata.
- Prefer conservative, narrow categories; fallback to `unknown` when uncertain.

Compatibility:
- This schema is intentionally small and extensible. Future indexers may add fields like `source_id`, `doc_id`, `published_at`.

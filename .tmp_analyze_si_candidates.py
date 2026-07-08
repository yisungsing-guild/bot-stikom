#!/usr/bin/env python3
"""
Analyze SI chunk candidates from top 20 before filtering.
For each query SI benchmark, identify:
1. SI chunks (program=SI, not MI/SK/DD) from top 20
2. Their ranking, semantic score, composite score
3. Whether they passed filterRelevantChunks (in relevantIds)
4. If rejected, which rule likely rejected them
"""

import json
from pathlib import Path

# Load audit results
results_path = Path('.tmp_retrieval_results.json')
results = json.loads(results_path.read_text('utf8'))

print("=" * 120)
print("SI CHUNK CANDIDATE ANALYSIS")
print("=" * 120)

for query_idx, r in enumerate(results):
    question = r.get('question', 'N/A')
    intent = r.get('intent', 'N/A')
    user_intent = r.get('userIntent', 'N/A')
    
    print(f"\n{'='*120}")
    print(f"QUERY {query_idx + 1}: {question}")
    print(f"Intent: {intent} | UserIntent: {user_intent}")
    print(f"{'='*120}")
    
    top20 = r.get('top20', [])
    relevant_ids = set(item['id'] for item in r.get('relevantIds', []))
    
    # Extract SI candidates from top 20
    # SI = program=SI but not (MI or SK or "Double Degree")
    si_candidates = []
    
    for rank, scored_item in enumerate(top20, 1):
        item = scored_item.get('item', {})
        item_id = item.get('id', 'unknown')
        filename = item.get('filename') or item.get('trainingId') or 'unknown'
        program = item.get('program') or item.get('programName') or 'N/A'
        doc_category = scored_item.get('docCategory') or item.get('docCategory') or 'N/A'
        
        # Skip non-SI programs
        if str(program).upper() != 'SI':
            continue
        
        # Skip Double Degree (already tracked separately)
        if 'double' in filename.lower() or 'double' in str(item.get('chunk', '')).lower():
            continue
        
        # This is a valid SI candidate
        semantic_score = scored_item.get('score', 0)
        composite_score = scored_item.get('compositeScore', 0)
        final_score = scored_item.get('finalScore', 0)
        
        # Check if passed filterRelevantChunks
        passed_filter = item_id in relevant_ids
        
        si_candidates.append({
            'rank': rank,
            'id': item_id,
            'filename': filename,
            'category': doc_category,
            'semantic_score': semantic_score,
            'composite_score': composite_score,
            'final_score': final_score,
            'passed_filter': passed_filter,
            'chunk_preview': str(item.get('chunk', ''))[:150]
        })
    
    if not si_candidates:
        print("\n[NONE] NO SI CANDIDATES found in top 20 (excluding Double Degree)")
        print("\nTop 20 program distribution:")
        for rank, scored_item in enumerate(top20[:5], 1):
            item = scored_item.get('item', {})
            filename = item.get('filename') or item.get('trainingId') or 'unknown'
            program = item.get('program') or item.get('programName') or 'N/A'
            doc_category = scored_item.get('docCategory') or item.get('docCategory') or 'N/A'
            composite_score = scored_item.get('compositeScore', 0)
            print(f"  {rank}. {filename[:50]:50} | program={program} | category={doc_category} | composite={composite_score:.4f}")
    else:
        print(f"\n[YES] Found {len(si_candidates)} SI candidates in top 20:")
        print()
        
        for candidate in si_candidates:
            status = "[PASSED] filterRelevantChunks" if candidate['passed_filter'] else "[REJECTED] by filterRelevantChunks"
            print(f"  Rank #{candidate['rank']} | {status}")
            print(f"    ID: {candidate['id']}")
            print(f"    Filename: {candidate['filename']}")
            print(f"    Category: {candidate['category']}")
            print(f"    Semantic Score: {candidate['semantic_score']:.4f}")
            print(f"    Composite Score: {candidate['composite_score']:.4f}")
            print(f"    Final Score: {candidate['final_score']:.4f}")
            print(f"    Chunk Preview: {candidate['chunk_preview']}")
            print()
    
    # Summary statistics
    print(f"\nSUMMARY:")
    print(f"  - Top 20 count: {len(top20)}")
    print(f"  - SI candidates: {len(si_candidates)}")
    print(f"  - SI candidates passed filter: {sum(1 for c in si_candidates if c['passed_filter'])}")
    print(f"  - SI candidates rejected: {sum(1 for c in si_candidates if not c['passed_filter'])}")
    print(f"  - Relevant IDs after filter: {len(relevant_ids)}")
    
    # Show what passed the filter
    if relevant_ids:
        print(f"\n  [INFO] Chunks that PASSED filterRelevantChunks:")
        for item in r.get('relevantIds', []):
            print(f"    - {item['filename'][:50]:50} | category={item['docCategory']} | composite={float(item['compositeScore']):.4f}")

print("\n" + "=" * 120)
print("END OF ANALYSIS")
print("=" * 120)

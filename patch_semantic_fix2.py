from pathlib import Path
path = Path('src/engine/semanticRagEngine.js')
text = path.read_text(encoding='utf-8')
lines = text.splitlines(True)
start = next(i for i, line in enumerate(lines) if 'const asksStudentExchangeProgramOptions' in line)
end = next(i for i, line in enumerate(lines) if "if (resolved.entity.key === 'linkedin-career-center') {" in line)
new_block = [
    "  const asksStudentExchangeProgramOptions = /\\b(program\\s+apa\\s+saja|ada\\s+program\\s+apa\\s+saja|pilihan\\s+program|program\\s+yang\\s+tersedia|opsi\\s+program|ada\\s+pilihan\\s+program|program\\s+internasional|program\\s+support|program\\s+pendukung)\\b/i.test(q);\n",
    "  if (resolved.entity.key === 'student-exchange' && asksStudentExchangeProgramOptions) {\n",
    "    return {\n",
    "      answer: buildStudentExchangeProgramOptionsAnswer(),\n",
    "      source: 'semantic-rag-campus-support-entity',\n",
    "      frameSource: 'semantic-rag-campus-support-entity',\n",
    "      matchedEntity: resolved.entity.key,\n",
    "      contextResolved: resolved.fromRecent || undefined\n",
    "    };\n",
    "  }\n",
    "\n",
    "  const entityQuestion = currentMentionsEntity\n",
    "    ? question\n",
    "    : `${resolved.entity.label} ${question}`;\n",
    "  const specific = buildSpecificFacilityAnswerFromIndex(entityQuestion, indexForQuery);\n",
    "  if (specific) {\n",
    "    return {\n",
    "      ...specific,\n",
    "      source: 'semantic-rag-campus-support-entity',\n",
    "      frameSource: specific.frameSource || 'semantic-rag-campus-support-entity',\n",
    "      matchedEntity: resolved.entity.key,\n",
    "      contextResolved: resolved.fromRecent || undefined\n",
    "    };\n",
    "  }\n",
    "\n",
    "  if (resolved.entity.key === 'student-exchange') {\n",
    "    return {\n",
    "      answer: buildStudentExchangeProgramOptionsAnswer(),\n",
    "      source: 'semantic-rag-campus-support-entity',\n",
    "      frameSource: 'semantic-rag-campus-support-entity',\n",
    "      matchedEntity: resolved.entity.key,\n",
    "      contextResolved: resolved.fromRecent || undefined\n",
    "    };\n",
    "  }\n"
]
lines[start:end] = new_block
path.write_text(''.join(lines), encoding='utf-8')
print('patched', start, end)

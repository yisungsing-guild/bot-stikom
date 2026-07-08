import json
import re
from pathlib import Path
import sys
sys.path.insert(0, 'src/engine')
try:
    from ragEngine import normalizeProgramLabel
except Exception as e:
    print('ERROR importing ragEngine:', e)
    raise

index_path = Path('src/data/rag_index.json')
idx = json.loads(index_path.read_text(encoding='utf-8', errors='replace'))
null_items = [item for item in idx if not item.get('program')]

cats = {
    'Dokumen administrasi': [r'undang[- ]?undang|surat keputusan|keputusan|rektor|kepala|sekretaris|izin|notulen|putusan|peraturan|instruksi|sk |surat |pemberitahuan|pengumuman|administrasi|laporan kegiatan|kegiatan|proposal|nota dinas|nota|dokumen administrasi|persyaratan'],
    'Dokumen akreditasi': [r'akreditasi|ban-pt|banpt|akreditasi|peringkat akreditasi|surat akreditasi|sk akreditasi|perguruan tinggi terakreditasi'],
    'Dokumen biaya': [r'biaya|spp|dana pendidikan pokok|dpp|ukt|uang kuliah tunggal|uang kuliah|pendaftaran|gelombang|pembayaran|harga|tarif|biaya pendidikan|beasiswa|potongan'],
    'Dokumen program studi': [r'program studi|prodi|jurusan|sistem informasi|teknologi informasi|bisnis digital|sistem komputer|manajemen informatika|desain komunikasi visual|multimedia|animasi|teknologi komputer|rekayasa perangkat lunak|perangkat lunak'],
    'Dokumen RPL': [r'rekognisi pembelajaran lampau|rpl|rekognisi pembelajaran|pengakuan sks|rekomendasi rpl|rekayasa pembelajaran'],
    'Dokumen formulir': [r'formulir|formulir pendaftaran|daftar isi|lampiran|template|isi data|kolom|pertanyaan|survei|kuisioner|pendaftaran online|pendaftaran'],
}
ordered = [
    'Dokumen program studi',
    'Dokumen RPL',
    'Dokumen biaya',
    'Dokumen akreditasi',
    'Dokumen formulir',
    'Dokumen administrasi',
]
compiled = {cat: [re.compile(p, re.I | re.UNICODE) for p in patterns] for cat, patterns in cats.items()}
classified = {cat: [] for cat in cats}
classified['Dokumen lain'] = []
for item in null_items:
    tex = item.get('chunk', '')
    text_lo = tex.lower()
    found = False
    for cat in ordered:
        if any(p.search(text_lo) for p in compiled[cat]):
            classified[cat].append(item)
            found = True
            break
    if not found:
        classified['Dokumen lain'].append(item)

output_lines = []
output_lines.append(f'total_null={len(null_items)}')
for cat, items in classified.items():
    filenames = sorted({it.get('filename') or it.get('sourceFile') or 'UNKNOWN' for it in items})
    output_lines.append(f'CATEGORY: {cat} count={len(items)}')
    output_lines.append(f'  filenames sample={filenames[:10]}')

output_lines.append('\nSAMPLES 100 NULL CHUNKS:')
for i, item in enumerate(null_items[:100], 1):
    cat = next((c for c, its in classified.items() if item in its), 'Dokumen lain')
    snippet = item.get('chunk', '').strip().replace('\n', '\\n')
    filename = item.get('filename') or item.get('sourceFile') or 'UNKNOWN'
    output_lines.append(f'--- {i} id={item.get("id")} filename={filename} category={cat}')
    output_lines.append(f'  snippet={snippet[:300]}')

keywords = [r'program studi', r'prodi', r'jurusan', r'sistem informasi', r'teknologi informasi', r'(?<!\w)bisnis digital', r'sistem komputer']
kw_re = re.compile('|'.join(keywords), re.I)
output_lines.append('\nSUSPICIOUS KEYWORD NULL CHUNKS:')
totalsusp = 0
for item in null_items:
    if kw_re.search(item.get('chunk', '')):
        totalsusp += 1
        if totalsusp <= 50:
            prog_norm = normalizeProgramLabel(item.get('chunk', '') or '')
            filename = item.get('filename') or item.get('sourceFile') or 'UNKNOWN'
            output_lines.append(f'id={item.get("id")} filename={filename} program={item.get("program")} normalize={prog_norm}')
output_lines.append(f'total suspicious count={totalsusp}')

out_path = Path('tmp/audit_null_programs.txt')
out_path.write_text('\n'.join(output_lines), encoding='utf-8')
print(f'Wrote {out_path} ({len(output_lines)} lines)')

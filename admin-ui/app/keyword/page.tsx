"use client"

import { useEffect, useMemo, useState } from 'react'
import { Plus, Edit2, Trash2, Search } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { AdminApiError, adminFetchJson } from '@/lib/adminApi'

type KeywordReply = {
  id: string
  keyword: string
  response: string
  matchType: string
  priority?: number
  active?: boolean
  createdAt?: string
}

type MediaUploadResponse = {
  ok?: boolean
  url?: string
  marker?: string
  storedAs?: string
  originalname?: string
  size?: number
  mimetype?: string
}

export default function KeywordPage() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<KeywordReply[] | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formKeyword, setFormKeyword] = useState('')
  const [formMatchType, setFormMatchType] = useState('contains')
  const [formResponse, setFormResponse] = useState('')
  const [formPriority, setFormPriority] = useState('0')

  const [imageCaption, setImageCaption] = useState('')
  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [uploadedImage, setUploadedImage] = useState<MediaUploadResponse | null>(null)

  const isEditMode = useMemo(() => !!editingId, [editingId])

  function resetForm() {
    setFormKeyword('')
    setFormMatchType('contains')
    setFormResponse('')
    setFormPriority('0')
    setImageCaption('')
    setUploadedImage(null)
    setImageError(null)
    setError(null)
  }

  function openAddDialog() {
    setEditingId(null)
    resetForm()
    setAddOpen(true)
  }

  function openEditDialog(kw: KeywordReply) {
    if (!kw || !kw.id) return
    setEditingId(String(kw.id))
    setFormKeyword(String(kw.keyword || ''))
    setFormMatchType(String(kw.matchType || 'contains'))
    setFormResponse(String(kw.response || ''))
    setFormPriority(String(typeof kw.priority === 'number' ? kw.priority : 0))
    setImageCaption('')
    setUploadedImage(null)
    setImageError(null)
    setError(null)
    setAddOpen(true)
  }

  async function fetchItems(q: string) {
    const trimmed = q.trim()
    const url = trimmed ? `/admin/keywords?q=${encodeURIComponent(trimmed)}` : '/admin/keywords'
    const res = await adminFetchJson<KeywordReply[]>(url)
    setItems(Array.isArray(res) ? res : [])
    setItemsError(null)
  }

  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(async () => {
      try {
        await fetchItems(query)
        if (cancelled) return
      } catch (e) {
        if (cancelled) return
        let msg = 'Failed to load keywords from API.'
        if (e instanceof AdminApiError) {
          msg = `Failed to load keywords (${e.status}).`
          if (e.bodyText) msg = `${msg} ${e.bodyText.slice(0, 180)}`
        }
        setItemsError(msg)
        setItems([])
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [query])

  async function handleSave() {
    const keyword = formKeyword.trim()
    const matchType = formMatchType.trim()
    const response = formResponse.trim()

    if (!keyword || !matchType || !response) {
      setError('Keyword, Match Type, dan Response wajib diisi')
      return
    }

    const priorityNum = Number.parseInt(formPriority || '0', 10)
    const priority = Number.isFinite(priorityNum) ? priorityNum : 0

    setSaving(true)
    setError(null)
    try {
      if (editingId) {
        await adminFetchJson(`/admin/keywords/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          body: JSON.stringify({ keyword, matchType, response, priority }),
        })
      } else {
        await adminFetchJson('/admin/keywords', {
          method: 'POST',
          body: JSON.stringify({ keyword, matchType, response, priority }),
        })
      }

      setAddOpen(false)
      setEditingId(null)
      resetForm()

      await fetchItems(query)
    } catch (e: any) {
      const body = e && e.bodyText ? String(e.bodyText) : ''
      const msg = e && e.status === 403
        ? (editingId
          ? 'Forbidden: role kamu tidak punya akses untuk mengubah keyword'
          : 'Forbidden: role kamu tidak punya akses untuk menambah keyword')
        : (body || e?.message || (editingId ? 'Gagal update keyword' : 'Gagal menambah keyword'))
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(idRaw: string) {
    const id = String(idRaw || '').trim()
    if (!id) return

    const item = (items || []).find((x) => String(x && x.id) === id) || null
    const label = item && item.keyword ? String(item.keyword) : id

    const ok = typeof window !== 'undefined'
      ? window.confirm(`Hapus keyword "${label}"?\n\nAksi ini tidak bisa dibatalkan.`)
      : false
    if (!ok) return

    setDeletingId(id)
    try {
      await adminFetchJson(`/admin/keywords/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await fetchItems(query)
    } catch (e: any) {
      const body = e && e.bodyText ? String(e.bodyText) : ''
      const msg = body || e?.message || 'Gagal menghapus keyword'
      setItemsError(msg)
    } finally {
      setDeletingId(null)
    }
  }

  async function uploadImage(file: File) {
    setImageUploading(true)
    setImageError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const caption = imageCaption.trim()
      if (caption) fd.append('caption', caption)

      const res = await adminFetchJson<MediaUploadResponse>('/admin/media/upload', {
        method: 'POST',
        body: fd,
      })

      setUploadedImage(res)

      const marker = res && res.marker ? String(res.marker) : ''
      if (marker) {
        setFormResponse((prev) => {
          const p = String(prev || '')
          if (p.includes(marker)) return p
          if (!p.trim()) return marker
          return `${marker}\n\n${p}`.trim()
        })
      }
    } catch (e: any) {
      const body = e && e.bodyText ? String(e.bodyText) : ''
      setImageError(body || e?.message || 'Gagal upload gambar')
      setUploadedImage(null)
    } finally {
      setImageUploading(false)
    }
  }

  const rows = useMemo(() => {
    if (!items) return []

    return items.map((kw) => ({
      id: kw.id,
      keyword: kw.keyword,
      response: kw.response,
      type: kw.matchType,
      priority: typeof kw.priority === 'number' ? kw.priority : 0,
      active: kw.active !== false,
      createdAt: kw.createdAt || '',
    }))
  }, [items])

  return (
    <div className="space-y-8 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Keywords</h1>
          <p className="text-muted-foreground mt-2">Manage keywords and their responses</p>
        </div>
        <Dialog open={addOpen} onOpenChange={(v) => {
          setAddOpen(v)
          if (v) {
            setError(null)
            setImageError(null)
          } else {
            setEditingId(null)
            resetForm()
          }
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={openAddDialog}>
              <Plus className="h-4 w-4" />
              Add Keyword
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isEditMode ? 'Edit Keyword' : 'Add Keyword'}</DialogTitle>
              <DialogDescription>
                {isEditMode ? 'Ubah keyword yang sudah ada.' : 'Tambahkan keyword baru untuk auto-reply.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="kw-keyword">Keyword</Label>
                <Input
                  id="kw-keyword"
                  value={formKeyword}
                  onChange={(e) => setFormKeyword(e.target.value)}
                  placeholder="mis: biaya kuliah / jadwal kuliah / krs"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="kw-match">Match Type</Label>
                <select
                  id="kw-match"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                  value={formMatchType}
                  onChange={(e) => setFormMatchType(e.target.value)}
                >
                  <option value="contains">contains</option>
                  <option value="exact">exact</option>
                  <option value="starts_with">starts_with</option>
                  <option value="regex">regex</option>
                </select>
                {formMatchType === 'regex' ? (
                  <p className="text-xs text-muted-foreground">
                    Regex pakai JavaScript RegExp (case-insensitive). Tulis pola tanpa{' '}
                    <span className="font-mono">/ /</span>. Contoh:{' '}
                    <span className="font-mono">^promo</span>,{' '}
                    <span className="font-mono">^(info|help)$</span>, atau{' '}
                    <span className="font-mono">biaya\\s+kuliah</span>.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="kw-response">Response</Label>
                <Textarea
                  id="kw-response"
                  value={formResponse}
                  onChange={(e) => setFormResponse(e.target.value)}
                  placeholder="Tulis balasan bot (boleh multi-baris)…"
                  className="!field-sizing-fixed max-h-60 overflow-y-auto"
                  rows={5}
                />
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                  <div className="text-sm font-medium">Gambar (opsional)</div>
                  <div className="grid gap-2">
                    <div className="grid gap-1">
                      <Label htmlFor="kw-image-caption">Caption (opsional)</Label>
                      <Input
                        id="kw-image-caption"
                        value={imageCaption}
                        onChange={(e) => setImageCaption(e.target.value)}
                        placeholder="mis: Formulir pendaftaran"
                      />
                    </div>

                    <div className="grid gap-1">
                      <Label htmlFor="kw-image-file">Upload gambar</Label>
                      <Input
                        id="kw-image-file"
                        type="file"
                        accept="image/*"
                        disabled={imageUploading}
                        onChange={(e) => {
                          const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
                          if (!f) return
                          void uploadImage(f)
                          // allow re-select same file
                          try { e.currentTarget.value = '' } catch { /* ignore */ }
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Setelah upload sukses, marker akan otomatis ditambahkan ke Response.
                      </p>
                    </div>

                    {uploadedImage && uploadedImage.url ? (
                      <div className="text-xs text-muted-foreground break-all">
                        URL: {uploadedImage.url}
                      </div>
                    ) : null}

                    {imageError ? (
                      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
                        {imageError}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="kw-priority">Priority</Label>
                <Input
                  id="kw-priority"
                  type="number"
                  value={formPriority}
                  onChange={(e) => setFormPriority(e.target.value)}
                  placeholder="0 (default)"
                />
              </div>

              {error ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
                  {error}
                </div>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (isEditMode ? 'Updating...' : 'Saving...') : (isEditMode ? 'Update' : 'Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari keyword…"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemsError ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-muted-foreground">
                      {itemsError}
                    </TableCell>
                  </TableRow>
                ) : null}

                {!itemsError && items && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-muted-foreground">
                      No keywords found.
                    </TableCell>
                  </TableRow>
                ) : null}

                {!itemsError && items === null ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : null}

                {rows.map((kw) => (
                  <TableRow key={kw.id}>
                    <TableCell className="font-medium">{kw.keyword}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {kw.response}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{kw.type}</Badge>
                    </TableCell>
                    <TableCell>{'priority' in kw ? kw.priority : kw.count}</TableCell>
                    <TableCell>
                      {'active' in kw ? (
                        <Badge variant={kw.active ? 'default' : 'secondary'}>
                          {kw.active ? 'true' : 'false'}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">—</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {'createdAt' in kw && kw.createdAt
                        ? new Date(kw.createdAt).toISOString().slice(0, 10)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(kw)}
                          disabled={saving || deletingId === kw.id}
                          aria-label={`Edit keyword ${kw.keyword}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDelete(kw.id)}
                          disabled={saving || deletingId === kw.id}
                          aria-label={`Delete keyword ${kw.keyword}`}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState } from 'react'
import { Plus, Edit2, Trash2, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { AdminApiError, adminFetchJson } from '@/lib/adminApi'

type MenuItem = {
  id: string
  key: string
  text: string
  parentId?: string | null
  order?: number
  followupPrompt?: string | null
}

type MenuRow = {
  id: string
  title: string
  key: string
  order: number
  parentId: string | null
  submenu: number
  status: 'active'
}

function menuLabelFromText(text: string) {
  const raw = String(text || '').replace(/\r\n/g, '\n')
  const firstNonEmpty = raw
    .split('\n')
    .map((l) => String(l || '').trim())
    .find((l) => !!l) || ''
  const compact = firstNonEmpty.replace(/\s{2,}/g, ' ').trim()
  if (!compact) return '(empty)'
  return compact.length > 80 ? compact.slice(0, 79) + '…' : compact
}

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[] | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formText, setFormText] = useState('')
  const [formOrder, setFormOrder] = useState('')
  const [formParentId, setFormParentId] = useState<string>('__root__')
  const [formFollowupPrompt, setFormFollowupPrompt] = useState('')

  const [editKey, setEditKey] = useState('')
  const [editText, setEditText] = useState('')
  const [editOrder, setEditOrder] = useState('')
  const [editParentId, setEditParentId] = useState<string>('__root__')
  const [editFollowupPrompt, setEditFollowupPrompt] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await adminFetchJson<MenuItem[]>('/admin/menu')
        if (cancelled) return
        setItems(Array.isArray(res) ? res : [])
        setItemsError(null)
      } catch {
        if (cancelled) return
        setItems([])
        setItemsError('Failed to load menu from API.')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function refresh() {
    try {
      const res = await adminFetchJson<MenuItem[]>('/admin/menu')
      setItems(Array.isArray(res) ? res : [])
      setItemsError(null)
    } catch {
      setItems([])
      setItemsError('Failed to load menu from API.')
    }
  }

  async function handleAdd() {
    const key = formKey.trim()
    const text = formText.trim()
    const orderRaw = formOrder.trim()
    const orderNum = orderRaw === '' ? null : Number.parseInt(orderRaw, 10)
    if (orderNum !== null && !Number.isFinite(orderNum)) {
      setError('Order harus berupa angka')
      return
    }
    if (orderNum !== null && orderNum < 0) {
      setError('Order tidak boleh negatif')
      return
    }
    const parentId = formParentId === '__root__' ? null : formParentId

    if (!key || !text) {
      setError('Key dan Text wajib diisi')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const followupPrompt = formFollowupPrompt.trim()
      await adminFetchJson('/admin/menu', {
        method: 'POST',
        body: JSON.stringify({ 
          key, 
          text, 
          order: orderNum ?? undefined, 
          parentId,
          followupPrompt: followupPrompt === '' ? undefined : followupPrompt
        }),
      })

      setAddOpen(false)
      setFormKey('')
      setFormText('')
      setFormOrder('')
      setFormParentId('__root__')
      setFormFollowupPrompt('')
      await refresh()
    } catch (e: any) {
      const body = e && e.bodyText ? String(e.bodyText) : ''
      const msg = e && e.status === 403
        ? 'Forbidden: role kamu tidak punya akses untuk menambah menu'
        : (body || e?.message || 'Gagal menambah menu')
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  function openEditDialog(menuId: string) {
    const id = String(menuId || '').trim()
    if (!id) return
    const current = Array.isArray(items) ? items.find((it) => it && it.id === id) : null
    if (!current) return

    setEditingId(id)
    setEditKey(String(current.key || ''))
    setEditText(String(current.text || ''))
    setEditOrder(typeof current.order === 'number' ? String(current.order) : '')
    setEditParentId(current.parentId ? String(current.parentId) : '__root__')
    setEditFollowupPrompt(String(current.followupPrompt || ''))
    setEditError(null)
    setEditOpen(true)
  }

  async function handleEditSave() {
    const id = String(editingId || '').trim()
    if (!id) return

    const key = editKey.trim()
    const text = editText.trim()
    const orderRaw = editOrder.trim()
    const orderNum = orderRaw === '' ? undefined : Number.parseInt(orderRaw, 10)
    if (typeof orderNum !== 'undefined' && !Number.isFinite(orderNum)) {
      setEditError('Order harus berupa angka')
      return
    }
    if (typeof orderNum !== 'undefined' && orderNum < 0) {
      setEditError('Order tidak boleh negatif')
      return
    }

    const parentId = editParentId === '__root__' ? null : editParentId

    if (!key || !text) {
      setEditError('Key dan Text wajib diisi')
      return
    }

    setSaving(true)
    setEditError(null)
    try {
      const followupPrompt = editFollowupPrompt.trim()
      await adminFetchJson(`/admin/menu/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ 
          key, 
          text, 
          order: typeof orderNum === 'number' ? orderNum : undefined, 
          parentId,
          followupPrompt: followupPrompt === '' ? undefined : followupPrompt
        }),
      })
      setEditOpen(false)
      setEditingId(null)
      await refresh()
    } catch (e: any) {
      const body = e && e.bodyText ? String(e.bodyText) : ''
      const msg = e && e.status === 403
        ? 'Forbidden: role kamu tidak punya akses untuk mengedit menu'
        : (body || e?.message || 'Gagal mengedit menu')
      setEditError(msg)
    } finally {
      setSaving(false)
    }
  }

  function openDeleteDialog(menuId: string) {
    const id = String(menuId || '').trim()
    if (!id) return
    setDeletingId(id)
    setDeleteError(null)
    setDeleteOpen(true)
  }

  async function handleDeleteConfirm() {
    const id = String(deletingId || '').trim()
    if (!id) return
    setSaving(true)
    setDeleteError(null)
    try {
      await adminFetchJson(`/admin/menu/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setDeleteOpen(false)
      setDeletingId(null)
      await refresh()
    } catch (e: any) {
      const body = e && e.bodyText ? String(e.bodyText) : ''
      const msg = e && e.status === 403
        ? 'Forbidden: role kamu tidak punya akses untuk menghapus menu'
        : (body || e?.message || 'Gagal menghapus menu')
      setDeleteError(msg)
    } finally {
      setSaving(false)
    }
  }

  const menuItems = useMemo<MenuRow[]>(() => {
    if (!items) return []

    const childrenCount = new Map<string, number>()
    for (const it of items) {
      if (!it.parentId) continue
      childrenCount.set(it.parentId, (childrenCount.get(it.parentId) || 0) + 1)
    }

    const topLevel = items.filter((it) => !it.parentId)
    topLevel.sort((a, b) => (a.order || 0) - (b.order || 0))

    return topLevel.map((it) => ({
      id: it.id,
      title: menuLabelFromText(it.text),
      key: it.key,
      order: it.order || 0,
      parentId: it.parentId ?? null,
      submenu: childrenCount.get(it.id) || 0,
      status: 'active',
    }))
  }, [items])

  const menuTree = useMemo(() => {
    if (!items) return [] as Array<MenuItem & { children: Array<MenuItem & { children: any[] }> }>

    const byId = new Map<string, MenuItem & { children: Array<MenuItem & { children: any[] }> }>()
    for (const item of items) {
      if (!item || !item.id) continue
      byId.set(item.id, { ...item, children: [] })
    }

    const roots: Array<MenuItem & { children: Array<MenuItem & { children: any[] }> }> = []
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    const sortNodes = (nodes: Array<MenuItem & { children: any[] }>) => {
      nodes.sort((a, b) => {
        const byOrder = (a.order || 0) - (b.order || 0)
        if (byOrder !== 0) return byOrder
        return menuLabelFromText(a.text).localeCompare(menuLabelFromText(b.text))
      })
      for (const node of nodes) sortNodes(node.children)
    }

    sortNodes(roots)
    return roots
  }, [items])

  function toggleExpanded(menuId: string) {
    const id = String(menuId || '').trim()
    if (!id) return
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderMenuNode(node: MenuItem & { children: any[] }, depth = 0) {
    const title = menuLabelFromText(node.text)
    const hasChildren = Array.isArray(node.children) && node.children.length > 0
    const isExpanded = expandedIds.has(node.id)

    return (
      <div key={node.id} className={depth > 0 ? 'pl-6' : ''}>
        <Card
          className={`p-6 transition-colors ${hasChildren ? 'cursor-pointer hover:bg-muted/50' : ''}`}
          onClick={hasChildren ? () => toggleExpanded(node.id) : undefined}
          role={hasChildren ? 'button' : undefined}
          aria-expanded={hasChildren ? isExpanded : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          onKeyDown={hasChildren ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleExpanded(node.id)
            }
          } : undefined}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold truncate">{title}</h3>
                  <p className="text-sm text-muted-foreground break-all">{node.key}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">order {node.order || 0}</Badge>
                <Badge variant="outline">
                  parent {node.parentId ? node.parentId.slice(0, 8) : '—'}
                </Badge>
                <Badge variant="outline">id {node.id.slice(0, 8)}</Badge>
                {hasChildren ? (
                  <Badge variant="outline">{node.children.length} sub-items</Badge>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <Badge variant="default">active</Badge>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openEditDialog(node.id)
                  }}
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openDeleteDialog(node.id)
                  }}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
              {hasChildren ? (
                <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              ) : null}
            </div>
          </div>
        </Card>

        {hasChildren && isExpanded ? (
          <div className="mt-3 space-y-3">
            {node.children.map((child) => renderMenuNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  const parentOptions = useMemo(() => {
    const list = Array.isArray(items) ? items.slice() : []
    list.sort((a, b) => {
      const byOrder = (a.order || 0) - (b.order || 0)
      if (byOrder !== 0) return byOrder
      return menuLabelFromText(a.text).localeCompare(menuLabelFromText(b.text))
    })
    return list
  }, [items])

  return (
    <div className="space-y-8 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Menu</h1>
          <p className="text-muted-foreground mt-2">Configure bot menu structure</p>
        </div>
        <Dialog open={addOpen} onOpenChange={(v) => {
          setAddOpen(v)
          if (v) {
            setError(null)
            setFormParentId('__root__')
          }
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Menu Item
            </Button>
          </DialogTrigger>
          <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>Add Menu Item</DialogTitle>
              <DialogDescription>Tambahkan menu top-level baru.</DialogDescription>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0 pr-4">
              <div className="space-y-4 pb-6">
                <div className="space-y-2">
                  <Label htmlFor="menu-parent">Parent</Label>
                  <Select value={formParentId} onValueChange={setFormParentId}>
                    <SelectTrigger id="menu-parent" className="w-full">
                      <SelectValue placeholder="Top-level (tanpa parent)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__root__">Top-level (tanpa parent)</SelectItem>
                      {parentOptions.map((it) => (
                        <SelectItem key={it.id} value={it.id}>
                          {menuLabelFromText(it.text)} ({it.key})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Untuk submenu, pilih parent lalu isi <b>Key</b> dengan pola seperti <b>root.1.2</b>.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="menu-key">Key</Label>
                  <Input
                    id="menu-key"
                    value={formKey}
                    onChange={(e) => setFormKey(e.target.value)}
                    placeholder="mis: root.1 (top-level) atau root.1.2 (submenu)"
                  />
                  <p className="text-xs text-muted-foreground">
                    Bot membaca menu berdasarkan <b>Key</b> (contoh: <b>root.1</b>, <b>root.1.2</b>). Parent hanya untuk struktur di admin.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="menu-text">Text</Label>
                  <Textarea
                    id="menu-text"
                    value={formText}
                    onChange={(e) => setFormText(e.target.value)}
                    placeholder="Teks balasan/menu yang akan dikirim bot"
                    className="!field-sizing-fixed max-h-72 overflow-y-auto"
                    rows={6}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="menu-order">Order (optional)</Label>
                  <Input
                    id="menu-order"
                    type="number"
                    value={formOrder}
                    onChange={(e) => setFormOrder(e.target.value)}
                    placeholder="Auto"
                  />
                  <p className="text-xs text-muted-foreground">
                    Kosongkan untuk urutan otomatis (berdasarkan parent yang sama).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="menu-followup">Follow-up Prompt (optional)</Label>
                  <Textarea
                    id="menu-followup"
                    value={formFollowupPrompt}
                    onChange={(e) => setFormFollowupPrompt(e.target.value)}
                    placeholder="Misal: 'Jika ingin tahu lebih lanjut, ketik 3'"
                    className="!field-sizing-fixed max-h-32 overflow-y-auto"
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    Instruksi atau prompt yang ditambahkan di akhir teks menu ini untuk mendorong user explore submenu lain.
                  </p>
                </div>

                {error ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
                    {error}
                  </div>
                ) : null}
              </div>
            </ScrollArea>

            <DialogFooter className="relative z-10 bg-background pt-2">
              <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleAdd} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => {
        setEditOpen(v)
        if (!v) {
          setEditingId(null)
          setEditError(null)
        }
      }}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Edit Menu Item</DialogTitle>
            <DialogDescription>Ubah key/text/order/parent untuk item menu.</DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 min-h-0 pr-4">
            <div className="space-y-4 pb-6">
              <div className="space-y-2">
                <Label htmlFor="edit-menu-parent">Parent</Label>
                <Select value={editParentId} onValueChange={setEditParentId}>
                  <SelectTrigger id="edit-menu-parent" className="w-full">
                    <SelectValue placeholder="Top-level (tanpa parent)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__root__">Top-level (tanpa parent)</SelectItem>
                    {parentOptions
                      .filter((it) => it.id !== editingId)
                      .map((it) => (
                        <SelectItem key={it.id} value={it.id}>
                          {menuLabelFromText(it.text)} ({it.key})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-menu-key">Key</Label>
                <Input
                  id="edit-menu-key"
                  value={editKey}
                  onChange={(e) => setEditKey(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-menu-text">Text</Label>
                <Textarea
                  id="edit-menu-text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="!field-sizing-fixed max-h-72 overflow-y-auto"
                  rows={8}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-menu-order">Order (optional)</Label>
                <Input
                  id="edit-menu-order"
                  type="number"
                  value={editOrder}
                  onChange={(e) => setEditOrder(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-menu-followup">Follow-up Prompt (optional)</Label>
                <Textarea
                  id="edit-menu-followup"
                  value={editFollowupPrompt}
                  onChange={(e) => setEditFollowupPrompt(e.target.value)}
                  placeholder="Misal: 'Jika ingin tahu lebih lanjut, ketik 3'"
                  className="!field-sizing-fixed max-h-32 overflow-y-auto"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Instruksi atau prompt yang ditambahkan di akhir teks menu ini untuk mendorong user explore submenu lain.
                </p>
              </div>

              {editError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
                  {editError}
                </div>
              ) : null}
            </div>
          </ScrollArea>

          <DialogFooter className="relative z-10 bg-background pt-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteOpen} onOpenChange={(v) => {
        setDeleteOpen(v)
        if (!v) {
          setDeletingId(null)
          setDeleteError(null)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Menu Item?</DialogTitle>
            <DialogDescription>
              Item ini akan dihapus. Jika item punya sub-menu, sub-menu juga akan ikut terhapus.
            </DialogDescription>
          </DialogHeader>

          {deleteError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
              {deleteError}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={saving}>
              {saving ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-3">
        {itemsError ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">{itemsError}</p>
          </Card>
        ) : null}

        {!itemsError && items === null ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </Card>
        ) : null}

        {!itemsError && items && items.length === 0 ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">No menu items found.</p>
          </Card>
        ) : null}

        {menuTree.map((item) => renderMenuNode(item))}
      </div>

      <Card className="p-6 border-dashed">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Preview your menu structure</p>
          <Button variant="outline" size="sm">
            Open Preview
          </Button>
        </div>
      </Card>
    </div>
  )
}

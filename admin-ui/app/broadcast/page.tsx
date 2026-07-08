"use client"

import { useEffect, useMemo, useState } from 'react'
import { Plus, Edit2, Trash2, Clock, CheckCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { AdminApiError, adminFetchJson } from '@/lib/adminApi'

type BroadcastItem = {
  id: string
  title: string
  body: string
  status: string
  recipientList?: unknown
  scheduledAt?: string | null
  sentCount?: number
  failedCount?: number
  createdAt?: string
  completedAt?: string | null
  updatedAt?: string
}

export default function BroadcastPage() {
  const [items, setItems] = useState<BroadcastItem[] | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formScheduledAt, setFormScheduledAt] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await adminFetchJson<BroadcastItem[]>('/admin/broadcast')
        if (cancelled) return
        setItems(Array.isArray(res) ? res : [])
        setItemsError(null)
      } catch {
        if (cancelled) return
        setItems([])
        setItemsError('Failed to load broadcasts from API.')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function refresh() {
    try {
      const res = await adminFetchJson<BroadcastItem[]>('/admin/broadcast')
      setItems(Array.isArray(res) ? res : [])
      setItemsError(null)
    } catch {
      setItems([])
      setItemsError('Failed to load broadcasts from API.')
    }
  }

  async function handleCreate() {
    const title = formTitle.trim()
    const body = formBody.trim()
    const scheduledAtRaw = formScheduledAt.trim()
    const scheduledAtDate = scheduledAtRaw ? new Date(scheduledAtRaw) : null
    const scheduledAt = scheduledAtDate ? scheduledAtDate.toISOString() : ''

    if (scheduledAtRaw && (!scheduledAtDate || Number.isNaN(scheduledAtDate.getTime()))) {
      setError('Scheduled At tidak valid. Silakan pilih tanggal dan waktu dari picker.')
      return
    }

    if (!title || !body) {
      setError('Title dan Message wajib diisi')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await adminFetchJson('/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          title,
          body,
          ...(scheduledAt ? { scheduledAt } : {}),
        }),
      })

      setAddOpen(false)
      setFormTitle('')
      setFormBody('')
      setFormScheduledAt('')
      await refresh()
    } catch (e: any) {
      const bodyText = e && e.bodyText ? String(e.bodyText) : ''
      const msg = e && e.status === 403
        ? 'Forbidden: role kamu tidak punya akses untuk membuat broadcast'
        : (bodyText || e?.message || 'Gagal membuat broadcast')
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const broadcasts = useMemo(() => {
    if (!items) return []

    return items.map((b) => {
      const sent = typeof b.sentCount === 'number' ? b.sentCount : 0
      const failed = typeof b.failedCount === 'number' ? b.failedCount : 0

      let recipients: number | null = sent + failed
      let target: string = ''
      if (Array.isArray(b.recipientList)) {
        recipients = b.recipientList.length
        target = `${b.recipientList.length}`
      } else if (typeof b.recipientList === 'string') {
        recipients = null
        target = b.recipientList
      } else if (b.recipientList != null) {
        recipients = null
        target = 'custom'
      }

      const toDate = (value?: string | null) => {
        if (!value) return ''
        const d = new Date(value)
        return !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : ''
      }

      const statusRaw = (b.status || '').toLowerCase()
      const status = statusRaw || 'unknown'

      return {
        id: b.id,
        title: b.title,
        message: b.body,
        status,
        target,
        recipients,
        sent,
        failed,
        scheduledAt: toDate(b.scheduledAt || null),
        createdAt: toDate(b.createdAt || ''),
        completedAt: toDate(b.completedAt || null),
        updatedAt: toDate(b.updatedAt || ''),
      }
    })
  }, [items])

  const summary = useMemo(() => {
    const total = broadcasts.length
    const scheduled = broadcasts.filter((b) => ['queued', 'scheduled', 'in_progress'].includes(b.status)).length
    const sentTotal = broadcasts.reduce((acc, b) => acc + (typeof (b as any).sent === 'number' ? (b as any).sent : 0), 0)
    const recipientsTotal = broadcasts.reduce((acc, b) => acc + (typeof (b as any).recipients === 'number' ? ((b as any).recipients as number) : 0), 0)
    const successRate = recipientsTotal > 0 ? ((sentTotal / recipientsTotal) * 100) : 0
    return { total, scheduled, successRate }
  }, [broadcasts])

  return (
    <div className="space-y-8 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Broadcast</h1>
          <p className="text-muted-foreground mt-2">Send messages to multiple users</p>
        </div>
        <Dialog open={addOpen} onOpenChange={(v) => {
          setAddOpen(v)
          if (v) setError(null)
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Create Broadcast
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Broadcast</DialogTitle>
              <DialogDescription>Broadcast default ke semua user yang opt-in.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bc-title">Title</Label>
                <Input
                  id="bc-title"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="mis: Pengumuman UTS"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bc-body">Message</Label>
                <Textarea
                  id="bc-body"
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  placeholder="Isi pesan broadcast yang akan dikirim…"
                  rows={6}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bc-scheduled">Scheduled At (optional)</Label>
                <Input
                  id="bc-scheduled"
                  type="datetime-local"
                  value={formScheduledAt}
                  onChange={(e) => setFormScheduledAt(e.target.value)}
                  placeholder="Pilih tanggal dan waktu"
                />
                <p className="text-xs text-muted-foreground">
                  Kosongkan untuk kirim sekarang.
                </p>
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
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Total Broadcasts</p>
            <p className="text-3xl font-bold">{summary.total}</p>
            <p className="text-xs text-muted-foreground">From database</p>
          </div>
        </Card>
        <Card className="p-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Scheduled</p>
            <p className="text-3xl font-bold">{summary.scheduled}</p>
            <p className="text-xs text-muted-foreground">From database</p>
          </div>
        </Card>
        <Card className="p-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Success Rate</p>
            <p className="text-3xl font-bold">{summary.successRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">From database</p>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Broadcast History</h2>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemsError ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-sm text-muted-foreground">
                      {itemsError}
                    </TableCell>
                  </TableRow>
                ) : null}

                {!itemsError && items === null ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : null}

                {!itemsError && items && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-sm text-muted-foreground">
                      No broadcasts yet.
                    </TableCell>
                  </TableRow>
                ) : null}

                {broadcasts.map((broadcast) => (
                  <TableRow key={broadcast.id}>
                    <TableCell className="font-medium">{broadcast.title}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {broadcast.message}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          broadcast.status === 'completed'
                            ? 'default'
                            : 'secondary'
                        }
                        className="gap-1"
                      >
                        {broadcast.status === 'completed' ? (
                          <CheckCircle className="h-3 w-3" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                        {broadcast.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(broadcast as any).target || (typeof (broadcast as any).recipients === 'number' ? String((broadcast as any).recipients) : '—')}
                    </TableCell>
                    <TableCell>
                      {(broadcast as any).sent}
                      {typeof (broadcast as any).recipients === 'number' ? `/${(broadcast as any).recipients}` : ''}
                    </TableCell>
                    <TableCell>{(broadcast as any).failed}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {(broadcast as any).scheduledAt || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {(broadcast as any).createdAt || '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {['queued', 'scheduled', 'in_progress'].includes(broadcast.status) && (
                          <Button variant="ghost" size="sm">
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm">
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

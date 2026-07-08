"use client"

import { useEffect, useMemo, useState } from 'react'
import { Download, Filter, Search } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AdminApiError, adminFetchJson } from '@/lib/adminApi'

type ChatMessage = {
  direction?: 'user' | 'bot' | 'agent' | 'system' | string
  message?: string
  at?: string
}

type ChatRecapResponse = {
  chatId: string
  top: Array<{ question: string; count: number }>
}

type ChatListItem = {
  chatId: string
  updatedAt?: string
  status?: string
  lastSeenAt?: string | null
  optIn?: boolean | null
  lastMessage?: ChatMessage | null
}

const DEMO_CHAT_ITEMS: ChatListItem[] = [
  {
    chatId: '628123450001',
    updatedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    status: 'BOT',
    lastSeenAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    optIn: true,
    lastMessage: { direction: 'user', message: 'Halo kak, saya mau tanya biaya kuliah.', at: new Date(Date.now() - 1000 * 60 * 8).toISOString() },
  },
  {
    chatId: '628123450002',
    updatedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    status: 'HUMAN',
    lastSeenAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    optIn: true,
    lastMessage: { direction: 'agent', message: 'Baik kak, saya bantu ya. Mau prodi apa?', at: new Date(Date.now() - 1000 * 60 * 35).toISOString() },
  },
  {
    chatId: '628123450003',
    updatedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    status: 'BOT',
    lastSeenAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    optIn: false,
    lastMessage: { direction: 'bot', message: 'Baik kak, kami tidak akan mengirim pesan lagi. Terima kasih.', at: new Date(Date.now() - 1000 * 60 * 120).toISOString() },
  },
]

const DEMO_MESSAGES_BY_CHAT: Record<string, ChatMessage[]> = {
  '628123450001': [
    { direction: 'user', message: 'Halo kak, saya mau tanya biaya kuliah.', at: new Date(Date.now() - 1000 * 60 * 12).toISOString() },
    { direction: 'bot', message: 'Halo kak! Boleh ya, kak. Untuk biaya kuliah, biasanya tergantung prodi & jalur masuk. Kakak minat prodi apa?', at: new Date(Date.now() - 1000 * 60 * 11).toISOString() },
    { direction: 'user', message: 'Sistem Informasi. Ada cicilan?', at: new Date(Date.now() - 1000 * 60 * 10).toISOString() },
    { direction: 'bot', message: 'Ada kak. Bisa dicicil per bulan/semester (tergantung kebijakan kampus). Kak mau info pendaftaran juga?', at: new Date(Date.now() - 1000 * 60 * 9).toISOString() },
  ],
  '628123450002': [
    { direction: 'user', message: 'Admin, saya mau daftar. Bisa dibantu?', at: new Date(Date.now() - 1000 * 60 * 40).toISOString() },
    { direction: 'bot', message: 'Bisa kak. Saya hubungkan ke admin ya.', at: new Date(Date.now() - 1000 * 60 * 39).toISOString() },
    { direction: 'system', message: 'Handover dimulai oleh sistem.', at: new Date(Date.now() - 1000 * 60 * 39).toISOString() },
    { direction: 'agent', message: 'Baik kak, saya bantu ya. Mau prodi apa?', at: new Date(Date.now() - 1000 * 60 * 35).toISOString() },
  ],
  '628123450003': [
    { direction: 'user', message: 'STOP', at: new Date(Date.now() - 1000 * 60 * 125).toISOString() },
    { direction: 'system', message: 'User opted out from messages.', at: new Date(Date.now() - 1000 * 60 * 124).toISOString() },
    { direction: 'bot', message: 'Baik kak, kami tidak akan mengirim pesan lagi. Terima kasih.', at: new Date(Date.now() - 1000 * 60 * 120).toISOString() },
  ],
}

export default function HistoryPage() {
  const [query, setQuery] = useState('')
  const [dayFilter, setDayFilter] = useState<'today' | 'all'>('today')
  const [directionFilter, setDirectionFilter] = useState<'all' | 'incoming' | 'outgoing'>('all')
  const [items, setItems] = useState<ChatListItem[] | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [selectedMessages, setSelectedMessages] = useState<ChatMessage[] | null>(null)
  const [selectedTopQuestions, setSelectedTopQuestions] = useState<Array<{ question: string; count: number }>>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setItemsError(null)
        const res = await adminFetchJson<ChatListItem[]>('/admin/chats?limit=200')
        if (cancelled) return
        setItems(Array.isArray(res) ? res : [])
      } catch (e) {
        if (cancelled) return
        let msg = 'Failed to load chat history from API.'
        if (e instanceof AdminApiError) {
          msg = `Failed to load chat history (${e.status}).`
          if (e.status === 404) msg = 'History API not found (404). This usually means the UI is not served by the Node backend or reverse-proxy is not forwarding /admin/* to the bot server.'
          if (e.status === 403) msg = 'Forbidden (403). Your admin role may not have access to view chats.'
          if (e.status === 500) msg = 'Server error (500) while loading chats.'
        }
        setItemsError(msg)
        // When DB/API is down, show a clearly-labeled demo table so users can still preview the UI.
        setItems([])
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const isDemoMode = Boolean(itemsError)
  const effectiveItems = isDemoMode ? DEMO_CHAT_ITEMS : (items || [])

  const buildTopQuestions = (list: ChatMessage[]) => {
    const normalizeQuestion = (text: string) => {
      let s = String(text || '').toLowerCase()
      s = s.replace(/\s+/g, ' ').trim()
      if (!s) return ''
      s = s
        .replace(/^(halo|hai|hi|ass?alam(u)?alaikum|pagi|siang|sore|malam)\b\s*/g, '')
        .replace(/^(kak|min|admin|gan|bro|sis|pak|bu)\b\s*/g, '')
        .replace(/^(saya\s+(ingin|mau)\s+)?(tanya|bertanya|nanya|mau\s+nanya)\b\s*/g, '')
        .replace(/^(mohon|tolong|boleh|bisa)\b\s*/g, '')
        .trim()
      s = s
        .replace(/\bprogram\s+studi\b/g, 'prodi')
        .replace(/\bsistem\s+informasi\b/g, 'si')
        .replace(/\bteknologi\s+informasi\b/g, 'ti')
        .replace(/\bbisnis\s+digital\b/g, 'bd')
        .replace(/\bsistem\s+komputer\b/g, 'sk')
      s = s
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return s
    }

    const shouldInclude = (raw: string) => {
      const t = String(raw || '').trim()
      if (!t) return false
      if (t.length >= 6) return true
      if (/[?]/.test(t)) return true
      const low = t.toLowerCase()
      if (/^(apa|siapa|kapan|dimana|di\s+mana|berapa|bagaimana|gimana|kenapa|mengapa)\b/.test(low)) return true
      return false
    }

    const counts = new Map<string, number>()
    for (const m of list) {
      if (!m || m.direction !== 'user') continue
      const raw = String(m.message || '').trim()
      if (!shouldInclude(raw)) continue
      const key = normalizeQuestion(raw)
      if (!key) continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([question, count]) => ({ question, count }))
  }

  useEffect(() => {
    let cancelled = false

    async function loadMessages() {
      if (!selectedChatId) return

      if (isDemoMode) {
        const demo = DEMO_MESSAGES_BY_CHAT[selectedChatId] || []
        setSelectedMessages(demo)
        setSelectedTopQuestions(buildTopQuestions(demo))
        return
      }

      try {
        const res = await adminFetchJson<ChatMessage[]>(`/admin/chats/${encodeURIComponent(selectedChatId)}/messages`)
        if (cancelled) return
        const list = Array.isArray(res) ? res : []
        setSelectedMessages(list)

        try {
          const recap = await adminFetchJson<ChatRecapResponse>(`/admin/chats/${encodeURIComponent(selectedChatId)}/recap?top=10`)
          if (cancelled) return
          if (recap && Array.isArray(recap.top)) {
            setSelectedTopQuestions(recap.top)
          } else {
            setSelectedTopQuestions(buildTopQuestions(list))
          }
        } catch {
          if (cancelled) return
          setSelectedTopQuestions(buildTopQuestions(list))
        }
      } catch {
        if (cancelled) return
        setSelectedMessages(null)
        setSelectedTopQuestions([])
      }
    }

    loadMessages()
    return () => {
      cancelled = true
    }
  }, [selectedChatId, isDemoMode])

  const rows = useMemo(() => {
    const base = effectiveItems
    if (!base) return []

    const todayKey = new Date().toISOString().slice(0, 10)

    const mapped = base
      .filter((c) => c && c.lastMessage && c.lastMessage.message)
      .map((c, idx) => {
        const dir = c.lastMessage && c.lastMessage.direction ? c.lastMessage.direction : 'system'
        const isIncoming = dir === 'user'

        const updatedAt = c.updatedAt ? new Date(c.updatedAt) : null
        const timestamp = updatedAt && !Number.isNaN(updatedAt.getTime())
          ? `${updatedAt.toISOString().slice(0, 10)} ${updatedAt.toTimeString().slice(0, 5)}`
          : ''

        const lastSeen = c.lastSeenAt ? new Date(c.lastSeenAt) : null
        const lastSeenStr = lastSeen && !Number.isNaN(lastSeen.getTime())
          ? `${lastSeen.toISOString().slice(0, 10)} ${lastSeen.toTimeString().slice(0, 5)}`
          : ''

        return {
          id: `${idx}-${c.chatId}`,
          sender: isIncoming ? c.chatId : 'Bot',
          message: c.lastMessage && c.lastMessage.message ? c.lastMessage.message : '',
          type: isIncoming ? 'incoming' : 'outgoing',
          timestamp,
          chatId: c.chatId,
          chatStatus: c.status || 'UNKNOWN',
          optIn: typeof c.optIn === 'boolean' ? c.optIn : null,
          lastSeenAt: lastSeenStr,
          dayKey: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toISOString().slice(0, 10) : '—',
        }
      })

    let filtered = mapped
    if (dayFilter === 'today') {
      filtered = filtered.filter((m) => m.dayKey === todayKey)
    }
    if (directionFilter !== 'all') {
      filtered = filtered.filter((m) => m.type === directionFilter)
    }

    const q = query.trim().toLowerCase()
    if (!q) return filtered
    return filtered.filter((m) =>
      (m.sender || '').toLowerCase().includes(q) ||
      (m.message || '').toLowerCase().includes(q)
    )
  }, [effectiveItems, query, dayFilter, directionFilter])

  const tableRows = useMemo(() => {
    const list = rows as any[]
    const out: Array<{ kind: 'day' | 'item'; day?: string; item?: any }> = []

    let lastDay: string | null = null
    for (const r of list) {
      const day = r.dayKey || '—'
      if (day !== lastDay) {
        out.push({ kind: 'day', day })
        lastDay = day
      }
      out.push({ kind: 'item', item: r })
    }

    return out
  }, [rows])

  const stats = useMemo(() => {
    const total = rows.length
    const bot = rows.filter((r: any) => (r.chatStatus || '').toUpperCase() === 'BOT').length
    const human = rows.filter((r: any) => (r.chatStatus || '').toUpperCase() === 'HUMAN').length
    const optedOut = rows.filter((r: any) => r.optIn === false).length
    return { total, bot, human, optedOut }
  }, [rows])

  return (
    <div className="space-y-8 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">History</h1>
          <p className="text-muted-foreground mt-2">View message history and logs</p>
        </div>
        <Button className="gap-2" variant="outline">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari pesan / chatId…"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setDayFilter('all')
                setDirectionFilter('all')
              }}
              disabled={dayFilter === 'all' && directionFilter === 'all'}
            >
              <Filter className="h-4 w-4" />
              Filter
            </Button>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Badge
              variant={dayFilter === 'today' ? 'secondary' : 'outline'}
              className="cursor-pointer select-none"
              role="button"
              tabIndex={0}
              onClick={() => setDayFilter(dayFilter === 'today' ? 'all' : 'today')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDayFilter(dayFilter === 'today' ? 'all' : 'today')
                }
              }}
              title={dayFilter === 'today' ? 'Showing Today only' : 'Showing all days'}
            >
              Today
            </Badge>

            <Badge
              variant={directionFilter === 'incoming' ? 'secondary' : 'outline'}
              className="cursor-pointer select-none"
              role="button"
              tabIndex={0}
              onClick={() => setDirectionFilter(directionFilter === 'incoming' ? 'all' : 'incoming')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDirectionFilter(directionFilter === 'incoming' ? 'all' : 'incoming')
                }
              }}
              title={directionFilter === 'incoming' ? 'Showing Incoming only' : 'Toggle Incoming filter'}
            >
              Incoming
            </Badge>

            <Badge
              variant={directionFilter === 'outgoing' ? 'secondary' : 'outline'}
              className="cursor-pointer select-none"
              role="button"
              tabIndex={0}
              onClick={() => setDirectionFilter(directionFilter === 'outgoing' ? 'all' : 'outgoing')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDirectionFilter(directionFilter === 'outgoing' ? 'all' : 'outgoing')
                }
              }}
              title={directionFilter === 'outgoing' ? 'Showing Outgoing only' : 'Toggle Outgoing filter'}
            >
              Outgoing
            </Badge>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chat</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Chat Status</TableHead>
                  <TableHead>Opt-In</TableHead>
                  <TableHead>Last Seen</TableHead>
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

                {isDemoMode ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-muted-foreground">
                      Showing demo (dummy) data so you can preview the History UI. This will be replaced automatically when real chat history is available.
                    </TableCell>
                  </TableRow>
                ) : null}

                {items && items.length === 0 && !itemsError && !isDemoMode ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-muted-foreground">
                      No chats found yet. If you expect chats, verify the bot is receiving messages and that this UI points to the correct backend.
                    </TableCell>
                  </TableRow>
                ) : null}

                {tableRows.map((row) => {
                  if (row.kind === 'day') {
                    return (
                      <TableRow key={`day-${row.day}`}>
                        <TableCell colSpan={7} className="bg-muted/40 text-xs text-muted-foreground font-medium">
                          Recap: {row.day}
                        </TableCell>
                      </TableRow>
                    )
                  }

                  const msg = row.item
                  const chatId = (msg as any).chatId || msg.sender
                  return (
                    <TableRow
                      key={msg.id}
                      className={selectedChatId === chatId ? 'bg-muted/50' : undefined}
                      onClick={() => setSelectedChatId(chatId)}
                      role="button"
                      tabIndex={0}
                    >
                      <TableCell className="font-medium">{chatId}</TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate">
                        {msg.message}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            msg.type === 'incoming'
                              ? 'default'
                              : 'secondary'
                          }
                        >
                          {msg.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {msg.timestamp}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            ((msg as any).chatStatus || '').toUpperCase() === 'HUMAN'
                              ? 'secondary'
                              : 'default'
                          }
                        >
                          {(msg as any).chatStatus || 'UNKNOWN'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {(msg as any).optIn == null ? '—' : (msg as any).optIn ? 'yes' : 'no'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(msg as any).lastSeenAt || '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>

      {/* Selected chat detail */}
      {selectedChatId && (
        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Chat Detail</h2>
                <p className="text-sm text-muted-foreground mt-1">{selectedChatId}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedChatId(null)}>
                Close
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="p-4 lg:col-span-1">
                <div className="space-y-3">
                  <p className="font-medium">Top Questions (this user)</p>
                  {selectedTopQuestions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No questions detected yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedTopQuestions.map((q) => (
                        <div key={q.question} className="flex items-center justify-between gap-3">
                          <p className="text-sm text-muted-foreground max-w-[260px] truncate" title={q.question}>
                            {q.question}
                          </p>
                          <Badge variant="outline">{q.count}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              <Card className="p-4 lg:col-span-2">
                <div className="space-y-3">
                  <p className="font-medium">Messages</p>
                  {!selectedMessages ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : selectedMessages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No messages.</p>
                  ) : (
                    <ScrollArea className="h-[360px]">
                      <div className="space-y-2 pr-4">
                        {selectedMessages.map((m, idx) => {
                          const at = m.at ? new Date(m.at) : null
                          const time = at && !Number.isNaN(at.getTime())
                            ? `${at.toISOString().slice(0, 10)} ${at.toTimeString().slice(0, 5)}`
                            : ''
                          const dir = m.direction || 'system'
                          return (
                            <div key={`${idx}-${m.at || ''}`} className="border border-border rounded-md p-3">
                              <div className="flex items-center justify-between">
                                <Badge variant={dir === 'user' ? 'default' : 'secondary'}>{dir}</Badge>
                                <span className="text-xs text-muted-foreground">{time}</span>
                              </div>
                              <p className="text-sm mt-2 text-muted-foreground whitespace-pre-wrap">{m.message || ''}</p>
                            </div>
                          )
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Chats</p>
          <p className="text-2xl font-bold mt-2">{stats.total.toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">BOT</p>
          <p className="text-2xl font-bold mt-2">{stats.bot.toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">HUMAN</p>
          <p className="text-2xl font-bold mt-2">{stats.human.toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Opted Out</p>
          <p className="text-2xl font-bold mt-2">{stats.optedOut.toLocaleString()}</p>
        </Card>
      </div>
    </div>
  )
}

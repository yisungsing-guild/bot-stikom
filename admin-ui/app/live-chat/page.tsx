'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Bot, MessageCircle, RefreshCw, Send, UserCheck } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { AdminApiError, adminFetchJson } from '@/lib/adminApi'
import { getAdminIdentity, isSuperAdminRole } from '@/lib/adminIdentity'

type ChatMessage = {
  direction?: 'user' | 'bot' | 'agent' | 'system' | string
  message?: string
  at?: string
}

type LiveChatItem = {
  chatId: string
  status?: string
  updatedAt?: string
  lastSeenAt?: string
  optIn?: boolean | null
  lastMessage?: ChatMessage | null
}

type UiChat = {
  id: string
  name: string
  presence: 'online' | 'away' | 'offline'
  chatStatus: string
  optIn?: boolean | null
  lastMsg: string
  time: string
  updatedAt?: string
}

type UiMessage = {
  id: string
  sender: 'user' | 'bot' | 'agent' | 'system'
  name: string
  message: string
  time: string
}

function computePresence(lastSeenAt?: string): 'online' | 'away' | 'offline' {
  if (!lastSeenAt) return 'offline'
  const d = new Date(lastSeenAt)
  if (Number.isNaN(d.getTime())) return 'offline'
  const minutes = (Date.now() - d.getTime()) / (1000 * 60)
  if (minutes <= 10) return 'online'
  if (minutes <= 60) return 'away'
  return 'offline'
}

function errorToText(prefix: string, e: unknown): string {
  if (e instanceof AdminApiError) {
    const snippet = e.bodyText ? ` ${e.bodyText.slice(0, 180)}` : ''
    return `${prefix} (${e.status}).${snippet}`
  }
  return prefix
}

function normalizeChatStatus(status?: string) {
  const s = String(status || '').trim().toUpperCase()
  if (s === 'HUMAN' || s === 'BOT') return s
  return s || 'UNKNOWN'
}

export default function LiveChatPage() {
  const identity = useMemo(() => getAdminIdentity(), [])
  const isSuperAdmin = isSuperAdminRole(identity?.role)
  const chatsEndpoint = isSuperAdmin ? '/admin/realtime-chats?limit=300' : '/admin/live-chats'

  const [rawChats, setRawChats] = useState<LiveChatItem[] | null>(null)
  const [chatsError, setChatsError] = useState<string | null>(null)
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [rawMessages, setRawMessages] = useState<ChatMessage[] | null>(null)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null)

  const loadChats = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true)
    try {
      const res = await adminFetchJson<LiveChatItem[]>(chatsEndpoint)
      setRawChats(Array.isArray(res) ? res : [])
      setChatsError(null)
      setLastRefreshAt(new Date())
    } catch (e) {
      setChatsError(errorToText('Gagal memuat chat realtime', e))
      setRawChats([])
    } finally {
      if (!quiet) setIsRefreshing(false)
    }
  }, [chatsEndpoint])

  const loadMessages = useCallback(async (chatId: string, quiet = false) => {
    if (!quiet) {
      setRawMessages(null)
      setMessagesError(null)
    }

    try {
      const res = await adminFetchJson<ChatMessage[]>(
        `/admin/chats/${encodeURIComponent(chatId)}/messages`
      )
      setRawMessages(Array.isArray(res) ? res : [])
      setMessagesError(null)
    } catch (e) {
      setMessagesError(errorToText('Gagal memuat pesan', e))
      setRawMessages([])
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function initialLoad() {
      if (cancelled) return
      await loadChats()
    }

    initialLoad()
    const id = window.setInterval(() => {
      if (!cancelled) loadChats(true)
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [loadChats])

  const chats = useMemo<UiChat[]>(() => {
    if (!rawChats) return []

    return rawChats.map((c) => {
      const updatedRaw = c.updatedAt || c.lastSeenAt
      const updated = updatedRaw ? new Date(updatedRaw) : null
      const time = updated && !Number.isNaN(updated.getTime())
        ? formatDistanceToNow(updated, { addSuffix: true })
        : ''

      return {
        id: c.chatId,
        name: c.chatId,
        presence: computePresence(c.lastSeenAt || c.updatedAt),
        chatStatus: normalizeChatStatus(c.status),
        optIn: typeof c.optIn === 'boolean' ? c.optIn : null,
        lastMsg: c.lastMessage?.message || '',
        time,
        updatedAt: updatedRaw,
      }
    })
  }, [rawChats])

  const filteredChats = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chats
    return chats.filter((chat) => {
      return chat.id.toLowerCase().includes(q)
        || chat.chatStatus.toLowerCase().includes(q)
        || chat.lastMsg.toLowerCase().includes(q)
    })
  }, [chats, query])

  const selectedChat = useMemo(() => {
    if (!selectedChatId) return null
    return chats.find((c) => c.id === selectedChatId) || null
  }, [chats, selectedChatId])

  useEffect(() => {
    if (rawChats === null) return
    if (filteredChats.length === 0) {
      if (selectedChatId && !chats.some((c) => c.id === selectedChatId)) setSelectedChatId(null)
      return
    }
    if (selectedChatId && chats.some((c) => c.id === selectedChatId)) return
    setSelectedChatId(filteredChats[0].id)
  }, [rawChats, chats, filteredChats, selectedChatId])

  useEffect(() => {
    if (!selectedChatId) {
      setRawMessages([])
      setMessagesError(null)
      return
    }

    let cancelled = false
    loadMessages(selectedChatId)
    const id = window.setInterval(() => {
      if (!cancelled) loadMessages(selectedChatId, true)
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [selectedChatId, loadMessages])

  const messages = useMemo<UiMessage[]>(() => {
    if (!rawMessages || !selectedChat) return []

    return rawMessages.map((m, idx) => {
      const at = m.at ? new Date(m.at) : null
      const time = at && !Number.isNaN(at.getTime())
        ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : ''
      const direction = String(m.direction || '').toLowerCase()
      const sender: UiMessage['sender'] = direction === 'user'
        ? 'user'
        : direction === 'agent'
          ? 'agent'
          : direction === 'system'
            ? 'system'
            : 'bot'

      return {
        id: `${idx}-${m.at || ''}`,
        sender,
        name: selectedChat.name,
        message: m.message || '',
        time,
      }
    })
  }, [rawMessages, selectedChat])


  const selectedIsHuman = selectedChat?.chatStatus === 'HUMAN'
  const selectedNeedsAdmin = selectedIsHuman

  async function refreshAll() {
    await loadChats()
    if (selectedChatId) await loadMessages(selectedChatId, true)
  }

  async function handleStartHandover() {
    if (!selectedChatId) return
    try {
      await adminFetchJson(`/admin/live-chats/${encodeURIComponent(selectedChatId)}/handover`, {
        method: 'POST',
      })
      await refreshAll()
    } catch (e) {
      setMessagesError(errorToText('Gagal mengambil alih chat', e))
    }
  }

  async function handleEndHandover() {
    if (!selectedChatId) return
    if (!confirm('Kembalikan chat ini ke BOT?')) return

    try {
      await adminFetchJson(`/admin/live-chats/${encodeURIComponent(selectedChatId)}/end-handover`, {
        method: 'POST',
      })
      await refreshAll()
    } catch (e) {
      setMessagesError(errorToText('Gagal mengembalikan chat ke BOT', e))
    }
  }

  async function handleSend() {
    const text = inputValue.trim()
    if (!text || !selectedChatId) return

    setIsSending(true)
    try {
      await adminFetchJson(`/admin/live-chats/${encodeURIComponent(selectedChatId)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      })
      setInputValue('')
      await refreshAll()
    } catch (e) {
      setMessagesError(errorToText('Gagal mengirim pesan', e))
    } finally {
      setIsSending(false)
    }
  }

  const humanCount = chats.filter((chat) => chat.chatStatus === 'HUMAN').length
  const botCount = chats.filter((chat) => chat.chatStatus === 'BOT').length
  const selectedDotClass = selectedChat?.presence === 'online'
    ? 'bg-green-500'
    : selectedChat?.presence === 'away'
      ? 'bg-yellow-500'
      : 'bg-gray-400'

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col gap-3 overflow-hidden px-6 py-3">
      <div className="flex shrink-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Realtime Chat</h1>
          <p className="text-muted-foreground mt-2">
            {isSuperAdmin
              ? 'Pantau semua percakapan bot dan ambil alih saat user meminta admin.'
              : 'Pantau dan balas chat yang sudah masuk mode admin.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1"><MessageCircle className="h-3.5 w-3.5" /> {chats.length} chat</Badge>
          <Badge variant="outline" className="gap-1"><UserCheck className="h-3.5 w-3.5" /> {humanCount} admin</Badge>
          {isSuperAdmin ? <Badge variant="outline" className="gap-1"><Bot className="h-3.5 w-3.5" /> {botCount} bot</Badge> : null}
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={isRefreshing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-4">
        <Card className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-950/95 p-4 shadow-lg lg:col-span-1">
          <div className="mb-3 shrink-0 space-y-2">
            <Input
              placeholder="Cari chat, status, atau pesan..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Auto-refresh aktif{lastRefreshAt ? `, terakhir ${lastRefreshAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </p>
          </div>

          <ScrollArea className="min-h-0 flex-1 overflow-hidden">
            <div className="space-y-2 pr-2">
              {chatsError ? <div className="p-3 text-sm text-destructive">{chatsError}</div> : null}
              {!chatsError && rawChats === null ? <div className="p-3 text-sm text-muted-foreground">Memuat chat...</div> : null}
              {!chatsError && rawChats !== null && filteredChats.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">Belum ada chat yang cocok.</div>
              ) : null}

              {filteredChats.map((chat) => {
                const active = selectedChatId === chat.id
                const isHuman = chat.chatStatus === 'HUMAN'
                return (
                  <button
                    key={chat.id}
                    onClick={() => setSelectedChatId(chat.id)}
                    className={`w-full min-h-[5rem] rounded-3xl border p-4 text-left transition-colors ${
                      active
                        ? 'border-slate-500/40 bg-slate-900 text-slate-100 shadow-slate-950/50'
                        : 'border-transparent bg-slate-950/90 text-slate-100 hover:bg-slate-900/80'
                    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600/70`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <span className="truncate text-sm font-semibold">{chat.name}</span>
                          <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                            chat.presence === 'online' ? 'bg-emerald-400' : chat.presence === 'away' ? 'bg-amber-400' : 'bg-slate-500'
                          }`} />
                        </div>
                        <p className="mt-3 text-sm leading-6 opacity-75">{chat.lastMsg || 'Belum ada pesan'}</p>
                        <div className="mt-2 flex items-center gap-2 text-xs opacity-75">
                          <span>{isHuman ? 'Butuh admin' : chat.chatStatus}</span>
                          <span>{chat.optIn == null ? '' : chat.optIn ? 'opt-in' : 'opt-out'}</span>
                        </div>
                        <p className="mt-1 text-xs opacity-60">{chat.time}</p>
                      </div>
                      {isHuman ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Admin</span> : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-950/95 shadow-lg lg:col-span-3">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold">{selectedChat ? selectedChat.name : 'Pilih chat'}</p>
                {selectedChat ? <span className={`h-2 w-2 rounded-full ${selectedDotClass}`} /> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedChat
                  ? `${selectedChat.presence} - ${selectedChat.chatStatus}${selectedChat.optIn == null ? '' : selectedChat.optIn ? ' - opt-in' : ' - opt-out'}`
                  : 'Tidak ada chat dipilih'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={!selectedChatId || selectedIsHuman} onClick={handleStartHandover} className="gap-2">
                <UserCheck className="h-4 w-4" />
                Ambil Alih
              </Button>
              <Button variant="ghost" size="sm" disabled={!selectedChatId || !selectedIsHuman} onClick={handleEndHandover}>
                Kembali ke BOT
              </Button>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1 overflow-hidden p-3">
            <div className="space-y-5">
              {!selectedChatId ? <div className="rounded-xl border border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">Pilih chat untuk melihat isi percakapan.</div> : null}
              {selectedChatId && messagesError ? <div className="rounded-xl border border-destructive/70 bg-destructive/10 p-4 text-sm text-destructive">{messagesError}</div> : null}
              {selectedChatId && !messagesError && rawMessages === null ? <div className="rounded-xl border border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">Memuat pesan...</div> : null}
              {selectedChatId && !messagesError && rawMessages !== null && messages.length === 0 ? (
                <div className="rounded-xl border border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">Belum ada pesan.</div>
              ) : null}

              {messages.map((msg) => {
                const isUser = msg.sender === 'user'
                const isAgent = msg.sender === 'agent'
                const isSystem = msg.sender === 'system'
                return (
                  <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[82%] min-h-[8rem] rounded-3xl px-6 py-5 shadow-sm ${
                      isUser
                        ? 'bg-slate-900/95 text-slate-100 border border-slate-700/40 shadow-slate-950/20'
                        : isAgent
                          ? 'bg-slate-900/95 text-slate-100 border border-slate-700/40 shadow-slate-950/20'
                          : isSystem
                            ? 'bg-slate-900/95 text-slate-100 border border-slate-700/40 shadow-slate-950/20'
                            : 'bg-slate-900/95 text-slate-100 border border-slate-700/40 shadow-slate-950/20'
                    }`}>
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
                        <span>{isUser ? 'USER' : isAgent ? 'ADMIN' : isSystem ? 'SYSTEM' : 'BOT'}</span>
                        <span>•</span>
                        <span>{msg.time}</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{msg.message}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>

          <div className="shrink-0 border-t border-border/70 bg-slate-950/95 p-4 backdrop-blur-sm">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder={selectedChatId ? selectedNeedsAdmin ? 'Ketik balasan admin...' : 'Ambil alih dulu untuk membalas' : 'Pilih chat dulu untuk membalas'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) handleSend()
                }}
                disabled={!selectedChatId || !selectedIsHuman || isSending}
                className="min-w-0"
              />
              <Button
                variant="default"
                className="flex-none gap-2 bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700"
                onClick={handleSend}
                disabled={!selectedChatId || !selectedIsHuman || isSending || !inputValue.trim()}
              >
                <Send className="h-4 w-4" />
                Kirim
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

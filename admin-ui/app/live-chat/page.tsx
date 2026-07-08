'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Send, Phone, MoreVertical } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AdminApiError, adminFetchJson } from '@/lib/adminApi'

type ChatMessage = {
  direction?: 'user' | 'bot' | 'agent' | 'system' | string
  message?: string
  at?: string
}

type LiveChatItem = {
  chatId: string
  status?: string
  lastSeenAt?: string
  optIn?: boolean | null
  lastMessage?: ChatMessage | null
}

type UiChat = {
  id: string
  name: string
  status: 'online' | 'away' | 'offline'
  chatStatus?: string
  optIn?: boolean | null
  lastMsg: string
  time: string
}

type UiMessage = {
  id: string
  sender: 'user' | 'bot'
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

export default function LiveChatPage() {
  const [rawChats, setRawChats] = useState<LiveChatItem[] | null>(null)
  const [chatsError, setChatsError] = useState<string | null>(null)

  const chats = useMemo<UiChat[]>(() => {
    if (!rawChats) return []

    return rawChats.map((c) => {
      const lastSeen = c.lastSeenAt ? new Date(c.lastSeenAt) : null
      const time = lastSeen && !Number.isNaN(lastSeen.getTime())
        ? formatDistanceToNow(lastSeen, { addSuffix: true })
        : ''

      return {
        id: c.chatId,
        name: c.chatId,
        status: computePresence(c.lastSeenAt),
        chatStatus: c.status,
        optIn: typeof c.optIn === 'boolean' ? c.optIn : null,
        lastMsg: c.lastMessage && c.lastMessage.message ? c.lastMessage.message : '',
        time,
      }
    })
  }, [rawChats])

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)

  const selectedChat = useMemo(() => {
    if (!selectedChatId) return null
    return chats.find((c) => c.id === selectedChatId) || null
  }, [chats, selectedChatId])

  const [rawMessages, setRawMessages] = useState<ChatMessage[] | null>(null)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadChats() {
      try {
        const res = await adminFetchJson<LiveChatItem[]>('/admin/live-chats')
        if (cancelled) return
        setRawChats(Array.isArray(res) ? res : [])
        setChatsError(null)
      } catch (e) {
        if (cancelled) return
        setChatsError(errorToText('Failed to load live chats', e))
        setRawChats([])
      }
    }

    loadChats()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (rawChats === null) return
    if (chats.length === 0) {
      setSelectedChatId(null)
      return
    }
    if (selectedChatId && chats.some((c) => c.id === selectedChatId)) return
    setSelectedChatId(chats[0].id)
  }, [rawChats, chats, selectedChatId])

  useEffect(() => {
    let cancelled = false

    async function loadMessages(chatId: string) {
      setRawMessages(null)
      setMessagesError(null)

      try {
        const res = await adminFetchJson<ChatMessage[]>(
          `/admin/live-chats/${encodeURIComponent(chatId)}/messages`
        )
        if (cancelled) return
        setRawMessages(Array.isArray(res) ? res : [])
        setMessagesError(null)
      } catch (e) {
        if (cancelled) return
        setMessagesError(errorToText('Failed to load messages', e))
        setRawMessages([])
      }
    }

    if (selectedChatId) {
      loadMessages(selectedChatId)
    } else {
      setRawMessages([])
      setMessagesError(null)
    }

    return () => {
      cancelled = true
    }
  }, [selectedChatId])

  const messages = useMemo<UiMessage[]>(() => {
    if (!rawMessages || !selectedChat) return []

    return rawMessages.map((m, idx) => {
      const at = m.at ? new Date(m.at) : null
      const time = at && !Number.isNaN(at.getTime())
        ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : ''

      const sender: UiMessage['sender'] = m.direction === 'user' ? 'user' : 'bot'

      return {
        id: `${idx}-${m.at || ''}`,
        sender,
        name: selectedChat.name,
        message: m.message || '',
        time,
      }
    })
  }, [rawMessages, selectedChat])

  async function refreshMessages(chatId: string) {
    try {
      const res = await adminFetchJson<ChatMessage[]>(
        `/admin/live-chats/${encodeURIComponent(chatId)}/messages`
      )
      setRawMessages(Array.isArray(res) ? res : [])
      setMessagesError(null)
    } catch (e) {
      setMessagesError(errorToText('Failed to refresh messages', e))
    }
  }

  async function handleSend() {
    const text = inputValue.trim()
    if (!text) return
    if (!selectedChatId) return

    setIsSending(true)
    try {
      await adminFetchJson(`/admin/live-chats/${encodeURIComponent(selectedChatId)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      })
      setInputValue('')
      await refreshMessages(selectedChatId)
    } catch (e) {
      setMessagesError(errorToText('Failed to send message', e))
    } finally {
      setIsSending(false)
    }
  }

  async function handleEndHandover() {
    if (!selectedChatId) return
    if (!confirm('Akhiri handover dan kembalikan chat ini ke BOT?')) return

    try {
      await adminFetchJson(`/admin/live-chats/${encodeURIComponent(selectedChatId)}/end-handover`, {
        method: 'POST'
      })

      // Refresh chat list and clear selection/messages
      try {
        const res = await adminFetchJson<LiveChatItem[]>('/admin/live-chats')
        setRawChats(Array.isArray(res) ? res : [])
      } catch (e) {
        // ignore refresh error; set an error message
        setChatsError(errorToText('Failed to refresh live chats', e))
      }

      setSelectedChatId(null)
      setRawMessages([])
      setMessagesError(null)
    } catch (e) {
      setChatsError(errorToText('Failed to end handover', e))
    }
  }

  const selectedStatus = selectedChat?.status
  const selectedDotClass =
    selectedStatus === 'online'
      ? 'bg-green-500'
      : selectedStatus === 'away'
        ? 'bg-yellow-500'
        : 'bg-gray-500'

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Live Chat</h1>
        <p className="text-muted-foreground mt-2">Manage live conversations with customers</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[600px]">
        {/* Chat List */}
        <Card className="lg:col-span-1 p-4 flex flex-col">
          <div className="mb-4">
            <Input placeholder="Cari chat (nama / chatId)..." />
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-2">
              {chatsError ? (
                <div className="text-sm text-muted-foreground p-3">{chatsError}</div>
              ) : null}

              {!chatsError && rawChats === null ? (
                <div className="text-sm text-muted-foreground p-3">Loading…</div>
              ) : null}

              {!chatsError && rawChats !== null && chats.length === 0 ? (
                <div className="text-sm text-muted-foreground p-3">No live chats (HUMAN) right now.</div>
              ) : null}

              {chats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => setSelectedChatId(chat.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedChatId === chat.id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{chat.name}</p>
                        <div
                          className={`h-2 w-2 rounded-full ${
                            chat.status === 'online'
                              ? 'bg-green-500'
                              : chat.status === 'away'
                                ? 'bg-yellow-500'
                                : 'bg-gray-500'
                          }`}
                        />
                      </div>
                      <p className="text-sm truncate opacity-75">{chat.lastMsg}</p>
                      <p className="text-xs opacity-60">
                        {(chat.chatStatus || 'HUMAN')}
                        {chat.optIn == null ? '' : chat.optIn ? ' • opt-in' : ' • opt-out'}
                      </p>
                      <p className="text-xs opacity-60">{chat.time}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </Card>

        {/* Chat Area */}
        <Card className="lg:col-span-3 flex flex-col">
          {/* Chat Header */}
          <div className="border-b border-border p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{selectedChat ? selectedChat.name : 'Select a chat'}</p>
                  <div className={`h-2 w-2 rounded-full ${selectedDotClass}`} />
                </div>
                <p className="text-sm text-muted-foreground capitalize">
                  {selectedChat ? selectedChat.status : '—'}
                  <span className="ml-2">
                    {(selectedChat?.chatStatus || 'HUMAN')}
                    {selectedChat?.optIn == null ? '' : selectedChat?.optIn ? ' • opt-in' : ' • opt-out'}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={!selectedChatId} onClick={handleEndHandover}>
                Kembali ke BOT
              </Button>
              <Button variant="ghost" size="sm" disabled={!selectedChatId}>
                <Phone className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" disabled={!selectedChatId}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {!selectedChatId ? (
                <div className="text-sm text-muted-foreground p-3">Select a chat to view messages.</div>
              ) : null}

              {selectedChatId && messagesError ? (
                <div className="text-sm text-muted-foreground p-3">{messagesError}</div>
              ) : null}

              {selectedChatId && !messagesError && rawMessages === null ? (
                <div className="text-sm text-muted-foreground p-3">Loading messages…</div>
              ) : null}

              {selectedChatId && !messagesError && rawMessages !== null && messages.length === 0 ? (
                <div className="text-sm text-muted-foreground p-3">No messages yet.</div>
              ) : null}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs px-4 py-2 rounded-lg ${
                      msg.sender === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {msg.sender === 'user' && <p className="text-xs font-semibold mb-1">{msg.name}</p>}
                    <p className="text-sm">{msg.message}</p>
                    <p className="text-xs opacity-70 mt-1">{msg.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="border-t border-border p-4">
            <div className="flex gap-2">
              <Input
                placeholder={selectedChatId ? 'Ketik balasan untuk dikirim…' : 'Pilih chat dulu untuk membalas'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={!selectedChatId || isSending}
              />
              <Button
                className="gap-2"
                onClick={handleSend}
                disabled={!selectedChatId || isSending || !inputValue.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

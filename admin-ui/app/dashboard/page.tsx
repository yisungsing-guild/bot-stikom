"use client"

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { MessageSquare, Users, Send, TrendingUp } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AdminApiError, adminFetchJson } from '@/lib/adminApi'

type AdminStatsResponse = {
  ok?: boolean
  env?: string
  databaseUrlPresent?: boolean
  counts?: {
    trainingData?: number | null
    sessions?: number | null
    chats?: number | null
    broadcasts?: number | null
  }
  latestSession?: {
    chatId?: string
    updatedAt?: string
    state?: string
    messagesCount?: number
  } | null
}

type EngagementSummary = {
  totalUsers: number
  optedIn: number
  optedOut: number
  activeLastWeek: number
  avgSessionsPerUser: string | number
}

type HandoverRate = {
  totalChats: number
  handoverChats: number
  handoverRate: number
}

type QuestionsRecap = {
  sessionsScanned?: number
  totalUserMessages?: number
  includedUserMessages?: number
  uniqueQuestions?: number
  top?: Array<{ question: string; count: number }>
  byDivision?: Record<string, { uniqueQuestions?: number; top?: Array<{ question: string; count: number }> }>
}

type ChatMessage = {
  direction?: 'user' | 'bot' | 'agent' | 'system' | string
  message?: string
  at?: string
}

type ChatListItem = {
  chatId: string
  updatedAt?: string
  status?: string
  lastSeenAt?: string | null
  optIn?: boolean | null
  lastMessage?: ChatMessage | null
}

export default function DashboardPage() {
  const router = useRouter()
  const [stats, setStats] = useState<AdminStatsResponse | null>(null)
  const [engagement, setEngagement] = useState<EngagementSummary | null>(null)
  const [handover, setHandover] = useState<HandoverRate | null>(null)
  const [recentChats, setRecentChats] = useState<ChatListItem[]>([])
  const [questionsRecap, setQuestionsRecap] = useState<QuestionsRecap | null>(null)

  const [statsError, setStatsError] = useState<string | null>(null)
  const [recentChatsError, setRecentChatsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadCore() {
      try {
        setStatsError(null)
        setRecentChatsError(null)

        const results = await Promise.allSettled([
          adminFetchJson<AdminStatsResponse>('/admin/stats'),
          adminFetchJson<EngagementSummary>('/admin/analytics/engagement'),
          adminFetchJson<HandoverRate>('/admin/analytics/handover'),
          adminFetchJson<ChatListItem[]>('/admin/chats?limit=10'),
        ])

        if (cancelled) return

        const statsRes = results[0].status === 'fulfilled' ? results[0].value : null
        const engagementRes = results[1].status === 'fulfilled' ? results[1].value : null
        const handoverRes = results[2].status === 'fulfilled' ? results[2].value : null
        const chatsRes = results[3].status === 'fulfilled' ? results[3].value : null

        if (statsRes) {
          setStats(statsRes)
        } else {
          const reason = results[0].status === 'rejected' ? results[0].reason : null
          let msg = 'Failed to load /admin/stats.'
          if (reason instanceof AdminApiError) {
            msg = `Failed to load /admin/stats (${reason.status}).`
            if (reason.bodyText) msg = `${msg} ${reason.bodyText.slice(0, 180)}`
          }
          setStatsError(msg)
        }
        if (engagementRes) setEngagement(engagementRes)
        if (handoverRes) setHandover(handoverRes)
        if (Array.isArray(chatsRes)) {
          setRecentChats(chatsRes)
        } else {
          const reason = results[3].status === 'rejected' ? results[3].reason : null
          let msg = 'Failed to load /admin/chats.'
          if (reason instanceof AdminApiError) {
            msg = `Failed to load /admin/chats (${reason.status}).`
            if (reason.bodyText) msg = `${msg} ${reason.bodyText.slice(0, 180)}`
          }
          setRecentChatsError(msg)
          setRecentChats([])
        }
      } catch {
        // Keep the UI stable if API/token is not available.
      }
    }

    async function loadRecap() {
      try {
        const recapRes = await adminFetchJson<QuestionsRecap>('/admin/analytics/questions-recap?top=10')
        if (cancelled) return
        if (recapRes) setQuestionsRecap(recapRes)
      } catch {
        // ignore
      }
    }

    loadCore()
    // Do not block core dashboard render on recap computation.
    void Promise.resolve().then(() => loadRecap())
    return () => {
      cancelled = true
    }
  }, [])

  const topQuestions = useMemo(() => {
    const top = questionsRecap && Array.isArray(questionsRecap.top) ? questionsRecap.top : []
    return top.filter((t) => t && typeof t.question === 'string')
  }, [questionsRecap])

  const questionGroups = useMemo(() => {
    const byDivision = questionsRecap && questionsRecap.byDivision && typeof questionsRecap.byDivision === 'object'
      ? questionsRecap.byDivision
      : null

    if (!byDivision) return [] as Array<{ key: string; title: string; top: Array<{ question: string; count: number }> }>

    const labels: Record<string, string> = {
      akademik: 'Akademik',
      kemahasiswaan: 'Kemahasiswaan',
      keuangan: 'Keuangan',
      pmb: 'PMB (Marketing)',
      prodi: 'Program Studi',
      beasiswa: 'Beasiswa',
      kerjasama: 'Kerjasama / Industri / Inkubator',
      international: 'Urusan International',
      lainnya: 'Lainnya',
    }
    const order = ['akademik', 'kemahasiswaan', 'keuangan', 'international', 'kerjasama', 'pmb', 'prodi', 'beasiswa', 'lainnya']

    const keys = Object.keys(byDivision || {}).filter(Boolean)
    const sortedKeys = keys.sort((a, b) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      if (ia === -1 && ib === -1) return a.localeCompare(b)
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })

    return sortedKeys.map((k) => {
      const top = byDivision[k] && Array.isArray(byDivision[k].top) ? byDivision[k].top : []
      return {
        key: k,
        title: labels[k] || k,
        top: top.filter((t) => t && typeof t.question === 'string'),
      }
    })
  }, [questionsRecap])

  const recentMessages = useMemo(() => {
    return (recentChats || []).map((c) => {
      const updatedAt = c.updatedAt ? new Date(c.updatedAt) : null
      const time = updatedAt && !Number.isNaN(updatedAt.getTime())
        ? formatDistanceToNow(updatedAt, { addSuffix: true })
        : ''

      const status = (c.status || '').toUpperCase() === 'HUMAN'
        ? 'in-progress'
        : (c.lastMessage && c.lastMessage.direction === 'user')
          ? 'pending'
          : 'resolved'

      return {
        id: c.chatId,
        sender: c.chatId,
        message: c.lastMessage && c.lastMessage.message ? c.lastMessage.message : '',
        time,
        status,
      }
    })
  }, [recentChats])

  const totalSessions = stats && stats.counts && typeof stats.counts.sessions === 'number'
    ? stats.counts.sessions
    : null

  const activeLastWeek = engagement && typeof engagement.activeLastWeek === 'number'
    ? engagement.activeLastWeek
    : null

  const totalChats = stats && stats.counts && typeof stats.counts.chats === 'number'
    ? stats.counts.chats
    : null

  const totalBroadcasts = stats && stats.counts && typeof stats.counts.broadcasts === 'number'
    ? stats.counts.broadcasts
    : null

  const responseRate = handover && typeof handover.handoverRate === 'number'
    ? `${Math.max(0, Math.min(100, 100 - handover.handoverRate)).toFixed(1)}%`
    : '—'

  const messagesReceived = totalSessions !== null ? totalSessions : 0
  const successPct = handover && typeof handover.handoverRate === 'number'
    ? Math.max(0, Math.min(100, 100 - handover.handoverRate))
    : null
  const successfulResponses = successPct !== null ? Math.round(messagesReceived * (successPct / 100)) : 0
  const failedResponses = successPct !== null ? Math.max(0, messagesReceived - successfulResponses) : 0

  const lastSyncText = useMemo(() => {
    const ts = stats && stats.latestSession && stats.latestSession.updatedAt ? new Date(stats.latestSession.updatedAt) : null
    if (!ts || Number.isNaN(ts.getTime())) return '—'
    return formatDistanceToNow(ts, { addSuffix: true })
  }, [stats])

  const apiOk = !!(stats && stats.ok)
  const dbHealthy = apiOk && stats && stats.databaseUrlPresent === true

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Welcome back! Here's your bot performance overview.</p>
        {statsError ? (
          <p className="text-sm text-muted-foreground mt-2">{statsError}</p>
        ) : null}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Messages"
          value={totalSessions !== null ? totalSessions.toLocaleString() : '—'}
          icon={MessageSquare}
        />
        <StatCard
          title="Active Chats"
          value={activeLastWeek !== null ? activeLastWeek.toLocaleString() : (totalChats !== null ? totalChats.toLocaleString() : '—')}
          icon={Users}
        />
        <StatCard
          title="Messages Sent"
          value={totalBroadcasts !== null ? totalBroadcasts.toLocaleString() : '—'}
          icon={Send}
        />
        <StatCard
          title="Response Rate"
          value={responseRate}
          icon={TrendingUp}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity Chart */}
        <Card className="lg:col-span-2 p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Activity Overview</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/history')}
              >
                View more
              </Button>
            </div>
            
            <div className="space-y-3 pt-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-blue-500" />
                  <span>Messages Received</span>
                </div>
                <span className="font-semibold">{messagesReceived.toLocaleString()}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: '100%' }} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span>Successful Responses</span>
                </div>
                <span className="font-semibold">{successfulResponses.toLocaleString()}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-green-500"
                  style={{ width: `${successPct !== null ? successPct : 0}%` }}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-amber-500" />
                  <span>Failed Responses</span>
                </div>
                <span className="font-semibold">{failedResponses.toLocaleString()}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${successPct !== null ? Math.max(0, 100 - successPct) : 0}%` }}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* System Status */}
        <Card className="p-6">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">System Status</h3>
            
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Bot Status</span>
                <Badge className={apiOk ? "bg-green-500/20 text-green-500 hover:bg-green-500/30" : "bg-amber-500/20 text-amber-500 hover:bg-amber-500/30"}>
                  {apiOk ? 'Online' : 'Unknown'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">API Connection</span>
                <Badge className={apiOk ? "bg-green-500/20 text-green-500 hover:bg-green-500/30" : "bg-amber-500/20 text-amber-500 hover:bg-amber-500/30"}>
                  {apiOk ? 'Connected' : 'Error'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Database</span>
                <Badge className={dbHealthy ? "bg-green-500/20 text-green-500 hover:bg-green-500/30" : "bg-amber-500/20 text-amber-500 hover:bg-amber-500/30"}>
                  {dbHealthy ? 'Healthy' : 'Unknown'}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last Sync</span>
                <span className="text-xs text-muted-foreground">{lastSyncText}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent Messages Table */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Recent Messages</h3>
            <Button variant="ghost" size="sm">View all</Button>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sender</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentChatsError ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      {recentChatsError}
                    </TableCell>
                  </TableRow>
                ) : null}

                {!recentChatsError && recentMessages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      No recent messages yet.
                    </TableCell>
                  </TableRow>
                ) : null}

                {recentMessages.map((msg) => (
                  <TableRow key={msg.id}>
                    <TableCell className="font-medium">{msg.sender}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {msg.message}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{msg.time}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          msg.status === 'resolved'
                            ? 'default'
                            : msg.status === 'in-progress'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {msg.status.charAt(0).toUpperCase() +
                          msg.status.slice(1)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>

      {/* Frequently Asked Questions */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Frequently Asked Questions</h3>
            <Button variant="ghost" size="sm">View more</Button>
          </div>

          {questionGroups.length ? (
            <div className="space-y-6">
              {questionGroups.map((g) => (
                <div key={g.key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{g.title}</p>
                    <Badge variant="secondary" className="shrink-0">
                      {g.top.length} items
                    </Badge>
                  </div>

                  {g.top.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recap data yet.</p>
                  ) : (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Question</TableHead>
                            <TableHead className="w-32">Count</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.top.map((q) => (
                            <TableRow key={`${g.key}:${q.question}`}>
                              <TableCell className="font-medium max-w-xl truncate" title={q.question}>
                                {q.question}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{q.count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : topQuestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recap data yet.</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Question</TableHead>
                    <TableHead className="w-32">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topQuestions.map((q) => (
                    <TableRow key={q.question}>
                      <TableCell className="font-medium max-w-xl truncate" title={q.question}>
                        {q.question}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{q.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {questionsRecap && typeof questionsRecap.sessionsScanned === 'number' && (
            <p className="text-xs text-muted-foreground">
              Based on {questionsRecap.sessionsScanned.toLocaleString()} sessions.
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}

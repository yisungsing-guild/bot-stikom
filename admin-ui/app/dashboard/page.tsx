"use client"

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import {
  MessageSquare,
  Users,
  Send,
  TrendingUp,
  Sparkles,
  AlertCircle,
  Database,
  ShieldCheck,
  Activity,
  ArrowUpRight,
  Clock,
  HelpCircle,
} from 'lucide-react'
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

type RetrievalQuality = {
  days: number
  totalTraces: number
  retrievalHits: number
  noAnswer: number
  lowConfidence: number
  retrievalHitRate: number
  noAnswerRate: number
  lowConfidenceRate: number
}

type KnowledgePreparationSummary = {
  ok?: boolean
  total: number
  reviewRequired: number
  autoApprovedCandidate: number
  byQualityBand?: Record<string, number>
  byCategory?: Record<string, number>
  conflictSignals?: Record<string, number>
  lowQualityReasons?: Record<string, number>
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
  const [retrievalQuality, setRetrievalQuality] = useState<RetrievalQuality | null>(null)
  const [knowledgePreparation, setKnowledgePreparation] = useState<KnowledgePreparationSummary | null>(null)
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
          adminFetchJson<RetrievalQuality>('/admin/analytics/retrieval-quality?days=30'),
          adminFetchJson<KnowledgePreparationSummary>('/admin/analytics/knowledge-preparation?limit=500'),
          adminFetchJson<ChatListItem[]>('/admin/chats?limit=10'),
        ])

        if (cancelled) return

        const statsRes = results[0].status === 'fulfilled' ? results[0].value : null
        const engagementRes = results[1].status === 'fulfilled' ? results[1].value : null
        const handoverRes = results[2].status === 'fulfilled' ? results[2].value : null
        const retrievalRes = results[3].status === 'fulfilled' ? results[3].value : null
        const knowledgePrepRes = results[4].status === 'fulfilled' ? results[4].value : null
        const chatsRes = results[5].status === 'fulfilled' ? results[5].value : null

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
        if (retrievalRes) setRetrievalQuality(retrievalRes)
        if (knowledgePrepRes) setKnowledgePreparation(knowledgePrepRes)
        if (Array.isArray(chatsRes)) {
          setRecentChats(chatsRes)
        } else {
          const reason = results[5].status === 'rejected' ? results[5].reason : null
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

  const retrievalHitRate = retrievalQuality && typeof retrievalQuality.retrievalHitRate === 'number'
    ? `${retrievalQuality.retrievalHitRate.toFixed(1)}%`
    : '---'

  const noAnswerRate = retrievalQuality && typeof retrievalQuality.noAnswerRate === 'number'
    ? `${retrievalQuality.noAnswerRate.toFixed(1)}%`
    : '---'

  const knowledgeReviewRequired = knowledgePreparation && typeof knowledgePreparation.reviewRequired === 'number'
    ? knowledgePreparation.reviewRequired
    : null

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
    <div className="space-y-8 p-6 sm:p-8 max-w-[1600px] mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/95 to-foreground/75 bg-clip-text text-transparent">
            Dashboard
          </h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Ringkasan performa dan kesehatan bot WhatsApp secara real-time.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live Production System
          </span>
        </div>
      </div>

      {statsError ? (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {statsError}
        </div>
      ) : null}

      {/* Stats Grid: Overflow-proof and color-coded */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3.5 sm:gap-4">
        <StatCard
          title="Total Messages"
          value={totalSessions !== null ? totalSessions.toLocaleString() : '—'}
          icon={MessageSquare}
          variant="violet"
        />
        <StatCard
          title="Active Chats"
          value={activeLastWeek !== null ? activeLastWeek.toLocaleString() : (totalChats !== null ? totalChats.toLocaleString() : '—')}
          icon={Users}
          variant="emerald"
        />
        <StatCard
          title="Messages Sent"
          value={totalBroadcasts !== null ? totalBroadcasts.toLocaleString() : '—'}
          icon={Send}
          variant="sky"
        />
        <StatCard
          title="Response Rate"
          value={responseRate}
          icon={TrendingUp}
          variant="blue"
        />
        <StatCard
          title="Retrieval Hit"
          value={retrievalHitRate}
          icon={Sparkles}
          variant="amber"
        />
        <StatCard
          title="No Answer"
          value={noAnswerRate}
          icon={AlertCircle}
          variant="rose"
        />
        <StatCard
          title="Knowledge Review"
          value={knowledgeReviewRequired !== null ? knowledgeReviewRequired.toLocaleString() : '---'}
          icon={Database}
          variant="fuchsia"
        />
      </div>

      {/* Middle Grid: Activity Overview & System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity Chart */}
        <div className="lg:col-span-2 rounded-2xl border border-border/80 bg-card/70 p-6 backdrop-blur-md shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-2 border-b border-border/40">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Activity className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-base font-semibold tracking-tight">Activity Overview</h3>
                <p className="text-xs text-muted-foreground">Volume pesan masuk & efisiensi respons AI</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 gap-1.5 rounded-lg border-border/70 hover:bg-muted"
              onClick={() => router.push('/history')}
            >
              <span>Detail Riwayat</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50" />
                  <span className="font-medium text-foreground/90">Messages Received</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Total masuk</span>
                  <span className="font-bold text-foreground font-mono">{messagesReceived.toLocaleString()}</span>
                </div>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted/60 overflow-hidden p-[1px]">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400 shadow-sm shadow-blue-500/30 transition-all duration-500" style={{ width: '100%' }} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                  <span className="font-medium text-foreground/90">Successful Responses</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 font-mono">
                    {successPct !== null ? `${successPct.toFixed(1)}%` : '100%'}
                  </span>
                  <span className="font-bold text-foreground font-mono">{successfulResponses.toLocaleString()}</span>
                </div>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted/60 overflow-hidden p-[1px]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400 shadow-sm shadow-emerald-500/30 transition-all duration-500"
                  style={{ width: `${successPct !== null ? successPct : 100}%` }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" />
                  <span className="font-medium text-foreground/90">Failed Responses</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20 font-mono">
                    {successPct !== null ? `${Math.max(0, 100 - successPct).toFixed(1)}%` : '0%'}
                  </span>
                  <span className="font-bold text-foreground font-mono">{failedResponses.toLocaleString()}</span>
                </div>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted/60 overflow-hidden p-[1px]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-rose-500 shadow-sm shadow-amber-500/30 transition-all duration-500"
                  style={{ width: `${successPct !== null ? Math.max(0, 100 - successPct) : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* System Status */}
        <div className="rounded-2xl border border-border/80 bg-card/70 p-6 backdrop-blur-md shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border/40">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
                <h3 className="text-base font-semibold tracking-tight">System Status</h3>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Active
              </span>
            </div>
            
            <div className="space-y-2.5 divide-y divide-border/30">
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm text-muted-foreground font-medium">Bot Status</span>
                <Badge className={apiOk ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 font-semibold text-xs" : "bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold text-xs"}>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1.5 inline-block" />
                  {apiOk ? 'Online' : 'Unknown'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between pt-2.5">
                <span className="text-sm text-muted-foreground font-medium">API Connection</span>
                <Badge className={apiOk ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 font-semibold text-xs" : "bg-rose-500/15 text-rose-400 border border-rose-500/30 font-semibold text-xs"}>
                  {apiOk ? 'Connected' : 'Error'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between pt-2.5">
                <span className="text-sm text-muted-foreground font-medium">Database</span>
                <Badge className={dbHealthy ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 font-semibold text-xs" : "bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold text-xs"}>
                  {dbHealthy ? 'Healthy' : 'Unknown'}
                </Badge>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <span className="text-sm text-muted-foreground font-medium">Knowledge Prep</span>
                <Badge className={knowledgeReviewRequired && knowledgeReviewRequired > 0 ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold text-xs" : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 font-semibold text-xs"}>
                  {knowledgeReviewRequired && knowledgeReviewRequired > 0 ? `${knowledgeReviewRequired} Review` : 'Clear'}
                </Badge>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-border/40 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
              <span>Last Sync</span>
            </div>
            <span className="text-xs font-mono font-medium text-foreground/80 bg-muted/60 px-2 py-0.5 rounded-md border border-border/40 truncate max-w-[170px]" title={lastSyncText}>
              {lastSyncText}
            </span>
          </div>
        </div>
      </div>

      {/* Recent Messages Table */}
      <div className="rounded-2xl border border-border/80 bg-card/70 p-6 backdrop-blur-md shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border/40">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold tracking-tight">Recent Messages</h3>
            <span className="text-xs text-muted-foreground bg-muted/70 px-2 py-0.5 rounded-full font-mono">
              {recentMessages.length}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-8 text-muted-foreground hover:text-foreground"
            onClick={() => router.push('/live-chat')}
          >
            Buka Live Chat
          </Button>
        </div>

        <div className="rounded-xl border border-border/60 overflow-hidden bg-background/50">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Sender</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Message</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Time</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentChatsError ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-destructive py-6 text-center">
                    {recentChatsError}
                  </TableCell>
                </TableRow>
              ) : null}

              {!recentChatsError && recentMessages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-muted-foreground py-8 text-center">
                    Belum ada pesan terbaru.
                  </TableCell>
                </TableRow>
              ) : null}

              {recentMessages.map((msg) => (
                <TableRow key={msg.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-mono text-xs font-semibold text-foreground/90">{msg.sender}</TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-xs truncate">
                    {msg.message || '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{msg.time}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        msg.status === 'resolved'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : msg.status === 'in-progress'
                            ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                            : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      }
                    >
                      {msg.status.charAt(0).toUpperCase() + msg.status.slice(1)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Frequently Asked Questions */}
      <div className="rounded-2xl border border-border/80 bg-card/70 p-6 backdrop-blur-md shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border/40">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold tracking-tight">Frequently Asked Questions</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-8 text-muted-foreground hover:text-foreground"
            onClick={() => router.push('/training-data')}
          >
            Kelola Training Data
          </Button>
        </div>

        {questionGroups.length ? (
          <div className="space-y-6 pt-1">
            {questionGroups.map((g) => (
              <div key={g.key} className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold tracking-wide text-foreground/90">{g.title}</p>
                  <Badge variant="secondary" className="shrink-0 text-xs font-mono">
                    {g.top.length} pertanyaan
                  </Badge>
                </div>

                {g.top.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">Belum ada rekap pertanyaan.</p>
                ) : (
                  <div className="rounded-xl border border-border/60 overflow-hidden bg-background/50">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="font-semibold text-xs uppercase tracking-wider">Pertanyaan</TableHead>
                          <TableHead className="w-28 font-semibold text-xs uppercase tracking-wider text-right">Frekuensi</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.top.map((q) => (
                          <TableRow key={`${g.key}:${q.question}`} className="hover:bg-muted/30 transition-colors">
                            <TableCell className="font-medium text-sm max-w-xl truncate text-foreground/90" title={q.question}>
                              {q.question}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-bold text-primary">
                              {q.count}x
                            </TableCell>
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
          <p className="text-sm text-muted-foreground py-6 text-center">Belum ada data pertanyaan terdeteksi.</p>
        ) : (
          <div className="rounded-xl border border-border/60 overflow-hidden bg-background/50">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Pertanyaan</TableHead>
                  <TableHead className="w-28 font-semibold text-xs uppercase tracking-wider text-right">Frekuensi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topQuestions.map((q) => (
                  <TableRow key={q.question} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-medium text-sm max-w-xl truncate text-foreground/90" title={q.question}>
                      {q.question}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-primary">
                      {q.count}x
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {questionsRecap && typeof questionsRecap.sessionsScanned === 'number' && (
          <p className="text-xs text-muted-foreground pt-2">
            Berdasarkan analisis {questionsRecap.sessionsScanned.toLocaleString()} sesi obrolan WhatsApp.
          </p>
        )}
      </div>
    </div>
  )
}

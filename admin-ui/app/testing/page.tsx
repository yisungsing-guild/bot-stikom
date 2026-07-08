
'use client'

import { useEffect, useMemo, useState } from 'react'
import { Send, RotateCcw, PlayCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { adminFetchJson } from '@/lib/adminApi'

type SampleMessage = {
  chatId: string
  text: string
  label?: string
}

type SimulateResponse = {
  ok?: boolean
  botReply?: string
  source?: string
  handover?: boolean
  processingFlow?: any[]
}

type TestResult = {
  id: number
  input: string
  output: string
  timestamp: string
  status: 'success' | 'error'
  scenario?: string
  ms?: number
  source?: string
  handover?: boolean
  flowSteps?: number
}

export default function TestingPage() {
  const [testMessage, setTestMessage] = useState('')
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [samples, setSamples] = useState<SampleMessage[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await adminFetchJson<SampleMessage[]>('/admin/test/sample-messages')
        if (cancelled) return
        setSamples(Array.isArray(data) ? data : [])
      } catch {
        // keep empty
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const successCount = useMemo(
    () => testResults.filter((r) => r.status === 'success').length,
    [testResults]
  )

  const failureCount = testResults.length - successCount
  const successRate = testResults.length
    ? Math.round((successCount / testResults.length) * 100)
    : 0

  const avgMs = useMemo(() => {
    const ms = testResults.map((r) => r.ms).filter((v): v is number => typeof v === 'number')
    if (!ms.length) return null
    return Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)
  }, [testResults])

  const handleSendTest = async () => {
    if (!testMessage.trim()) return

    const chatId = selectedChatId || samples[0]?.chatId || '628123456789'
    const input = testMessage
    setIsRunning(true)
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now()

    try {
      const res = await adminFetchJson<SimulateResponse>('/admin/test/simulate-message', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: input }),
      })

      const ended = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const newResult: TestResult = {
        id: Date.now(),
        input,
        output: res?.botReply || '(no reply)',
        timestamp: new Date().toLocaleTimeString(),
        status: 'success',
        ms: Math.max(0, Math.round(ended - started)),
        source: typeof res?.source === 'string' ? res.source : undefined,
        handover: typeof res?.handover === 'boolean' ? res.handover : undefined,
        flowSteps: Array.isArray(res?.processingFlow) ? res.processingFlow.length : undefined,
      }
      setTestResults((prev) => [newResult, ...prev])
      setTestMessage('')
    } catch (e: any) {
      const ended = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const newResult: TestResult = {
        id: Date.now(),
        input,
        output: e?.bodyText || e?.message || 'Request failed',
        timestamp: new Date().toLocaleTimeString(),
        status: 'error',
        ms: Math.max(0, Math.round(ended - started)),
      }
      setTestResults((prev) => [newResult, ...prev])
    } finally {
      setIsRunning(false)
    }
  }

  const handleRunScenarios = async () => {
    if (!samples.length) return
    setIsRunning(true)

    const results: TestResult[] = []
    for (const sample of samples) {
      const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
      try {
        const res = await adminFetchJson<SimulateResponse>('/admin/test/simulate-message', {
          method: 'POST',
          body: JSON.stringify({ chatId: sample.chatId, text: sample.text }),
        })
        const ended = typeof performance !== 'undefined' ? performance.now() : Date.now()

        results.push({
          id: Date.now() + results.length,
          input: sample.text,
          output: res?.botReply || '(no reply)',
          timestamp: new Date().toLocaleTimeString(),
          status: 'success',
          scenario: sample.label || 'Scenario',
          ms: Math.max(0, Math.round(ended - started)),
          source: typeof res?.source === 'string' ? res.source : undefined,
          handover: typeof res?.handover === 'boolean' ? res.handover : undefined,
          flowSteps: Array.isArray(res?.processingFlow) ? res.processingFlow.length : undefined,
        })
      } catch (e: any) {
        const ended = typeof performance !== 'undefined' ? performance.now() : Date.now()
        results.push({
          id: Date.now() + results.length,
          input: sample.text,
          output: e?.bodyText || e?.message || 'Request failed',
          timestamp: new Date().toLocaleTimeString(),
          status: 'error',
          scenario: sample.label || 'Scenario',
          ms: Math.max(0, Math.round(ended - started)),
        })
      }
    }

    setTestResults((prev) => [...results.reverse(), ...prev])
    setIsRunning(false)
  }

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Testing</h1>
        <p className="text-muted-foreground mt-2">Test bot responses and scenarios</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Test Input */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-4">Test Input</h3>
              </div>

              <div className="space-y-3">
                <Textarea
                  placeholder="Ketik pesan untuk test bot…"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  rows={6}
                />

                <Button
                  onClick={handleSendTest}
                  className="w-full gap-2"
                  disabled={!testMessage.trim()}
                >
                  <Send className="h-4 w-4" />
                  Send Test
                </Button>
              </div>
            </div>
          </Card>

          {/* Test Scenarios */}
          <Card className="p-6">
            <div className="space-y-4">
              <h3 className="font-semibold mb-4">Test Scenarios</h3>

              <div className="space-y-2">
                {samples.map((scenario, idx) => (
                  <button
                    key={idx}
                    className="w-full text-left p-3 rounded-lg hover:bg-muted transition-colors border border-border"
                    onClick={() => {
                      setSelectedChatId(scenario.chatId)
                      setTestMessage(scenario.text)
                    }}
                  >
                    <p className="text-sm font-medium">{scenario.label || 'Scenario'}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {scenario.text}
                    </p>
                  </button>
                ))}
              </div>

              <Button
                onClick={handleRunScenarios}
                variant="outline"
                className="w-full gap-2"
                disabled={isRunning || samples.length === 0}
              >
                <PlayCircle className="h-4 w-4" />
                {isRunning ? 'Running...' : 'Run All'}
              </Button>
            </div>
          </Card>
        </div>

        {/* Test Results */}
        <Card className="lg:col-span-2 p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">Test Results</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTestResults([])}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Clear
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-4 pr-4">
              {testResults.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <p>No test results yet. Send a test message to get started.</p>
                </div>
              ) : (
                testResults.map((result) => (
                  <div
                    key={result.id}
                    className="border border-border rounded-lg p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        {result.scenario && (
                          <Badge className="mb-2">
                            {result.scenario}
                          </Badge>
                        )}
                        <p className="font-medium text-sm">
                          Input: {result.input}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {result.timestamp}
                      </span>
                    </div>

                    <div className="bg-muted p-3 rounded-lg">
                      <p className="text-sm text-muted-foreground">Response:</p>
                      <p className="text-sm mt-2">{result.output}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {result.source && (
                          <Badge variant="outline">source: {result.source}</Badge>
                        )}
                        {typeof result.handover === 'boolean' && (
                          <Badge variant="outline">handover: {result.handover ? 'yes' : 'no'}</Badge>
                        )}
                        {typeof result.flowSteps === 'number' && (
                          <Badge variant="outline">flow: {result.flowSteps} steps</Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <Badge
                        variant={
                          result.status === 'success'
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {result.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Response time: {typeof result.ms === 'number' ? `${result.ms}ms` : '—'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </Card>
      </div>

      {/* Test Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Tests</p>
          <p className="text-2xl font-bold mt-2">{testResults.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Success Rate</p>
          <p className="text-2xl font-bold mt-2">{successRate}%</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Avg Response Time</p>
          <p className="text-2xl font-bold mt-2">{avgMs !== null ? `${avgMs}ms` : '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Failed Tests</p>
          <p className="text-2xl font-bold mt-2">{failureCount}</p>
        </Card>
      </div>
    </div>
  )
}

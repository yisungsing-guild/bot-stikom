"use client"

import { useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminFetchJson } from '@/lib/adminApi'

type WhatsAppConfig = {
  provider?: string
  phoneNumberId?: string
  businessAccountId?: string
  webhookVerifyToken?: string
  webhookUrl?: string
  isConfigured?: boolean
}

type WebhookSetup = {
  currentConfig?: {
    suggestedWebhookUrl?: string
  }
}

type WebhookDiagnostics = {
  values?: Record<string, string>
}

function safeJsonParse<T>(value: string | undefined | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export default function WhatsAppPage() {
  const [config, setConfig] = useState<WhatsAppConfig | null>(null)
  const [webhookSetup, setWebhookSetup] = useState<WebhookSetup | null>(null)
  const [diagnostics, setDiagnostics] = useState<WebhookDiagnostics | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [cfg, setup] = await Promise.all([
          adminFetchJson<WhatsAppConfig>('/admin/whatsapp/config'),
          adminFetchJson<WebhookSetup>('/admin/whatsapp/webhook-setup'),
        ])
        if (cancelled) return
        setConfig(cfg || null)
        setWebhookSetup(setup || null)

        try {
          const diag = await adminFetchJson<WebhookDiagnostics>('/admin/whatsapp/webhook-diagnostics')
          if (!cancelled) setDiagnostics(diag || null)
        } catch {
          // ignore diagnostics errors
        }
      } catch {
        // Keep defaults.
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const diagValues = diagnostics && diagnostics.values ? diagnostics.values : {}
  const lastAcceptedAt = diagValues['wati_last_webhook_accepted_at'] || '—'
  const lastRejectedAt = diagValues['wati_last_webhook_rejected_at'] || '—'
  const lastRejectedMetaRaw = diagValues['wati_last_webhook_rejected_meta'] || ''
  const lastIgnoredAt = diagValues['wati_last_webhook_ignored_at'] || '—'
  const lastIgnoredReason = diagValues['wati_last_webhook_ignored_reason'] || '—'
  const lastForwardedAt = diagValues['wati_last_webhook_forwarded_at'] || '—'
  const forwardResultRaw = diagValues['wati_last_webhook_forward_result'] || ''

  const rejectedMeta = safeJsonParse<{ source?: string; hasProvidedToken?: boolean; providedTokenLength?: number; expectedTokenLength?: number }>(lastRejectedMetaRaw)
  const forwardResult = safeJsonParse<{ ok?: boolean; error?: string }>(forwardResultRaw)

  const phoneNumberId = config && typeof config.phoneNumberId === 'string'
    ? config.phoneNumberId
    : '+1 (555) 123-4567'

  const businessAccountId = config && typeof config.businessAccountId === 'string'
    ? config.businessAccountId
    : '123456789'

  const webhookUrl = webhookSetup && webhookSetup.currentConfig && webhookSetup.currentConfig.suggestedWebhookUrl
    ? webhookSetup.currentConfig.suggestedWebhookUrl
    : (config && typeof config.webhookUrl === 'string' ? config.webhookUrl : 'https://api.example.com/webhook')

  const verifyToken = config && typeof config.webhookVerifyToken === 'string'
    ? config.webhookVerifyToken
    : 'your_verify_token_here'

  const isConfigured = !!(config && config.isConfigured)
  const provider = config && typeof config.provider === 'string' ? config.provider : ''
  const credentialHint = isConfigured ? 'Configured on server' : 'Not configured'

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
  }

  async function handleTestWebhook() {
    try {
      await adminFetchJson('/admin/whatsapp/health', { method: 'POST' })
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">WhatsApp Configuration</h1>
        <p className="text-muted-foreground mt-2">Connect and configure your WhatsApp bot</p>
      </div>

      {/* Connection Status */}
      <Card className="p-6 border-l-4 border-l-green-500">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <p className="font-semibold text-lg">Connection Status</p>
            <div className="flex items-center gap-2">
              <div className={`h-3 w-3 rounded-full ${isConfigured ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
              <span className="text-sm">{isConfigured ? 'Connected' : 'Not configured'}</span>
            </div>
          </div>
          {isConfigured ? (
            <Badge className="bg-green-500/20 text-green-500 hover:bg-green-500/30">Active</Badge>
          ) : (
            <Badge variant="secondary">Inactive</Badge>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* QR Code Section */}
        <Card className="lg:col-span-1 p-6">
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">QR Code</h3>
              <p className="text-sm text-muted-foreground">
                Scan with your WhatsApp to connect
              </p>
            </div>

            <div className="aspect-square bg-muted rounded-lg flex items-center justify-center border-2 border-dashed border-border">
              <div className="text-center">
                <p className="text-2xl mb-2">📱</p>
                <p className="text-sm text-muted-foreground">QR Code</p>
              </div>
            </div>

            <Button variant="outline" className="w-full gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh QR
            </Button>
          </div>
        </Card>

        {/* Configuration Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Phone Configuration */}
          <Card className="p-6">
            <div className="space-y-4">
              <h3 className="font-semibold">Phone Configuration</h3>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="provider">Provider</Label>
                  <Input id="provider" value={provider || '—'} disabled />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">WhatsApp Phone Number</Label>
                  <Input
                    id="phone"
                    value={phoneNumberId}
                    disabled
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="display-name">Display Name</Label>
                  <Input
                    id="display-name"
                    placeholder="Nama bot (tampilan)"
                    defaultValue="WhatsApp Assistant"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="business-id">Business Account ID</Label>
                  <div className="flex gap-2">
                    <Input
                      id="business-id"
                      value={businessAccountId}
                      readOnly
                    />
                    <Button variant="outline" size="sm" onClick={() => copyText(businessAccountId)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Webhook Configuration */}
          <Card className="p-6">
            <div className="space-y-4">
              <h3 className="font-semibold">Webhook Configuration</h3>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">Webhook URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="webhook-url"
                      value={webhookUrl}
                      readOnly
                    />
                    <Button variant="outline" size="sm" onClick={() => copyText(webhookUrl)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="verify-token">Verify Token</Label>
                  <div className="flex gap-2">
                    <Input
                      id="verify-token"
                      type="password"
                      value={verifyToken}
                      readOnly
                    />
                    <Button variant="outline" size="sm" onClick={() => copyText(verifyToken)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <Button variant="outline" className="w-full" onClick={handleTestWebhook}>
                  Test Webhook
                </Button>
              </div>
            </div>
          </Card>

          {/* Webhook Diagnostics */}
          <Card className="p-6">
            <div className="space-y-4">
              <h3 className="font-semibold">Webhook Diagnostics</h3>
              <p className="text-sm text-muted-foreground">
                Ini membantu memastikan webhook WATI benar-benar masuk ke server (diterima/ditolak/diabaikan) dan apakah forward ke engine berhasil.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Last Accepted</p>
                  <p className="text-sm text-muted-foreground break-all">{lastAcceptedAt}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-medium">Last Rejected</p>
                  <p className="text-sm text-muted-foreground break-all">{lastRejectedAt}</p>
                  {rejectedMeta ? (
                    <p className="text-xs text-muted-foreground">
                      source: {rejectedMeta.source || '—'}; hasToken: {String(!!rejectedMeta.hasProvidedToken)}; len: {String(rejectedMeta.providedTokenLength ?? '—')} / {String(rejectedMeta.expectedTokenLength ?? '—')}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-medium">Last Ignored</p>
                  <p className="text-sm text-muted-foreground break-all">{lastIgnoredAt}</p>
                  <p className="text-xs text-muted-foreground">reason: {lastIgnoredReason}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-medium">Last Forward</p>
                  <p className="text-sm text-muted-foreground break-all">{lastForwardedAt}</p>
                  <p className="text-xs text-muted-foreground">
                    result: {forwardResult ? (forwardResult.ok ? 'ok' : 'failed') : (forwardResultRaw ? 'unknown' : '—')}
                    {forwardResult && !forwardResult.ok && forwardResult.error ? ` (${String(forwardResult.error).slice(0, 120)})` : ''}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* API Keys */}
          <Card className="p-6">
            <div className="space-y-4">
              <h3 className="font-semibold">API Credentials</h3>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-key">API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="api-key"
                      type="password"
                      value={credentialHint}
                      readOnly
                    />
                    <Button variant="outline" size="sm" disabled>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="access-token">Access Token</Label>
                  <div className="flex gap-2">
                    <Input
                      id="access-token"
                      type="password"
                      value={credentialHint}
                      readOnly
                    />
                    <Button variant="outline" size="sm" disabled>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <Button variant="outline" className="w-full" disabled>
                  Regenerate Keys
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Recent Activity */}
      <Card className="p-6">
        <div className="space-y-4">
          <h3 className="font-semibold">Connection Activity</h3>

          <div className="space-y-3">
            <div className="flex items-start gap-4 pb-3 border-b border-border">
              <div className="h-2 w-2 rounded-full bg-green-500 mt-2" />
              <div className="flex-1">
                <p className="font-medium">Connection established</p>
                <p className="text-xs text-muted-foreground">Today at 10:30 AM</p>
              </div>
            </div>

            <div className="flex items-start gap-4 pb-3 border-b border-border">
              <div className="h-2 w-2 rounded-full bg-blue-500 mt-2" />
              <div className="flex-1">
                <p className="font-medium">Webhook verified</p>
                <p className="text-xs text-muted-foreground">Yesterday at 3:45 PM</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="h-2 w-2 rounded-full bg-green-500 mt-2" />
              <div className="flex-1">
                <p className="font-medium">API keys rotated</p>
                <p className="text-xs text-muted-foreground">3 days ago</p>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

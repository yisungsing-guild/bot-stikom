"use client"

import { useEffect, useMemo, useState } from 'react'
import { Save, EyeOff } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { adminFetchJson } from '@/lib/adminApi'

type SettingItem = {
  id: string
  key: string
  value: string
}

export default function SettingPage() {
  const [activeSection, setActiveSection] = useState<'general' | 'api' | 'notifications' | 'advanced'>('general')

  const [botName, setBotName] = useState('WhatsApp Assistant')
  const [botDescription, setBotDescription] = useState('This bot helps with customer support and information queries.')
  const [welcomeMessage, setWelcomeMessage] = useState('')
  const [language, setLanguage] = useState('English')
  const [webhookUrl, setWebhookUrl] = useState('https://api.example.com/webhook')
  const [apiEndpoint, setApiEndpoint] = useState('https://api.whatsapp.com/v1')

  const [autoResponse, setAutoResponse] = useState(true)
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true)
  const [humanHandoff, setHumanHandoff] = useState(true)
  const [typingIndicator, setTypingIndicator] = useState(false)

  const [saving, setSaving] = useState(false)

  const [allSettings, setAllSettings] = useState<SettingItem[] | null>(null)

  async function loadSettings() {
    const res = await adminFetchJson<SettingItem[]>('/admin/settings')

    const normalized = Array.isArray(res) ? res : []
    setAllSettings(normalized)

    const map = new Map<string, string>()
    for (const s of normalized) {
      if (s && typeof s.key === 'string') map.set(s.key, String(s.value ?? ''))
    }

    if (map.has('bot_name')) setBotName(map.get('bot_name') || '')
    if (map.has('bot_description')) setBotDescription(map.get('bot_description') || '')
    if (map.has('welcome_message')) setWelcomeMessage(map.get('welcome_message') || '')
    if (map.has('default_language')) setLanguage(map.get('default_language') || 'English')
    if (map.has('webhook_url')) setWebhookUrl(map.get('webhook_url') || '')
    if (map.has('api_endpoint')) setApiEndpoint(map.get('api_endpoint') || '')

    if (map.has('feature_auto_response')) setAutoResponse(map.get('feature_auto_response') === 'true')
    if (map.has('feature_analytics')) setAnalyticsEnabled(map.get('feature_analytics') === 'true')
    if (map.has('feature_human_handoff')) setHumanHandoff(map.get('feature_human_handoff') === 'true')
    if (map.has('feature_typing_indicator')) setTypingIndicator(map.get('feature_typing_indicator') === 'true')
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        await loadSettings()
        if (cancelled) return
      } catch {
        // Keep defaults.
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const sortedSettings = useMemo(() => {
    const list = allSettings ? [...allSettings] : []
    list.sort((a, b) => a.key.localeCompare(b.key))
    return list
  }, [allSettings])

  const saveItems = useMemo(() => {
    return [
      { key: 'bot_name', value: botName },
      { key: 'bot_description', value: botDescription },
      { key: 'welcome_message', value: welcomeMessage },
      { key: 'default_language', value: language },
      { key: 'webhook_url', value: webhookUrl },
      { key: 'api_endpoint', value: apiEndpoint },
      { key: 'feature_auto_response', value: String(autoResponse) },
      { key: 'feature_analytics', value: String(analyticsEnabled) },
      { key: 'feature_human_handoff', value: String(humanHandoff) },
      { key: 'feature_typing_indicator', value: String(typingIndicator) },
    ]
  }, [
    botName,
    botDescription,
    welcomeMessage,
    language,
    webhookUrl,
    apiEndpoint,
    autoResponse,
    analyticsEnabled,
    humanHandoff,
    typingIndicator,
  ])

  async function handleSave() {
    try {
      setSaving(true)
      await Promise.all(
        saveItems.map((it) =>
          adminFetchJson('/admin/settings', {
            method: 'POST',
            body: JSON.stringify(it),
          })
        )
      )

      try {
        await loadSettings()
      } catch {
        // Ignore refresh errors.
      }
    } catch {
      // Ignore UI changes; keep form.
    } finally {
      setSaving(false)
    }
  }

  function jumpTo(section: 'general' | 'api' | 'notifications' | 'advanced') {
    setActiveSection(section)

    const sectionId =
      section === 'general'
        ? 'settings-general'
        : section === 'api'
          ? 'settings-api'
          : section === 'notifications'
            ? 'settings-notifications'
            : 'settings-advanced'

    try {
      requestAnimationFrame(() => {
        const el = document.getElementById(sectionId)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch {
      // ignore
    }
  }

  const navBtnBase =
    'w-full px-4 py-3 text-left hover:bg-muted border-b border-border'

  const navBtnActive = 'font-medium text-foreground bg-muted'
  const navBtnInactive = 'text-muted-foreground'

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-2">Configure your WhatsApp bot settings</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sidebar navigation */}
        <div className="space-y-2">
          <div className="rounded-lg border border-border">
            <button
              type="button"
              aria-current={activeSection === 'general' ? 'true' : 'false'}
              onClick={() => jumpTo('general')}
              className={`${navBtnBase} rounded-t-lg ${
                activeSection === 'general' ? navBtnActive : navBtnInactive
              }`}
            >
              General
            </button>
            <button
              type="button"
              aria-current={activeSection === 'api' ? 'true' : 'false'}
              onClick={() => jumpTo('api')}
              className={`${navBtnBase} ${activeSection === 'api' ? navBtnActive : navBtnInactive}`}
            >
              API Keys
            </button>
            <button
              type="button"
              aria-current={activeSection === 'notifications' ? 'true' : 'false'}
              onClick={() => jumpTo('notifications')}
              className={`${navBtnBase} ${
                activeSection === 'notifications' ? navBtnActive : navBtnInactive
              }`}
            >
              Notifications
            </button>
            <button
              type="button"
              aria-current={activeSection === 'advanced' ? 'true' : 'false'}
              onClick={() => jumpTo('advanced')}
              className={`w-full px-4 py-3 text-left hover:bg-muted rounded-b-lg ${
                activeSection === 'advanced' ? navBtnActive : navBtnInactive
              }`}
            >
              Advanced
            </button>
          </div>
        </div>

        {/* Main settings content */}
        <div className="lg:col-span-2 space-y-6">
          {/* General Settings */}
          <Card id="settings-general" className="p-6 scroll-mt-24">
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-4">General Settings</h2>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bot-name">Bot Name</Label>
                  <Input
                    id="bot-name"
                    placeholder="mis: Asisten Kampus STIKOM"
                    value={botName}
                    onChange={(e) => setBotName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bot-description">Description</Label>
                  <Textarea
                    id="bot-description"
                    placeholder="mis: Asisten virtual untuk informasi kampus"
                    value={botDescription}
                    onChange={(e) => setBotDescription(e.target.value)}
                    rows={4}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="welcome-message">Welcome Message</Label>
                  <Textarea
                    id="welcome-message"
                    placeholder={
                      'Contoh:\nHalo 👋\nSelamat datang di Layanan Informasi Kampus 🎓\n\nKetik angka menu berikut:\n1. Akademik & Kemahasiswaan\n2. Keuangan\n3. Program Internasional\n\n(Opsional) User juga bisa ketik: menu'
                    }
                    value={welcomeMessage}
                    onChange={(e) => setWelcomeMessage(e.target.value)}
                    rows={4}
                  />
                  <p className="text-sm text-muted-foreground">
                    Stored as setting key <span className="font-mono">welcome_message</span>.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="language">Default Language</Label>
                  <select
                    className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option>English</option>
                    <option>Indonesian</option>
                    <option>Spanish</option>
                    <option>French</option>
                  </select>
                </div>
              </div>
            </div>
          </Card>

          {/* API Configuration */}
          <Card id="settings-api" className="p-6 scroll-mt-24">
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-4">API Configuration</h2>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-key">API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="api-key"
                      type="password"
                      defaultValue="sk_test_51234567890"
                      readOnly
                    />
                    <Button variant="outline" size="sm">
                      <EyeOff className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="webhook-url">Webhook URL</Label>
                  <Input
                    id="webhook-url"
                    type="url"
                    placeholder="https://domainmu.com/provider/webhook"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="api-endpoint">API Endpoint</Label>
                  <Input
                    id="api-endpoint"
                    type="url"
                    placeholder="https://api.provider.com"
                    value={apiEndpoint}
                    onChange={(e) => setApiEndpoint(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Features & Preferences */}
          <Card id="settings-notifications" className="p-6 scroll-mt-24">
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-4">Features & Preferences</h2>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Enable Auto-Response</p>
                    <p className="text-sm text-muted-foreground">
                      Automatically respond to messages
                    </p>
                  </div>
                  <Switch checked={autoResponse} onCheckedChange={setAutoResponse} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Enable Analytics</p>
                    <p className="text-sm text-muted-foreground">
                      Track bot performance and metrics
                    </p>
                  </div>
                  <Switch checked={analyticsEnabled} onCheckedChange={setAnalyticsEnabled} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Enable Human Handoff</p>
                    <p className="text-sm text-muted-foreground">
                      Allow escalation to human agents
                    </p>
                  </div>
                  <Switch checked={humanHandoff} onCheckedChange={setHumanHandoff} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Enable Typing Indicator</p>
                    <p className="text-sm text-muted-foreground">
                      Show typing indicator while processing
                    </p>
                  </div>
                  <Switch checked={typingIndicator} onCheckedChange={setTypingIndicator} />
                </div>
              </div>
            </div>
          </Card>

          {/* All settings (DB) */}
          <Card id="settings-advanced" className="p-6 scroll-mt-24">
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">All Settings (Database)</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Read-only view of every setting row stored in the database.
                </p>
              </div>

              {sortedSettings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No settings found.</p>
              ) : (
                <div className="rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Key</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedSettings.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.key}</TableCell>
                          <TableCell className="text-muted-foreground max-w-[360px] truncate" title={String(s.value ?? '')}>
                            {String(s.value ?? '')}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{s.id.slice(0, 8)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Card>

          {/* Save Button */}
          <div className="flex gap-3">
            <Button className="gap-2" onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4" />
              Save Changes
            </Button>
            <Button variant="outline">Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

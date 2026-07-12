"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, CheckCircle, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AdminApiError, adminFetchJson, adminFetchRaw } from '@/lib/adminApi'
import { getAdminIdentity, getAdminToken } from '@/lib/adminIdentity'

type TrainingItem = {
  id: string
  filename: string
  divisionKey?: string | null
  ragIngestStatus?: string | null
  ragIngestError?: string | null
  ragIngestedAt?: string | null
  ragChunkCount?: number | null
  active?: boolean
  createdAt?: string
  source?: string
  uploadedBy?: {
    id: string
    username: string
    displayName?: string | null
    role?: string
  } | null
}

type UploadSingleResponse = {
  ok?: boolean
  trainingDataId?: string
  filename?: string
  contentPreview?: string
}

type UploadBulkResponse = {
  ok?: boolean
  results?: Array<{
    ok?: boolean
    trainingDataId?: string
    filename?: string
    contentPreview?: string
  }>
}

type TrainingPreviewResponse = {
  id: string
  filename?: string
  source?: string | null
  divisionKey?: string | null
  ragIngestStatus?: string | null
  ragIngestError?: string | null
  ragIngestedAt?: string | null
  ragChunkCount?: number | null
  createdAt?: string
  uploadedBy?: {
    id: string
    username: string
    displayName?: string | null
    role?: string
  } | null
  preview?: string
  length?: number
  truncated?: boolean
}

type ValidationFileItem = {
  id: string
  createdAt?: string
  originalname?: string | null
  storedAs?: string | null
  size?: number | null
  mimetype?: string | null
  exists?: boolean
  uploader?: {
    id?: string | null
    username?: string | null
    displayName?: string | null
    role?: string | null
    divisionKey?: string | null
  } | null
}

type MediaUploadResponse = {
  ok?: boolean
  url?: string
  marker?: string
  storedAs?: string
  originalname?: string
  size?: number
  mimetype?: string
}

type ManualTrainingCreateResponse = {
  ok?: boolean
  trainingDataId?: string
  filename?: string
  contentLength?: number
  wasTruncated?: boolean
}

function formatApiErrorText(input: unknown): string {
  const raw = input == null ? '' : String(input)
  const trimmed = raw.trim()
  if (!trimmed) return 'Request failed.'

  // If backend returns JSON error, render it human-friendly.
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed: any = JSON.parse(trimmed)
      const msg = parsed && parsed.error ? String(parsed.error) : raw
      const suggestions = Array.isArray(parsed && parsed.suggestions)
        ? parsed.suggestions.map((s: any) => String(s)).filter(Boolean)
        : []
      const errorCode = parsed && parsed.errorCode ? String(parsed.errorCode) : ''
      const prismaCode = parsed && parsed.prismaCode ? String(parsed.prismaCode) : ''
      const requestId = parsed && parsed.requestId ? String(parsed.requestId) : ''
      const parts: string[] = [msg]
      if (suggestions.length) {
        parts.push('', 'Saran:', ...suggestions.map((s) => `- ${s}`))
      }
      if (errorCode) {
        parts.push('', `ErrorCode: ${errorCode}`)
      }
      if (prismaCode) {
        parts.push(`PrismaCode: ${prismaCode}`)
      }
      if (requestId) {
        parts.push('', `RequestId: ${requestId}`)
      }
      return parts.join('\n')
    } catch {
      // fall through
    }
  }

  return raw
}

export default function TrainingDataPage() {
  const [items, setItems] = useState<TrainingItem[] | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const validationFileInputRef = useRef<HTMLInputElement | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [lastUploadResults, setLastUploadResults] = useState<Array<{ ok: boolean; filename: string; trainingDataId?: string }> | null>(null)
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

  const [mediaCaption, setMediaCaption] = useState('')
  const [mediaDescription, setMediaDescription] = useState('')
  const [mediaUploading, setMediaUploading] = useState(false)
  const [mediaSavingTraining, setMediaSavingTraining] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [mediaUploaded, setMediaUploaded] = useState<MediaUploadResponse | null>(null)
  const [mediaTraining, setMediaTraining] = useState<ManualTrainingCreateResponse | null>(null)

  const ident = getAdminIdentity()
  const role = ident && ident.role ? String(ident.role) : null
  const canUpload = !!getAdminToken()

  async function uploadPublicImage(file: File) {
    setMediaUploading(true)
    setMediaError(null)
    setMediaTraining(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const cap = mediaCaption.trim()
      if (cap) fd.append('caption', cap)

      const res = await adminFetchJson<MediaUploadResponse>('/admin/media/upload', {
        method: 'POST',
        body: fd,
      })
      setMediaUploaded(res)
    } catch (e: any) {
      if (e instanceof AdminApiError) {
        setMediaError(formatApiErrorText(e.bodyText || `Upload failed (${e.status}).`))
      } else {
        setMediaError(formatApiErrorText(e?.message || 'Upload failed.'))
      }
      setMediaUploaded(null)
    } finally {
      setMediaUploading(false)
    }
  }

  async function copyMediaMarker() {
    const marker = mediaUploaded && mediaUploaded.marker ? String(mediaUploaded.marker) : ''
    if (!marker.trim()) return
    try {
      await navigator.clipboard.writeText(marker)
    } catch {
      // ignore (clipboard may be blocked)
    }
  }

  async function saveMediaAsTraining() {
    const marker = mediaUploaded && mediaUploaded.marker ? String(mediaUploaded.marker).trim() : ''
    const desc = mediaDescription.trim()
    if (!marker || !desc) {
      setMediaError('Upload gambar dulu dan isi deskripsi (untuk RAG).')
      return
    }

    setMediaSavingTraining(true)
    setMediaError(null)
    try {
      const titleBase = mediaUploaded && mediaUploaded.originalname
        ? `media-${String(mediaUploaded.originalname).slice(0, 120)}`
        : `media-${new Date().toISOString()}`

      const text = `${marker}\n\n${desc}`
      const created = await adminFetchJson<ManualTrainingCreateResponse>('/admin/training/manual', {
        method: 'POST',
        body: JSON.stringify({ title: titleBase, text }),
      })
      setMediaTraining(created)

      try {
        const refreshed = await adminFetchJson<TrainingItem[]>('/admin/training')
        setItems(Array.isArray(refreshed) ? refreshed : [])
      } catch {
        // ignore refresh errors
      }
    } catch (e: any) {
      if (e instanceof AdminApiError) {
        setMediaError(formatApiErrorText(e.bodyText || `Request failed (${e.status}).`))
      } else {
        setMediaError(formatApiErrorText(e?.message || 'Failed to create training data.'))
      }
      setMediaTraining(null)
    } finally {
      setMediaSavingTraining(false)
    }
  }

  const isSuperAdmin = useMemo(() => {
    const r = String(role || '').toLowerCase().trim()
    return r === 'superadmin'
  }, [role])

  const canManageValidationFlag = useMemo(() => {
    const r = String(role || '').toLowerCase().trim()
    return r === 'admin' || r === 'superadmin' || r === 'marketing'
  }, [role])

  const [validationFileEnabled, setValidationFileEnabled] = useState<boolean | null>(null)
  const [isValidationFlagLoading, setIsValidationFlagLoading] = useState(false)
  const [validationFlagError, setValidationFlagError] = useState<string | null>(null)
  const [isValidationUploading, setIsValidationUploading] = useState(false)
  const [validationUploadError, setValidationUploadError] = useState<string | null>(null)
  const [lastValidationUpload, setLastValidationUpload] = useState<{ filename: string; storedAs?: string } | null>(null)

  const [validationFiles, setValidationFiles] = useState<ValidationFileItem[] | null>(null)
  const [validationFilesError, setValidationFilesError] = useState<string | null>(null)
  const [isValidationFilesLoading, setIsValidationFilesLoading] = useState(false)
  const [downloadingStoredAs, setDownloadingStoredAs] = useState<string | null>(null)

  const [ragQuestion, setRagQuestion] = useState('')
  const [ragResult, setRagResult] = useState<any>(null)
  const [ragError, setRagError] = useState<string | null>(null)
  const [isRagRunning, setIsRagRunning] = useState(false)
  const [lastUploaded, setLastUploaded] = useState<{ filename: string; trainingDataId?: string } | null>(null)

  const [isDragOverUpload, setIsDragOverUpload] = useState(false)

  const [review, setReview] = useState<TrainingPreviewResponse | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [isReviewLoading, setIsReviewLoading] = useState(false)
  const [isReviewFull, setIsReviewFull] = useState(false)
  const [reviewMode, setReviewMode] = useState<'text' | 'file'>('text')
  const [reviewImageUrl, setReviewImageUrl] = useState<string | null>(null)
  const [isReviewAssetLoading, setIsReviewAssetLoading] = useState(false)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [downloadingTrainingId, setDownloadingTrainingId] = useState<string | null>(null)
  const [retrainingIds, setRetrainingIds] = useState<Record<string, boolean>>({})
  const [retrainMessage, setRetrainMessage] = useState<string | null>(null)
  const [retrainError, setRetrainError] = useState<string | null>(null)

  const PAGE_SIZE = 5

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await adminFetchJson<TrainingItem[]>('/admin/training')
        if (cancelled) return
        setItems(Array.isArray(res) ? res : [])
        setItemsError(null)
      } catch (e) {
        if (cancelled) return
        if (e instanceof AdminApiError) {
          const snippet = e.bodyText ? ` ${String(e.bodyText).slice(0, 180)}` : ''
          setItemsError(`Failed to load training data (${e.status}).${snippet}`)
        } else {
          setItemsError('Failed to load training data.')
        }
        setItems([])
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function loadValidationFiles() {
    if (!getAdminToken()) return
    if (!isSuperAdmin) return

    setIsValidationFilesLoading(true)
    setValidationFilesError(null)
    try {
      const res = await adminFetchJson<{ ok?: boolean; items?: ValidationFileItem[] }>('/admin/training/validation?limit=100')
      const list = Array.isArray(res?.items) ? res.items : []
      setValidationFiles(list)
    } catch (e: any) {
      const msg = e && e.bodyText ? String(e.bodyText) : (e && e.message ? String(e.message) : 'Failed to load validation files')
      setValidationFiles([])
      setValidationFilesError(formatApiErrorText(msg))
    } finally {
      setIsValidationFilesLoading(false)
    }
  }

  useEffect(() => {
    void loadValidationFiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin])

  async function downloadValidationFile(item: ValidationFileItem) {
    const storedAs = item && item.storedAs ? String(item.storedAs) : ''
    if (!storedAs) return
    const name = item && item.originalname ? String(item.originalname) : storedAs

    setDownloadingStoredAs(storedAs)
    try {
      const url = `/admin/training/validation/download/${encodeURIComponent(storedAs)}?name=${encodeURIComponent(name)}`
      const res = await adminFetchRaw(url, { method: 'GET' })
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = objectUrl
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()

      try {
        URL.revokeObjectURL(objectUrl)
      } catch {
        // ignore
      }
    } catch (e: any) {
      const msg = e && e.bodyText ? String(e.bodyText) : (e && e.message ? String(e.message) : 'Download failed')
      setValidationFilesError(formatApiErrorText(msg))
    } finally {
      setDownloadingStoredAs(null)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadFlag() {
      if (!getAdminToken()) return

      setIsValidationFlagLoading(true)
      setValidationFlagError(null)

      try {
        const res = await adminFetchJson<{ ok?: boolean; enabled?: boolean }>('/admin/feature-flags/validation-file')
        if (cancelled) return
        setValidationFileEnabled(!!res?.enabled)
      } catch (e: any) {
        if (cancelled) return
        setValidationFileEnabled(false)
        const msg = e && e.bodyText ? String(e.bodyText) : (e && e.message ? String(e.message) : 'Failed to load feature flag')
        setValidationFlagError(msg)
      } finally {
        if (!cancelled) setIsValidationFlagLoading(false)
      }
    }

    loadFlag()
    return () => {
      cancelled = true
    }
  }, [])

  async function toggleValidationFileEnabled(nextEnabled: boolean) {
    setIsValidationFlagLoading(true)
    setValidationFlagError(null)

    try {
      const res = await adminFetchJson<{ ok?: boolean; enabled?: boolean }>('/admin/feature-flags/validation-file', {
        method: 'PUT',
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      setValidationFileEnabled(!!res?.enabled)
    } catch (e: any) {
      const msg = e && e.bodyText ? String(e.bodyText) : (e && e.message ? String(e.message) : 'Failed to update feature flag')
      setValidationFlagError(msg)
    } finally {
      setIsValidationFlagLoading(false)
    }
  }

  async function uploadValidationFile(file: File) {
    if (!file) return
    setIsValidationUploading(true)
    setValidationUploadError(null)
    setLastValidationUpload(null)

    try {
      const fd = new FormData()
      fd.append('file', file)
      const resp = await adminFetchJson<{ ok?: boolean; filename?: string; storedAs?: string }>('/admin/training/validation/upload', {
        method: 'POST',
        body: fd,
      })
      setLastValidationUpload({
        filename: resp?.filename ? String(resp.filename) : file.name,
        storedAs: resp?.storedAs ? String(resp.storedAs) : undefined,
      })
    } catch (e: any) {
      const msg = e && e.bodyText ? e.bodyText : (e && e.message ? e.message : 'Validation upload failed')
      setValidationUploadError(formatApiErrorText(msg))
    } finally {
      setIsValidationUploading(false)
      try {
        if (validationFileInputRef.current) validationFileInputRef.current.value = ''
      } catch {
        // ignore
      }
    }
  }

  async function refresh() {
    try {
      const res = await adminFetchJson<TrainingItem[]>('/admin/training')
      setItems(Array.isArray(res) ? res : [])
      setItemsError(null)
    } catch {
      // ignore
    }
  }

  async function retrainDataset(trainingId: string, options: { quiet?: boolean } = {}) {
    const id = String(trainingId || '').trim()
    if (!id) return

    setRetrainError(null)
    if (!options.quiet) setRetrainMessage('Retrain started. Status will refresh automatically.')
    setRetrainingIds((prev) => ({ ...prev, [id]: true }))
    setItems((prev) => Array.isArray(prev)
      ? prev.map((item) => (item.id === id ? { ...item, ragIngestStatus: 'processing', ragIngestError: null } : item))
      : prev)

    try {
      const result: any = await adminFetchJson(`/admin/rag/ingest/${encodeURIComponent(id)}`, { method: 'POST' })
      await refresh()
      const status = result && result.success === false
        ? (result.status || 'failed')
        : 'success'
      const detail = result && result.reason ? ` (${String(result.reason)})` : ''
      setRetrainMessage(`Retrain finished: ${status}${detail}`)
    } catch (e: any) {
      const msg = e && e.bodyText ? e.bodyText : (e && e.message ? e.message : 'Retrain failed')
      setRetrainError(formatApiErrorText(msg))
      await refresh()
    } finally {
      setRetrainingIds((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  async function retrainProblemDatasets() {
    const targets = rows
      .filter((row: any) => row.status === 'active' && ['rejected', 'failed', 'unknown'].includes(String(row.ragStatus || '').toLowerCase()))
      .map((row: any) => String(row.id))

    if (!targets.length) {
      setRetrainError(null)
      setRetrainMessage('No rejected/failed datasets to retrain. Click Refresh Status to check latest state.')
      await refresh()
      return
    }

    setRetrainError(null)
    setRetrainMessage(`Retraining ${targets.length} dataset(s). Keep this page open; status will update automatically.`)

    for (const id of targets) {
      await retrainDataset(id, { quiet: true })
    }

    setRetrainMessage('Retrain complete. Latest RAG status is shown in the table.')
  }
  async function loadReview(trainingId: string, opts: { full?: boolean } = {}) {
    const id = String(trainingId || '').trim()
    if (!id) return

    setIsReviewLoading(true)
    setReviewError(null)

    try {
      const full = !!opts.full
      const qs = full ? '?full=1' : ''
      const res = await adminFetchJson<TrainingPreviewResponse>(`/admin/training/${encodeURIComponent(id)}/preview${qs}`)
      setReview(res || null)
      setIsReviewFull(full)
      if (!full) setReviewMode('text')
    } catch (e: any) {
      const msg = e && e.bodyText ? e.bodyText : (e && e.message ? e.message : 'Failed to load review')
      setReviewError(formatApiErrorText(msg))
      setReview(null)
      setIsReviewFull(false)
      setReviewMode('text')
    } finally {
      setIsReviewLoading(false)
    }
  }

  // When review is an image/pdf, fetch binary via adminFetchRaw and keep object URL for inline preview
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    async function fetchAsset() {
      try {
        if (!review || !review.filename) return
        const fn = String(review.filename || '').toLowerCase()
        const isInline = /\.(jpe?g|png|gif|webp|svg|pdf)$/i.test(fn)
        if (!isInline) return

        setIsReviewAssetLoading(true)
        const res = await adminFetchRaw(`/admin/training/${encodeURIComponent(String(review.id))}/raw`, { method: 'GET' })
        if (cancelled) return

        // Only treat binary responses as inline preview when Content-Type is image/* or PDF.
        const contentType = String(res.headers.get('content-type') || '').toLowerCase()
        if (!/(image\/|application\/pdf)/i.test(contentType)) {
          // Not an inline asset (server returned text fallback). Try to use text as preview if available.
          try {
            const txt = await res.text()
            if (!cancelled && txt) {
              setReview((prev) => (prev ? { ...prev, preview: String(txt).slice(0, 20000), length: String(txt || '').length } : prev))
            }
          } catch {
            // ignore text parse errors
          }
          return
        }

        const blob = await res.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setReviewImageUrl(objectUrl)
      } catch (e) {
        setReviewImageUrl(null)
      } finally {
        if (!cancelled) setIsReviewAssetLoading(false)
      }
    }

    void fetchAsset()

    return () => {
      cancelled = true
      try {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
      } catch {}
      setReviewImageUrl(null)
      setIsReviewAssetLoading(false)
    }
  }, [review && review.id, review && review.filename])

  async function deactivateDataset(trainingId: string) {
    const id = String(trainingId || '').trim()
    if (!id) return

    setDeactivatingId(id)
    try {
      // NOTE: Backend uses DELETE but it only deactivates (sets active=false).
      await adminFetchJson(`/admin/training/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await refresh()

      // Keep review panel in-sync if currently open.
      if (review && review.id === id) {
        void loadReview(id, { full: isReviewFull })
      }
    } catch (e: any) {
      const msg = e && e.bodyText ? e.bodyText : (e && e.message ? e.message : 'Deactivate failed')
      setReviewError(formatApiErrorText(msg))
    } finally {
      setDeactivatingId(null)
    }
  }

  async function downloadTrainingData(trainingId: string) {
    const id = String(trainingId || '').trim()
    if (!id) return

    setDownloadingTrainingId(id)
    try {
      const url = `/admin/training/${encodeURIComponent(id)}/download`
      const res = await adminFetchRaw(url, { method: 'GET' })
      const blob = await res.blob()

      // Try to infer filename from Content-Disposition if present
      let filename = `training-${id}.txt`
      try {
        const cd = res.headers.get('content-disposition') || ''
        const m = cd.match(/filename\*=(?:UTF-8'')?([^;\n]+)/i) || cd.match(/filename="?([^";]+)"?/i)
        if (m && m[1]) filename = decodeURIComponent(String(m[1]).replace(/\"/g, ''))
      } catch {
        // ignore
      }

      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()

      try {
        URL.revokeObjectURL(objectUrl)
      } catch {
        // ignore
      }
    } catch (e: any) {
      const msg = e && e.bodyText ? String(e.bodyText) : (e && e.message ? String(e.message) : 'Download failed')
      setItemsError(formatApiErrorText(msg))
    } finally {
      setDownloadingTrainingId(null)
    }
  }

  async function runRagTest(question: string) {
    const q = String(question || '').trim()
    if (!q) return

    setIsRagRunning(true)
    setRagError(null)

    try {
      const res = await adminFetchJson('/admin/rag/query', {
        method: 'POST',
        body: JSON.stringify({ question: q, topK: 3 }),
      })
      setRagResult(res)
    } catch (e: any) {
      const msg = e && e.bodyText ? e.bodyText : (e && e.message ? e.message : 'RAG query failed')
      setRagError(formatApiErrorText(msg))
      setRagResult(null)
    } finally {
      setIsRagRunning(false)
    }
  }

  async function uploadFiles(files: FileList) {
    const list = Array.from(files || [])
    if (!list.length) return

    setIsUploading(true)
    setUploadError(null)
    setLastUploadResults(null)

    try {
      let uploaded: { filename: string; trainingDataId?: string } | null = null

      if (list.length === 1) {
        const fd = new FormData()
        fd.append('file', list[0])
        const resp = await adminFetchJson<UploadSingleResponse>('/admin/training/upload', { method: 'POST', body: fd })
        setLastUploadResults([
          {
            ok: true,
            filename: resp && resp.filename ? resp.filename : list[0].name,
            trainingDataId: resp && resp.trainingDataId ? resp.trainingDataId : undefined,
          },
        ])
        if (resp && resp.filename) {
          uploaded = { filename: resp.filename, trainingDataId: resp.trainingDataId }
        } else {
          uploaded = { filename: list[0].name }
        }
      } else {
        const fd = new FormData()
        for (const f of list) fd.append('files', f)
        const resp = await adminFetchJson<UploadBulkResponse>('/admin/training/upload-bulk', { method: 'POST', body: fd })

        const results = resp && Array.isArray(resp.results) ? resp.results : []
        if (results.length) {
          setLastUploadResults(
            results
              .filter((r): r is NonNullable<typeof r> => !!r)
              .map((r) => ({
                ok: !!r.ok,
                filename: r.filename ? String(r.filename) : '(unknown)',
                trainingDataId: r.trainingDataId ? String(r.trainingDataId) : undefined,
              }))
          )
        } else {
          setLastUploadResults(list.map((f) => ({ ok: true, filename: f.name })))
        }

        const firstOk = resp && Array.isArray(resp.results)
          ? resp.results.find((r) => r && r.ok && r.filename)
          : null
        if (firstOk && firstOk.filename) {
          uploaded = { filename: firstOk.filename, trainingDataId: firstOk.trainingDataId }
        } else {
          uploaded = { filename: `${list.length} files` }
        }
      }

      await refresh()

      if (uploaded) {
        setLastUploaded(uploaded)
        const autoQuestion = uploaded.filename
          ? `Ringkas isi data training dari file "${uploaded.filename}".`
          : 'Ringkas isi data training yang baru diupload.'
        setRagQuestion(autoQuestion)
        void runRagTest(autoQuestion)
      }
    } catch (e: any) {
      const msg = e && e.bodyText ? e.bodyText : (e && e.message ? e.message : 'Upload failed')
      setUploadError(formatApiErrorText(msg))
    } finally {
      setIsUploading(false)
      try {
        if (fileInputRef.current) fileInputRef.current.value = ''
      } catch {
        // ignore
      }
      setSelectedFiles([])
    }
  }

  const rows = useMemo(() => {
    if (!items) return []

    return items.map((it) => {
      const created = it.createdAt ? new Date(it.createdAt) : null
      const createdDate = created && !Number.isNaN(created.getTime())
        ? created.toISOString().slice(0, 10)
        : ''

      const uploadedBy = it.uploadedBy
        ? (it.uploadedBy.displayName || it.uploadedBy.username || it.uploadedBy.id)
        : ''

      const status = it.active === false ? 'inactive' : 'active'
      const ragStatus = String(it.ragIngestStatus || 'unknown').toLowerCase()

      return {
        id: it.id,
        name: it.filename,
        source: it.source || '',
        divisionKey: it.divisionKey || '',
        uploadedBy,
        createdDate,
        createdAtMs: created && !Number.isNaN(created.getTime()) ? created.getTime() : null,
        status,
        ragStatus,
        ragIngestError: it.ragIngestError || '',
        ragIngestedAt: it.ragIngestedAt || '',
        ragChunkCount: typeof it.ragChunkCount === 'number' ? it.ragChunkCount : null,
      }
    })
  }, [items])

  const sortedRows = useMemo(() => {
    const withCreated = rows.map((r: any) => {
      const ms = typeof r.createdAtMs === 'number'
        ? r.createdAtMs
        : (typeof r.createdDate === 'string' && r.createdDate ? new Date(r.createdDate).getTime() : null)
      return { ...r, __createdAtMs: Number.isFinite(ms as any) ? (ms as number) : null }
    })

    const dir = sortOrder === 'oldest' ? 1 : -1
    return withCreated.slice().sort((a: any, b: any) => {
      const ar = a && a.status === 'inactive' ? 1 : 0
      const br = b && b.status === 'inactive' ? 1 : 0
      if (ar !== br) return ar - br

      const am = typeof a.__createdAtMs === 'number' ? a.__createdAtMs : null
      const bm = typeof b.__createdAtMs === 'number' ? b.__createdAtMs : null
      if (am === null && bm === null) return 0
      if (am === null) return 1
      if (bm === null) return -1
      return (am - bm) * dir
    })
  }, [rows, sortOrder])

  const totalRows = sortedRows.length
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))

  useEffect(() => {
    // Keep page in-range when rows change.
    setPage((p) => {
      const maxPage = Math.max(0, totalPages - 1)
      return Math.min(Math.max(0, p), maxPage)
    })
  }, [totalPages])

  const pagedRows = useMemo(() => {
    const start = page * PAGE_SIZE
    return sortedRows.slice(start, start + PAGE_SIZE)
  }, [sortedRows, page])

  useEffect(() => {
    const hasProcessing = Array.isArray(items) && items.some((item) => String(item.ragIngestStatus || '').toLowerCase() === 'processing')
    const hasRetraining = Object.keys(retrainingIds).length > 0
    if (!hasProcessing && !hasRetraining) return

    const timer = window.setInterval(() => {
      void refresh()
    }, 3000)

    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, retrainingIds])

  const stats = useMemo(() => {
    const total = sortedRows.length
    const active = sortedRows.filter((r) => (r as any).status === 'active').length
    const inactive = sortedRows.filter((r) => (r as any).status === 'inactive').length
    const indexed = sortedRows.filter((r) => (r as any).ragStatus === 'success').length
    const ingestFailed = sortedRows.filter((r) => ['failed', 'rejected'].includes((r as any).ragStatus)).length
    const sources = new Set(sortedRows.map((r: any) => (r.source || '').toString()).filter(Boolean)).size
    return { total, active, inactive, indexed, ingestFailed, sources }
  }, [sortedRows])

  return (
    <div className="space-y-8 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Training Data</h1>
          <p className="text-muted-foreground mt-2">Manage and upload training datasets</p>
        </div>
        <Button
          className="gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || !canUpload}
        >
          <Upload className="h-4 w-4" />
          Upload Dataset
        </Button>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Upload Gambar untuk Bot</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Upload gambar sekali, lalu pakai marker-nya di Keyword atau Training supaya bot bisa kirim gambar + jawaban.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="media-caption">Caption (opsional)</Label>
              <Input
                id="media-caption"
                value={mediaCaption}
                onChange={(e) => setMediaCaption(e.target.value)}
                placeholder="mis: Formulir pendaftaran"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="media-file">File gambar</Label>
              <Input
                id="media-file"
                type="file"
                accept="image/*"
                disabled={mediaUploading || !canUpload}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
                  if (!f) return
                  void uploadPublicImage(f)
                  try { e.currentTarget.value = '' } catch { /* ignore */ }
                }}
              />
            </div>
          </div>

          {mediaUploaded && mediaUploaded.marker ? (
            <div className="space-y-2">
              <Label>Marker (auto kirim gambar)</Label>
              <Textarea value={String(mediaUploaded.marker)} readOnly rows={2} />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void copyMediaMarker()}
                  disabled={!mediaUploaded.marker}
                >
                  Copy Marker
                </Button>
                {mediaUploaded.url ? (
                  <p className="text-xs text-muted-foreground break-all">URL: {mediaUploaded.url}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="media-desc">Deskripsi untuk RAG (opsional)</Label>
            <Textarea
              id="media-desc"
              value={mediaDescription}
              onChange={(e) => setMediaDescription(e.target.value)}
              placeholder="Tulis kapan gambar ini harus dikirim. Contoh: 'Ini adalah formulir pendaftaran PMB. Kirim gambar ini ketika user bilang mau daftar.'"
              rows={3}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => void saveMediaAsTraining()}
                disabled={!canUpload || mediaSavingTraining || !String(mediaUploaded?.marker || '').trim() || mediaDescription.trim().length < 8}
              >
                {mediaSavingTraining ? 'Saving…' : 'Simpan jadi Training (RAG)'}
              </Button>
              {mediaTraining && mediaTraining.ok && mediaTraining.trainingDataId ? (
                <p className="text-sm text-muted-foreground">
                  Training dibuat: <span className="font-medium">{mediaTraining.trainingDataId}</span>
                </p>
              ) : null}
            </div>
          </div>

          {mediaError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
              {mediaError}
            </div>
          ) : null}

          {!canUpload ? (
            <p className="text-sm text-muted-foreground">Login dulu untuk upload.</p>
          ) : null}
        </div>
      </Card>

      {validationFileEnabled === true || canManageValidationFlag ? (
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Upload Validation File</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Fitur ini masih belum final. Bisa di-enable/disable oleh Admin/Marketing.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {validationFileEnabled !== null ? (
                <Badge variant={validationFileEnabled ? 'default' : 'secondary'}>
                  {validationFileEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
              ) : null}
              {canManageValidationFlag ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void toggleValidationFileEnabled(!validationFileEnabled)}
                  disabled={isValidationFlagLoading || validationFileEnabled === null}
                >
                  {validationFileEnabled ? 'Disable' : 'Enable'}
                </Button>
              ) : null}
            </div>
          </div>

          {validationFileEnabled ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border p-4">
              <div className="flex items-center gap-3">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Validation upload</p>
                  <p className="text-xs text-muted-foreground">
                    Upload file untuk kebutuhan validasi internal.
                  </p>
                </div>
              </div>
              {canUpload ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => validationFileInputRef.current?.click()}
                    disabled={isValidationUploading || isValidationFlagLoading}
                  >
                    {isValidationUploading ? 'Uploading...' : 'Upload Validation File'}
                  </Button>
                  <input
                    ref={validationFileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0]
                      if (f) void uploadValidationFile(f)
                    }}
                  />
                </>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Fitur validation file sedang dimatikan.
            </p>
          )}

          {lastValidationUpload ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Uploaded: <span className="font-medium">{lastValidationUpload.filename}</span>
            </p>
          ) : null}

          {isSuperAdmin ? (
            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Validation files (Super Admin)</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadValidationFiles()}
                  disabled={isValidationFilesLoading}
                >
                  {isValidationFilesLoading ? 'Loading...' : 'Refresh'}
                </Button>
              </div>

              <div className="mt-3 rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Uploaded At</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Uploader</TableHead>
                      <TableHead>Role/Division</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(validationFiles || []).length ? (
                      (validationFiles || []).map((vf) => {
                        const uploadedAt = vf && vf.createdAt ? new Date(vf.createdAt).toLocaleString() : '-'
                        const uploaderName = vf?.uploader?.displayName || vf?.uploader?.username || '-'
                        const uploaderRole = vf?.uploader?.role ? String(vf.uploader.role) : '-'
                        const uploaderDivision = vf?.uploader?.divisionKey ? String(vf.uploader.divisionKey) : '-'
                        const originalname = vf?.originalname ? String(vf.originalname) : (vf?.storedAs ? String(vf.storedAs) : '-')
                        const exists = typeof vf?.exists === 'boolean' ? vf.exists : true
                        const storedAs = vf?.storedAs ? String(vf.storedAs) : ''

                        return (
                          <TableRow key={vf.id}>
                            <TableCell className="text-xs text-muted-foreground">{uploadedAt}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{originalname}</span>
                                {!exists ? (
                                  <Badge variant="secondary">missing</Badge>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{uploaderName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{uploaderRole} / {uploaderDivision}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void downloadValidationFile(vf)}
                                disabled={!storedAs || !exists || downloadingStoredAs === storedAs}
                              >
                                {downloadingStoredAs === storedAs ? 'Downloading...' : 'Download'}
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-sm text-muted-foreground">
                          {isValidationFilesLoading ? 'Loading...' : 'Belum ada validation file yang diupload.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          {validationUploadError ? (
            <p className="mt-3 text-sm text-destructive whitespace-pre-wrap">{validationUploadError}</p>
          ) : null}

          {validationFilesError ? (
            <p className="mt-3 text-sm text-destructive whitespace-pre-wrap">{validationFilesError}</p>
          ) : null}

          {validationFlagError ? (
            <p className="mt-3 text-sm text-destructive whitespace-pre-wrap">{validationFlagError}</p>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-12 border-2 border-dashed">
        <div
          className="text-center"
          onDragEnter={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOverUpload(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOverUpload(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOverUpload(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOverUpload(false)
            const dt = e.dataTransfer
            if (dt && dt.files && dt.files.length) {
              setSelectedFiles(Array.from(dt.files).map((f) => f.name))
              void uploadFiles(dt.files)
            }
          }}
        >
          <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <div className="flex items-center justify-center gap-2">
            <h3 className="text-lg font-semibold mb-2">Upload Training Data</h3>
          </div>
          <p className="text-muted-foreground mb-6">
            Drag and drop your CSV/XLS/XLSX/TXT/PDF/DOCX file(s) here, or click to browse
          </p>
          <div className="flex gap-3 justify-center">
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || !canUpload}
            >
              {isUploading ? 'Uploading...' : 'Browse Files'}
            </Button>
            <Button variant="outline" disabled={!canUpload}>Learn Format</Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Tip: kamu bisa pilih banyak file sekaligus (Ctrl/Shift) atau drag & drop beberapa file.
            {isDragOverUpload ? ' (Lepas file untuk upload)' : ''}
          </p>
          {selectedFiles.length ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Selected: {selectedFiles.join(', ')}
            </p>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.xls,.xlsx,.txt,.pdf,.docx"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                setSelectedFiles(Array.from(e.target.files).map((f) => f.name))
                void uploadFiles(e.target.files)
              }
            }}
          />

          {uploadError ? (
            <p className="mt-4 text-sm text-destructive whitespace-pre-wrap">{uploadError}</p>
          ) : null}

          {lastUploadResults && lastUploadResults.length ? (
            <div className="mt-4 text-left mx-auto max-w-xl">
              <p className="text-xs font-medium mb-2">Upload results</p>
              <div className="space-y-2">
                {lastUploadResults.map((r, idx) => (
                  <div key={`${r.filename}-${idx}`} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground truncate" title={r.filename}>
                      {r.filename}
                    </span>
                    <Badge variant={r.ok ? 'default' : 'secondary'} className="shrink-0">
                      {r.ok ? 'OK' : 'FAILED'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Test RAG */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Test RAG</h2>
              <p className="text-sm text-muted-foreground">
                Otomatis terisi setelah upload, dan bisa dijalankan ulang.
              </p>
            </div>
            {lastUploaded ? (
              <Badge variant="secondary" className="shrink-0">
                Last: {lastUploaded.filename}
              </Badge>
            ) : null}
          </div>

          <Textarea
            placeholder="Tulis pertanyaan untuk test RAG (mis: jadwal pendaftaran / biaya kuliah)…"
            value={ragQuestion}
            onChange={(e) => setRagQuestion(e.target.value)}
            rows={4}
          />

          <div className="flex items-center gap-2">
            <Button
              onClick={() => void runRagTest(ragQuestion)}
              disabled={isRagRunning || !ragQuestion.trim()}
            >
              {isRagRunning ? 'Running...' : 'Run Test'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setRagResult(null)
                setRagError(null)
              }}
              disabled={isRagRunning}
            >
              Clear
            </Button>
          </div>

          {ragError ? (
            <p className="text-sm text-destructive whitespace-pre-wrap">{ragError}</p>
          ) : null}

          {ragResult ? (
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Result</p>
                <Badge variant="outline">
                  {typeof ragResult?.source === 'string' ? ragResult.source : 'rag'}
                </Badge>
              </div>
              <div className="mt-3">
                {typeof ragResult?.answer === 'string' && ragResult.answer.trim() ? (
                  <ScrollArea className="h-72">
                    <pre className="text-sm whitespace-pre-wrap">{ragResult.answer}</pre>
                  </ScrollArea>
                ) : (
                  <ScrollArea className="h-40">
                    <pre className="text-xs whitespace-pre-wrap text-muted-foreground">
                      {JSON.stringify(ragResult, null, 2)}
                    </pre>
                  </ScrollArea>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Datasets</p>
          <p className="text-2xl font-bold mt-2">{stats.total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Active</p>
          <p className="text-2xl font-bold mt-2">{stats.active}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Inactive</p>
          <p className="text-2xl font-bold mt-2">{stats.inactive}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">RAG Indexed</p>
          <p className="text-2xl font-bold mt-2">{stats.indexed}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">RAG Failed</p>
          <p className="text-2xl font-bold mt-2">{stats.ingestFailed}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Sources</p>
          <p className="text-2xl font-bold mt-2">{stats.sources}</p>
        </Card>
      </div>

      {/* Review extracted content */}
      <Card className="p-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Review Hasil Upload</h2>
              <p className="text-sm text-muted-foreground">
                Lihat teks yang berhasil dibaca (hasil parse/OCR) dari dataset.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {review ? (
                <Badge variant="secondary" className="shrink-0">
                  {review.filename || review.id}
                </Badge>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setReview(null)
                  setReviewError(null)
                  setIsReviewFull(false)
                  setReviewMode('text')
                }}
                disabled={isReviewLoading && !review}
              >
                Clear
              </Button>
            </div>
          </div>

          {reviewError ? (
            <p className="text-sm text-destructive whitespace-pre-wrap">{reviewError}</p>
          ) : null}

          {isReviewLoading && !review ? (
            <p className="text-sm text-muted-foreground">Loading review…</p>
          ) : null}

          {review ? (
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{reviewMode === 'text' ? 'Preview Text' : 'Preview File'}</p>
                  <Badge variant="outline">
                    {typeof review.source === 'string' && review.source.trim() ? review.source : 'upload'}
                  </Badge>
                  {review.ragIngestStatus ? (
                    <Badge variant={review.ragIngestStatus === 'success' ? 'default' : 'secondary'}>
                      RAG: {review.ragIngestStatus}
                      {typeof review.ragChunkCount === 'number' && review.ragIngestStatus === 'success' ? ` (${review.ragChunkCount})` : ''}
                    </Badge>
                  ) : null}
                  {typeof review.truncated === 'boolean' ? (
                    <Badge variant={review.truncated ? 'secondary' : 'outline'}>
                      {review.truncated ? 'Preview' : 'Full'}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={reviewMode === 'text' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setReviewMode('text')}
                  >
                    Text
                  </Button>
                  <Button
                    variant={reviewMode === 'file' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setReviewMode('file')}
                  >
                    File
                  </Button>
                  {review.truncated && !isReviewFull ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void loadReview(review.id, { full: true })}
                      disabled={isReviewLoading}
                    >
                      Load Full
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3">
                {(() => {
                  const fn = String(review.filename || '').toLowerCase()
                  const inlineable = /\.(jpe?g|png|gif|webp|svg|pdf)$/i.test(fn)
                  if (reviewMode === 'file') {
                    if (!inlineable) {
                      return (
                        <div className="h-72 flex flex-col items-center justify-center gap-2 text-center">
                          <p className="text-sm text-muted-foreground">Preview file asli hanya tersedia untuk gambar dan PDF.</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void downloadTrainingData(review.id)}
                            disabled={downloadingTrainingId === review.id}
                          >
                            {downloadingTrainingId === review.id ? 'Downloading...' : 'Download File'}
                          </Button>
                        </div>
                      )
                    }
                    if (isReviewAssetLoading) {
                      return (
                        <div className="h-72 flex items-center justify-center"><p className="text-sm text-muted-foreground">Loading preview…</p></div>
                      )
                    }
                    if (!reviewImageUrl) {
                      return (
                        <div className="h-72 flex items-center justify-center"><p className="text-sm text-muted-foreground">Preview not available</p></div>
                      )
                    }

                    if (/\.pdf$/i.test(fn)) {
                      return (
                        <div className="h-72">
                          <iframe src={reviewImageUrl as string} title={review.filename || 'preview'} className="w-full h-full border" />
                        </div>
                      )
                    }

                    return (
                      <div className="flex items-center justify-center h-72">
                        <img src={reviewImageUrl as string} alt={review.filename || 'preview'} className="max-h-72 object-contain" />
                      </div>
                    )
                  }

                  return (
                    <div>
                      {review.ragIngestStatus === 'rejected' && review.ragIngestError ? (
                        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          {review.ragIngestError}
                        </div>
                      ) : null}
                      {review.ragIngestStatus === 'success' && review.ragChunkCount === 0 ? (
                        <div className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                          File berhasil diproses, tetapi tidak ada chunk baru yang masuk ke index. Biasanya karena isi file duplikat atau semua potongan teks sudah pernah di-index.
                        </div>
                      ) : null}
                      <ScrollArea className="h-72">
                        <pre className="text-sm whitespace-pre-wrap">{String(review.preview || '').trim() || 'Tidak ada teks hasil parse/OCR yang tersimpan untuk dataset ini.'}</pre>
                      </ScrollArea>
                    </div>
                  )
                })()}
              </div>

              {typeof review.length === 'number' ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Total chars: {review.length}{review.truncated ? ' (preview shown)' : ''}
                  {typeof review.ragChunkCount === 'number' ? ` | RAG chunks: ${review.ragChunkCount}` : ''}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Klik tombol <span className="font-medium">Review</span> pada tabel dataset untuk melihat hasil baca.
            </p>
          )}
        </div>
      </Card>

      {/* Training Data Table */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Datasets</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPage(0)
                  setSortOrder((s) => (s === 'newest' ? 'oldest' : 'newest'))
                }}
              >
                Sort: {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                Refresh Status
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void retrainProblemDatasets()}
                disabled={Object.keys(retrainingIds).length > 0}
              >
                {Object.keys(retrainingIds).length > 0 ? 'Retraining...' : 'Retrain Model'}
              </Button>
            </div>
          </div>

          {retrainMessage ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {retrainMessage}
            </div>
          ) : null}
          {retrainError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
              {retrainError}
            </div>
          ) : null}

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Filename</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Division</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>RAG</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemsError ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-sm text-muted-foreground">{itemsError}</TableCell>
                  </TableRow>
                ) : null}

                {!itemsError && items === null ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-sm text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : null}

                {!itemsError && items !== null && pagedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-sm text-muted-foreground">No training datasets yet.</TableCell>
                  </TableRow>
                ) : null}

                {pagedRows.map((data) => (
                  <TableRow key={data.id}>
                    <TableCell className="font-medium">{data.name}</TableCell>
                    <TableCell className="text-muted-foreground">{(data as any).source || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{(data as any).divisionKey || '—'}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[220px] truncate">{(data as any).uploadedBy || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{(data as any).createdDate || '—'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={(data as any).status === 'active' ? 'default' : 'secondary'}
                        className="gap-1"
                      >
                        {(data as any).status === 'active' ? (
                          <CheckCircle className="h-3 w-3" />
                        ) : (
                          <AlertCircle className="h-3 w-3" />
                        )}
                        {(data as any).status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const ragStatus = String((data as any).ragStatus || 'unknown').toLowerCase()
                        const isOk = ragStatus === 'success'
                        const isBad = ragStatus === 'failed' || ragStatus === 'rejected'
                        const isProcessing = ragStatus === 'processing'
                        const chunkCount = (data as any).ragChunkCount
                        const title = (data as any).ragIngestError || (data as any).ragIngestedAt || ''

                        return (
                          <Badge
                            variant={isOk ? 'default' : 'secondary'}
                            className="gap-1"
                            title={title}
                          >
                            {isOk ? (
                              <CheckCircle className="h-3 w-3" />
                            ) : isBad ? (
                              <AlertCircle className="h-3 w-3" />
                            ) : isProcessing ? (
                              <AlertCircle className="h-3 w-3" />
                            ) : null}
                            {ragStatus}
                            {typeof chunkCount === 'number' && isOk ? ` (${chunkCount})` : ''}
                          </Badge>
                        )
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void loadReview(data.id, { full: false })}
                          disabled={isReviewLoading && review?.id === data.id}
                        >
                          Review
                        </Button>
                        {isSuperAdmin ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void downloadTrainingData(data.id)}
                            disabled={downloadingTrainingId === data.id}
                          >
                            {downloadingTrainingId === data.id ? 'Downloading...' : 'Download'}
                          </Button>
                        ) : null}
                        {['rejected', 'failed', 'unknown'].includes(String((data as any).ragStatus || '').toLowerCase()) ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void retrainDataset(data.id)}
                            disabled={(data as any).status !== 'active' || !!retrainingIds[data.id]}
                          >
                            {retrainingIds[data.id] ? 'Retraining...' : 'Retrain'}
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void deactivateDataset(data.id)}
                          disabled={(data as any).status !== 'active' || deactivatingId === data.id}
                        >
                          {deactivatingId === data.id ? 'Deactivating...' : 'Deactivate'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {rows.length > PAGE_SIZE ? (
            <div className="flex items-center justify-end gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Recent Activity */}
      <Card className="p-6">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Recent Activity</h2>

          {lastUploaded || lastValidationUpload || lastUploadResults ? (
            <div className="space-y-3">
              {lastUploaded ? (
                <div className="flex items-start gap-4 pb-3 border-b border-border">
                  <div className="h-2 w-2 rounded-full bg-blue-500 mt-2" />
                  <div className="flex-1">
                    <p className="font-medium">Dataset uploaded</p>
                    <p className="text-sm text-muted-foreground">
                      {lastUploaded.filename}
                    </p>
                  </div>
                </div>
              ) : null}

              {lastValidationUpload ? (
                <div className="flex items-start gap-4 pb-3 border-b border-border">
                  <div className="h-2 w-2 rounded-full bg-green-500 mt-2" />
                  <div className="flex-1">
                    <p className="font-medium">Validation file uploaded</p>
                    <p className="text-sm text-muted-foreground">
                      {lastValidationUpload.filename}
                    </p>
                  </div>
                </div>
              ) : null}

              {lastUploadResults ? (
                <div className="flex items-start gap-4">
                  <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
                  <div className="flex-1">
                    <p className="font-medium">Last upload results</p>
                    <p className="text-sm text-muted-foreground">
                      {lastUploadResults.filter((r) => r.ok).length} succeeded, {lastUploadResults.filter((r) => !r.ok).length} failed
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No recent activity yet.</p>
          )}
        </div>
      </Card>
    </div>
  )
}





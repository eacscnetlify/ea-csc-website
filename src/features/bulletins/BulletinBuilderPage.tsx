import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PdfCanvasViewer } from '../../components/ui/PdfCanvasViewer'
import { shouldUseCanvasPdfViewer } from '../records/download'
import { formatManilaDate, formatManilaDateTime } from '../../lib/dates'
import { getSupabaseClient } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'
import { getOfficerProfile } from '../auth/auth.api'
import type { BulletinCandidate } from './bulletinPdf'

function todayManilaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
  }).format(new Date())
}

function nowManilaDateTimeLocal(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(Date.now() - 60_000))
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '00'
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

interface IssuedBulletinRow {
  issue_uuid: string
  bulletin_id: string
  issue_version: number
  title: string
  coverage_start: string
  coverage_end: string
  cutoff_at: string
  audience: string
  sources_count: number
  issued_at: string
}

export default function BulletinBuilderPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const id = useId()

  const today = todayManilaDate()
  const [bulletinId, setBulletinId] = useState('EACSC-2026-BUL-0001')
  const [title, setTitle] = useState('EA-CSC Official Update Bulletin')
  const [audience, setAudience] = useState<'public' | 'internal'>('public')
  const [coverageStart, setCoverageStart] = useState(today)
  const [coverageEnd, setCoverageEnd] = useState(today)
  const [cutoffLocal, setCutoffLocal] = useState(() => nowManilaDateTimeLocal())
  const [executiveContext, setExecutiveContext] = useState('')
  const [instructions, setInstructions] = useState('')
  const [officialContact, setOfficialContact] = useState('EA-CSC Secretariat')
  const [preparerName, setPreparerName] = useState('Council Officer')

  const [candidates, setCandidates] = useState<BulletinCandidate[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [verifiedPreview, setVerifiedPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [issueNotice, setIssueNotice] = useState('')
  const [isCustodian, setIsCustodian] = useState<boolean | null>(null)
  const [issuedBulletins, setIssuedBulletins] = useState<IssuedBulletinRow[]>([])
  const [loadingIssued, setLoadingIssued] = useState(false)
  const [withdrawingKey, setWithdrawingKey] = useState<string | null>(null)
  const [withdrawReason, setWithdrawReason] = useState(
    'Removed by Custodian to issue updated bulletin',
  )

  const loadIssuedBulletins = useCallback(async () => {
    setLoadingIssued(true)
    try {
      const { data, error: rpcError } = await getSupabaseClient().rpc(
        'eacsc_list_issued_bulletins',
      )
      if (!rpcError && Array.isArray(data)) {
        setIssuedBulletins(data as IssuedBulletinRow[])
      }
    } finally {
      setLoadingIssued(false)
    }
  }, [])

  useEffect(() => {
    if (!isCustodian) return
    let active = true
    const client = getSupabaseClient()
    void client
      .rpc('eacsc_list_issued_bulletins')
      .then(({ data, error: rpcError }) => {
        if (!active) return
        if (!rpcError && Array.isArray(data)) {
          setIssuedBulletins(data as IssuedBulletinRow[])
        }
      })
    void client
      .rpc('eacsc_next_bulletin_id')
      .then(({ data, error: rpcError }) => {
        if (!active) return
        if (!rpcError && typeof data === 'string' && data.trim()) {
          setBulletinId(data)
        }
      })
    return () => {
      active = false
    }
  }, [isCustodian])

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    void getOfficerProfile(userId, controller.signal)
      .then((profile) => {
        if (profile?.full_name) setPreparerName(profile.full_name)
        setIsCustodian(
          Boolean(
            profile?.is_active &&
              profile?.functional_roles.includes('custodian'),
          ),
        )
      })
      .catch(() => setIsCustodian(false))
    return () => controller.abort()
  }, [userId])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function validateReportingWindow(checkFutureCutoff: boolean): string | null {
    if (!coverageStart || !coverageEnd || !cutoffLocal) {
      return 'Coverage start date, coverage end date, and cutoff timestamp are all required.'
    }
    if (coverageStart > coverageEnd) {
      return 'Coverage start date cannot be after Coverage end date.'
    }
    const cutoffDate = cutoffLocal.slice(0, 10)
    if (coverageEnd > cutoffDate) {
      return `Coverage end date (${coverageEnd}) cannot be after the Cutoff timestamp's date (${cutoffDate}). Lower the Coverage end date or update the Cutoff timestamp.`
    }
    const cutoffMs = new Date(`${cutoffLocal}:00+08:00`).getTime()
    if (Number.isNaN(cutoffMs)) {
      return 'Cutoff timestamp is invalid.'
    }
    if (checkFutureCutoff && cutoffMs > Date.now() + 5000) {
      return 'Cutoff timestamp cannot be in the future when issuing an official bulletin. Click "Use current time" and try again.'
    }
    return null
  }

  async function loadCandidates() {
    const windowError = validateReportingWindow(false)
    if (windowError) {
      setError(windowError)
      setCandidates([])
      setSelectedIds([])
      return
    }
    setLoading(true)
    setError('')
    setVerifiedPreview(false)
    try {
      const cutoffIso = new Date(`${cutoffLocal}:00+08:00`).toISOString()
      const { data, error: rpcError } = await getSupabaseClient().rpc(
        'eacsc_list_bulletin_candidates',
        {
          p_audience: audience,
          p_coverage_start: coverageStart,
          p_cutoff_at: cutoffIso,
        },
      )
      if (rpcError || !Array.isArray(data)) {
        setError(
          rpcError?.message ||
            'Eligible releases could not be loaded. Check your role and date window.',
        )
        setCandidates([])
        setSelectedIds([])
        return
      }

      const mapped: BulletinCandidate[] = (
        data as Record<string, unknown>[]
      ).map((row) => ({
        releaseId: String(row.release_id),
        recordId: String(row.record_id),
        versionId: String(row.version_id),
        versionNumber: Number(row.version_number),
        publicTitle: String(row.public_title),
        publicCategory: String(row.public_category),
        audience: row.audience === 'public' ? 'public' : 'internal',
        releasedAt: String(row.released_at),
        effectiveFrom: String(row.effective_from),
        approvedAt:
          typeof row.approved_at === 'string' ? row.approved_at : null,
        summaryNote: String(row.summary_note),
      }))

      setCandidates(mapped)
      setSelectedIds(mapped.map((item) => item.releaseId))
    } catch {
      setError('Eligible releases could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  const selectedItems = useMemo(
    () => candidates.filter((c) => selectedIds.includes(c.releaseId)),
    [candidates, selectedIds],
  )

  const frozenSnapshotJson = useMemo(
    () =>
      JSON.stringify(
        selectedItems.map((item) => ({
          record_id: item.recordId,
          version_id: item.versionId,
          version_number: item.versionNumber,
          release_id: item.releaseId,
          title: item.publicTitle,
          summary: item.summaryNote,
        })),
        null,
        2,
      ),
    [selectedItems],
  )

  function toggleItem(releaseId: string) {
    setVerifiedPreview(false)
    setSelectedIds((prev) =>
      prev.includes(releaseId)
        ? prev.filter((idVal) => idVal !== releaseId)
        : [...prev, releaseId],
    )
  }

  async function generatePreview() {
    setError('')
    const cutoffIso = new Date(`${cutoffLocal}:00+08:00`).toISOString()
    const { buildBulletinPdfBlob } = await import('./bulletinPdf')
    const blob = buildBulletinPdfBlob({
      bulletinId,
      issueVersion: 1,
      title,
      audience,
      coverageStart,
      coverageEnd,
      cutoffAt: cutoffIso,
      executiveContext,
      instructions,
      officialContact,
      preparerName,
      items: selectedItems,
    })
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewBlob(blob)
    setPreviewUrl(URL.createObjectURL(blob))
  }

  async function handleIssue() {
    if (selectedItems.length === 0 || !verifiedPreview || issuing) return
    const windowError = validateReportingWindow(true)
    if (windowError) {
      setError(windowError)
      return
    }
    setIssuing(true)
    setError('')
    setIssueNotice('')
    try {
      const cutoffIso = new Date(`${cutoffLocal}:00+08:00`).toISOString()
      const { buildBulletinPdfBlob } = await import('./bulletinPdf')
      const blob = buildBulletinPdfBlob({
        bulletinId,
        issueVersion: 1,
        title,
        audience,
        coverageStart,
        coverageEnd,
        cutoffAt: cutoffIso,
        executiveContext,
        instructions,
        officialContact,
        preparerName,
        items: selectedItems,
      })

      const bytes = new Uint8Array(await blob.arrayBuffer())
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const sha256 = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')

      const client = getSupabaseClient()
      const storageKey = `bulletins/${bulletinId}/v1_${crypto.randomUUID()}.pdf`

      // 1. Stage the PDF in verified-council-releases
      const { error: uploadError } = await client.storage
        .from('verified-council-releases')
        .upload(storageKey, blob, {
          contentType: 'application/pdf',
          upsert: false,
        })

      if (uploadError) {
        throw new Error('Could not upload bulletin PDF to storage.')
      }

      // 2. Call eacsc_issue_bulletin
      const sourceSnapshot = selectedItems.map((item) => ({
        record_id: item.recordId,
        version_id: item.versionId,
        version_number: item.versionNumber,
        release_id: item.releaseId,
        title: item.publicTitle,
        summary: item.summaryNote,
      }))

      const { data, error: rpcError } = await client.rpc(
        'eacsc_issue_bulletin',
        {
          p_bulletin_id: bulletinId,
          p_issue_version: 1,
          p_title: title,
          p_coverage_start: coverageStart,
          p_coverage_end: coverageEnd,
          p_cutoff_at: cutoffIso,
          p_audience: audience,
          p_source_snapshot: sourceSnapshot,
          p_pdf_storage_key: storageKey,
          p_pdf_size_bytes: blob.size,
          p_pdf_sha256: sha256,
          p_publication_reference: `Issue check: ${preparerName}`,
          p_issuance_request_id: crypto.randomUUID(),
        },
      )

      if (rpcError) {
        throw new Error(rpcError.message)
      }

      void data
      setIssueNotice(
        `Successfully issued and preserved ${bulletinId} (v1). It is now recorded in council archives.`,
      )
      void loadIssuedBulletins()
      void client.rpc('eacsc_next_bulletin_id').then(({ data: nextId }) => {
        if (typeof nextId === 'string' && nextId.trim()) {
          setBulletinId(nextId)
        }
      })
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Bulletin issuance failed.',
      )
    } finally {
      setIssuing(false)
    }
  }

  async function handleWithdrawBulletin(
    targetBulletinId: string,
    issueVersion: number,
  ) {
    const key = `${targetBulletinId}:${issueVersion}`
    if (withdrawingKey) return
    setWithdrawingKey(key)
    setError('')
    setIssueNotice('')
    try {
      const { error: rpcError } = await getSupabaseClient().rpc(
        'eacsc_withdraw_bulletin',
        {
          p_bulletin_id: targetBulletinId,
          p_issue_version: issueVersion,
          p_reason: withdrawReason.trim() || 'Withdrawn by Custodian',
        },
      )
      if (rpcError) {
        throw new Error(rpcError.message)
      }
      setIssueNotice(
        `Withdrew ${targetBulletinId} (v${issueVersion}). You may now issue a replacement bulletin.`,
      )
      await loadIssuedBulletins()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Bulletin could not be withdrawn.',
      )
    } finally {
      setWithdrawingKey(null)
    }
  }

  if (isCustodian === false) {
    return (
      <section aria-labelledby="bulletin-builder-heading" className="space-y-4">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 space-y-3">
          <h1 id="bulletin-builder-heading" className="text-xl font-bold text-amber-950">
            Custodian Role Required
          </h1>
          <p className="text-sm text-amber-900">
            Only officers holding the <strong>Custodian</strong> role (such as the Secretary or Treasurer) can compile and issue Update Bulletins.
          </p>
          <Link
            to="/officer"
            className="inline-block rounded-lg border border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100"
          >
            Back to Document Workspace
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="bulletin-builder-heading" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-800">
            Update bulletin compiler
          </p>
          <h1 id="bulletin-builder-heading" className="mt-2 text-3xl font-bold">
            Update Bulletin builder &amp; preview
          </h1>
          <p className="mt-3 text-slate-700">
            Select a reporting window and audience to compile eligible releases
            into a frozen snapshot, preview PDF, and official council archive.
          </p>
        </div>
        <Link
          to="/officer"
          className="rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 hover:bg-emerald-50"
        >
          Back to workspace
        </Link>
      </div>

      {issueNotice && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-4 text-emerald-950"
        >
          {issueNotice}
        </p>
      )}

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">
            1. Reporting window &amp; audience
          </h2>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                const t = todayManilaDate()
                setCoverageStart(t)
                setCoverageEnd(t)
                setCutoffLocal(nowManilaDateTimeLocal())
              }}
              className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date()
                const weekAgo = new Date(now.getTime() - 6 * 86400_000)
                const fmt = (d: Date) =>
                  new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'Asia/Manila',
                  }).format(d)
                setCoverageStart(fmt(weekAgo))
                setCoverageEnd(fmt(now))
                setCutoffLocal(nowManilaDateTimeLocal())
              }}
              className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date()
                const t = todayManilaDate()
                setCoverageStart(`${t.slice(0, 7)}-01`)
                setCoverageEnd(
                  new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'Asia/Manila',
                  }).format(now),
                )
                setCutoffLocal(nowManilaDateTimeLocal())
              }}
              className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              This Month
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label
              htmlFor={`${id}-bul-id`}
              className="block text-sm font-semibold"
            >
              Bulletin ID
            </label>
            <input
              id={`${id}-bul-id`}
              type="text"
              value={bulletinId}
              onChange={(e) => setBulletinId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-400 p-2 font-mono text-sm"
            />
            <p className="mt-1 text-xs text-slate-600">
              Auto-assigned next available ID. Each Public or Internal bulletin
              needs a unique Bulletin ID.
            </p>
          </div>
          <div>
            <label
              htmlFor={`${id}-audience`}
              className="block text-sm font-semibold"
            >
              Target audience
            </label>
            <select
              id={`${id}-audience`}
              value={audience}
              onChange={(e) => {
                setAudience(e.target.value as 'public' | 'internal')
                setCandidates([])
                setSelectedIds([])
                setVerifiedPreview(false)
              }}
              className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
            >
              <option value="public">
                Public (approved public releases only)
              </option>
              <option value="internal">Internal Council</option>
            </select>
          </div>
          <div>
            <label
              htmlFor={`${id}-title`}
              className="block text-sm font-semibold"
            >
              Bulletin title
            </label>
            <input
              id={`${id}-title`}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
            />
          </div>
          <div>
            <label
              htmlFor={`${id}-start`}
              className="block text-sm font-semibold"
            >
              Coverage start date
            </label>
            <input
              id={`${id}-start`}
              type="date"
              value={coverageStart}
              onChange={(e) => setCoverageStart(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
            />
          </div>
          <div>
            <label
              htmlFor={`${id}-end`}
              className="block text-sm font-semibold"
            >
              Coverage end date
            </label>
            <input
              id={`${id}-end`}
              type="date"
              value={coverageEnd}
              onChange={(e) => setCoverageEnd(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={`${id}-cutoff`}
                className="block text-sm font-semibold"
              >
                Cutoff timestamp (Asia/Manila)
              </label>
              <button
                type="button"
                onClick={() => setCutoffLocal(nowManilaDateTimeLocal())}
                className="text-xs font-semibold text-emerald-800 hover:underline"
              >
                Use current time
              </button>
            </div>
            <input
              id={`${id}-cutoff`}
              type="datetime-local"
              value={cutoffLocal}
              onChange={(e) => setCutoffLocal(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Must be at or before the current Manila time when issuing an official bulletin.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void loadCandidates()}
          className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Querying releases…' : 'Query eligible releases'}
        </button>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950"
          >
            {error}
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold">
          2. Eligible releases ({candidates.length} found,{' '}
          {selectedItems.length} selected)
        </h2>

        {candidates.length === 0 ? (
          <p className="text-sm text-slate-600">
            No eligible releases matched the selected window and audience.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-600">
                  <th className="p-2">Include</th>
                  <th className="p-2">Record ID</th>
                  <th className="p-2">Title</th>
                  <th className="p-2">Version</th>
                  <th className="p-2">Released (PST)</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((item) => (
                  <tr
                    key={item.releaseId}
                    className="border-b border-slate-100"
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`Include ${item.recordId}`}
                        checked={selectedIds.includes(item.releaseId)}
                        onChange={() => toggleItem(item.releaseId)}
                      />
                    </td>
                    <td className="p-2 font-mono text-xs">{item.recordId}</td>
                    <td className="p-2 font-semibold">{item.publicTitle}</td>
                    <td className="p-2">v{item.versionNumber}</td>
                    <td className="p-2 text-xs text-slate-600">
                      {formatManilaDateTime(item.releasedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`${id}-context`}
              className="block text-sm font-semibold"
            >
              Executive context
            </label>
            <textarea
              id={`${id}-context`}
              rows={3}
              value={executiveContext}
              onChange={(e) => setExecutiveContext(e.target.value)}
              placeholder="Brief overview of the releases in this bulletin"
              className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
            />
          </div>
          <div>
            <label
              htmlFor={`${id}-instr`}
              className="block text-sm font-semibold"
            >
              Instructions / action needed
            </label>
            <textarea
              id={`${id}-instr`}
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Any deadlines or next steps for readers"
              className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor={`${id}-contact`}
              className="block text-sm font-semibold"
            >
              Official contact
            </label>
            <input
              id={`${id}-contact`}
              type="text"
              value={officialContact}
              onChange={(e) => setOfficialContact(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
            />
          </div>
        </div>

        <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-800">
            Inspect frozen source snapshot JSON ({selectedItems.length} items)
          </summary>
          <pre className="mt-2 overflow-x-auto font-mono text-xs text-slate-700">
            {frozenSnapshotJson}
          </pre>
        </details>

        <div className="space-y-3 border-t border-slate-200 pt-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={verifiedPreview}
              onChange={(e) => setVerifiedPreview(e.target.checked)}
            />
            I confirm the selected source releases and summary are accurate and
            suitable for the {audience} audience.
          </label>

          <button
            type="button"
            disabled={selectedItems.length === 0 || !verifiedPreview}
            onClick={generatePreview}
            className="rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            Generate PDF preview
          </button>
        </div>
      </div>

      {previewUrl && (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">3. Live PDF preview</h2>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={issuing}
                onClick={() => void handleIssue()}
                className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
              >
                {issuing ? 'Preserving & issuing…' : 'Issue official bulletin'}
              </button>
              <a
                href={previewUrl}
                download={`${bulletinId}_preview.pdf`}
                className="rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50"
              >
                Download preview PDF
              </a>
            </div>
          </div>
          {shouldUseCanvasPdfViewer() && previewBlob ? (
            <div className="h-[70vh] rounded-lg border border-slate-300 bg-slate-50">
              <PdfCanvasViewer blob={previewBlob} />
            </div>
          ) : (
            <iframe
              title="Update Bulletin PDF Preview"
              src={previewUrl}
              className="h-150 w-full rounded-lg border border-slate-300"
            />
          )}
        </div>
      )}

      {isCustodian && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">4. Manage Posted Bulletins</h2>
              <p className="text-xs text-slate-600">
                Withdraw a previously posted Public or Internal bulletin so it
                no longer appears on the portal and you can issue a new one.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadIssuedBulletins()}
              disabled={loadingIssued}
              className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {loadingIssued ? 'Refreshing…' : 'Refresh list'}
            </button>
          </div>

          <div>
            <label
              htmlFor={`${id}-withdraw-reason`}
              className="block text-xs font-semibold text-slate-700"
            >
              Withdrawal reason (applied when removing a bulletin)
            </label>
            <input
              id={`${id}-withdraw-reason`}
              type="text"
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>

          {issuedBulletins.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              No active posted bulletins right now.
            </p>
          ) : (
            <div className="space-y-2">
              {issuedBulletins.map((b) => {
                const key = `${b.bulletin_id}:${b.issue_version}`
                const busy = withdrawingKey === key
                return (
                  <div
                    key={b.issue_uuid}
                    className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-700">
                          {b.bulletin_id} (v{b.issue_version})
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                            b.audience === 'public'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-sky-100 text-sky-800'
                          }`}
                        >
                          {b.audience}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900">
                        {b.title}
                      </p>
                      <p className="text-xs text-slate-600">
                        Coverage: {formatManilaDate(b.coverage_start)} –{' '}
                        {formatManilaDate(b.coverage_end)} ·{' '}
                        {b.sources_count} releases · Issued{' '}
                        {formatManilaDateTime(b.issued_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(withdrawingKey)}
                      onClick={() =>
                        void handleWithdrawBulletin(
                          b.bulletin_id,
                          b.issue_version,
                        )
                      }
                      className="shrink-0 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                    >
                      {busy ? 'Withdrawing…' : 'Withdraw / Remove'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

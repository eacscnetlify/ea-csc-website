import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { formatManilaDateTime } from '../../lib/dates'
import { getSupabaseClient } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'
import { getOfficerProfile } from '../auth/auth.api'
import { buildBulletinPdfBlob } from './bulletinPdf'
import type { BulletinCandidate } from './bulletinPdf'

function todayManilaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
  }).format(new Date())
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
  const [cutoffLocal, setCutoffLocal] = useState(`${today}T23:59`)
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
  const [issuing, setIssuing] = useState(false)
  const [issueNotice, setIssueNotice] = useState('')

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    void getOfficerProfile(userId, controller.signal)
      .then((profile) => {
        if (profile?.full_name) setPreparerName(profile.full_name)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [userId])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function loadCandidates() {
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

  function generatePreview() {
    setError('')
    const cutoffIso = new Date(`${cutoffLocal}:00+08:00`).toISOString()
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
    setPreviewUrl(URL.createObjectURL(blob))
  }

  async function handleIssue() {
    if (selectedItems.length === 0 || !verifiedPreview || issuing) return
    setIssuing(true)
    setError('')
    setIssueNotice('')
    try {
      const cutoffIso = new Date(`${cutoffLocal}:00+08:00`).toISOString()
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
            into a frozen snapshot and preview PDF. Issuance and private
            archival follow in Slice 8B.
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
        <h2 className="text-lg font-bold">
          1. Reporting window &amp; audience
        </h2>

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
            <label
              htmlFor={`${id}-cutoff`}
              className="block text-sm font-semibold"
            >
              Cutoff timestamp (Asia/Manila)
            </label>
            <input
              id={`${id}-cutoff`}
              type="datetime-local"
              value={cutoffLocal}
              onChange={(e) => setCutoffLocal(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-400 p-2 text-sm"
            />
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
          <iframe
            title="Update Bulletin PDF Preview"
            src={previewUrl}
            className="h-150 w-full rounded-lg border border-slate-300"
          />
        </div>
      )}
    </section>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { TurnoverItem } from '../turnover/turnover.types'
import { getMockWorkspaceOverview } from './workspace.api'
import type {
  MockWorkspaceOverview,
  MockWorkspaceRecord,
} from './workspace.api'

type WorkspaceState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'success'
      overview: MockWorkspaceOverview
    }

const accessLabels = {
  public: 'Public',
  internal: 'Internal',
  restricted: 'Restricted',
}

interface TextListProps {
  items: string[]
  emptyMessage: string
}

function TextList({ items, emptyMessage }: TextListProps) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-600">{emptyMessage}</p>
  }

  return (
    <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
      {items.map((item, index) => (
        <li key={`${index}-${item}`} className="wrap-break-word">
          {item}
        </li>
      ))}
    </ul>
  )
}

function WorkspaceRecordCard({ item }: { item: MockWorkspaceRecord }) {
  const { record, latestVersion, versionCount, currentPublicRecord } = item

  const hasApprovedReplacement =
    record.accessClass === 'public' &&
    latestVersion?.state === 'Approved' &&
    currentPublicRecord !== null &&
    latestVersion.versionId !== currentPublicRecord.versionId

  return (
    <li className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold leading-5 text-green-800">
        {record.category}
      </p>

      <h3 className="mt-3 text-lg font-bold leading-7 text-slate-900">
        {record.title}
      </h3>

      <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-500">
        {record.recordId}
      </p>

      <dl className="mt-5 space-y-4 text-sm">
        <div>
          <dt className="font-semibold text-slate-900">
            Access classification
          </dt>
          <dd className="mt-1 text-slate-600">
            {accessLabels[record.accessClass]}
          </dd>
        </div>

        <div>
          <dt className="font-semibold text-slate-900">
            Latest working version
          </dt>
          <dd className="mt-1 text-slate-600">
            {latestVersion
              ? `Version ${latestVersion.versionNumber} — ${latestVersion.state}`
              : 'No version available'}
          </dd>
        </div>

        <div>
          <dt className="font-semibold text-slate-900">
            Versions in this prototype
          </dt>
          <dd className="mt-1 text-slate-600">{versionCount}</dd>
        </div>

        <div>
          <dt className="font-semibold text-slate-900">
            Current public release
          </dt>
          <dd className="mt-1 text-slate-600">
            {currentPublicRecord ? (
              <Link
                to={`/records/${encodeURIComponent(currentPublicRecord.recordId)}`}
                className="rounded font-semibold text-green-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
              >
                Version {currentPublicRecord.versionNumber} — open public page
              </Link>
            ) : (
              'None'
            )}
          </dd>
        </div>

        <div>
          <dt className="font-semibold text-slate-900">Custodian position</dt>
          <dd className="mt-1 text-slate-600">{record.custodianPosition}</dd>
        </div>
      </dl>

      {latestVersion && (
        <p className="mt-5 border-t border-slate-200 pt-4 text-sm leading-6 text-slate-600">
          {latestVersion.changeSummary}
        </p>
      )}

      {hasApprovedReplacement && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          The latest working version is approved but has not replaced the
          current public release.
        </p>
      )}
    </li>
  )
}

function TurnoverPackage({ item }: { item: TurnoverItem }) {
  return (
    <details className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer rounded-xl p-5 text-base font-bold leading-7 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700">
        {item.positionTitle} — {item.termCovered}
      </summary>

      <div className="space-y-6 border-t border-slate-200 p-5">
        <p className="break-all font-mono text-xs text-slate-500">
          {item.turnoverId}
        </p>

        <div>
          <h3 className="mb-3 font-semibold text-slate-900">
            Related record IDs
          </h3>
          <TextList
            items={item.recordIds}
            emptyMessage="No related records are listed."
          />
        </div>

        <div>
          <h3 className="mb-3 font-semibold text-slate-900">Pending matters</h3>

          {item.pendingMatters.length === 0 ? (
            <p className="text-sm text-slate-600">
              No pending matters are listed.
            </p>
          ) : (
            <ul className="list-none space-y-4 p-0">
              {item.pendingMatters.map((matter) => (
                <li
                  key={matter.matterId}
                  className="rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-600"
                >
                  <p className="font-semibold text-slate-900">
                    {matter.summary}
                  </p>

                  <p className="mt-2">
                    <strong>Next action:</strong> {matter.nextAction}
                  </p>

                  <p className="mt-2">
                    <strong>Responsible position:</strong>{' '}
                    {matter.responsiblePosition}
                  </p>

                  <p className="mt-2">
                    <strong>Due date:</strong>{' '}
                    {matter.dueAt
                      ? new Intl.DateTimeFormat('en-PH', {
                          dateStyle: 'medium',
                          timeZone: 'Asia/Manila',
                        }).format(new Date(matter.dueAt))
                      : 'Not set'}
                  </p>

                  <p className="mt-2 wrap-break-word">
                    <strong>Related records:</strong>{' '}
                    {matter.relatedRecordIds.length > 0
                      ? matter.relatedRecordIds.join(', ')
                      : 'None listed'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-3 font-semibold text-slate-900">
            Recurring duties
          </h3>
          <TextList
            items={item.recurringDuties}
            emptyMessage="No recurring duties are listed."
          />
        </div>

        <div>
          <h3 className="mb-3 font-semibold text-slate-900">
            Official contacts
          </h3>

          {item.officialContacts.length === 0 ? (
            <p className="text-sm text-slate-600">
              No official contacts are listed.
            </p>
          ) : (
            <ul className="list-none space-y-3 p-0">
              {item.officialContacts.map((contact, index) => (
                <li
                  key={`${index}-${contact.office}`}
                  className="text-sm leading-6 text-slate-600"
                >
                  <p className="font-semibold text-slate-900">
                    {contact.office}
                  </p>
                  <p>{contact.purpose}</p>
                  <p className="break-all">{contact.publicContactDetails}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-3 font-semibold text-slate-900">
            Known exceptions
          </h3>
          <TextList
            items={item.knownExceptions}
            emptyMessage="No exceptions are listed."
          />
        </div>
      </div>
    </details>
  )
}

function WorkspaceOverview({ overview }: { overview: MockWorkspaceOverview }) {
  const totalVersions = overview.records.reduce(
    (total, item) => total + item.versionCount,
    0,
  )

  const publicReleaseCount = overview.records.filter(
    (item) => item.currentPublicRecord !== null,
  ).length

  const statistics = [
    { label: 'Fictional records', value: overview.records.length },
    { label: 'Stored mock versions', value: totalVersions },
    { label: 'Current public releases', value: publicReleaseCount },
    { label: 'Turnover packages', value: overview.turnoverItems.length },
  ]

  return (
    <div className="space-y-10">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statistics.map((statistic) => (
          <div
            key={statistic.label}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <dt className="text-sm font-semibold text-slate-600">
              {statistic.label}
            </dt>
            <dd className="mt-3 text-3xl font-bold text-slate-900">
              {statistic.value}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="workspace-records-heading">
        <h2
          id="workspace-records-heading"
          className="text-2xl font-bold text-slate-900"
        >
          Records and versions
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-600">
          The latest working version and the current public release are shown
          separately. Approval alone does not publish a version.
        </p>

        {overview.records.length === 0 ? (
          <p className="mt-5 rounded-xl border border-slate-200 bg-white p-5 text-slate-600">
            No fictional records are available.
          </p>
        ) : (
          <ul className="mt-5 grid list-none gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
            {overview.records.map((item) => (
              <WorkspaceRecordCard key={item.record.recordId} item={item} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="workspace-turnover-heading">
        <h2
          id="workspace-turnover-heading"
          className="text-2xl font-bold text-slate-900"
        >
          Turnover and continuity
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-600">
          Expand a sample package to inspect its record inventory, pending
          matters, recurring duties, contacts, and exceptions.
        </p>

        <div className="mt-5 space-y-4">
          {overview.turnoverItems.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-600">
              No sample turnover packages are available.
            </p>
          ) : (
            overview.turnoverItems.map((item) => (
              <TurnoverPackage key={item.turnoverId} item={item} />
            ))
          )}
        </div>
      </section>
    </div>
  )
}

export default function OfficerWorkspacePage() {
  const [state, setState] = useState<WorkspaceState>({
    status: 'loading',
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false

    getMockWorkspaceOverview()
      .then((overview) => {
        if (!ignore) {
          setState({ status: 'success', overview })
        }
      })
      .catch(() => {
        if (!ignore) {
          setState({ status: 'error' })
        }
      })

    return () => {
      ignore = true
    }
  }, [attempt])

  function retryLoading() {
    setState({ status: 'loading' })
    setAttempt((previous) => previous + 1)
  }

  return (
    <section aria-labelledby="workspace-heading">
      <p className="text-sm font-semibold tracking-wide text-green-800">
        PUBLICLY ACCESSIBLE MOCK PREVIEW
      </p>

      <h1
        id="workspace-heading"
        className="mt-2 text-3xl font-bold tracking-tight text-slate-900"
      >
        Officer workspace
      </h1>

      <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
        Explore fictional records and a sample turnover package. This preview
        does not provide operational officer access.
      </p>

      <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        Authentication and position-based permissions are not connected. All
        displayed information is fictional. Editing, approval, release, and
        turnover acknowledgment are not enabled.
      </p>

      <div className="mt-8" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && (
          <p
            role="status"
            className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600"
          >
            Loading workspace preview…
          </p>
        )}

        {state.status === 'error' && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-6"
          >
            <h2 className="text-lg font-semibold text-red-900">
              Workspace preview could not be loaded
            </h2>

            <button
              type="button"
              onClick={retryLoading}
              className="mt-4 rounded-lg bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
            >
              Try again
            </button>
          </div>
        )}

        {state.status === 'success' && (
          <WorkspaceOverview overview={state.overview} />
        )}
      </div>
    </section>
  )
}

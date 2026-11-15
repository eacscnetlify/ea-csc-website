import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getOfficerProfile, type OfficerProfile } from './auth.api'
import { useAuth } from './useAuth'

interface ActionStep {
  roleLabel: string
  summary: string
  to: string
  cta: string
  tone: string
}

export function RoleActionBanner() {
  const { session } = useAuth()
  const [profile, setProfile] = useState<OfficerProfile | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return
    const controller = new AbortController()
    getOfficerProfile(userId, controller.signal)
      .then((p) => {
        if (!controller.signal.aborted) {
          setProfile(p)
        }
      })
      .catch(() => {
        // Ignore abort/network errors in banner
      })
    return () => controller.abort()
  }, [session?.user?.id])

  if (!profile) return null

  const roles = profile.functional_roles ?? []
  const items: ActionStep[] = []

  if (roles.length === 0) {
    items.push({
      roleLabel: 'Student Observer',
      summary: 'Apply for a council position or wait for President approval to unlock officer tabs.',
      to: '/account',
      cta: 'My Account & Role',
      tone: 'border-slate-200 bg-slate-50 text-slate-800',
    })
  }
  if (roles.includes('author')) {
    items.push({
      roleLabel: 'Author',
      summary: 'Create folders/records, upload PDF/DOCX drafts, fix returned items, and submit for review.',
      to: '/officer',
      cta: 'Open Workspace',
      tone: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
    })
  }
  if (roles.includes('reviewer') || roles.includes('approver')) {
    items.push({
      roleLabel: roles.includes('approver') ? 'Approver / President' : 'Reviewer / Auditor',
      summary: 'Inspect submitted drafts, return items needing fixes, or complete 6-point verification.',
      to: '/officer/reviews',
      cta: 'Review Queue',
      tone: 'border-amber-200 bg-amber-50/70 text-amber-950',
    })
  }
  if (roles.includes('publisher')) {
    items.push({
      roleLabel: 'Publisher / PRO',
      summary: 'Publish approved versions to the Public Library or execute emergency withdrawals.',
      to: '/officer/releases',
      cta: 'Release Panel',
      tone: 'border-rose-200 bg-rose-50/70 text-rose-950',
    })
  }
  if (roles.includes('custodian')) {
    items.push({
      roleLabel: 'Custodian / Secretary',
      summary: 'Bundle active releases into official Update Bulletins or freeze turnover inventories.',
      to: '/officer/bulletins',
      cta: 'Bulletin Compiler',
      tone: 'border-cyan-200 bg-cyan-50/70 text-cyan-950',
    })
  }
  if (roles.includes('technical_admin')) {
    items.push({
      roleLabel: 'Technical Admin',
      summary: 'Execute verified position & role transfers for outgoing/incoming officers.',
      to: '/officer/access',
      cta: 'Access Transfer',
      tone: 'border-indigo-200 bg-indigo-50/70 text-indigo-950',
    })
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
            Role-Guided Quick Actions
          </p>
          <h2 className="text-sm font-bold text-slate-900">
            What You Can Do Next ({profile.council_position ?? 'Officer'})
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {!collapsed && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.roleLabel}
              className={`flex flex-col justify-between rounded-xl border p-3.5 transition hover:shadow-xs ${item.tone}`}
            >
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide">
                  {item.roleLabel}
                </p>
                <p className="mt-1 text-xs leading-relaxed opacity-90">
                  {item.summary}
                </p>
              </div>
              <Link
                to={item.to}
                className="mt-3 inline-flex w-fit items-center rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-emerald-900"
              >
                {item.cta} →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import { Link } from 'react-router'

interface HelpLinkProps {
  section: string
  label?: string
}

export default function HelpLink({
  section,
  label = 'Open guide for this page',
}: HelpLinkProps) {
  return (
    <Link
      to={`/help#${section}`}
      aria-label={label}
      title={label}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-sm font-bold text-emerald-900 shadow-xs transition-colors hover:border-emerald-700 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
    >
      ?
    </Link>
  )
}

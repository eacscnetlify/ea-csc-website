import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import {
  askAssistant,
  summarizeWithAssistant,
  type EngineSource,
  type SummaryAnalysis,
} from './assistantEngine'

interface AssistantDrawerProps {
  open: boolean
  onClose: () => void
}

interface Message {
  id: string
  role: 'assistant' | 'user'
  text: string
  engine?: EngineSource
  model?: string
  helpSection?: string
  helpLabel?: string
}

export default function AssistantDrawer({
  open,
  onClose,
}: AssistantDrawerProps) {
  const { pathname } = useLocation()
  const [tab, setTab] = useState<'chat' | 'summarize'>('chat')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [engineMode, setEngineMode] = useState<EngineSource>('local')
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      engine: 'local',
      text:
        'Hi! I am the EA-CSC AI Assistant. I can help you with:\n' +
        '• Website & governance questions (roles, 6-point checklist, statuses, bulletins, turnover)\n' +
        '• Word & term definitions (e.g., "define superseded" or "define algorithm")\n' +
        '• Text summarization & entity extraction (use the Summarize & Analyze tab or type "summarize: <text>")',
      helpSection: 'overview',
      helpLabel: 'Open full Help Center',
    },
  ])
  const [draftText, setDraftText] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [summaryResult, setSummaryResult] = useState<SummaryAnalysis | null>(null)
  const [copiedSummary, setCopiedSummary] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  if (!open) return null

  async function sendPrompt(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const userMsg: Message = {
      id: `${Date.now()}-u`,
      role: 'user',
      text: trimmed,
    }
    const historySnapshot = messages
      .filter((m) => m.id !== 'welcome')
      .map((m) => ({ role: m.role, text: m.text }))

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const reply = await askAssistant({
        question: trimmed,
        pathname,
        history: historySnapshot,
      })
      if (reply.engine === 'gemini') {
        setEngineMode('gemini')
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-a`,
          role: 'assistant',
          text: reply.text,
          engine: reply.engine,
          model: reply.model,
          helpSection: reply.helpSection,
          helpLabel: reply.helpLabel,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  async function handleSummarize() {
    if (!draftText.trim() || summarizing) return
    setSummarizing(true)
    setCopiedSummary(false)
    try {
      const result = await summarizeWithAssistant({
        rawText: draftText,
        pathname,
      })
      if (result?.engine === 'gemini') {
        setEngineMode('gemini')
      }
      setSummaryResult(result)
    } finally {
      setSummarizing(false)
    }
  }

  function handleCopySummary() {
    if (!summaryResult) return
    const text = [
      `Category: ${summaryResult.category}`,
      '',
      'Key Points:',
      ...summaryResult.bullets.map((b) => `- ${b}`),
      '',
      '6-Point Checklist Reminders:',
      ...summaryResult.reminders.map((r) => `- ${r}`),
    ].join('\n')
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedSummary(true)
      window.setTimeout(() => setCopiedSummary(false), 2000)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/45 backdrop-blur-[2px] transition-opacity duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="EA-CSC AI Assistant"
    >
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-[#0e172a] via-[#1c1020] to-[#3a0a18] px-4 py-3.5 text-white">
          <div className="flex items-center gap-3">
            <img
              src="/ai-chatbot-icon.png"
              alt="EA-CSC AI Chatbot"
              className="size-11 shrink-0 rounded-full border border-white/25 bg-slate-950/60 object-cover shadow-md"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-tight sm:text-base">
                  EA-CSC AI Assistant
                </h2>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    engineMode === 'gemini'
                      ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
                      : 'bg-white/10 text-slate-200 ring-1 ring-white/20'
                  }`}
                  title={
                    engineMode === 'gemini'
                      ? 'Powered by Google Gemini API via Supabase Edge Function'
                      : 'Running local governance, dictionary & TextRank engine (connect Gemini API key for full LLM)'
                  }
                >
                  {engineMode === 'gemini' ? 'Gemini AI' : 'Smart Local'}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Portal guide, definitions &amp; text analyzer
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 pt-2">
          <div className="flex">
            <button
              type="button"
              onClick={() => setTab('chat')}
              className={`border-b-2 px-3.5 py-2 text-xs font-semibold transition sm:text-sm ${
                tab === 'chat'
                  ? 'border-[#8B0029] text-[#8B0029]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Ask &amp; Define
            </button>
            <button
              type="button"
              onClick={() => setTab('summarize')}
              className={`border-b-2 px-3.5 py-2 text-xs font-semibold transition sm:text-sm ${
                tab === 'summarize'
                  ? 'border-[#8B0029] text-[#8B0029]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Summarize &amp; Analyze
            </button>
          </div>
          {tab === 'chat' && messages.length > 1 && (
            <button
              type="button"
              onClick={() => setMessages((prev) => prev.slice(0, 1))}
              className="mb-1 text-[11px] font-medium text-slate-500 hover:text-slate-800"
            >
              Clear chat
            </button>
          )}
        </div>

        {tab === 'chat' ? (
          <>
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-white px-4 py-2.5">
              {[
                'What can I do on this page?',
                'Explain user roles',
                'Define superseded',
                '6-point checklist',
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={loading}
                  onClick={() => void sendPrompt(chip)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 disabled:opacity-50"
                >
                  {chip}
                </button>
              ))}
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {msg.role === 'assistant' && (
                    <img
                      src="/ai-chatbot-icon.png"
                      alt=""
                      className="mt-0.5 size-7 shrink-0 rounded-full border border-slate-200 bg-slate-900 object-cover"
                    />
                  )}
                  <div
                    className={`max-w-[85%] rounded-xl p-3 text-sm leading-relaxed whitespace-pre-line ${
                      msg.role === 'user'
                        ? 'bg-emerald-900 text-white shadow-sm'
                        : 'border border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  >
                    <p>{msg.text}</p>
                    {msg.helpSection && (
                      <Link
                        to={`/help#${msg.helpSection}`}
                        onClick={onClose}
                        className="mt-2 inline-block text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
                      >
                        {msg.helpLabel ?? 'Read more in Help'} →
                      </Link>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2.5">
                  <img
                    src="/ai-chatbot-icon.png"
                    alt=""
                    className="size-7 shrink-0 rounded-full border border-slate-200 bg-slate-900 object-cover"
                  />
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-500">
                    Analyzing your question…
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void sendPrompt(input)
              }}
              className="flex gap-2 border-t border-slate-200 bg-white p-3"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about the site, define a word, or summarize…"
                disabled={loading}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-700 focus:outline-none disabled:bg-slate-50"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                Ask
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <p className="text-xs leading-5 text-slate-600">
              Paste council announcement text, meeting minutes, or draft
              guidelines below to extract key bullet points, entities (dates,
              venues, contacts, amounts), suggested record category, and 6-point
              checklist reminders.
            </p>
            <textarea
              rows={6}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Paste resolution, memo, or event announcement text here…"
              className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-emerald-700 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={summarizing || !draftText.trim()}
                onClick={() => void handleSummarize()}
                className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                {summarizing ? 'Analyzing…' : 'Summarize & Analyze'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftText('')
                  setSummaryResult(null)
                  setCopiedSummary(false)
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>

            {summaryResult && (
              <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-bold tracking-wide text-emerald-900 uppercase">
                      Suggested Category
                    </p>
                    <p className="mt-0.5 font-semibold text-slate-900">
                      {summaryResult.category}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopySummary}
                    className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
                  >
                    {copiedSummary ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                <div>
                  <p className="text-[11px] font-bold tracking-wide text-emerald-900 uppercase">
                    Key Points Summary
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-800">
                    {summaryResult.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>

                {(summaryResult.entities.dates.length > 0 ||
                  summaryResult.entities.locations.length > 0 ||
                  summaryResult.entities.contacts.length > 0 ||
                  summaryResult.entities.amounts.length > 0) && (
                  <div>
                    <p className="text-[11px] font-bold tracking-wide text-emerald-900 uppercase">
                      Detected Details
                    </p>
                    <div className="mt-1 space-y-1 text-xs text-slate-700">
                      {summaryResult.entities.dates.length > 0 && (
                        <p>
                          <strong>Dates/Times:</strong>{' '}
                          {summaryResult.entities.dates.join(', ')}
                        </p>
                      )}
                      {summaryResult.entities.locations.length > 0 && (
                        <p>
                          <strong>Venues/Links:</strong>{' '}
                          {summaryResult.entities.locations.join(', ')}
                        </p>
                      )}
                      {summaryResult.entities.contacts.length > 0 && (
                        <p>
                          <strong>Contacts:</strong>{' '}
                          {summaryResult.entities.contacts.join(', ')}
                        </p>
                      )}
                      {summaryResult.entities.amounts.length > 0 && (
                        <p>
                          <strong>Amounts:</strong>{' '}
                          {summaryResult.entities.amounts.join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-[11px] font-bold tracking-wide text-emerald-900 uppercase">
                    6-Point Verification Reminders
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-700">
                    {summaryResult.reminders.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

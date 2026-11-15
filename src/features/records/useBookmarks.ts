import { useCallback, useEffect, useState } from 'react'

export interface PinnedRecord {
  recordId: string
  title: string
  category: string
  versionNumber: number
}

const STORAGE_KEY = 'eacsc.pinned_records.v1'

function loadBookmarks(): PinnedRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is PinnedRecord =>
        typeof item?.recordId === 'string' && typeof item?.title === 'string',
    )
  } catch {
    return []
  }
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<PinnedRecord[]>(() =>
    loadBookmarks(),
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks))
    } catch {
      // Ignore storage quota errors in restricted browsing modes
    }
  }, [bookmarks])

  const isPinned = useCallback(
    (recordId: string) => bookmarks.some((b) => b.recordId === recordId),
    [bookmarks],
  )

  const togglePin = useCallback((record: PinnedRecord) => {
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.recordId === record.recordId)
      if (exists) {
        return prev.filter((b) => b.recordId !== record.recordId)
      }
      return [record, ...prev]
    })
  }, [])

  const clearPins = useCallback(() => {
    setBookmarks([])
  }, [])

  return { bookmarks, isPinned, togglePin, clearPins }
}

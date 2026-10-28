export type MockResponseMode = 'normal' | 'slow' | 'empty' | 'error'

const storageKey = 'ea-csc:mock-mode'

function readMockMode(): MockResponseMode {
  if (!import.meta.env.DEV) {
    return 'normal'
  }

  try {
    const savedMode = window.sessionStorage.getItem(storageKey)

    if (savedMode === null) {
      window.sessionStorage.setItem(storageKey, 'normal')
    }

    if (
      savedMode === 'slow' ||
      savedMode === 'empty' ||
      savedMode === 'error'
    ) {
      return savedMode
    }
  } catch {
    // Continue normally if browser storage is unavailable.
    return 'normal'
  }

  return 'normal'
}

export async function waitForMockResponse(): Promise<MockResponseMode> {
  const mode = readMockMode()
  const delay = mode === 'slow' ? 2000 : 250

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, delay)
  })

  if (mode === 'error') {
    throw new Error('Simulated mock request failure.')
  }

  return mode
}

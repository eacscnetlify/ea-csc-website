export function isConflictError(status: number, code?: unknown): boolean {
  return status === 409 || code === 'PT409'
}

export function getConflictMessage(
  fallback = 'Another authorized officer saved a newer revision first. Review the latest record before resubmitting.',
): string {
  return fallback
}

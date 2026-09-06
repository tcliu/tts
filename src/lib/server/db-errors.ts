export function isUniqueViolation(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === '23505') {
      return true
    }
  }
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}

export interface DbResult<T> {
  rows: T[]
  rowCount: number | null
}

export type DbQuery = <T>(sql: string, params?: unknown[]) => Promise<DbResult<T>>

export interface Db {
  query<T>(sql: string, params?: unknown[]): Promise<DbResult<T>>
  transaction<T>(fn: (query: DbQuery) => Promise<T>): Promise<T>
  close(): Promise<void>
}

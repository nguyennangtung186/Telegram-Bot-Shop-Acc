/**
 * CMS API response và pagination types.
 */

export interface ApiResponse<T> {
  success: boolean
  data: T | null
  error: string | null
  meta?: PaginationMeta
}

export interface PaginationMeta {
  total: number
  page: number
  limit: number
}

export interface PaginationParams {
  page: number // default: 1
  limit: number // default: 20, max: 100
  sort: string // field name
  order: 'asc' | 'desc'
  search?: string
  filter?: Record<string, string>
}

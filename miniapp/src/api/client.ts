/**
 * client.ts — HTTP client mỏng cho API Mini App (`/api/app/*`).
 *
 * Nguyên tắc (bám sát Req 1.1, 1.7 + design "API client (frontend)"):
 *  - Đính kèm header `X-Telegram-Init-Data` (initData thô) vào MỌI request (Req 1.1).
 *  - Stateless HOÀN TOÀN: KHÔNG đọc/ghi token hay localStorage (Req 1.7). Xác thực
 *    do Worker verify lại initData trên từng request.
 *  - Parse `ApiResponse<T>` của Worker, unwrap `data`, ném `ApiError` khi thất bại.
 *  - 401 (thiếu/sai initData hoặc hết TTL) → bật cờ `unauthorized` ở ui store để app
 *    hiển thị màn "Mở lại từ Telegram", sau đó vẫn ném `ApiError(401)` cho caller.
 */

import { getInitData } from '@/telegram/sdk'
import { setUnauthorized } from '@/stores/ui'
import type { PaginationMeta } from '@/types'

/** Prefix chung của API Mini App — mọi path đều được nối sau prefix này. */
const BASE = '/api/app'

/**
 * Shape phản hồi chuẩn của Worker — khớp `ApiResponse<T>` backend (`src/types/api.ts`):
 * `{ success, data, error, meta? }`.
 */
export interface ApiResponse<T> {
  success: boolean
  data: T | null
  error: string | null
  meta?: PaginationMeta
}

/**
 * Lỗi API có mã trạng thái HTTP + chuỗi `error` từ Worker.
 *  - `status = 0`  : lỗi mạng / không gọi được server (fetch reject).
 *  - `status = 401`: chưa xác thực (đồng thời đã bật cờ `unauthorized`).
 *  - Các mã khác   : lỗi nghiệp vụ, `error` là chuỗi mã lỗi do Worker trả.
 */
export class ApiError extends Error {
  readonly status: number
  readonly error: string

  constructor(status: number, error: string | null) {
    super(error ?? `http_${status}`)
    this.name = 'ApiError'
    this.status = status
    this.error = error ?? `http_${status}`
  }
}

/** Tuỳ chọn cho `request` — tập con của `RequestInit` đủ dùng cho API Mini App. */
export interface RequestOptions {
  method?: string
  /** Body sẽ được JSON.stringify; bỏ qua khi `undefined`/`null` (vd request GET). */
  body?: unknown
  /** Cho phép huỷ request (vd polling trạng thái nạp khi rời màn hình). */
  signal?: AbortSignal
}

/**
 * Gửi một request tới API Mini App và trả về `data` đã unwrap.
 *
 * @throws ApiError khi lỗi mạng (status 0), 401, `res.ok === false`,
 *         hoặc `ApiResponse.success === false`.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options

  // Header initData gắn cho MỌI request (Req 1.1) — đọc tươi mỗi lần để tránh giá trị rỗng
  // bị "đóng băng" lúc cold start. Content-Type chỉ set khi có body JSON.
  const headers: Record<string, string> = {
    'X-Telegram-Init-Data': getInitData(),
  }
  const hasBody = body !== undefined && body !== null
  if (hasBody) {
    headers['Content-Type'] = 'application/json'
  }

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (err) {
    // Lỗi mạng / fetch bị abort → status 0 để caller phân biệt với lỗi nghiệp vụ.
    throw new ApiError(0, err instanceof Error ? err.message : 'network_error')
  }

  // 401: bật cờ unauthorized để app hiện màn "Mở lại từ Telegram" (Req 1.7 — không lưu token).
  if (res.status === 401) {
    setUnauthorized(true)
    throw new ApiError(401, 'unauthorized')
  }

  let json: ApiResponse<T>
  try {
    json = (await res.json()) as ApiResponse<T>
  } catch {
    throw new ApiError(res.status, 'invalid_response')
  }

  if (!res.ok || !json.success) {
    throw new ApiError(res.status, json.error)
  }

  return json.data as T
}

/** Helper GET — path đã được prefix `/api/app` bên trong `request`. */
export function get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
  return request<T>(path, { ...options, method: 'GET' })
}

/** Helper POST — `body` sẽ được JSON-encode và set Content-Type tự động. */
export function post<T>(
  path: string,
  body?: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<T> {
  return request<T>(path, { ...options, method: 'POST', body })
}

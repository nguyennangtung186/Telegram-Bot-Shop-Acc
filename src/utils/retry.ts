/**
 * D1 retry utility — retry tối đa 2 lần với delay 500ms giữa mỗi lần.
 * Requirement: 9.2
 */

const DEFAULT_MAX_RETRIES = 2
const DEFAULT_DELAY_MS = 500

/**
 * Thực thi một D1 operation với retry logic.
 * Retry tối đa `maxRetries` lần (default 2) với `delayMs` giữa mỗi lần (default 500ms).
 * Nếu tất cả retry đều fail, throw lỗi cuối cùng.
 */
export async function d1WithRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; delayMs?: number }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES
  const delayMs = options?.delayMs ?? DEFAULT_DELAY_MS

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt < maxRetries) {
        await sleep(delayMs)
      }
    }
  }

  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

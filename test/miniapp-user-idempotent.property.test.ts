import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import fc from 'fast-check'
import { getOrCreateUser } from '../src/middleware/miniapp-auth'
import type { InitDataParsed } from '../src/utils/telegram-initdata'
import type { DbUser } from '../src/types/db'

// Feature: telegram-mini-app, Property 4
/**
 * Property-based test cho tự tạo user idempotent (`getOrCreateUser`).
 *
 * **Property 4: Tự tạo user idempotent với balance khởi tạo 0**
 * **Validates: Requirements 3.1, 3.2, 3.3**
 *
 * - Req 3.1: request đã xác thực với `telegram_id` chưa tồn tại → tạo bản ghi `users` mới.
 * - Req 3.2: khi tạo mới → khởi tạo `balance = 0`.
 * - Req 3.3: với `telegram_id` đã tồn tại → dùng lại bản ghi, KHÔNG tạo trùng lặp.
 *
 * Sau 1..n lần gọi `getOrCreateUser` (có thể đổi `username`/`first_name`) cho cùng
 * `telegram_id`: đúng 1 bản ghi `users` với `telegram_id` đó và `balance = 0`.
 * Chạy trên D1 thật của `@cloudflare/vitest-pool-workers` (binding `env.DB`).
 */

// users: telegram_id UNIQUE, balance INTEGER CHECK(balance >= 0)
// (trích từ migration 0001 / test/integration.test.ts)
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
    is_active INTEGER DEFAULT 1,
    last_interaction_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
]

async function applySchema(db: D1Database) {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.prepare(stmt).run()
  }
}

async function cleanTables(db: D1Database) {
  await db.prepare('DELETE FROM users').run()
}

// --- Arbitraries (generator thông minh, giới hạn đúng không gian đầu vào) ---

const SAFE_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.'.split('')

const arbNullableText = fc.option(
  fc.array(fc.constantFrom(...SAFE_CHARS), { maxLength: 16 }).map((a) => a.join('')),
  { nil: null }
)

/** Hồ sơ một lần gọi getOrCreateUser cho cùng telegram_id (username/first_name có thể đổi). */
const arbCallProfile = fc.record({
  username: arbNullableText,
  firstName: arbNullableText,
})

/** Dựng InitDataParsed cho 1 lần gọi (authDate/raw không ảnh hưởng tới getOrCreateUser). */
function makeParsed(
  telegramId: number,
  profile: { username: string | null; firstName: string | null }
): InitDataParsed {
  return {
    telegramId,
    username: profile.username,
    firstName: profile.firstName,
    authDate: 1_700_000_000,
    raw: '',
  }
}

describe('Property 4: Tự tạo user idempotent với balance khởi tạo 0', () => {
  beforeEach(async () => {
    await applySchema(env.DB)
    await cleanTables(env.DB)
  })

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   * n lần gọi cho cùng telegram_id → đúng 1 bản ghi users, balance = 0;
   * lần tạo đầu trả DbUser có telegram_id khớp và balance = 0.
   */
  it('after n authenticated calls for same telegram_id: exactly 1 row with balance 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 9_999_999_999 }), // telegram_id tuỳ ý
        fc.array(arbCallProfile, { minLength: 1, maxLength: 6 }), // n ∈ [1, 6]
        async (telegramId, profiles) => {
          await cleanTables(env.DB)

          // Lần gọi đầu tiên: bản ghi mới (Req 3.1) với balance = 0 (Req 3.2)
          const firstUser: DbUser = await getOrCreateUser(
            env.DB,
            makeParsed(telegramId, profiles[0])
          )
          expect(firstUser.telegram_id).toBe(telegramId)
          expect(firstUser.balance).toBe(0)

          // Các lần gọi tiếp theo: dùng lại bản ghi, không tạo trùng (Req 3.3)
          for (let i = 1; i < profiles.length; i++) {
            const u = await getOrCreateUser(env.DB, makeParsed(telegramId, profiles[i]))
            expect(u.telegram_id).toBe(telegramId)
            expect(u.id).toBe(firstUser.id)
          }

          // Đúng 1 bản ghi users cho telegram_id này (Req 3.3)
          const countRow = await env.DB
            .prepare('SELECT COUNT(*) AS cnt FROM users WHERE telegram_id = ?')
            .bind(telegramId)
            .first<{ cnt: number }>()
          expect(countRow!.cnt).toBe(1)

          // Balance của bản ghi vẫn là 0 sau mọi lần gọi (Req 3.2)
          const balanceRow = await env.DB
            .prepare('SELECT balance FROM users WHERE telegram_id = ?')
            .bind(telegramId)
            .first<{ balance: number }>()
          expect(balanceRow!.balance).toBe(0)
        }
      ),
      { numRuns: 100 }
    )
  })
})

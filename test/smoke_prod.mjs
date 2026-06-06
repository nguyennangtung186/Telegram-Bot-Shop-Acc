#!/usr/bin/env node
/**
 * Smoke test PRODUCTION cho Mini App đã deploy.
 * - Serve static /app: index.html, asset JS thật, SPA deep-link, asset-404 fallback.
 * - API /api/app/*: 401 khi thiếu/sai initData; 200 khi initData ký hợp lệ (HMAC như backend).
 *
 * Ký initData bằng BOT_TOKEN (đọc từ .dev.vars, KHÔNG in token). In [PASS]/[FAIL] từng case.
 * LƯU Ý: case /me hợp lệ sẽ tạo 1 user test (telegram_id dưới) trong D1 production, balance 0.
 *
 * Usage: node test/smoke_prod.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://telegram-shop-bot.n5pskgzs9g.workers.dev'
const TEST_TELEGRAM_ID = 909090901
const TEST_USERNAME = 'smoke_tester'
const TEST_FIRST = 'Smoke'

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label}${detail ? ' :: ' + detail : ''}`)
  if (ok) pass++
  else fail++
}

function botToken() {
  const raw = readFileSync(join(ROOT, '.dev.vars'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*BOT_TOKEN\s*=\s*(.+)\s*$/)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return ''
}

const enc = new TextEncoder()
async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', key, enc.encode(msg))
}
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Ký initData hợp lệ theo chuẩn Telegram WebApp. */
async function signInitData(token, fields) {
  const pairs = Object.keys(fields).filter((k) => k !== 'hash').map((k) => `${k}=${fields[k]}`)
  pairs.sort()
  const dcs = pairs.join('\n')
  const secret = await hmac(enc.encode('WebAppData'), token)
  const hash = toHex(await hmac(secret, dcs))
  const p = new URLSearchParams()
  for (const k of Object.keys(fields)) p.append(k, fields[k])
  p.append('hash', hash)
  return p.toString()
}

function formatCurrency(n) {
  return n.toLocaleString('en-US') + 'đ'
}

async function main() {
  const token = botToken()
  if (!token) return check(false, 'đọc BOT_TOKEN')

  // 1. /app/ index.html
  const r1 = await fetch(`${BASE}/app/`)
  const html = await r1.text()
  check(r1.status === 200 && /text\/html/.test(r1.headers.get('content-type') || '') && html.includes('id="app"'),
    '/app/ trả index.html', `code=${r1.status}`)

  // 2. asset JS thật
  const m = html.match(/\/app\/assets\/[^"']+\.js/)
  const assetPath = m ? m[0] : null
  if (!assetPath) {
    check(false, 'tìm asset trong index.html')
  } else {
    const r2 = await fetch(`${BASE}${assetPath}`)
    const ct = r2.headers.get('content-type') || ''
    const body = await r2.text()
    const isJs = /javascript/.test(ct)
    const notHtml = !body.trimStart().startsWith('<!DOCTYPE')
    check(r2.status === 200 && isJs && notHtml, `asset JS serve đúng (${assetPath})`, `code=${r2.status} ctype=${ct}`)
  }

  // 3. SPA deep-link
  const r3 = await fetch(`${BASE}/app/shop`)
  const b3 = await r3.text()
  check(r3.status === 200 && b3.includes('id="app"'), '/app/shop → SPA fallback index.html', `code=${r3.status}`)

  // 4. API thiếu initData → 401
  const r4 = await fetch(`${BASE}/api/app/me`)
  check(r4.status === 401, 'GET /api/app/me thiếu initData → 401', `code=${r4.status}`)

  // 5. API initData sai → 401
  const r5 = await fetch(`${BASE}/api/app/me`, { headers: { 'X-Telegram-Init-Data': 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef' } })
  check(r5.status === 401, 'GET /api/app/me initData sai hash → 401', `code=${r5.status}`)

  // 6. API initData hợp lệ → 200 (tạo user test)
  const initData = await signInitData(token, {
    user: JSON.stringify({ id: TEST_TELEGRAM_ID, username: TEST_USERNAME, first_name: TEST_FIRST }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  })
  const r6 = await fetch(`${BASE}/api/app/me`, { headers: { 'X-Telegram-Init-Data': initData } })
  const j6 = await r6.json().catch(() => null)
  const okMe = r6.status === 200 && j6?.success === true && j6.data?.telegram_id === TEST_TELEGRAM_ID &&
    j6.data?.balance_display === formatCurrency(j6.data?.balance)
  check(okMe, 'GET /api/app/me initData hợp lệ → 200 + đúng định dạng', `code=${r6.status} body=${JSON.stringify(j6?.data)}`)

  // 7. product-types với initData hợp lệ → 200 array
  const r7 = await fetch(`${BASE}/api/app/product-types`, { headers: { 'X-Telegram-Init-Data': initData } })
  const j7 = await r7.json().catch(() => null)
  check(r7.status === 200 && j7?.success === true && Array.isArray(j7.data),
    'GET /api/app/product-types → 200 array', `code=${r7.status} len=${Array.isArray(j7?.data) ? j7.data.length : 'n/a'}`)

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`)
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => { console.log('[FAIL] exception ::', e?.message ?? String(e)); process.exitCode = 1 })

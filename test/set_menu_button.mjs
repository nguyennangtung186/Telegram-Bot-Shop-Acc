#!/usr/bin/env node
/**
 * Cài Mini App vào bot: set Chat Menu Button kiểu `web_app` trỏ tới /app.
 * Đọc BOT_TOKEN từ .dev.vars (KHÔNG in token ra). In tiến trình từng bước.
 *
 * Usage: node test/set_menu_button.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MINIAPP_URL = 'https://telegram-shop-bot.n5pskgzs9g.workers.dev/app'
const BUTTON_TEXT = 'Cửa hàng'

function readBotToken() {
  const raw = readFileSync(join(ROOT, '.dev.vars'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*BOT_TOKEN\s*=\s*(.+)\s*$/)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return ''
}

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

async function main() {
  const token = readBotToken()
  if (!token || /your|xxx|placeholder/i.test(token)) {
    console.log('[FAIL] BOT_TOKEN không hợp lệ trong .dev.vars')
    process.exitCode = 1
    return
  }
  console.log(`[1/3] Đọc BOT_TOKEN OK (len=${token.length})`)

  const me = await tg(token, 'getMe')
  if (!me.ok) {
    console.log('[FAIL] getMe:', JSON.stringify(me))
    process.exitCode = 1
    return
  }
  console.log(`[2/3] Bot: @${me.result.username} (id=${me.result.id})`)

  const set = await tg(token, 'setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: BUTTON_TEXT,
      web_app: { url: MINIAPP_URL },
    },
  })
  console.log('[3/3] setChatMenuButton:', JSON.stringify(set))

  const cur = await tg(token, 'getChatMenuButton')
  console.log('       getChatMenuButton:', JSON.stringify(cur))

  if (!set.ok) process.exitCode = 1
}

main().catch((e) => {
  console.log('[FAIL]', e?.message ?? String(e))
  process.exitCode = 1
})

#!/usr/bin/env node
// Kiểm tĩnh no-gradient (Task 14.5 — Req 13.3)
// Quét dist/miniapp (CSS/JS/HTML) đảm bảo KHÔNG có gradient:
//   bg-gradient-*, linear-gradient, radial-gradient, conic-gradient
// Đây là kiểm tra hạ tầng/cấu hình (không phải PBT). Chạy bằng Node thật
// (vitest-pool-workers/workerd không có filesystem nên không dùng node:fs trong worker test).

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST_MINIAPP = join(REPO_ROOT, 'dist', 'miniapp');
const SCAN_EXTENSIONS = new Set(['.css', '.js', '.mjs', '.html']);

// Các dạng gradient cấm theo Req 13.3 (gradient MÀU được render trong UI):
//   bg-gradient-* (Tailwind util class), linear-gradient(), radial-gradient(),
//   conic-gradient() và các biến thể repeating-*-gradient().
//
// Chỉ bắt cú pháp HÀM gradient (`*-gradient(` có dấu mở ngoặc) và class
// `bg-gradient-*`. Lý do: Tailwind preflight luôn tự chèn các custom property
// rỗng `--tw-gradient-from/via/to(-position): ;` vào selector `*` dù KHÔNG dùng
// gradient — đây là placeholder trơ, KHÔNG render gradient, không phải vi phạm
// và không thể gỡ nếu không phá base của Tailwind. Bắt theo `gradient(` loại bỏ
// các placeholder này (chúng không có dấu mở ngoặc) đồng thời vẫn phủ trọn 4
// dạng cấm (linear/radial/conic đều dùng `gradient(`).
const GRADIENT_PATTERNS = [
  { name: 'bg-gradient-*', regex: /bg-gradient-[a-z0-9-]+/gi },
  { name: 'linear-gradient()', regex: /(?:repeating-)?linear-gradient\s*\(/gi },
  { name: 'radial-gradient()', regex: /(?:repeating-)?radial-gradient\s*\(/gi },
  { name: 'conic-gradient()', regex: /(?:repeating-)?conic-gradient\s*\(/gi },
];

function log(line) {
  process.stdout.write(line + '\n');
}

async function collectFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full)));
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function findGradients(content) {
  const hits = [];
  for (const { name, regex } of GRADIENT_PATTERNS) {
    regex.lastIndex = 0;
    const matches = content.match(regex);
    if (matches && matches.length > 0) {
      hits.push({ pattern: name, count: matches.length, sample: matches[0] });
    }
  }
  return hits;
}

async function main() {
  log('=== Kiểm tĩnh no-gradient (Req 13.3) — quét dist/miniapp ===');

  if (!existsSync(DIST_MINIAPP)) {
    log(`[FAIL] dist/miniapp không tồn tại :: ${DIST_MINIAPP}`);
    log('       → Chạy build trước: npm run build:miniapp (từ repo root)');
    process.exitCode = 1;
    return;
  }

  const distStat = await stat(DIST_MINIAPP);
  if (!distStat.isDirectory()) {
    log(`[FAIL] dist/miniapp không phải thư mục :: ${DIST_MINIAPP}`);
    process.exitCode = 1;
    return;
  }

  const files = await collectFiles(DIST_MINIAPP);
  log(`Tìm thấy ${files.length} file (.css/.js/.mjs/.html) để quét.`);

  if (files.length === 0) {
    log('[FAIL] Không có file nào để quét — dist/miniapp rỗng. Chạy npm run build:miniapp.');
    process.exitCode = 1;
    return;
  }

  const offenders = [];
  let scanned = 0;

  for (const file of files) {
    scanned += 1;
    const rel = relative(REPO_ROOT, file);
    const content = await readFile(file, 'utf8');
    const hits = findGradients(content);
    if (hits.length === 0) {
      log(`[PASS] [${scanned}/${files.length}] ${rel} :: 0 gradient`);
    } else {
      const detail = hits.map((h) => `${h.pattern} x${h.count} (vd: "${h.sample}")`).join('; ');
      log(`[FAIL] [${scanned}/${files.length}] ${rel} :: ${detail}`);
      offenders.push({ rel, hits });
    }
  }

  log('=== Tổng kết ===');
  log(`Đã quét: ${scanned} file`);
  if (offenders.length > 0) {
    const totalOccurrences = offenders.reduce(
      (sum, o) => sum + o.hits.reduce((s, h) => s + h.count, 0),
      0,
    );
    log(`[FAIL] Phát hiện gradient trong ${offenders.length} file (tổng ${totalOccurrences} occurrence):`);
    for (const o of offenders) {
      const detail = o.hits.map((h) => `${h.pattern} x${h.count}`).join('; ');
      log(`   - ${o.rel} :: ${detail}`);
    }
    log('Req 13.3 yêu cầu KHÔNG dùng gradient. Sửa source trong miniapp/ (thay bằng màu phẳng), rebuild rồi quét lại.');
    process.exitCode = 1;
    return;
  }

  log('[PASS] 0 gradient occurrence — dist/miniapp tuân thủ Req 13.3 (no-gradient).');
  process.exitCode = 0;
}

main().catch((err) => {
  log(`[FAIL] Lỗi không mong đợi khi quét :: ${err && err.stack ? err.stack : String(err)}`);
  process.exitCode = 1;
});

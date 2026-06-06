<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{
  modelValue: string
  maxLength?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const textarea = ref<HTMLTextAreaElement | null>(null)
const local = ref(props.modelValue)
const MAX = computed(() => props.maxLength ?? 3500)

watch(
  () => props.modelValue,
  (v) => {
    if (v !== local.value) local.value = v
  }
)

function onInput() {
  emit('update:modelValue', local.value)
}

/**
 * Chèn text tại vị trí con trỏ qua execCommand('insertText').
 * Cách này GIỮ NGUYÊN undo stack native của browser → Ctrl+Z / Ctrl+Shift+Z chạy chuẩn.
 * Fallback set .value thủ công nếu execCommand không khả dụng.
 */
function insertText(text: string, cursorBack = 0) {
  const el = textarea.value
  if (!el) return
  el.focus()

  const ok = document.execCommand('insertText', false, text)
  if (!ok) {
    // Fallback (hiếm): mất undo nhưng vẫn hoạt động
    const start = el.selectionStart
    const end = el.selectionEnd
    el.value = el.value.slice(0, start) + text + el.value.slice(end)
    const pos = start + text.length
    el.setSelectionRange(pos, pos)
  }

  local.value = el.value
  emit('update:modelValue', local.value)

  if (cursorBack > 0) {
    const pos = el.selectionStart - cursorBack
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }
}

/** Bọc tag quanh vùng chọn; nếu không chọn gì thì đặt con trỏ vào giữa cặp tag. */
function wrap(openTag: string, closeTag: string) {
  const el = textarea.value
  if (!el) return
  el.focus()
  const start = el.selectionStart
  const end = el.selectionEnd
  const selected = el.value.slice(start, end)

  if (selected) {
    insertText(openTag + selected + closeTag)
  } else {
    // Chèn cặp tag rỗng, đưa con trỏ vào giữa
    insertText(openTag + closeTag, closeTag.length)
  }
}

function insertLink() {
  const url = window.prompt('Nhập URL (https://...)')
  if (!url) return
  const el = textarea.value
  if (!el) return
  const start = el.selectionStart
  const end = el.selectionEnd
  const selected = el.value.slice(start, end) || 'văn bản'
  insertText(`<a href="${url}">${selected}</a>`)
}

const placeholders = [
  { key: '[content]', label: 'Nội dung acc', desc: 'Danh sách tài khoản đã mua' },
  { key: '[name]', label: 'Tên SP', desc: 'Tên loại sản phẩm' },
  { key: '[emoji]', label: 'Emoji', desc: 'Emoji loại sản phẩm' },
  { key: '[quantity]', label: 'Số lượng', desc: 'Số lượng mua' },
  { key: '[total]', label: 'Tổng tiền', desc: 'Tổng tiền (đã format)' },
  { key: '[balance]', label: 'Số dư', desc: 'Số dư còn lại' },
]

// --- Live preview: render Telegram HTML an toàn ---
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const previewHtml = computed(() => {
  const sampleContents = ['user01|pass123', 'user02|pass456', 'user03|pass789']
  const contentBlock = sampleContents
    .map((c, i) => `${i + 1}. <code>${escapeHtml(c)}</code>`)
    .join('\n')

  // Header cố định (luôn có) — khớp với backend renderSuccessMessage
  const headerRaw = [
    '✅ <b>Mua hàng thành công!</b>',
    '',
    '📦 CHATGPT × 3',
    '',
    '📋 <b>Nội dung sản phẩm:</b>',
  ].join('\n')

  // Body: template custom, hoặc body mặc định khi trống
  let bodyRaw: string
  if (local.value.trim()) {
    bodyRaw = local.value
      .replace(/\[content\]/g, contentBlock)
      .replace(/\[name\]/g, 'CHATGPT')
      .replace(/\[emoji\]/g, '📦')
      .replace(/\[quantity\]/g, '3')
      .replace(/\[total\]/g, '75,000đ')
      .replace(/\[balance\]/g, '350,000đ')
  } else {
    bodyRaw = [
      contentBlock,
      '',
      '━━━━━━━━━━━━━━━',
      '💵 Tổng tiền: 75,000đ',
      '💰 Số dư còn lại: 350,000đ',
    ].join('\n')
  }

  const raw = `${headerRaw}\n${bodyRaw}`

  let safe = escapeHtml(raw)

  const allowed = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'blockquote']
  for (const tag of allowed) {
    safe = safe
      .replace(new RegExp(`&lt;${tag}&gt;`, 'g'), `<${tag}>`)
      .replace(new RegExp(`&lt;/${tag}&gt;`, 'g'), `</${tag}>`)
  }
  safe = safe
    .replace(/&lt;tg-spoiler&gt;/g, '<span class="tg-spoiler">')
    .replace(/&lt;\/tg-spoiler&gt;/g, '</span>')
  safe = safe.replace(/&lt;a href=&quot;([^&]*)&quot;&gt;/g, '<a href="$1" target="_blank" rel="noopener">')
  safe = safe.replace(/&lt;a href="([^"]*)"&gt;/g, '<a href="$1" target="_blank" rel="noopener">')
  safe = safe.replace(/&lt;\/a&gt;/g, '</a>')
  safe = safe.replace(/\n/g, '<br>')
  return safe
})

const charCount = computed(() => local.value.length)
const overLimit = computed(() => charCount.value > MAX.value)
</script>

<template>
  <div class="tg-editor">
    <!-- Toolbar -->
    <div class="tg-toolbar">
      <div class="tg-group">
        <button type="button" class="tg-tool" title="Đậm (bao quanh <b>)" @click="wrap('<b>', '</b>')">
          <strong>B</strong>
        </button>
        <button type="button" class="tg-tool" title="Nghiêng <i>" @click="wrap('<i>', '</i>')">
          <em>I</em>
        </button>
        <button type="button" class="tg-tool" title="Gạch chân <u>" @click="wrap('<u>', '</u>')">
          <span style="text-decoration: underline">U</span>
        </button>
        <button type="button" class="tg-tool" title="Gạch ngang <s>" @click="wrap('<s>', '</s>')">
          <span style="text-decoration: line-through">S</span>
        </button>
      </div>
      <span class="tg-sep" />
      <div class="tg-group">
        <button type="button" class="tg-tool" title="Mã đơn dòng <code>" @click="wrap('<code>', '</code>')">
          <Icon name="code" :size="15" />
        </button>
        <button type="button" class="tg-tool" title="Spoiler (ẩn nội dung)" @click="wrap('<tg-spoiler>', '</tg-spoiler>')">
          <span style="font-size: 13px">🫥</span>
        </button>
        <button type="button" class="tg-tool" title="Chèn liên kết" @click="insertLink">
          <Icon name="link" :size="15" />
        </button>
      </div>
    </div>

    <!-- Placeholder chips -->
    <div class="tg-vars">
      <span class="tg-vars-label">Chèn biến</span>
      <button
        v-for="p in placeholders"
        :key="p.key"
        type="button"
        class="tg-chip"
        :title="p.desc"
        @click="insertText(p.key)"
      >
        {{ p.key }}
      </button>
    </div>

    <!-- Source textarea -->
    <textarea
      ref="textarea"
      v-model="local"
      class="tg-source"
      rows="7"
      spellcheck="false"
      placeholder="Để trống = dùng mẫu mặc định. Bôi đen rồi bấm B/I/code để định dạng, bấm [content] để chèn danh sách tài khoản…"
      @input="onInput"
    />
    <div class="tg-meta">
      <span :class="{ 'tg-over': overLimit }">{{ charCount }}/{{ MAX }}</span>
      <span class="tg-hint">Telegram HTML · Ctrl+Z hoàn tác được</span>
    </div>

    <!-- Live preview -->
    <div class="tg-preview-wrap">
      <p class="tg-preview-label">Xem trước (header tự động + nội dung của bạn)</p>
      <div class="tg-bubble">
        <div class="tg-bubble-content" v-html="previewHtml" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tg-editor {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tg-toolbar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.3rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-alt);
}
.tg-group {
  display: flex;
  gap: 0.125rem;
}
.tg-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 28px;
  padding: 0 0.4rem;
  border-radius: 5px;
  font-size: 14px;
  color: var(--ink-soft);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.tg-tool:hover {
  background: var(--border);
}
.tg-tool:active {
  background: var(--border-strong);
}
.tg-sep {
  width: 1px;
  height: 18px;
  background: var(--border-strong);
  margin: 0 0.25rem;
}

.tg-vars {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
}
.tg-vars-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--faint);
}
.tg-chip {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  border-radius: 9999px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--blue-fg);
  cursor: pointer;
  transition: all 0.12s ease;
}
.tg-chip:hover {
  background: var(--blue-bg);
  border-color: var(--blue-fg);
}

.tg-source {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.55;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  resize: vertical;
  min-height: 120px;
}
.tg-source:focus {
  outline: none;
  border-color: var(--ink);
}

.tg-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.6875rem;
  color: var(--faint);
}
.tg-over {
  color: var(--red-fg);
  font-weight: 600;
}
.tg-hint {
  font-style: italic;
}

.tg-preview-wrap {
  margin-top: 0.125rem;
}
.tg-preview-label {
  font-size: 0.6875rem;
  color: var(--muted);
  margin-bottom: 0.375rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tg-bubble {
  background: #212d3b;
  border-radius: 12px 12px 12px 4px;
  padding: 0.625rem 0.875rem;
  max-width: 100%;
}
.tg-bubble-content {
  color: #e9edf0;
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: normal;
  word-break: break-word;
}
:deep(.tg-bubble-content code) {
  font-family: var(--font-mono);
  background: rgba(255, 255, 255, 0.08);
  padding: 0.05rem 0.25rem;
  border-radius: 4px;
  font-size: 0.85em;
}
:deep(.tg-bubble-content pre) {
  font-family: var(--font-mono);
  background: rgba(255, 255, 255, 0.08);
  padding: 0.5rem;
  border-radius: 6px;
  overflow-x: auto;
}
:deep(.tg-bubble-content a) {
  color: #6ab3f3;
  text-decoration: none;
}
:deep(.tg-bubble-content .tg-spoiler) {
  background: rgba(255, 255, 255, 0.22);
  border-radius: 3px;
  filter: blur(3.5px);
  transition: filter 0.2s;
}
:deep(.tg-bubble-content .tg-spoiler:hover) {
  filter: none;
}
:deep(.tg-bubble-content blockquote) {
  border-left: 3px solid #6ab3f3;
  padding-left: 0.625rem;
  margin: 0.25rem 0;
  opacity: 0.9;
}
</style>

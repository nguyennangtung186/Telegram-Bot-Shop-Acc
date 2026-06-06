<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api/client'
import Icon from '@/components/Icon.vue'
import TelegramEditor from '@/components/TelegramEditor.vue'

interface Category {
  id: number
  name: string
  description: string | null
  price: number
  emoji: string
  sort_order: number
  is_visible: number
  success_template: string | null
  available_count: number
  total_count: number
  created_at: string
  updated_at: string
}

interface CategoryForm {
  name: string
  description: string
  price: number | null
  emoji: string
  is_visible: number
  success_template: string
}

const categories = ref<Category[]>([])
const loading = ref(false)
const error = ref('')
const successMsg = ref('')

// Modal state
const showModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingId = ref<number | null>(null)
const formError = ref('')
const saving = ref(false)

const form = ref<CategoryForm>({
  name: '',
  description: '',
  price: null,
  emoji: '',
  is_visible: 1,
  success_template: '',
})

// Delete confirmation
const showDeleteConfirm = ref(false)
const deletingCategory = ref<Category | null>(null)
const deleting = ref(false)

onMounted(() => {
  fetchCategories()
})

async function fetchCategories() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.get<Category[]>('/product-types?sort=sort_order&order=asc&limit=100')
    if (res.success && res.data) {
      categories.value = res.data
    } else {
      error.value = res.error || 'Không thể tải danh sách'
    }
  } catch {
    error.value = 'Lỗi kết nối server'
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  modalMode.value = 'create'
  editingId.value = null
  form.value = { name: '', description: '', price: null, emoji: '', is_visible: 1, success_template: '' }
  formError.value = ''
  showModal.value = true
}

function openEditModal(cat: Category) {
  modalMode.value = 'edit'
  editingId.value = cat.id
  form.value = {
    name: cat.name,
    description: cat.description || '',
    price: cat.price,
    emoji: cat.emoji,
    is_visible: cat.is_visible,
    success_template: cat.success_template || '',
  }
  formError.value = ''
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  formError.value = ''
}

async function saveCategory() {
  formError.value = ''

  // Client validation
  if (!form.value.name.trim()) {
    formError.value = 'Tên không được để trống'
    return
  }
  if (form.value.name.trim().length > 100) {
    formError.value = 'Tên tối đa 100 ký tự'
    return
  }
  if (form.value.description.length > 500) {
    formError.value = 'Mô tả tối đa 500 ký tự'
    return
  }
  if (!form.value.price || form.value.price < 1000 || form.value.price > 999999999) {
    formError.value = 'Giá phải từ 1,000 đến 999,999,999'
    return
  }
  if (form.value.success_template.length > 3500) {
    formError.value = 'Template tin nhắn tối đa 3500 ký tự'
    return
  }

  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
      price: form.value.price,
      emoji: form.value.emoji.trim() || '',
      is_visible: form.value.is_visible,
      success_template: form.value.success_template.trim() || null,
    }

    let res
    if (modalMode.value === 'create') {
      res = await api.post<Category>('/product-types', payload)
    } else {
      res = await api.put<Category>(`/product-types/${editingId.value}`, payload)
    }

    if (res.success) {
      showModal.value = false
      showSuccess(modalMode.value === 'create' ? 'Tạo category thành công' : 'Cập nhật thành công')
      await fetchCategories()
    } else {
      formError.value = res.error || 'Có lỗi xảy ra'
    }
  } catch {
    formError.value = 'Lỗi kết nối server'
  } finally {
    saving.value = false
  }
}

function confirmDelete(cat: Category) {
  deletingCategory.value = cat
  showDeleteConfirm.value = true
}

async function deleteCategory() {
  if (!deletingCategory.value) return
  deleting.value = true
  try {
    const res = await api.delete<{ id: number }>(`/product-types/${deletingCategory.value.id}`)
    if (res.success) {
      showDeleteConfirm.value = false
      deletingCategory.value = null
      showSuccess('Xoá category thành công')
      await fetchCategories()
    } else {
      error.value = res.error || 'Không thể xoá'
      showDeleteConfirm.value = false
    }
  } catch {
    error.value = 'Lỗi kết nối server'
    showDeleteConfirm.value = false
  } finally {
    deleting.value = false
  }
}

async function toggleVisibility(cat: Category) {
  const newValue = cat.is_visible ? 0 : 1
  try {
    const res = await api.put<Category>(`/product-types/${cat.id}`, { is_visible: newValue })
    if (res.success) {
      cat.is_visible = newValue
    } else {
      error.value = res.error || 'Không thể thay đổi trạng thái'
    }
  } catch {
    error.value = 'Lỗi kết nối server'
  }
}

async function moveUp(index: number) {
  if (index <= 0) return
  await swapSortOrder(index, index - 1)
}

async function moveDown(index: number) {
  if (index >= categories.value.length - 1) return
  await swapSortOrder(index, index + 1)
}

async function swapSortOrder(indexA: number, indexB: number) {
  const catA = categories.value[indexA]
  const catB = categories.value[indexB]

  const orderA = catA.sort_order
  const orderB = catB.sort_order

  // If same sort_order, use index as tie-breaker
  const newOrderA = orderB === orderA ? indexB : orderB
  const newOrderB = orderB === orderA ? indexA : orderA

  try {
    const [resA, resB] = await Promise.all([
      api.put<Category>(`/product-types/${catA.id}`, { sort_order: newOrderA }),
      api.put<Category>(`/product-types/${catB.id}`, { sort_order: newOrderB }),
    ])

    if (resA.success && resB.success) {
      await fetchCategories()
    } else {
      error.value = 'Không thể thay đổi thứ tự'
    }
  } catch {
    error.value = 'Lỗi kết nối server'
  }
}

function formatPrice(price: number): string {
  return price.toLocaleString('vi-VN') + 'đ'
}

function showSuccess(msg: string) {
  successMsg.value = msg
  setTimeout(() => { successMsg.value = '' }, 3000)
}
</script>

<template>
  <div class="animate-in">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="page-title">Danh mục</h1>
        <p class="page-subtitle">Quản lý loại sản phẩm</p>
      </div>
      <button class="btn btn-primary" @click="openCreateModal">
        <Icon name="plus" :size="16" />
        Thêm danh mục
      </button>
    </div>

    <!-- Success toast -->
    <div v-if="successMsg" class="toast toast-success">
      <Icon name="check" :size="16" />
      <span>{{ successMsg }}</span>
    </div>

    <!-- Error toast -->
    <div v-if="error" class="toast toast-error">
      <Icon name="warning" :size="16" />
      <span class="flex-1">{{ error }}</span>
      <button class="toast-close" @click="error = ''" aria-label="Đóng">
        <Icon name="close" :size="14" />
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="state-block">
      <Icon name="refresh" :size="20" />
      <span>Đang tải...</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="categories.length === 0" class="state-block state-empty">
      <Icon name="package" :size="48" />
      <p>Chưa có danh mục nào. Bấm "Thêm danh mục" để bắt đầu.</p>
    </div>

    <!-- Categories table -->
    <div v-else class="card overflow-hidden">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 64px">Thứ tự</th>
            <th>Tên</th>
            <th>Giá</th>
            <th style="text-align: center">Tồn kho</th>
            <th style="text-align: center">Hiển thị</th>
            <th style="text-align: right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(cat, index) in categories" :key="cat.id" class="row-hover">
            <!-- Sort order buttons -->
            <td>
              <div class="reorder">
                <button
                  class="btn btn-ghost btn-icon"
                  :disabled="index === 0"
                  title="Lên"
                  @click="moveUp(index)"
                >
                  <Icon name="chevronRight" :size="16" :style="{ transform: 'rotate(-90deg)' }" />
                </button>
                <button
                  class="btn btn-ghost btn-icon"
                  :disabled="index === categories.length - 1"
                  title="Xuống"
                  @click="moveDown(index)"
                >
                  <Icon name="chevronRight" :size="16" :style="{ transform: 'rotate(90deg)' }" />
                </button>
              </div>
            </td>

            <!-- Name + emoji -->
            <td>
              <div class="name-cell">
                <span class="emoji-box">{{ cat.emoji }}</span>
                <div class="name-text">
                  <p class="name-title">{{ cat.name }}</p>
                  <p v-if="cat.description" class="name-desc">{{ cat.description }}</p>
                </div>
              </div>
            </td>

            <!-- Price -->
            <td class="price-cell">{{ formatPrice(cat.price) }}</td>

            <!-- Stock -->
            <td style="text-align: center">
              <span class="badge" :class="cat.available_count > 0 ? 'badge-green' : 'badge-red'">
                {{ cat.available_count }}/{{ cat.total_count }}
              </span>
            </td>

            <!-- Visibility toggle -->
            <td style="text-align: center">
              <button
                type="button"
                class="toggle"
                :class="{ 'is-on': cat.is_visible }"
                role="switch"
                :aria-checked="!!cat.is_visible"
                title="Bật/tắt hiển thị"
                @click="toggleVisibility(cat)"
              >
                <span class="toggle-knob" />
              </button>
            </td>

            <!-- Actions -->
            <td>
              <div class="actions-cell">
                <button class="btn btn-ghost btn-sm" @click="openEditModal(cat)">
                  <Icon name="edit" :size="15" />
                  Sửa
                </button>
                <button
                  class="btn btn-ghost btn-sm"
                  :style="{ color: 'var(--red-fg)' }"
                  @click="confirmDelete(cat)"
                >
                  <Icon name="trash" :size="15" />
                  Xoá
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create/Edit Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="cat-modal">
        <!-- Sticky header -->
        <header class="cat-modal-head">
          <h2 class="cat-modal-title">
            {{ modalMode === 'create' ? 'Thêm danh mục mới' : 'Chỉnh sửa danh mục' }}
          </h2>
          <button type="button" class="btn btn-ghost btn-icon" @click="closeModal" aria-label="Đóng">
            <Icon name="close" :size="18" />
          </button>
        </header>

        <form class="cat-modal-body" @submit.prevent="saveCategory">
          <div v-if="formError" class="toast toast-error">
            <Icon name="warning" :size="16" />
            <span>{{ formError }}</span>
          </div>

          <!-- Emoji + Name -->
          <div class="field-row">
            <div class="field-col" style="flex: 0 0 72px">
              <label class="label">Emoji</label>
              <input
                v-model="form.emoji"
                type="text"
                class="field field-emoji"
                placeholder="📦"
              />
            </div>
            <div class="field-col" style="flex: 1">
              <label class="label">Tên danh mục *</label>
              <input
                v-model="form.name"
                type="text"
                required
                maxlength="100"
                class="field"
                placeholder="VD: Gmail cổ, Outlook…"
              />
            </div>
          </div>

          <!-- Description -->
          <div class="field-col">
            <label class="label">Mô tả</label>
            <textarea
              v-model="form.description"
              rows="2"
              maxlength="500"
              class="field"
              style="resize: none"
              placeholder="Mô tả ngắn về loại sản phẩm…"
            />
            <p class="char-count">{{ form.description.length }}/500</p>
          </div>

          <!-- Price + Visibility -->
          <div class="field-row field-row-bottom">
            <div class="field-col" style="flex: 1">
              <label class="label">Giá (VNĐ) *</label>
              <input
                v-model.number="form.price"
                type="number"
                required
                min="1000"
                max="999999999"
                step="1000"
                class="field"
                placeholder="50000"
              />
            </div>
            <div class="visibility-box">
              <span class="label" style="margin-bottom: 0">Hiển thị trên bot</span>
              <button
                type="button"
                class="toggle"
                :class="{ 'is-on': form.is_visible }"
                role="switch"
                :aria-checked="!!form.is_visible"
                @click="form.is_visible = form.is_visible ? 0 : 1"
              >
                <span class="toggle-knob" />
              </button>
            </div>
          </div>

          <!-- Success message template -->
          <div class="field-col tpl-section">
            <label class="label">Tin nhắn khi mua thành công</label>
            <p class="tpl-help">
              Phần header (✅ Mua hàng thành công + tên SP + 📋 Nội dung) luôn tự động hiển thị.
              Đây là phần <b>thân</b> bên dưới. Để trống = mẫu mặc định. Dùng <code>[content]</code> để chèn danh sách tài khoản.
            </p>
            <TelegramEditor v-model="form.success_template" />
          </div>
        </form>

        <!-- Sticky footer -->
        <footer class="cat-modal-foot">
          <button type="button" class="btn btn-secondary" @click="closeModal">Huỷ</button>
          <button type="button" class="btn btn-primary" :disabled="saving" @click="saveCategory">
            {{ saving ? 'Đang lưu…' : (modalMode === 'create' ? 'Tạo mới' : 'Lưu thay đổi') }}
          </button>
        </footer>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = false">
      <div class="card modal-panel" style="max-width: 24rem; padding: 1.5rem">
        <h2 class="modal-title">Xác nhận xoá</h2>
        <p class="confirm-text">
          Bạn có chắc muốn xoá danh mục
          <strong>{{ deletingCategory?.emoji }} {{ deletingCategory?.name }}</strong>?
        </p>
        <div
          v-if="deletingCategory && deletingCategory.available_count > 0"
          class="warning-line"
        >
          <Icon name="warning" :size="16" :style="{ color: 'var(--yellow-fg)', flexShrink: 0 }" />
          <span>
            Danh mục này còn {{ deletingCategory.available_count }} sản phẩm khả dụng. Cần xoá hết
            sản phẩm trước.
          </span>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showDeleteConfirm = false">
            Huỷ
          </button>
          <button class="btn btn-danger" :disabled="deleting" @click="deleteCategory">
            {{ deleting ? 'Đang xoá...' : 'Xoá' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.page-subtitle {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: var(--muted);
}

/* ---- Toasts ---- */
.toast {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 500;
  padding: 0.625rem 0.875rem;
  border-radius: var(--radius);
  margin-bottom: 1rem;
}
.toast-success {
  background: var(--green-bg);
  color: var(--green-fg);
}
.toast-error {
  background: var(--red-bg);
  color: var(--red-fg);
}
.toast-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.125rem;
  border-radius: 4px;
  color: inherit;
  opacity: 0.7;
}
.toast-close:hover {
  opacity: 1;
}

/* ---- State blocks ---- */
.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  color: var(--muted);
  font-size: 0.875rem;
}
.state-empty {
  color: var(--faint);
}

/* ---- Emoji box (user content) ---- */
.emoji-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  font-size: 18px;
  line-height: 1;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-alt);
  flex-shrink: 0;
}
.emoji-box-lg {
  width: 56px;
  height: 56px;
  font-size: 28px;
  border-radius: var(--radius-lg);
}

/* ---- Reorder column ---- */
.reorder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
}

/* ---- Name cell ---- */
.name-cell {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.name-text {
  min-width: 0;
}
.name-title {
  font-weight: 500;
  color: var(--ink);
}
.name-desc {
  margin-top: 0.125rem;
  font-size: 0.75rem;
  color: var(--muted);
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.price-cell {
  font-weight: 500;
  color: var(--ink);
}

/* ---- Actions ---- */
.actions-cell {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
}

/* ---- Toggle switch ---- */
.toggle {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  border-radius: 9999px;
  background: var(--border-strong);
  border: none;
  padding: 0;
  cursor: pointer;
  transition: background-color 0.15s ease;
  flex-shrink: 0;
  vertical-align: middle;
}
.toggle.is-on {
  background: var(--accent);
}
.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  background: #fff;
  transition: transform 0.15s ease;
}
.toggle.is-on .toggle-knob {
  transform: translateX(16px);
}

/* ---- Modals ---- */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.4);
}
.modal-panel {
  width: 100%;
}
.modal-title {
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 1rem;
}

/* ---- Category create/edit modal (sticky head/foot, scroll body) ---- */
.cat-modal {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 40rem;
  max-height: 90vh;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.cat-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.cat-modal-title {
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--ink);
}
.cat-modal-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  overflow-y: auto;
}
.cat-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.875rem 1.25rem;
  border-top: 1px solid var(--border);
  background: var(--surface-alt);
  flex-shrink: 0;
}

.field-row {
  display: flex;
  gap: 0.875rem;
}
.field-row-bottom {
  align-items: flex-end;
}
.field-col {
  display: flex;
  flex-direction: column;
}
.field-emoji {
  text-align: center;
  font-size: 1.25rem;
}
.char-count {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--faint);
  align-self: flex-end;
}
.tpl-section {
  border-top: 1px solid var(--border);
  padding-top: 1rem;
}
.tpl-help {
  font-size: 0.75rem;
  color: var(--muted);
  margin-bottom: 0.625rem;
  line-height: 1.4;
}
.tpl-help code {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  background: var(--surface-alt);
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  color: var(--blue-fg);
}
.visibility-box {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  height: 38px;
  padding: 0 0.875rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-alt);
  white-space: nowrap;
}
.confirm-text {
  font-size: 0.875rem;
  color: var(--ink-soft);
  margin-bottom: 1rem;
}
.confirm-text strong {
  color: var(--ink);
  font-weight: 600;
}
.warning-line {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--yellow-fg);
  background: var(--yellow-bg);
  border-radius: var(--radius);
  padding: 0.625rem 0.75rem;
  margin-bottom: 1rem;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 0.5rem;
}
</style>

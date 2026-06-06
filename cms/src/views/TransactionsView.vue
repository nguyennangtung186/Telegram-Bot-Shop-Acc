<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, getToken } from '@/api/client'
import Icon from '@/components/Icon.vue'

interface Transaction {
  id: number
  user_id: number
  type: string
  amount: number
  balance_before: number
  balance_after: number
  reference_type: string | null
  reference_id: number | null
  description: string | null
  status: string
  created_at: string
  telegram_id: number
  username: string | null
  first_name: string | null
}

const transactions = ref<Transaction[]>([])
const loading = ref(false)
const exporting = ref(false)

// Pagination
const page = ref(1)
const limit = ref(20)
const total = ref(0)

// Filters
const filterType = ref('')
const filterDateFrom = ref('')
const filterDateTo = ref('')

const totalPages = () => Math.ceil(total.value / limit.value) || 1

async function loadTransactions() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('page', String(page.value))
    params.set('limit', String(limit.value))
    params.set('order', 'desc')
    params.set('sort', 'created_at')

    if (filterType.value) params.set('type', filterType.value)
    if (filterDateFrom.value) params.set('from', filterDateFrom.value)
    if (filterDateTo.value) params.set('to', filterDateTo.value)

    const res = await api.get<Transaction[]>(`/transactions?${params.toString()}`)
    if (res.success && res.data) {
      transactions.value = res.data
      total.value = res.meta?.total || 0
    }
  } finally {
    loading.value = false
  }
}

async function exportCSV() {
  exporting.value = true
  try {
    const params = new URLSearchParams()
    if (filterType.value) params.set('type', filterType.value)
    if (filterDateFrom.value) params.set('from', filterDateFrom.value)
    if (filterDateTo.value) params.set('to', filterDateTo.value)

    const token = getToken()
    const response = await fetch(`/api/admin/transactions/export?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error('Export failed')
    }

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Export CSV error:', err)
    alert('Không thể xuất CSV. Vui lòng thử lại.')
  } finally {
    exporting.value = false
  }
}

function applyFilters() {
  page.value = 1
  loadTransactions()
}

function clearFilters() {
  filterType.value = ''
  filterDateFrom.value = ''
  filterDateTo.value = ''
  page.value = 1
  loadTransactions()
}

function goToPage(p: number) {
  page.value = p
  loadTransactions()
}

function formatCurrency(amount: number): string {
  const absAmount = Math.abs(amount)
  const prefix = amount < 0 ? '-' : '+'
  return `${prefix}${absAmount.toLocaleString('vi-VN')}đ`
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

function typeBadge(type: string) {
  switch (type) {
    case 'deposit':
      return 'badge-green'
    case 'purchase':
      return 'badge-blue'
    case 'refund':
      return 'badge-yellow'
    case 'adjustment':
      return 'badge-gray'
    default:
      return 'badge-gray'
  }
}

function typeLabel(type: string) {
  switch (type) {
    case 'deposit':
      return 'Nạp tiền'
    case 'purchase':
      return 'Mua hàng'
    case 'refund':
      return 'Hoàn tiền'
    case 'adjustment':
      return 'Điều chỉnh'
    default:
      return type
  }
}

function amountClass(amount: number) {
  return amount >= 0 ? 'amount-pos' : 'amount-neg'
}

onMounted(() => {
  loadTransactions()
})
</script>

<template>
  <div class="animate-in">
    <!-- Header -->
    <div class="page-head">
      <div>
        <h1 class="page-title">Giao dịch</h1>
        <p class="page-subtitle">Tổng {{ total }} giao dịch</p>
      </div>
      <button class="btn btn-primary" :disabled="exporting" @click="exportCSV">
        <Icon name="download" :size="16" />
        {{ exporting ? 'Đang xuất…' : 'Export CSV' }}
      </button>
    </div>

    <!-- Filters -->
    <div class="filters">
      <div class="field-wrap">
        <select v-model="filterType" class="field">
          <option value="">Tất cả loại</option>
          <option value="deposit">Nạp tiền</option>
          <option value="purchase">Mua hàng</option>
          <option value="refund">Hoàn tiền</option>
          <option value="adjustment">Điều chỉnh</option>
        </select>
      </div>

      <div class="field-wrap">
        <input v-model="filterDateFrom" type="date" class="field" />
      </div>

      <div class="field-wrap">
        <input v-model="filterDateTo" type="date" class="field" />
      </div>

      <div class="filter-actions">
        <button class="btn btn-primary" @click="applyFilters">
          <Icon name="search" :size="16" />
          Lọc
        </button>
        <button class="btn btn-secondary" @click="clearFilters">Xoá</button>
      </div>
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <!-- Loading -->
      <div v-if="loading" class="state-block">
        <div class="spinner"></div>
        <span>Đang tải…</span>
      </div>

      <!-- Empty -->
      <div v-else-if="transactions.length === 0" class="state-block state-empty">
        <Icon name="receipt" :size="32" />
        <p>Không có giao dịch nào</p>
      </div>

      <!-- Data -->
      <table v-else class="data-table">
        <thead>
          <tr>
            <th style="width: 64px">ID</th>
            <th>Người dùng</th>
            <th>Loại</th>
            <th>Số tiền</th>
            <th>Số dư trước</th>
            <th>Số dư sau</th>
            <th>Mô tả</th>
            <th>Thời gian</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tx in transactions" :key="tx.id">
            <td class="mono faint">#{{ tx.id }}</td>
            <td>
              <div class="ink">{{ tx.first_name || tx.username || '—' }}</div>
              <div class="muted">ID: {{ tx.telegram_id }}</div>
            </td>
            <td>
              <span class="badge" :class="typeBadge(tx.type)">
                {{ typeLabel(tx.type) }}
              </span>
            </td>
            <td class="amount-cell" :class="amountClass(tx.amount)">
              {{ formatCurrency(tx.amount) }}
            </td>
            <td class="muted">{{ tx.balance_before.toLocaleString('vi-VN') }}đ</td>
            <td class="muted">{{ tx.balance_after.toLocaleString('vi-VN') }}đ</td>
            <td class="muted desc-cell" :title="tx.description || ''">
              {{ tx.description || '—' }}
            </td>
            <td class="muted nowrap">{{ formatDate(tx.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="total > limit" class="pagination">
      <p class="page-info">
        Trang {{ page }} / {{ totalPages() }} — Tổng {{ total }} giao dịch
      </p>
      <div class="page-actions">
        <button
          class="btn btn-secondary btn-sm"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >
          <Icon name="arrowLeft" :size="15" />
          Trước
        </button>
        <button
          class="btn btn-secondary btn-sm"
          :disabled="page >= totalPages()"
          @click="goToPage(page + 1)"
        >
          Sau
          <Icon name="arrowRight" :size="15" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}
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

/* ---- Filters ---- */
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.field-wrap {
  min-width: 180px;
}
.filter-actions {
  display: flex;
  gap: 0.5rem;
}

/* ---- Table cells ---- */
.ink {
  color: var(--ink);
}
.muted {
  color: var(--muted);
  font-size: 0.75rem;
}
.faint {
  color: var(--faint);
}
.nowrap {
  white-space: nowrap;
}
.amount-cell {
  font-weight: 500;
}
.amount-pos {
  color: var(--green-fg);
}
.amount-neg {
  color: var(--red-fg);
}
.desc-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* ---- CSS border spinner ---- */
.spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--ink);
  border-radius: 9999px;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}

/* ---- Pagination ---- */
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 1rem;
}
.page-info {
  font-size: 0.8125rem;
  color: var(--muted);
}
.page-actions {
  display: flex;
  gap: 0.5rem;
}
</style>

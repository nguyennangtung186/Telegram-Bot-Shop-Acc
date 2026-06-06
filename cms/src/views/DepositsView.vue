<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { api } from '@/api/client'
import Icon from '@/components/Icon.vue'

interface Deposit {
  id: number
  user_id: number
  transfer_code: string
  amount: number
  status: 'pending' | 'completed' | 'expired' | 'cancelled'
  sepay_transaction_id: string | null
  bank_ref: string | null
  completed_at: string | null
  expired_at: string | null
  created_at: string
  telegram_id: number | null
  username: string | null
}

const deposits = ref<Deposit[]>([])
const loading = ref(false)
const error = ref('')
const statusFilter = ref('')
const page = ref(1)
const limit = ref(20)
const total = ref(0)

const approvingId = ref<number | null>(null)
const approveError = ref('')
const approveSuccess = ref('')

const selectedDeposit = ref<Deposit | null>(null)

const statusOptions = [
  { value: '', label: 'Tất cả' },
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'cancelled', label: 'Đã huỷ' },
]

const totalPages = () => Math.ceil(total.value / limit.value)

function formatCurrency(amount: number): string {
  return amount.toLocaleString('vi-VN') + 'đ'
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function statusBadge(status: string): string {
  switch (status) {
    case 'pending': return 'badge-yellow'
    case 'completed': return 'badge-green'
    case 'expired': return 'badge-gray'
    case 'cancelled': return 'badge-red'
    default: return 'badge-gray'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Chờ duyệt'
    case 'completed': return 'Hoàn thành'
    case 'expired': return 'Hết hạn'
    case 'cancelled': return 'Đã huỷ'
    default: return status
  }
}

async function fetchDeposits() {
  loading.value = true
  error.value = ''
  try {
    let path = `/deposits?page=${page.value}&limit=${limit.value}`
    if (statusFilter.value) path += `&status=${statusFilter.value}`
    const res = await api.get<Deposit[]>(path)
    if (res.success && res.data) {
      deposits.value = res.data
      total.value = res.meta?.total ?? 0
    } else {
      error.value = res.error || 'Không thể tải danh sách'
    }
  } catch {
    error.value = 'Lỗi kết nối server'
  } finally {
    loading.value = false
  }
}

async function approveDeposit(deposit: Deposit) {
  if (approvingId.value) return
  approvingId.value = deposit.id
  approveError.value = ''
  approveSuccess.value = ''
  try {
    const res = await api.post<{ deposit_id: number; new_balance: number; approved_at: string }>(
      `/deposits/${deposit.id}/approve`
    )
    if (res.success && res.data) {
      approveSuccess.value = `Duyệt thành công! Số dư mới: ${formatCurrency(res.data.new_balance)}`
      selectedDeposit.value = null
      await fetchDeposits()
    } else {
      approveError.value = res.error || 'Duyệt thất bại'
    }
  } catch {
    approveError.value = 'Lỗi kết nối server'
  } finally {
    approvingId.value = null
  }
}

function goToPage(p: number) {
  if (p < 1 || p > totalPages()) return
  page.value = p
}

function openDetail(deposit: Deposit) {
  selectedDeposit.value = deposit
}
function closeDetail() {
  selectedDeposit.value = null
}

watch(statusFilter, () => {
  page.value = 1
  fetchDeposits()
})
watch(page, () => {
  fetchDeposits()
})
onMounted(() => {
  fetchDeposits()
})
</script>

<template>
  <div class="animate-in">
    <!-- Header -->
    <div class="mb-5">
      <p class="text-[13px]" style="color: var(--muted)">Quản lý nạp tiền · Tổng {{ total }}</p>
    </div>

    <!-- Alerts -->
    <div
      v-if="approveSuccess"
      class="mb-4 flex items-center gap-2 rounded-md px-3 py-2.5 text-[13px]"
      style="background: var(--green-bg); color: var(--green-fg)"
    >
      <Icon name="check" :size="16" />
      <span class="flex-1">{{ approveSuccess }}</span>
      <button class="opacity-70 hover:opacity-100" @click="approveSuccess = ''"><Icon name="close" :size="14" /></button>
    </div>
    <div
      v-if="approveError"
      class="mb-4 flex items-center gap-2 rounded-md px-3 py-2.5 text-[13px]"
      style="background: var(--red-bg); color: var(--red-fg)"
    >
      <Icon name="warning" :size="16" />
      <span class="flex-1">{{ approveError }}</span>
      <button class="opacity-70 hover:opacity-100" @click="approveError = ''"><Icon name="close" :size="14" /></button>
    </div>

    <!-- Filter -->
    <div class="mb-4 flex items-center gap-2.5">
      <span class="text-[13px]" style="color: var(--muted)">Trạng thái</span>
      <select v-model="statusFilter" class="field" style="width: auto; min-width: 160px">
        <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <div v-if="error" class="mb-4 rounded-md px-3 py-2.5 text-[13px]" style="background: var(--red-bg); color: var(--red-fg)">
      {{ error }}
    </div>

    <!-- Table -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="flex flex-col items-center justify-center gap-3 py-12 text-[13px]" style="color: var(--muted)">
        <div class="spinner" />
        <span>Đang tải…</span>
      </div>

      <div
        v-else-if="deposits.length === 0"
        class="flex flex-col items-center justify-center gap-3 py-12 text-[13px]"
        style="color: var(--faint)"
      >
        <Icon name="wallet" :size="32" />
        <p>Không có giao dịch nạp nào.</p>
      </div>

      <table v-else class="data-table">
        <thead>
          <tr>
            <th style="width: 56px">ID</th>
            <th>User</th>
            <th>Mã CK</th>
            <th class="text-right">Số tiền</th>
            <th>Trạng thái</th>
            <th>Thời gian</th>
            <th class="text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="deposit in deposits" :key="deposit.id">
            <td class="mono" style="color: var(--faint)">#{{ deposit.id }}</td>
            <td>
              <div style="color: var(--ink)">{{ deposit.username || '—' }}</div>
              <div class="text-xs" style="color: var(--muted)">ID: {{ deposit.telegram_id || deposit.user_id }}</div>
            </td>
            <td><span class="chip-code">{{ deposit.transfer_code }}</span></td>
            <td class="text-right" style="font-weight: 500; color: var(--ink)">{{ formatCurrency(deposit.amount) }}</td>
            <td><span class="badge" :class="statusBadge(deposit.status)">{{ statusLabel(deposit.status) }}</span></td>
            <td class="text-xs" style="color: var(--muted); white-space: nowrap">{{ formatDate(deposit.created_at) }}</td>
            <td class="text-right">
              <div class="flex items-center justify-end gap-1.5">
                <button class="btn btn-ghost btn-sm" @click="openDetail(deposit)">Chi tiết</button>
                <button
                  v-if="deposit.status === 'pending'"
                  class="btn btn-primary btn-sm"
                  :disabled="approvingId === deposit.id"
                  @click="approveDeposit(deposit)"
                >
                  <Icon name="check" :size="14" />
                  {{ approvingId === deposit.id ? '...' : 'Duyệt' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div
        v-if="totalPages() > 1"
        class="flex items-center justify-between px-4 py-3"
        style="border-top: 1px solid var(--border)"
      >
        <span class="text-[13px]" style="color: var(--muted)">Trang {{ page }} / {{ totalPages() }}</span>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" :disabled="page <= 1" @click="goToPage(page - 1)">
            <Icon name="arrowLeft" :size="14" /> Trước
          </button>
          <button class="btn btn-secondary btn-sm" :disabled="page >= totalPages()" @click="goToPage(page + 1)">
            Sau <Icon name="arrowRight" :size="14" />
          </button>
        </div>
      </div>
    </div>

    <!-- Detail Modal -->
    <div
      v-if="selectedDeposit"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      style="background: rgba(0, 0, 0, 0.4)"
      @click.self="closeDetail"
    >
      <div class="card w-full max-w-md p-6">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-base font-semibold" style="color: var(--ink)">Chi tiết nạp #{{ selectedDeposit.id }}</h2>
          <button class="btn btn-ghost btn-icon" @click="closeDetail"><Icon name="close" :size="18" /></button>
        </div>

        <dl class="space-y-2.5 text-[13px]">
          <div class="flex items-center justify-between">
            <dt style="color: var(--muted)">Mã chuyển khoản</dt>
            <dd><span class="chip-code">{{ selectedDeposit.transfer_code }}</span></dd>
          </div>
          <div class="flex items-center justify-between">
            <dt style="color: var(--muted)">Số tiền</dt>
            <dd style="font-weight: 600; color: var(--ink)">{{ formatCurrency(selectedDeposit.amount) }}</dd>
          </div>
          <div class="flex items-center justify-between">
            <dt style="color: var(--muted)">Trạng thái</dt>
            <dd><span class="badge" :class="statusBadge(selectedDeposit.status)">{{ statusLabel(selectedDeposit.status) }}</span></dd>
          </div>
          <div class="flex items-center justify-between">
            <dt style="color: var(--muted)">User</dt>
            <dd style="color: var(--ink-soft)">{{ selectedDeposit.username || '—' }} ({{ selectedDeposit.telegram_id || selectedDeposit.user_id }})</dd>
          </div>
          <div class="flex items-center justify-between">
            <dt style="color: var(--muted)">SePay TX ID</dt>
            <dd class="mono text-xs" style="color: var(--ink-soft)">{{ selectedDeposit.sepay_transaction_id || '—' }}</dd>
          </div>
          <div class="flex items-center justify-between">
            <dt style="color: var(--muted)">Bank Ref</dt>
            <dd class="mono text-xs" style="color: var(--ink-soft)">{{ selectedDeposit.bank_ref || '—' }}</dd>
          </div>
          <div style="border-top: 1px solid var(--border); padding-top: 0.625rem">
            <div class="flex items-center justify-between">
              <dt style="color: var(--muted)">Tạo lúc</dt>
              <dd style="color: var(--ink-soft)">{{ formatDate(selectedDeposit.created_at) }}</dd>
            </div>
          </div>
          <div v-if="selectedDeposit.completed_at" class="flex items-center justify-between">
            <dt style="color: var(--muted)">Hoàn thành lúc</dt>
            <dd style="color: var(--ink-soft)">{{ formatDate(selectedDeposit.completed_at) }}</dd>
          </div>
          <div v-if="selectedDeposit.expired_at" class="flex items-center justify-between">
            <dt style="color: var(--muted)">Hết hạn lúc</dt>
            <dd style="color: var(--ink-soft)">{{ formatDate(selectedDeposit.expired_at) }}</dd>
          </div>
        </dl>

        <div v-if="selectedDeposit.status === 'pending'" class="mt-5 pt-4" style="border-top: 1px solid var(--border)">
          <button class="btn btn-primary w-full" :disabled="approvingId === selectedDeposit.id" @click="approveDeposit(selectedDeposit)">
            <Icon name="check" :size="16" />
            {{ approvingId === selectedDeposit.id ? 'Đang duyệt…' : 'Duyệt thủ công' }}
          </button>
          <p class="mt-2 text-center text-xs" style="color: var(--faint)">
            Chỉ dùng khi webhook SePay bị miss. Flow chính là tự động.
          </p>
        </div>

        <button class="btn btn-secondary mt-4 w-full" @click="closeDetail">Đóng</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--ink);
  border-radius: 9999px;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>

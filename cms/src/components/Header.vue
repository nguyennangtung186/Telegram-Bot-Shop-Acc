<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { removeToken } from '@/api/client'
import Icon from './Icon.vue'

defineEmits<{ toggleSidebar: [] }>()

const router = useRouter()
const route = useRoute()

const TITLES: Record<string, string> = {
  dashboard: 'Tổng quan',
  users: 'Người dùng',
  categories: 'Danh mục',
  products: 'Sản phẩm',
  orders: 'Đơn hàng',
  transactions: 'Giao dịch',
  deposits: 'Nạp tiền',
  config: 'Cấu hình & Báo cáo',
}

const pageTitle = computed(() => TITLES[route.name as string] || 'Shop Admin')

function logout() {
  removeToken()
  router.push('/login')
}
</script>

<template>
  <header
    class="sticky top-0 z-20 flex h-16 items-center gap-3 px-5 sm:px-8"
    style="background: rgba(251, 251, 250, 0.8); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border)"
  >
    <button class="btn btn-ghost btn-icon lg:hidden" @click="$emit('toggleSidebar')">
      <Icon name="menu" :size="20" />
    </button>

    <h1 class="text-[15px] font-semibold tracking-tight" style="color: var(--ink)">
      {{ pageTitle }}
    </h1>

    <div class="flex-1" />

    <div class="flex items-center gap-2">
      <div class="hidden items-center gap-2 rounded-md px-2.5 py-1.5 sm:flex" style="background: var(--surface-alt)">
        <div class="flex h-6 w-6 items-center justify-center rounded-full text-white" style="background: var(--accent)">
          <Icon name="user" :size="14" />
        </div>
        <span class="text-[13px] font-medium" style="color: var(--ink-soft)">admin</span>
      </div>
      <button class="btn btn-secondary btn-sm" @click="logout">
        <Icon name="logout" :size="15" />
        <span class="hidden sm:inline">Đăng xuất</span>
      </button>
    </div>
  </header>
</template>

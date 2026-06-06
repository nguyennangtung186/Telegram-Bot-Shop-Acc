<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, setToken } from '@/api/client'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    const res = await api.post<{ token: string }>('/auth/login', {
      username: username.value,
      password: password.value,
    })
    if (res.success && res.data) {
      setToken(res.data.token)
      router.push('/')
    } else {
      error.value = res.error || 'Đăng nhập thất bại'
    }
  } catch {
    error.value = 'Không thể kết nối máy chủ'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4" style="background: var(--canvas)">
    <!-- Ambient soft spot -->
    <div
      class="pointer-events-none fixed inset-0"
      style="background: radial-gradient(600px circle at 50% 30%, rgba(17,17,17,0.025), transparent 70%)"
    />

    <div class="animate-in relative w-full max-w-[380px]">
      <!-- Brand mark -->
      <div class="mb-8 flex flex-col items-center text-center">
        <div
          class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-white"
          style="background: var(--accent)"
        >
          <Icon name="store" :size="24" />
        </div>
        <h1 class="text-xl font-semibold tracking-tight" style="color: var(--ink)">Shop Admin</h1>
        <p class="mt-1 text-[13px]" style="color: var(--muted)">Đăng nhập để quản trị hệ thống</p>
      </div>

      <!-- Card -->
      <form class="card p-7" @submit.prevent="handleLogin">
        <Transition
          enter-active-class="transition-all duration-200"
          enter-from-class="opacity-0 -translate-y-1"
        >
          <div
            v-if="error"
            class="mb-5 flex items-center gap-2 rounded-md px-3 py-2.5 text-[13px]"
            style="background: var(--red-bg); color: var(--red-fg)"
          >
            <Icon name="warning" :size="16" />
            <span>{{ error }}</span>
          </div>
        </Transition>

        <div class="space-y-4">
          <div>
            <label class="label" for="username">Tên đăng nhập</label>
            <input
              id="username"
              v-model="username"
              type="text"
              required
              autocomplete="username"
              class="field"
              placeholder="admin"
            />
          </div>
          <div>
            <label class="label" for="password">Mật khẩu</label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              autocomplete="current-password"
              class="field"
              placeholder="••••••••"
            />
          </div>
        </div>

        <button type="submit" :disabled="loading" class="btn btn-primary mt-6 w-full py-2.5">
          <Icon v-if="!loading" name="lock" :size="16" />
          {{ loading ? 'Đang đăng nhập…' : 'Đăng nhập' }}
        </button>
      </form>

      <p class="mt-6 text-center text-[11px]" style="color: var(--faint)">
        Telegram Shop Bot · Cloudflare Workers
      </p>
    </div>
  </div>
</template>

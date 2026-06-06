<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import Header from '@/components/Header.vue'

const route = useRoute()
const sidebarOpen = ref(false)

const isPublicPage = computed(() => route.meta.public === true)

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}
function closeSidebar() {
  sidebarOpen.value = false
}
</script>

<template>
  <!-- Public pages (login) — no chrome -->
  <RouterView v-if="isPublicPage" />

  <!-- Authenticated app shell -->
  <div v-else class="flex h-screen overflow-hidden" style="background: var(--canvas)">
    <Sidebar :open="sidebarOpen" @close="closeSidebar" />

    <div class="flex flex-col flex-1 min-w-0">
      <Header @toggle-sidebar="toggleSidebar" />
      <main class="flex-1 overflow-y-auto">
        <div class="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-8">
          <RouterView v-slot="{ Component }">
            <component :is="Component" :key="route.path" />
          </RouterView>
        </div>
      </main>
    </div>
  </div>
</template>

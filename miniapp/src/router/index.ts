import { createRouter, createWebHistory } from 'vue-router'

// History base '/app/' khớp route serve `/app` trong Worker (SPA fallback miniapp/index.html).
// Views nạp lazy (dynamic import) — file .vue do các task 13.x tạo ở wave sau.
const router = createRouter({
  history: createWebHistory('/app/'),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/shop',
      name: 'shop',
      component: () => import('@/views/ShopView.vue'),
    },
    {
      path: '/shop/:id',
      name: 'product-detail',
      component: () => import('@/views/ProductDetailView.vue'),
      props: true,
    },
    {
      path: '/deposit',
      name: 'deposit',
      component: () => import('@/views/DepositView.vue'),
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('@/views/HistoryView.vue'),
    },
    {
      path: '/history/:id',
      name: 'order-detail',
      component: () => import('@/views/OrderDetailView.vue'),
      props: true,
    },
    {
      path: '/account',
      name: 'account',
      component: () => import('@/views/AccountView.vue'),
    },
  ],
})

export default router

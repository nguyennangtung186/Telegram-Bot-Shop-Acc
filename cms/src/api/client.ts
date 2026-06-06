import { ref } from 'vue'

const TOKEN_KEY = 'cms_token'

// Reactive auth state — initialized synchronously from localStorage to avoid flash
export const isAuthenticated = ref<boolean>(!!localStorage.getItem(TOKEN_KEY))

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  isAuthenticated.value = true
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  isAuthenticated.value = false
}

export interface ApiResponse<T> {
  success: boolean
  data: T | null
  error: string | null
  meta?: {
    total: number
    page: number
    limit: number
  }
}

class ApiClient {
  private baseUrl = '/api/admin'

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const token = getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (response.status === 401) {
      removeToken()
      // Use router-friendly redirect via hash to avoid full reload flash
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = '/cms/login'
      }
      throw new Error('Unauthorized')
    }

    return response.json() as Promise<ApiResponse<T>>
  }

  get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path)
  }

  post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body)
  }

  put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body)
  }

  delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path)
  }
}

export const api = new ApiClient()

/**
 * Error handling utilities — AppError class và handlers cho Bot/API errors.
 * Requirements: 9.1, 9.3
 */

export class AppError extends Error {
  public readonly statusCode: number
  public readonly details?: Record<string, unknown>

  constructor(message: string, statusCode = 500, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.details = details
  }
}

/**
 * Xử lý lỗi trong Bot handler — log error và gửi thông báo thân thiện cho user.
 * Trả về object chứa thông tin để gửi Telegram message.
 */
export function handleBotError(
  error: unknown,
  context?: { userId?: number; command?: string; operation?: string }
): { message: string; shouldNotifyUser: boolean } {
  const timestamp = new Date().toISOString()
  const errorMessage = error instanceof Error ? error.message : String(error)

  console.error(JSON.stringify({
    timestamp,
    level: 'error',
    source: 'bot',
    error: errorMessage,
    userId: context?.userId ?? null,
    command: context?.command ?? null,
    operation: context?.operation ?? null,
  }))

  return {
    message: '❌ Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.',
    shouldNotifyUser: true,
  }
}

/**
 * Xử lý lỗi trong API handler — log error và trả về ApiResponse format.
 */
export function handleApiError(
  error: unknown,
  context?: { adminId?: number; operation?: string }
): { success: false; data: null; error: string } {
  const timestamp = new Date().toISOString()
  const errorMessage = error instanceof Error ? error.message : String(error)

  console.error(JSON.stringify({
    timestamp,
    level: 'error',
    source: 'api',
    error: errorMessage,
    adminId: context?.adminId ?? null,
    operation: context?.operation ?? null,
  }))

  const userFacingMessage = error instanceof AppError
    ? error.message
    : 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.'

  const statusCode = error instanceof AppError ? error.statusCode : 500

  return {
    success: false,
    data: null,
    error: userFacingMessage,
  }
}

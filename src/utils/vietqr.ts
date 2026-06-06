/**
 * VietQR URL generator — tạo URL ảnh QR code thanh toán.
 * Format: https://img.vietqr.io/image/{bankId}-{accountNo}-compact.png?amount={amount}&addInfo={description}&accountName={accountName}
 * Requirement: 2.2
 */

export interface VietQRParams {
  /** Mã ngân hàng (BIN) */
  bankId: string
  /** Số tài khoản */
  accountNo: string
  /** Chủ tài khoản */
  accountName: string
  /** Số tiền (VNĐ) */
  amount: number
  /** Nội dung chuyển khoản */
  description: string
}

/**
 * Tạo VietQR image URL cho thanh toán.
 */
export function generateVietQRUrl(params: VietQRParams): string {
  const { bankId, accountNo, accountName, amount, description } = params

  const baseUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact.png`

  const queryParams = new URLSearchParams({
    amount: String(amount),
    addInfo: description,
    accountName: accountName,
  })

  return `${baseUrl}?${queryParams.toString()}`
}

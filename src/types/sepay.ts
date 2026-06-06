/**
 * SePay Webhook Payload — cấu trúc chính xác từ docs.sepay.vn.
 */
export interface SepayWebhookPayload {
  /** ID giao dịch trên SePay (dùng để chống trùng lặp — UNIQUE) */
  id: number
  /** Tên ngân hàng (vd: "Vietcombank") */
  gateway: string
  /** Ngày giao dịch "2024-07-02 11:08:33" */
  transactionDate: string
  /** Số tài khoản nhận (vd: "1017588888") */
  accountNumber: string
  /** Tài khoản phụ (VA) nếu có */
  subAccount: string | null
  /** Mã giao dịch SePay tự nhận diện (vd: "SEVN63DC8E5C") */
  code: string | null
  /** Nội dung chuyển khoản (chứa transfer_code) */
  content: string
  /** "in" = tiền vào, "out" = tiền ra */
  transferType: 'in' | 'out'
  /** Mô tả giao dịch từ ngân hàng */
  description: string
  /** Số tiền chuyển khoản (VNĐ, INTEGER) */
  transferAmount: number
  /** Số dư tích lũy sau giao dịch */
  accumulated: number
  /** Mã tham chiếu ngân hàng (vd: "FT24012345678") */
  referenceCode: string
}

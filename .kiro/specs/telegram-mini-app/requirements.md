# Requirements Document

## Introduction

Telegram Mini App là giao diện web chạy bên trong ứng dụng Telegram (mở từ bot hiện tại) phục vụ đầy đủ luồng của người mua: xem số dư, mua tài khoản số, nạp tiền qua VietQR/SePay, xem lịch sử đơn hàng và thông tin tài khoản. Mini App được xây dựng bằng Vue 3 + Vite + Tailwind trong thư mục `miniapp/`, build ra `dist/miniapp`, và được phục vụ qua một route mới (ví dụ `/app`) trong CÙNG Cloudflare Worker hiện tại (Hono + D1). Mini App không thêm hệ thống admin.

Mini App xác thực người dùng theo chuẩn Telegram WebApp `initData` (stateless, không tạo JWT riêng), tái sử dụng nguyên schema nghiệp vụ D1 hiện tại và các quy tắc bất biến của hệ thống (giao dịch atomic, số dư không âm, idempotency SePay). Mọi thao tác nghiệp vụ trên Mini App đều phải gửi tin nhắn đồng bộ qua bot Telegram giống hệt flow bot hiện tại, tái sử dụng `renderSuccessMessage` trong `src/utils/telegram-template.ts`.

Tài liệu này mô tả yêu cầu chức năng và phi chức năng theo EARS, làm cơ sở cho design và tasks.

## Glossary

- **Mini_App**: Ứng dụng web Vue 3 chạy trong Telegram WebApp, phục vụ luồng người mua, được serve qua route `/app` của Worker hiện tại.
- **Worker**: Cloudflare Worker hiện tại (Hono + D1) chứa toàn bộ backend (webhook bot, webhook SePay, API admin, CMS static) và nay phục vụ thêm Mini_App.
- **initData**: Chuỗi dữ liệu khởi tạo do Telegram WebApp cung cấp cho Mini_App, chứa thông tin người dùng, `auth_date` và trường `hash` dùng để xác thực bằng HMAC-SHA256 theo chuẩn Telegram WebApp.
- **Init_Data_Verifier**: Thành phần trong Worker xác thực `initData` trên mỗi request bằng Web Crypto (HMAC-SHA256) theo chuẩn Telegram WebApp.
- **Init_Data_Header**: Header HTTP `X-Telegram-Init-Data` mà Mini_App gửi kèm mỗi request API để truyền `initData` thô lên Worker.
- **TTL**: Khoảng thời gian sống tối đa (giây) cho phép tính từ `auth_date` của `initData` trước khi bị coi là hết hạn, dùng để chống replay.
- **telegram_id**: Định danh người dùng Telegram, dùng để định danh người mua trong Mini_App (JOIN/lọc qua cột `telegram_id`, KHÔNG dùng trực tiếp làm `users.id`).
- **Buyer**: Người dùng Telegram đang sử dụng Mini_App với vai trò người mua.
- **product_types**: Bảng danh mục loại sản phẩm trong D1 (giá, emoji, mô tả, `success_template`, tồn kho dẫn xuất).
- **products**: Bảng tài khoản số cụ thể trong D1 (trạng thái `available`/`sold`/`reserved`).
- **transfer_code**: Mã nội dung chuyển khoản duy nhất sinh cho mỗi yêu cầu nạp tiền, dùng để SePay đối soát và cộng tiền.
- **VietQR**: Ảnh/URL mã QR ngân hàng sinh động theo số tiền và `transfer_code` để Buyer chuyển khoản.
- **SePay_Webhook**: Endpoint hiện có (`/webhook/sepay`) nhận sự kiện tiền vào từ SePay và cộng số dư theo `transfer_code`.
- **sepay_transaction_id**: Định danh giao dịch SePay dùng để bảo đảm idempotency (không cộng tiền hai lần).
- **Bot_Notifier**: Thành phần gửi tin nhắn qua Telegram Bot API tái sử dụng template hiện có để đồng bộ thông báo cho Buyer.
- **renderSuccessMessage**: Hàm trong `src/utils/telegram-template.ts` render tin nhắn "Mua hàng thành công" (header cố định + body từ `success_template`), có escape HTML giá trị động.
- **liquid_glass**: Phong cách giao diện vật liệu kính trong suốt (nền mờ/blur, màu phẳng) áp dụng cho Mini_App, không dùng gradient.
- **iOS_HIG**: Apple Human Interface Guidelines cho iOS, làm chuẩn tham chiếu cho bố cục mobile-first, easing/spring animation và tương tác.
- **Theme_Params**: Bộ tham số theme do Telegram WebApp cung cấp (màu nền, màu chữ, màu nút...) dùng để đồng bộ chế độ sáng/tối.
- **Safe_Area**: Vùng an toàn/viewport do Telegram WebApp khai báo (insets) mà Mini_App phải tôn trọng khi bố cục.
- **Atomic_Transaction**: Giao dịch ghi nhiều bảng bằng D1 `batch()` kèm concurrency guard `WHERE balance >= total`, bảo đảm tất-cả-hoặc-không.

## Requirements

### Requirement 1: Xác thực bằng Telegram initData (stateless)

**User Story:** Là Buyer, tôi muốn được xác thực tự động bằng initData của Telegram khi mở Mini App, để truy cập các chức năng mà không cần đăng nhập riêng.

#### Acceptance Criteria

1. WHEN Mini_App gửi một request đến API nghiệp vụ, THE Mini_App SHALL đính kèm chuỗi `initData` thô trong Init_Data_Header `X-Telegram-Init-Data`.
2. WHEN Worker nhận một request API nghiệp vụ, THE Init_Data_Verifier SHALL xác thực trường `hash` của `initData` bằng HMAC-SHA256 theo chuẩn Telegram WebApp sử dụng Web Crypto trên chính request đó.
3. IF Init_Data_Header thiếu trong request API nghiệp vụ, THEN THE Worker SHALL từ chối request với mã trạng thái HTTP 401.
4. IF `hash` của `initData` không khớp kết quả HMAC-SHA256 tính được, THEN THE Worker SHALL từ chối request với mã trạng thái HTTP 401.
5. THE Init_Data_Verifier SHALL trích xuất `telegram_id` của Buyer từ `initData` đã xác thực.
6. THE Worker SHALL định danh Buyer qua `telegram_id` bằng cách JOIN hoặc lọc theo cột `telegram_id`, và SHALL KHÔNG dùng `telegram_id` trực tiếp làm `users.id`.
7. THE Worker SHALL KHÔNG phát hành JWT hoặc cơ chế phiên đăng nhập riêng cho Mini_App.

### Requirement 2: Chống replay theo auth_date/TTL

**User Story:** Là chủ hệ thống, tôi muốn initData hết hạn sau một khoảng thời gian, để ngăn việc phát lại (replay) initData cũ.

#### Acceptance Criteria

1. THE Init_Data_Verifier SHALL đọc giá trị `auth_date` từ `initData` đã xác thực.
2. WHEN khoảng thời gian giữa thời điểm hiện tại của Worker và `auth_date` vượt quá TTL, THE Worker SHALL từ chối request với mã trạng thái HTTP 401.
3. IF `initData` không chứa `auth_date`, THEN THE Worker SHALL từ chối request với mã trạng thái HTTP 401.
4. THE Worker SHALL áp dụng kiểm tra TTL sau khi đã xác thực thành công `hash` của `initData`.

### Requirement 3: Tự động tạo user mới

**User Story:** Là Buyer lần đầu dùng Mini App, tôi muốn tài khoản của mình được tạo tự động, để bắt đầu mua hàng mà không cần thao tác thủ công.

#### Acceptance Criteria

1. WHEN một request đã xác thực có `telegram_id` chưa tồn tại trong bảng `users`, THE Worker SHALL tạo bản ghi `users` mới cho `telegram_id` đó theo cùng quy tắc khởi tạo của flow `/start` trong bot.
2. WHEN tạo bản ghi `users` mới, THE Worker SHALL khởi tạo số dư của Buyer bằng 0.
3. WHEN một request đã xác thực có `telegram_id` đã tồn tại trong bảng `users`, THE Worker SHALL dùng lại bản ghi `users` hiện có mà không tạo bản ghi trùng lặp.

### Requirement 4: Trang chủ và hiển thị số dư

**User Story:** Là Buyer, tôi muốn xem số dư và các lối tắt nhanh ở trang chủ, để nắm tình trạng tài khoản và điều hướng nhanh.

#### Acceptance Criteria

1. WHEN Buyer mở trang chủ của Mini_App, THE Mini_App SHALL hiển thị số dư hiện tại của Buyer lấy từ bảng `users` theo `telegram_id`.
2. THE Mini_App SHALL hiển thị số dư theo định dạng tiền tệ thống nhất với hệ thống hiện tại.
3. THE Mini_App SHALL hiển thị lối tắt nhanh đến các chức năng mua hàng, nạp tiền, lịch sử đơn hàng và thông tin tài khoản trên trang chủ.
4. WHEN Buyer chọn một lối tắt nhanh, THE Mini_App SHALL điều hướng đến màn hình tương ứng.

### Requirement 5: Duyệt danh mục và chi tiết sản phẩm

**User Story:** Là Buyer, tôi muốn duyệt danh mục sản phẩm và xem chi tiết, để chọn loại tài khoản cần mua.

#### Acceptance Criteria

1. WHEN Buyer mở màn hình mua hàng, THE Mini_App SHALL hiển thị danh sách `product_types` có `is_visible` đang bật, theo thứ tự `sort_order`.
2. THE Mini_App SHALL hiển thị tên, emoji, giá và số lượng còn lại (tồn kho `available`) cho mỗi loại sản phẩm.
3. WHEN Buyer chọn một loại sản phẩm, THE Mini_App SHALL hiển thị màn hình chi tiết gồm mô tả, giá và số lượng còn lại của loại sản phẩm đó.
4. WHERE một loại sản phẩm có số lượng còn lại bằng 0, THE Mini_App SHALL hiển thị trạng thái hết hàng và SHALL vô hiệu hóa thao tác mua cho loại sản phẩm đó.

### Requirement 6: Mua hàng end-to-end

**User Story:** Là Buyer, tôi muốn chọn số lượng, xác nhận và nhận tài khoản ngay trong app, để hoàn tất mua hàng nhanh chóng.

#### Acceptance Criteria

1. WHEN Buyer chọn số lượng cho một loại sản phẩm, THE Mini_App SHALL hiển thị tổng tiền bằng giá loại sản phẩm nhân số lượng.
2. WHEN Buyer xác nhận mua, THE Worker SHALL thực hiện mua hàng bằng Atomic_Transaction sử dụng D1 `batch()` kèm concurrency guard `WHERE balance >= total`.
3. IF số dư của Buyer nhỏ hơn tổng tiền, THEN THE Worker SHALL từ chối giao dịch và SHALL giữ nguyên số dư và tồn kho.
4. IF số lượng còn lại nhỏ hơn số lượng yêu cầu, THEN THE Worker SHALL từ chối giao dịch và SHALL giữ nguyên số dư và tồn kho.
5. WHEN giao dịch mua thành công, THE Worker SHALL trừ tổng tiền vào số dư của Buyer, đánh dấu các `products` tương ứng là `sold`, tạo bản ghi `orders`, `order_items` và `transactions` loại `purchase` trong cùng một Atomic_Transaction.
6. WHEN giao dịch mua thành công, THE Mini_App SHALL hiển thị nội dung tài khoản (`products.content`) đã mua cho Buyer ngay trong app.
7. WHEN giao dịch mua thành công, THE Mini_App SHALL hiển thị số dư còn lại sau giao dịch.

### Requirement 7: Đồng bộ tin nhắn bot khi mua hàng

**User Story:** Là Buyer, tôi muốn nhận tin nhắn giao tài khoản qua bot Telegram giống flow bot, để có bản ghi thống nhất trong khung chat.

#### Acceptance Criteria

1. WHEN giao dịch mua trên Mini_App thành công, THE Bot_Notifier SHALL gửi tin nhắn giao tài khoản đến Buyer qua Telegram Bot API.
2. THE Bot_Notifier SHALL dựng nội dung tin nhắn giao tài khoản bằng hàm `renderSuccessMessage` trong `src/utils/telegram-template.ts`.
3. THE Bot_Notifier SHALL truyền các giá trị `emoji`, `name`, `quantity`, `totalAmount`, `balanceAfter` và danh sách nội dung tài khoản đúng với giao dịch vừa thực hiện.
4. THE Bot_Notifier SHALL escape HTML cho các giá trị động trong tin nhắn theo cơ chế của template hiện có.
5. IF việc gửi tin nhắn bot thất bại, THEN THE Worker SHALL giữ nguyên kết quả giao dịch mua đã commit và SHALL ghi log lỗi gửi tin nhắn.

### Requirement 8: Nạp tiền: tạo transfer code và VietQR

**User Story:** Là Buyer, tôi muốn chọn mệnh giá hoặc nhập số tiền để tạo mã chuyển khoản và mã VietQR, để nạp tiền vào tài khoản.

#### Acceptance Criteria

1. THE Mini_App SHALL cho phép Buyer chọn một mệnh giá nạp định sẵn hoặc nhập số tiền nạp thủ công.
2. IF số tiền nạp nằm ngoài khoảng `min_deposit` đến `max_deposit` trong `system_config`, THEN THE Worker SHALL từ chối tạo yêu cầu nạp và SHALL trả về thông báo lỗi nêu rõ giới hạn.
3. WHEN Buyer xác nhận tạo yêu cầu nạp với số tiền hợp lệ, THE Worker SHALL tạo bản ghi `deposits` trạng thái `pending` với `transfer_code` duy nhất gắn với `telegram_id` của Buyer.
4. WHEN một yêu cầu nạp được tạo, THE Mini_App SHALL hiển thị VietQR cùng thông tin chuyển khoản gồm tên ngân hàng, số tài khoản, chủ tài khoản, số tiền và `transfer_code`.
5. WHILE một yêu cầu nạp đang ở trạng thái `pending`, THE Mini_App SHALL hiển thị trạng thái chờ đối soát cho Buyer.

### Requirement 9: Nạp tiền: cộng tiền qua SePay và idempotency

**User Story:** Là Buyer, tôi muốn số dư được cộng tự động sau khi chuyển khoản thành công, để dùng tiền mua hàng ngay.

#### Acceptance Criteria

1. WHEN SePay_Webhook nhận sự kiện tiền vào khớp với `transfer_code` của một yêu cầu nạp `pending`, THE Worker SHALL cộng số tiền vào số dư của Buyer và chuyển `deposits` sang trạng thái `completed` trong một Atomic_Transaction.
2. WHEN cộng tiền nạp thành công, THE Worker SHALL tạo bản ghi `transactions` loại `deposit` ghi `balance_before` và `balance_after`.
3. IF SePay_Webhook nhận lại một sự kiện có `sepay_transaction_id` đã xử lý, THEN THE Worker SHALL bỏ qua việc cộng tiền lần nữa cho `sepay_transaction_id` đó.
4. THE Worker SHALL bảo đảm số dư của Buyer không bao giờ âm theo CHECK constraint của D1.

### Requirement 10: Đồng bộ tin nhắn bot khi nạp tiền

**User Story:** Là Buyer, tôi muốn nhận thông tin nạp tiền và xác nhận cộng tiền qua bot Telegram giống flow bot, để theo dõi trong khung chat.

#### Acceptance Criteria

1. WHEN một yêu cầu nạp được tạo trên Mini_App, THE Bot_Notifier SHALL gửi ảnh VietQR kèm thông tin chuyển khoản đến Buyer qua Telegram Bot API giống flow nạp tiền của bot hiện tại.
2. WHEN số dư được cộng thành công qua SePay_Webhook cho một yêu cầu nạp bắt nguồn từ Mini_App, THE Bot_Notifier SHALL gửi tin nhắn xác nhận cộng tiền đến Buyer qua Telegram Bot API.
3. THE Bot_Notifier SHALL escape HTML cho các giá trị động trong tin nhắn nạp tiền.
4. IF việc gửi tin nhắn bot thất bại, THEN THE Worker SHALL giữ nguyên trạng thái yêu cầu nạp và kết quả cộng tiền đã commit và SHALL ghi log lỗi gửi tin nhắn.

### Requirement 11: Lịch sử đơn hàng

**User Story:** Là Buyer, tôi muốn xem lịch sử đơn hàng của mình, để tra cứu lại các giao dịch đã mua.

#### Acceptance Criteria

1. WHEN Buyer mở màn hình lịch sử đơn hàng, THE Mini_App SHALL hiển thị danh sách `orders` của Buyer lọc theo `telegram_id`, sắp xếp theo thời gian tạo giảm dần.
2. THE Mini_App SHALL hiển thị tên loại sản phẩm, số lượng, tổng tiền, trạng thái và thời gian tạo cho mỗi đơn hàng.
3. WHEN Buyer chọn một đơn hàng, THE Mini_App SHALL hiển thị chi tiết đơn hàng gồm nội dung các `products` thuộc đơn hàng đó.
4. WHERE Buyer chưa có đơn hàng nào, THE Mini_App SHALL hiển thị trạng thái trống cho màn hình lịch sử đơn hàng.

### Requirement 12: Thông tin tài khoản

**User Story:** Là Buyer, tôi muốn xem thông tin tài khoản và số dư, để nắm thông tin cá nhân trong hệ thống.

#### Acceptance Criteria

1. WHEN Buyer mở màn hình thông tin tài khoản, THE Mini_App SHALL hiển thị số dư hiện tại của Buyer.
2. THE Mini_App SHALL hiển thị thông tin định danh của Buyer gồm `telegram_id`, `username` và `first_name` lấy từ bảng `users`.
3. THE Mini_App SHALL KHÔNG hiển thị bất kỳ chức năng quản trị nào.

### Requirement 13: Ràng buộc UI theo iOS HIG và liquid glass

**User Story:** Là Buyer, tôi muốn giao diện mobile-first kiểu iOS, tối giản và đồng bộ theme Telegram, để trải nghiệm mượt và quen thuộc.

#### Acceptance Criteria

1. THE Mini_App SHALL trình bày bố cục mobile-first theo iOS_HIG.
2. THE Mini_App SHALL áp dụng phong cách liquid_glass dùng màu phẳng và vật liệu kính trong suốt có hiệu ứng blur.
3. THE Mini_App SHALL KHÔNG sử dụng gradient màu trong giao diện.
4. THE Mini_App SHALL áp dụng animation và transition dùng easing/spring theo chuẩn iOS_HIG.
5. WHERE Telegram WebApp cung cấp API haptic, THE Mini_App SHALL kích hoạt phản hồi haptic cho các thao tác chính như xác nhận mua và tạo mã nạp.
6. WHEN Telegram cung cấp Theme_Params, THE Mini_App SHALL áp dụng chế độ sáng hoặc tối đồng bộ với Theme_Params đó.
7. THE Mini_App SHALL tôn trọng Safe_Area do Telegram WebApp khai báo khi bố cục nội dung.

### Requirement 14: Build và phục vụ Mini App qua route mới

**User Story:** Là người vận hành, tôi muốn Mini App được build và phục vụ trong cùng Worker qua route riêng, để triển khai đồng bộ với hệ thống hiện tại.

#### Acceptance Criteria

1. THE Mini_App SHALL được xây dựng trong thư mục `miniapp/` bằng Vue 3 + Vite + Tailwind.
2. WHEN script build Mini_App chạy, THE script `build:miniapp` SHALL tạo artifact tĩnh trong thư mục `dist/miniapp`.
3. WHEN Buyer truy cập route `/app`, THE Worker SHALL phục vụ các asset tĩnh của Mini_App từ `dist/miniapp`.
4. THE Worker SHALL phục vụ Mini_App trong cùng Worker với webhook bot, webhook SePay và API admin hiện có.
5. THE quy trình deploy SHALL build Mini_App trước khi đóng gói Worker.

### Requirement 15: Bảo mật tin nhắn và dữ liệu động

**User Story:** Là chủ hệ thống, tôi muốn mọi giá trị động được xử lý an toàn, để tránh lỗi hiển thị và rủi ro bảo mật khi gửi tin nhắn.

#### Acceptance Criteria

1. WHEN Bot_Notifier dựng tin nhắn chứa giá trị động, THE Bot_Notifier SHALL escape HTML các giá trị động trước khi gửi qua Telegram Bot API.
2. THE Worker SHALL coi `initData` nhận từ Mini_App là dữ liệu không tin cậy cho đến khi Init_Data_Verifier xác thực thành công.
3. THE Worker SHALL KHÔNG trả về nội dung `products.content` cho một Buyer trừ khi Buyer đó là chủ sở hữu đơn hàng chứa sản phẩm đó.

### Requirement 16: Yêu cầu phi chức năng: hiệu năng và an toàn giao dịch

**User Story:** Là chủ hệ thống, tôi muốn Mini App nhanh và an toàn về dữ liệu, để phục vụ nhiều người mua mà vẫn bảo toàn sổ cái.

#### Acceptance Criteria

1. THE Worker SHALL xử lý xác thực `initData` của mỗi request bằng Web Crypto trong môi trường Cloudflare Worker mà không phụ thuộc thư viện chạy ngoài Worker.
2. THE Worker SHALL thực hiện mọi thao tác ghi nhiều bảng cho mua hàng và nạp tiền bằng Atomic_Transaction để bảo đảm tính nhất quán tất-cả-hoặc-không.
3. WHEN nhiều request mua đồng thời cho cùng một Buyer được xử lý, THE Worker SHALL dùng concurrency guard `WHERE balance >= total` để ngăn số dư âm và bán vượt tồn kho.
4. THE Mini_App SHALL không thêm migration thay đổi schema nghiệp vụ hiện có, và SHALL chỉ thêm migration mới khi thật sự cần thiết cho chức năng Mini_App.

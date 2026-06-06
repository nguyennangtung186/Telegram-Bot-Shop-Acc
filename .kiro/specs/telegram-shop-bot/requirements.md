# Requirements Document

## Introduction

Hệ thống bot Telegram cho phép người dùng nạp tiền (qua SePay) và mua tài khoản số (digital accounts). Backend chạy trên Cloudflare Workers, dữ liệu lưu trữ trên Cloudflare D1. Bot sử dụng inline keyboard hiện đại, hỗ trợ quản trị viên thêm/quản lý tài khoản trực tiếp qua bot.

## Glossary

- **Bot**: Ứng dụng Telegram Bot xử lý lệnh và callback từ người dùng
- **Worker**: Cloudflare Worker nhận webhook từ Telegram và SePay
- **D1**: Cloudflare D1 database lưu trữ toàn bộ dữ liệu hệ thống
- **User**: Người dùng Telegram tương tác với Bot
- **Admin**: Người dùng có quyền quản trị, được xác định bằng Telegram ID hoặc CMS account
- **Category**: Loại sản phẩm/tài khoản, xác định tên, mô tả, và giá bán (bảng `product_types`)
- **Product**: Sản phẩm cụ thể (tài khoản số), chứa nội dung (content) gửi cho người mua (bảng `products`)
- **Order**: Đơn hàng khi User mua sản phẩm, chứa thông tin số lượng, tổng tiền, products đã giao (bảng `orders`)
- **Transaction**: Bản ghi sổ cái tài chính, ghi nhận mọi thay đổi balance: deposit, purchase, refund, adjust (bảng `transactions`)
- **Balance**: Số dư nội bộ của User trong hệ thống (đơn vị VNĐ)
- **SePay**: Cổng thanh toán trung gian, cung cấp webhook khi nhận được tiền
- **Deposit**: Yêu cầu nạp tiền từ SePay vào Balance của User (bảng `deposits`)
- **CMS**: Giao diện web quản trị (Vue 3), build static serve từ Worker
- **Inline_Keyboard**: Bàn phím nút bấm gắn dưới tin nhắn Telegram
- **Reply_Keyboard**: Bàn phím cố định hiển thị phía dưới chat (persistent menu)
- **Broadcast**: Thông báo gửi hàng loạt đến nhiều User khi có đơn hàng mới
- **VietQR**: Chuẩn QR code thanh toán liên ngân hàng Việt Nam
- **CMS**: Content Management System — giao diện web quản trị hệ thống cho Admin
- **JWT**: JSON Web Token — token xác thực cho CMS admin session
- **Audit_Log**: Nhật ký hành động admin trên CMS để truy vết
- **Order**: Đơn hàng — nhóm các Account được mua trong 1 lần giao dịch

## Requirements

### Requirement 1: Đăng ký và quản lý User

**User Story:** Là một người dùng Telegram, tôi muốn tự động được đăng ký khi tương tác với bot lần đầu, để tôi có thể sử dụng dịch vụ ngay lập tức.

#### Acceptance Criteria

1. WHEN User gửi lệnh /start và chưa có bản ghi User trong D1, THE Bot SHALL tạo bản ghi User mới với telegram_id, username, first_name, balance = 0, created_at, và hiển thị menu chính bằng Inline_Keyboard
2. WHEN User gửi lệnh /start và đã có bản ghi User trong D1, THE Bot SHALL cập nhật username và first_name từ thông tin Telegram hiện tại (nếu thay đổi), cập nhật updated_at, và hiển thị menu chính bằng Inline_Keyboard
3. THE Bot SHALL lưu trữ thông tin User bao gồm: telegram_id (unique, số nguyên), username (tối đa 32 ký tự), first_name (tối đa 64 ký tự), balance (số nguyên không âm, đơn vị VNĐ), created_at (UTC timestamp), updated_at (UTC timestamp)
4. WHEN User bấm nút "👤 Tài khoản" trên Inline_Keyboard, THE Bot SHALL hiển thị thông tin: username, first_name, số dư hiện tại (đơn vị VNĐ), tổng số Transaction đã thực hiện (cả deposit và purchase), ngày tham gia (created_at)
5. IF Bot không thể tạo hoặc truy vấn bản ghi User trong D1 khi xử lý lệnh /start, THEN THE Bot SHALL gửi thông báo lỗi cho User kèm hướng dẫn thử lại sau

### Requirement 2: Nạp tiền qua SePay

**User Story:** Là một người dùng, tôi muốn nạp tiền vào tài khoản qua chuyển khoản ngân hàng (SePay), để tôi có số dư mua tài khoản.

#### Acceptance Criteria

1. WHEN User bấm nút "💰 Nạp tiền" trên Inline_Keyboard, THE Bot SHALL hiển thị các nút chọn nhanh mệnh giá: 30.000đ, 50.000đ, 100.000đ, 200.000đ, 500.000đ, 1.000.000đ (grid 2 cột × 3 hàng), kèm hướng dẫn có thể gõ số tiền tùy ý (tối thiểu 20.000đ), và lệnh /huy để huỷ
2. WHEN User chọn mệnh giá hoặc nhập số tiền hợp lệ, THE Bot SHALL hiển thị thông tin chuyển khoản bao gồm: QR code VietQR (ảnh), tên ngân hàng, số tài khoản, chủ tài khoản, số tiền cần chuyển, và nội dung chuyển khoản chứa mã giao dịch duy nhất (bắt buộc gõ đúng y chang)
3. THE Bot SHALL hiển thị cảnh báo: "⚠️ Sai nội dung hoặc sai số tiền → không tự duyệt được. 🤖 Hệ thống tự động duyệt khi CK đúng nội dung (1-3 phút). Không cần liên hệ admin."
4. WHEN User yêu cầu nạp tiền, THE Worker SHALL tạo một Deposit record ở trạng thái "pending" với mã nội dung chuyển khoản duy nhất có độ dài từ 6 đến 20 ký tự, chứa định danh của User để SePay nhận diện giao dịch
5. WHEN SePay gửi webhook xác nhận thanh toán thành công, THE Worker SHALL xác thực webhook bằng cách kiểm tra API key hoặc signature từ SePay, và trả về HTTP response trong vòng 5 giây
6. WHEN webhook SePay hợp lệ và chứa mã giao dịch khớp với Deposit đang chờ, THE Worker SHALL cộng số tiền vào Balance của User tương ứng và cập nhật trạng thái Deposit thành "completed"
7. WHEN nạp tiền thành công, THE Bot SHALL gửi thông báo cho User qua Telegram với số tiền đã nạp và số dư mới
8. IF webhook SePay chứa mã giao dịch không khớp với Deposit nào đang chờ, THEN THE Worker SHALL ghi log cảnh báo và bỏ qua webhook đó, trả về HTTP 200
9. IF webhook SePay có signature không hợp lệ, THEN THE Worker SHALL từ chối xử lý và trả về HTTP 401
10. IF Worker nhận webhook SePay với mã giao dịch đã được xử lý thành công trước đó (duplicate), THEN THE Worker SHALL bỏ qua và trả về HTTP 200 mà không cộng tiền lần nữa
11. IF Deposit ở trạng thái "pending" quá 60 phút mà chưa nhận được webhook xác nhận, THEN THE Worker SHALL cập nhật trạng thái Deposit thành "expired"
12. IF số tiền trong webhook SePay nhỏ hơn 20,000 VNĐ hoặc lớn hơn 100,000,000 VNĐ, THEN THE Worker SHALL ghi log cảnh báo và không cộng tiền vào Balance
13. WHEN User gửi /huy hoặc bấm nút "❌ Huỷ" trong flow nạp tiền, THE Bot SHALL huỷ Deposit đang chờ và quay về menu chính

### Requirement 3: Mua tài khoản

**User Story:** Là một người dùng, tôi muốn mua tài khoản số từ bot với số lượng tùy chọn, để tôi nhận được nội dung tài khoản ngay lập tức.

#### Acceptance Criteria

1. WHEN User bấm nút "🛒 Mua tài khoản" trên Inline_Keyboard, THE Bot SHALL hiển thị danh sách Category có product khả dụng (status = available), kèm tên, giá, và số lượng còn lại
2. WHEN User chọn một Category, THE Bot SHALL hiển thị chi tiết loại sản phẩm (tên, giá, mô tả, số lượng còn) và cho phép chọn số lượng mua
3. THE Bot SHALL hiển thị grid nút số lượng từ 1 đến 10 (5 cột × 2 hàng) bằng Inline_Keyboard, đồng thời cho phép User nhập số lượng tùy ý bằng tin nhắn, kèm nút "🔙 Quay lại"
4. WHEN User chọn hoặc nhập số lượng, THE Bot SHALL hiển thị tổng tiền (giá × số lượng) và nút "✅ Xác nhận mua"
5. IF User nhập số lượng lớn hơn số Product khả dụng của Category đó, THEN THE Bot SHALL thông báo chỉ còn N sản phẩm và yêu cầu chọn lại
6. IF User nhập số lượng không hợp lệ (≤ 0, không phải số nguyên, hoặc > 50), THEN THE Bot SHALL thông báo lỗi và yêu cầu nhập lại
7. WHEN User bấm "✅ Xác nhận mua" và Balance >= tổng tiền (giá × số lượng), THE Worker SHALL thực hiện atomic transaction trong D1: kiểm tra Balance >= tổng tiền và còn đủ Product khả dụng, trừ Balance, đánh dấu N Product (theo thứ tự created_at tăng dần) là sold với sold_at = thời điểm hiện tại và buyer_id = User, tạo bản ghi Order, và tạo bản ghi Transaction với type = purchase
8. WHEN mua thành công, THE Bot SHALL gửi content của tất cả Product đã mua cho User, mỗi product trên một dòng riêng biệt, kèm thông tin xác nhận: tên Category, số lượng đã mua, tổng tiền đã trừ, và số dư còn lại
9. IF User bấm "✅ Xác nhận mua" và Balance < tổng tiền (giá × số lượng), THEN THE Bot SHALL thông báo số dư không đủ, hiển thị số dư hiện tại và số tiền cần nạp thêm (tổng tiền - Balance), kèm nút "💰 Nạp tiền"
10. IF không còn đủ Product khả dụng cho số lượng yêu cầu tại thời điểm xử lý, THEN THE Bot SHALL thông báo chỉ còn N sản phẩm và cho phép User chọn mua số lượng còn lại hoặc huỷ
11. IF atomic transaction thất bại do vi phạm điều kiện (Balance không đủ hoặc Product không còn khả dụng) trong quá trình thực thi, THEN THE Worker SHALL không thay đổi dữ liệu và THE Bot SHALL thông báo lỗi phù hợp cho User

### Requirement 4: Transaction, Order và bảo toàn dữ liệu

**User Story:** Là chủ hệ thống, tôi muốn mọi giao dịch tài chính được ghi nhận đầy đủ và atomic, để dữ liệu luôn nhất quán.

#### Acceptance Criteria

1. THE Worker SHALL ghi nhận mỗi giao dịch mua dưới dạng một bản ghi Order chứa: id, user_id, category_id, quantity, total_amount, status (success/failed), created_at; và liên kết với các Product đã giao qua bảng order_items
2. THE Worker SHALL ghi nhận mỗi thay đổi Balance dưới dạng một bản ghi Transaction (sổ cái) chứa: id, user_id, type (deposit/purchase/refund/adjust), amount, reference_id, description, created_at
3. WHEN thực hiện giao dịch mua, THE Worker SHALL sử dụng D1 batch (atomic transaction) để đảm bảo tất cả thao tác (trừ tiền, đánh dấu products sold, tạo order, ghi transaction) thành công hoặc thất bại cùng nhau
4. WHEN thực hiện giao dịch nạp tiền, THE Worker SHALL sử dụng D1 batch (atomic transaction) để đảm bảo cộng tiền, cập nhật deposit status, và ghi transaction thành công cùng nhau
5. IF User thực hiện giao dịch mua với tổng tiền vượt quá Balance hiện tại, THEN THE Worker SHALL từ chối giao dịch và thông báo cho User rằng số dư không đủ
6. IF D1 batch transaction thất bại, THEN THE Worker SHALL rollback toàn bộ thay đổi và trả về thông báo lỗi cho User chứa thông tin: loại giao dịch bị lỗi và yêu cầu thử lại sau
7. WHEN User bấm nút "📜 Lịch sử" trên Inline_Keyboard, THE Bot SHALL hiển thị tối đa 10 Order gần nhất sắp xếp theo created_at giảm dần, mỗi dòng gồm: tên category, số lượng, tổng tiền, thời gian (định dạng DD/MM/YYYY HH:mm)
8. IF User bấm nút "📜 Lịch sử" và không có Order nào, THEN THE Bot SHALL hiển thị thông báo cho biết chưa có đơn hàng nào
9. THE Worker SHALL đảm bảo Balance của User không bao giờ âm sau bất kỳ giao dịch nào

### Requirement 5: Quản lý Category (Admin Bot)

**User Story:** Là Admin, tôi muốn quản lý loại sản phẩm (thêm, sửa, xoá) qua bot, để tôi có thể cập nhật danh mục sản phẩm nhanh chóng.

#### Acceptance Criteria

1. WHEN Admin gửi lệnh /admin, THE Bot SHALL hiển thị bảng điều khiển Admin bằng Inline_Keyboard với các nút: "➕ Thêm loại", "📋 Danh sách loại", "➕ Thêm sản phẩm", "📊 Thống kê"
2. WHEN Admin bấm "➕ Thêm loại", THE Bot SHALL yêu cầu nhập lần lượt: tên loại (tối đa 100 ký tự), mô tả (tối đa 500 ký tự), giá bán (số nguyên từ 1.000 đến 999.999.999 VNĐ), sau đó tạo Category mới trong D1
3. IF Admin nhập giá trị không hợp lệ (tên rỗng, tên vượt 100 ký tự, mô tả vượt 500 ký tự, giá ngoài phạm vi 1.000–999.999.999, hoặc giá không phải số nguyên) trong quá trình thêm hoặc sửa Category, THEN THE Bot SHALL thông báo lỗi cụ thể cho trường không hợp lệ và yêu cầu nhập lại trường đó
4. WHEN Admin bấm "📋 Danh sách loại", THE Bot SHALL hiển thị danh sách Category (tối đa 20 mục mỗi trang) kèm thông tin: tên, giá, số lượng tổng, số lượng còn, và nút "✏️ Sửa" / "🗑️ Xoá" cho mỗi loại
5. WHEN Admin bấm "✏️ Sửa" trên một Category, THE Bot SHALL hiển thị giá trị hiện tại của tên, mô tả, giá bán và yêu cầu Admin nhập lần lượt giá trị mới cho từng trường (Admin có thể gửi /cancel để huỷ thao tác bất kỳ lúc nào)
6. WHEN Admin bấm "🗑️ Xoá" trên một Category, THE Bot SHALL hiển thị thông tin Category và yêu cầu xác nhận bằng Inline_Keyboard với nút "✅ Xác nhận xoá" và "❌ Huỷ"
7. WHEN Admin xác nhận xoá một Category không còn Product khả dụng, THE Bot SHALL xoá Category đó khỏi D1 và thông báo xoá thành công
8. IF Admin xác nhận xoá một Category còn Product khả dụng, THEN THE Bot SHALL từ chối xoá và thông báo số lượng Product khả dụng còn lại cần xoá trước
9. IF User không phải Admin gửi lệnh /admin, THEN THE Bot SHALL phản hồi thông báo cho biết người dùng không có quyền truy cập
10. WHILE Admin đang trong quy trình nhập liệu (thêm hoặc sửa Category), IF Admin gửi /cancel, THEN THE Bot SHALL huỷ thao tác hiện tại, không lưu thay đổi, và quay về bảng điều khiển Admin

### Requirement 6: Quản lý Product (Admin Bot)

**User Story:** Là Admin, tôi muốn thêm sản phẩm mới vào hệ thống qua bot, để có hàng cho người dùng mua.

#### Acceptance Criteria

1. WHEN Admin bấm "➕ Thêm sản phẩm" trong bảng điều khiển Admin, THE Bot SHALL hiển thị danh sách Category để Admin chọn loại
2. WHEN Admin chọn Category và nhập content (tối đa 2000 ký tự, không được rỗng hoặc chỉ chứa khoảng trắng), THE Bot SHALL tạo Product mới trong D1 với category_id tương ứng, status = available, created_at = thời điểm hiện tại, và phản hồi xác nhận đã thêm thành công
3. WHEN Admin nhập nhiều content (mỗi dòng một sản phẩm, tối đa 50 sản phẩm mỗi lần), THE Bot SHALL tạo nhiều Product cùng lúc (bulk insert) và xác nhận số lượng đã thêm thành công
4. IF content của Product trùng với một Product đã tồn tại cùng category_id (bất kể status), THEN THE Bot SHALL từ chối thêm và hiển thị thông báo lỗi chỉ rõ nội dung bị trùng
5. IF việc tạo Product thất bại (lỗi database hoặc dữ liệu không hợp lệ), THEN THE Bot SHALL thông báo lỗi cho Admin và không lưu bản ghi nào trong trường hợp bulk insert (rollback toàn bộ batch)
6. WHEN Admin bấm "📊 Thống kê", THE Bot SHALL hiển thị: tổng user, tổng doanh thu (đơn vị VNĐ), số sản phẩm đã bán, số sản phẩm còn lại — phân loại theo từng Category
7. THE Worker SHALL lưu trữ thông tin Product bao gồm: id, category_id, content, status (available/sold), created_at, sold_at, buyer_id

### Requirement 7: Giao diện Keyboard

**User Story:** Là một người dùng, tôi muốn tương tác với bot qua các nút bấm trực quan, để trải nghiệm sử dụng mượt mà và dễ hiểu.

#### Acceptance Criteria

1. THE Bot SHALL hiển thị Reply Keyboard (menu cố định phía dưới) sau lệnh /start gồm các nút: "� Mua hàng", "� Nạp tiền", "📜 Lịch sử", "� Số dư"
2. THE Bot SHALL hiển thị tin nhắn chào mừng kèm thông tin: tên shop, lời chào User (first_name), số dư hiện tại
3. THE Bot SHALL sử dụng Inline_Keyboard cho nội dung tương tác trong message: danh sách sản phẩm, chọn số lượng, xác nhận mua, chọn mệnh giá nạp tiền
4. THE Bot SHALL sử dụng callback_query để xử lý mọi tương tác nút inline, không yêu cầu User gõ lệnh thủ công (ngoại trừ /start, /admin, và nhập số lượng/số tiền)
5. WHEN User bấm nút quay lại ("🔙 Quay lại"), THE Bot SHALL điều hướng về màn hình cha trực tiếp của màn hình hiện tại
6. WHEN User chuyển giữa các màn hình thông qua nút bấm inline, THE Bot SHALL edit message hiện tại thay vì gửi message mới
7. WHEN hiển thị danh sách có nhiều hơn 5 mục, THE Bot SHALL phân trang với nút "⬅️ Trước" và "➡️ Sau"; ở trang đầu tiên nút "⬅️ Trước" SHALL bị ẩn, ở trang cuối cùng nút "➡️ Sau" SHALL bị ẩn
8. IF callback_query chứa dữ liệu không hợp lệ hoặc đã hết hạn, THEN THE Bot SHALL trả về thông báo lỗi cho User và hiển thị lại menu chính
9. IF Bot không thể edit message (message quá cũ hoặc đã bị xóa), THEN THE Bot SHALL gửi message mới kèm inline keyboard tương ứng
10. THE Bot SHALL hỗ trợ Bot Commands menu với: /start - Trang chủ, /admin - Quản trị (chỉ admin)

### Requirement 8: Bảo mật và xác thực

**User Story:** Là chủ hệ thống, tôi muốn bot được bảo mật đúng cách, để ngăn chặn truy cập trái phép và giả mạo webhook.

#### Acceptance Criteria

1. THE Worker SHALL xác thực mọi request từ Telegram bằng cách kiểm tra secret token trong header X-Telegram-Bot-Api-Secret-Token khớp với giá trị TELEGRAM_SECRET_TOKEN đã cấu hình
2. THE Worker SHALL xác thực mọi webhook từ SePay bằng API key hoặc signature được cấu hình trong environment variable SEPAY_API_KEY
3. THE Worker SHALL lưu trữ tất cả secret (BOT_TOKEN, SEPAY_API_KEY, ADMIN_IDS, TELEGRAM_SECRET_TOKEN) trong Cloudflare Workers environment variables/secrets, không hardcode
4. IF request đến endpoint Telegram webhook không có header X-Telegram-Bot-Api-Secret-Token hoặc giá trị không khớp với TELEGRAM_SECRET_TOKEN, THEN THE Worker SHALL trả về HTTP 401 và không xử lý request
5. IF request đến endpoint SePay webhook không có API key/signature hợp lệ, THEN THE Worker SHALL trả về HTTP 401 và không xử lý request
6. THE Worker SHALL xác định Admin bằng cách kiểm tra telegram_id của User có nằm trong danh sách ADMIN_IDS được cấu hình (danh sách các telegram_id phân tách bởi dấu phẩy)
7. IF request đến path không thuộc các endpoint đã đăng ký (Telegram webhook, SePay webhook), THEN THE Worker SHALL trả về HTTP 404

### Requirement 9: Xử lý lỗi và trạng thái

**User Story:** Là một người dùng, tôi muốn nhận thông báo rõ ràng khi có lỗi xảy ra, để tôi biết chuyện gì đang xảy ra.

#### Acceptance Criteria

1. IF Worker gặp lỗi không mong đợi khi xử lý request, THEN THE Bot SHALL gửi thông báo cho User với nội dung cho biết đã xảy ra lỗi hệ thống và đề nghị thử lại sau, kèm nút quay về menu chính
2. IF D1 database không phản hồi trong vòng 3 giây hoặc trả về lỗi kết nối, THEN THE Worker SHALL retry tối đa 2 lần với khoảng cách 500ms giữa mỗi lần, trước khi thông báo lỗi cho User
3. THE Worker SHALL ghi log cho mọi lỗi bao gồm: timestamp, error message, user_id (nếu có), callback_query hoặc command đã kích hoạt request, và tên operation bị lỗi
4. WHILE User đang trong flow nhập liệu (thêm acc, nạp tiền), THE Bot SHALL có timeout 5 phút không nhận được input tiếp theo, sau đó huỷ flow, loại bỏ mọi dữ liệu tạm của flow đó, và gửi thông báo cho User cho biết phiên nhập liệu đã hết hạn kèm nút quay về menu chính
5. IF tất cả retry D1 đều thất bại, THEN THE Bot SHALL gửi thông báo cho User cho biết hệ thống đang gặp sự cố tạm thời và đề nghị thử lại sau ít phút, kèm nút quay về menu chính

### Requirement 10: Thông báo đơn hàng mới (Broadcast)

**User Story:** Là chủ hệ thống, tôi muốn bot tự động thông báo cho tất cả user khi có đơn hàng mới, để tạo hiệu ứng FOMO và khuyến khích mua hàng.

#### Acceptance Criteria

1. WHEN một giao dịch mua thành công, THE Bot SHALL gửi thông báo broadcast đến tất cả User đang active (đã tương tác với bot trong 7 ngày gần nhất) với nội dung: "🎉 VỪA CÓ ĐƠN MỚI!" kèm thông tin: username ẩn một phần (vd: Yuke****), tên Category đã mua, số lượng, giá/sản phẩm
2. THE Bot SHALL hiển thị thông báo broadcast kèm nội dung marketing: "⚡ Giao tự động trong vài giây!", "🛒 Số lượng có hạn — mua ngay kẻo hết!"
3. THE Bot SHALL hiển thị nút CTA (Call-To-Action) trong broadcast: "🛒 Mua [tên Category]" và "💰 Nạp tiền"
4. IF Admin muốn tắt broadcast, THE Worker SHALL hỗ trợ cấu hình BROADCAST_ENABLED trong environment variables (mặc định: bật)
5. THE Worker SHALL giới hạn tối đa 1 broadcast mỗi 30 giây để tránh spam khi có nhiều đơn liên tiếp

### Requirement 11: CMS Admin Panel (Vue 3)

**User Story:** Là Admin, tôi muốn có giao diện web CMS quản trị chuyên nghiệp, để quản lý toàn bộ hệ thống một cách trực quan và hiệu quả hơn so với qua bot.

#### Acceptance Criteria

1. THE CMS SHALL được xây dựng bằng Vue 3 (Composition API + script setup), build ra static assets và serve trực tiếp từ Cloudflare Worker (cùng domain hoặc subdomain)
2. THE CMS SHALL có trang Dashboard hiển thị: tổng doanh thu (hôm nay, 7 ngày, 30 ngày, tất cả), tổng số user, tổng đơn hàng, số products còn lại theo từng category, biểu đồ doanh thu theo ngày (line chart)
3. THE CMS SHALL có trang quản lý Users: danh sách user (phân trang, tìm kiếm theo username/telegram_id), xem chi tiết user (balance, lịch sử giao dịch, lịch sử đơn hàng), điều chỉnh balance thủ công (kèm ghi chú lý do)
4. THE CMS SHALL có trang quản lý Categories: CRUD loại sản phẩm (tên, mô tả, giá, icon/emoji), bật/tắt hiển thị trên bot, sắp xếp thứ tự hiển thị (drag & drop)
5. THE CMS SHALL có trang quản lý Products: danh sách products (filter theo category, status), xem buyer info cho product đã bán, xoá product chưa bán
6. THE CMS SHALL có chức năng Import Products hàng loạt: textarea nhập nhiều dòng (mỗi dòng = 1 product content), upload file TXT (mỗi dòng = 1 product), chọn category đích, hiển thị preview số lượng trước khi import, báo cáo kết quả (thành công/trùng/lỗi)
7. THE CMS SHALL có trang quản lý Orders: danh sách đơn hàng (filter theo status, category, date range), xem chi tiết đơn (user, products đã giao, tổng tiền, thời gian)
8. THE CMS SHALL có trang quản lý Transactions: sổ cái tài chính (filter theo type: deposit/purchase/refund/adjust, date range), export CSV
9. THE CMS SHALL có trang quản lý Deposits: danh sách nạp tiền (filter theo status: pending/completed/expired), duyệt thủ công deposit pending chỉ khi webhook SePay bị miss (fallback, không phải flow chính — flow chính là auto 100% qua webhook), xem chi tiết với mã chuyển khoản
10. THE CMS SHALL có trang Cấu hình hệ thống: thông tin ngân hàng (tên NH, số TK, chủ TK), bật/tắt broadcast, số tiền nạp tối thiểu/tối đa, danh sách Admin Telegram IDs, tên shop, thông báo bảo trì
11. THE CMS SHALL có trang Báo cáo & Thống kê: doanh thu theo khoảng thời gian tuỳ chọn, top sản phẩm bán chạy, top user mua nhiều, tỷ lệ chuyển đổi (đăng ký vs mua hàng), biểu đồ trực quan (bar chart, pie chart)
12. THE CMS SHALL sử dụng responsive design, hoạt động tốt trên desktop và tablet

### Requirement 12: CMS Authentication & Authorization

**User Story:** Là chủ hệ thống, tôi muốn CMS được bảo mật cao với xác thực đúng cách, để chỉ admin mới truy cập được.

#### Acceptance Criteria

1. THE CMS SHALL yêu cầu đăng nhập bằng username/password trước khi truy cập bất kỳ trang nào
2. THE Worker SHALL xác thực CMS login bằng cách kiểm tra credentials với bản ghi admin trong D1, password được hash bằng bcrypt hoặc argon2
3. WHEN đăng nhập thành công, THE Worker SHALL tạo JWT token với thời hạn 24 giờ và trả về cho client
4. THE CMS SHALL lưu JWT token trong httpOnly cookie (hoặc localStorage nếu same-origin) và gửi kèm mọi API request trong header Authorization: Bearer
5. IF JWT token hết hạn hoặc không hợp lệ, THEN THE Worker SHALL trả về HTTP 401 và THE CMS SHALL redirect về trang login
6. THE Worker SHALL bảo vệ tất cả API endpoints của CMS (prefix /api/admin/*) bằng middleware kiểm tra JWT token
7. THE Worker SHALL ghi log mọi hành động admin trên CMS: ai làm gì, lúc nào, với dữ liệu nào (audit trail)
8. IF có 5 lần đăng nhập thất bại liên tiếp từ cùng IP trong 15 phút, THEN THE Worker SHALL block IP đó trong 30 phút

### Requirement 13: CMS API Backend

**User Story:** Là developer, tôi muốn CMS giao tiếp với backend qua REST API rõ ràng, để dễ maintain và scale.

#### Acceptance Criteria

1. THE Worker SHALL expose REST API endpoints cho CMS tại prefix /api/admin/ bao gồm: /users, /product-types, /products, /orders, /transactions, /deposits, /stats, /config
2. THE Worker SHALL hỗ trợ các operations: GET (list + detail), POST (create), PUT (update), DELETE cho mỗi resource
3. THE Worker SHALL hỗ trợ query parameters cho listing: page, limit, sort, order, search, filter (theo status, category, date range)
4. THE Worker SHALL trả về response theo format JSON chuẩn: { success: boolean, data: T | null, error: string | null, meta: { total, page, limit } }
5. THE Worker SHALL validate tất cả input từ CMS API bằng schema validation trước khi xử lý
6. THE Worker SHALL hỗ trợ endpoint GET /api/admin/stats/dashboard trả về dữ liệu tổng hợp cho Dashboard (aggregated queries)
7. THE Worker SHALL hỗ trợ endpoint GET /api/admin/stats/revenue?from=DATE&to=DATE trả về doanh thu theo ngày cho biểu đồ
8. THE Worker SHALL hỗ trợ endpoint POST /api/admin/users/:id/adjust-balance cho phép Admin điều chỉnh balance thủ công, bắt buộc kèm field reason
9. THE Worker SHALL hỗ trợ endpoint POST /api/admin/products/import cho phép import hàng loạt: body chứa category_id và mảng contents[], trả về kết quả: { imported: number, duplicates: string[], errors: string[] }
10. THE Worker SHALL hỗ trợ endpoint POST /api/admin/deposits/:id/approve cho phép duyệt thủ công deposit pending

### Requirement 14: Database Schema Design (D1/SQLite)

**User Story:** Là developer, tôi muốn database schema được thiết kế chuẩn, tối ưu cho D1/SQLite, để hệ thống scalable và dễ maintain.

#### Acceptance Criteria

1. THE Database SHALL sử dụng các bảng chính sau với quan hệ foreign key rõ ràng:
   - `users` — thông tin người dùng Telegram
   - `product_types` — danh mục loại sản phẩm (tên, mô tả, giá)
   - `products` — sản phẩm cụ thể (tài khoản số) thuộc một product_type
   - `transactions` — sổ cái giao dịch tài chính (ledger)
   - `deposits` — yêu cầu nạp tiền qua SePay
   - `orders` — đơn hàng (nhóm các accounts trong 1 lần mua)
   - `order_items` — chi tiết đơn hàng (account nào thuộc order nào)
   - `admin_users` — tài khoản admin cho CMS
   - `system_config` — cấu hình hệ thống dạng key-value
   - `audit_logs` — nhật ký hành động admin

2. THE Schema `users` SHALL chứa: id (INTEGER PRIMARY KEY AUTOINCREMENT), telegram_id (INTEGER UNIQUE NOT NULL), username (TEXT), first_name (TEXT), balance (INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0)), is_active (INTEGER DEFAULT 1), last_interaction_at (TEXT), created_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP), updated_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)

3. THE Schema `product_types` SHALL chứa: id (INTEGER PRIMARY KEY AUTOINCREMENT), name (TEXT NOT NULL), description (TEXT), price (INTEGER NOT NULL CHECK(price > 0)), emoji (TEXT DEFAULT '📦'), sort_order (INTEGER DEFAULT 0), is_visible (INTEGER DEFAULT 1), created_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP), updated_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)

4. THE Schema `products` SHALL chứa: id (INTEGER PRIMARY KEY AUTOINCREMENT), type_id (INTEGER NOT NULL REFERENCES product_types(id)), content (TEXT NOT NULL), status (TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','sold','reserved'))), buyer_id (INTEGER REFERENCES users(id)), order_id (INTEGER REFERENCES orders(id)), created_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP), sold_at (TEXT)

5. THE Schema `transactions` SHALL chứa: id (INTEGER PRIMARY KEY AUTOINCREMENT), user_id (INTEGER NOT NULL REFERENCES users(id)), type (TEXT NOT NULL CHECK(type IN ('deposit','purchase','refund','adjustment'))), amount (INTEGER NOT NULL), balance_before (INTEGER NOT NULL), balance_after (INTEGER NOT NULL), reference_type (TEXT), reference_id (INTEGER), description (TEXT), status (TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success','failed','pending'))), created_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)

6. THE Schema `deposits` SHALL chứa: id (INTEGER PRIMARY KEY AUTOINCREMENT), user_id (INTEGER NOT NULL REFERENCES users(id)), transfer_code (TEXT UNIQUE NOT NULL), amount (INTEGER NOT NULL CHECK(amount > 0)), status (TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','expired','cancelled'))), sepay_transaction_id (TEXT), bank_ref (TEXT), completed_at (TEXT), expired_at (TEXT), created_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)

7. THE Schema `orders` SHALL chứa: id (INTEGER PRIMARY KEY AUTOINCREMENT), user_id (INTEGER NOT NULL REFERENCES users(id)), product_type_id (INTEGER NOT NULL REFERENCES product_types(id)), quantity (INTEGER NOT NULL CHECK(quantity > 0)), total_amount (INTEGER NOT NULL), transaction_id (INTEGER REFERENCES transactions(id)), status (TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','refunded'))), created_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)

8. THE Schema `admin_users` SHALL chứa: id (INTEGER PRIMARY KEY AUTOINCREMENT), username (TEXT UNIQUE NOT NULL), password_hash (TEXT NOT NULL), display_name (TEXT), last_login_at (TEXT), failed_login_count (INTEGER DEFAULT 0), locked_until (TEXT), created_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)

9. THE Schema `system_config` SHALL chứa: key (TEXT PRIMARY KEY), value (TEXT NOT NULL), description (TEXT), updated_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP), updated_by (INTEGER REFERENCES admin_users(id))

10. THE Schema `audit_logs` SHALL chứa: id (INTEGER PRIMARY KEY AUTOINCREMENT), admin_id (INTEGER NOT NULL REFERENCES admin_users(id)), action (TEXT NOT NULL), resource_type (TEXT NOT NULL), resource_id (INTEGER), old_value (TEXT), new_value (TEXT), ip_address (TEXT), created_at (TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)

11. THE Database SHALL có các index sau để tối ưu query performance:
    - `idx_users_telegram_id` ON users(telegram_id)
    - `idx_users_last_interaction` ON users(last_interaction_at)
    - `idx_accounts_type_status` ON products(type_id, status)
    - `idx_accounts_buyer` ON products(buyer_id) WHERE buyer_id IS NOT NULL
    - `idx_transactions_user_created` ON transactions(user_id, created_at DESC)
    - `idx_transactions_type_created` ON transactions(type, created_at DESC)
    - `idx_deposits_transfer_code` ON deposits(transfer_code)
    - `idx_deposits_user_status` ON deposits(user_id, status)
    - `idx_deposits_status_created` ON deposits(status, created_at)
    - `idx_orders_user_created` ON orders(user_id, created_at DESC)
    - `idx_audit_logs_admin_created` ON audit_logs(admin_id, created_at DESC)

12. THE Database SHALL sử dụng D1 batch operations (atomic transaction) cho mọi thao tác multi-table write để đảm bảo data consistency

13. THE Database design SHALL hỗ trợ soft-delete pattern (sử dụng status field) thay vì xoá cứng dữ liệu, ngoại trừ bảng system_config

14. THE Schema SHALL lưu tất cả timestamp dạng TEXT ISO 8601 UTC (YYYY-MM-DDTHH:mm:ss.sssZ) để tương thích cross-timezone

15. THE Schema SHALL lưu tất cả monetary values dạng INTEGER (đơn vị VNĐ, không có phần thập phân) để tránh floating point errors

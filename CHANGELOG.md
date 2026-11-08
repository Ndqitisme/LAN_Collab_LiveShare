# Changelog

## 0.2.0

LAN Hub được viết lại thành ứng dụng Windows và bản headless `lanhub-cli`. Extension có quy trình kết nối, chẩn đoán và lịch sử lượt chỉnh sửa mới. Extension 0.2 và LAN Hub 0.1 không làm việc với nhau. Cách nâng cấp nằm trong [docs/upgrade-0.2.md](docs/upgrade-0.2.md).

### LAN Hub
- Ứng dụng LAN Hub cho Windows thay cho `start-hub.bat` và `start-hub.sh`. Máy LAN Hub không cần Node.js. Máy không có Internet dùng bộ cài offline `LanHub_0.2.0_x64-offline-setup.exe`, bộ cài này có sẵn WebView2.
- Một LAN Hub phục vụ nhiều dự án. Mỗi dự án có tên, thư mục, token và danh sách tài khoản được phép riêng, thêm và sửa ngay trong ứng dụng.
- Trang chi tiết dự án có các thẻ Truy cập, Đồng bộ, Lịch sử, Mã mời, Thành viên và Nhật ký.
- "Nhập từ LAN Hub 0.1…" đọc token và danh sách tài khoản từ thư mục hub cũ.
- Bản headless `lanhub-cli` đọc `lanhub.toml`. Thay đổi trong file được áp dụng khi đang chạy, chỉ dự án bị sửa khởi động lại.
- Mã hoá TLS tuỳ chọn. Mã mời chứa dấu vân tay chứng chỉ, nên extension chỉ nhận đúng LAN Hub đã tạo mã mời.
- Địa chỉ công khai tuỳ chọn để thành viên ngoài mạng nội bộ kết nối. Mặc định LAN Hub chỉ phục vụ mạng nội bộ.
- Quản lý LAN Hub headless trên máy khác từ ứng dụng, qua kênh quản trị có token riêng.
- Ứng dụng mở luật tường lửa bằng một lần xác nhận UAC và khởi động cùng Windows nếu được bật.
- `lanhub-cli --diagnose` kiểm tra cấu hình, cổng, địa chỉ mạng, chứng chỉ TLS và luật tường lửa. Trang `http://<địa chỉ>:<cổng>/` hiện tên LAN Hub và danh sách dự án.

### Extension
- Mọi câu chữ được viết lại theo một bảng thuật ngữ, giọng trung tính. Chi tiết kỹ thuật chỉ nằm trong nhật ký.
- Chat, phiên làm việc và lịch sử dùng giao diện mới, theo màu của theme VS Code.
- View "Thành viên" hiện file và dòng mỗi thành viên đang sửa, kèm dòng hoạt động lọc được theo thành viên.
- Thanh trạng thái và bảng lệnh chỉ hiện những gì dùng được ở trạng thái kết nối hiện tại.

### Kết nối và chẩn đoán
- Extension tự tìm LAN Hub trong mạng nội bộ và tự kết nối lại khi máy LAN Hub đổi địa chỉ IP.
- Bảng kết nối chạy từng bước khi tham gia bằng mã mời và chỉ ra bước không qua được kèm cách xử lý.
- "Chẩn đoán kết nối" kiểm tra theo thứ tự cấu hình, địa chỉ, đường mạng, TLS, dự án, token, tài khoản và độ trễ. Lỗi chỉ người quản trị LAN Hub sửa được có nút sao chép thông tin cần gửi.
- Token được lưu trong kho bí mật của VS Code thay cho cài đặt.
- File thay đổi ở cả hai phía trong lúc mất kết nối được liệt kê từng file. Mỗi file chọn được bản trên hub hoặc bản trên máy này. "Khôi phục từ bản sao lưu" liệt kê các bản sao lưu theo thời gian.

### Lịch sử lượt chỉnh sửa
- LAN Hub ghi lịch sử theo lượt chỉnh sửa. Một lượt là chuỗi thay đổi liên tục của một thành viên trên một file. Lượt kết thúc khi thành viên khác sửa file đó, sau 15 phút không sửa, hoặc khi tạo điểm khôi phục.
- Bảng lịch sử so sánh một lượt với nội dung hiện tại trong cửa sổ hai bên và sao chép được đoạn chữ của lượt đó.
- Hoàn tác một lượt chỉ gỡ đúng phần thay đổi của lượt đó và giữ thay đổi của các thành viên khác.
- Điểm khôi phục ghi lại nội dung mọi file của dự án để so sánh hoặc khôi phục sau này.

### Thay đổi không tương thích
- Extension 0.2 chỉ kết nối được LAN Hub 0.2, và LAN Hub 0.2 chỉ nhận extension 0.2. Nâng cấp LAN Hub và mọi thành viên trong cùng một đợt theo [docs/upgrade-0.2.md](docs/upgrade-0.2.md).
- Mã mời bắt đầu bằng `LC-` của bản 0.1 không còn dùng được. Lấy mã mời mới trong ứng dụng LAN Hub.
- Hub Node.js `hub/hub.js` cùng `start-hub.bat` và `start-hub.sh` đã bị gỡ.

## 0.1.1

Cập nhật cả extension và hub. Extension 0.1.1 vẫn làm việc với hub 0.1.0, nhưng chưa gửi được ảnh trong chat.

### Chat
- Gửi ảnh: dán bằng Ctrl+V hoặc chọn file (PNG, JPEG, GIF, WebP, tối đa 4 MB; ảnh lớn được thu nhỏ trước khi gửi). Hub lưu ảnh trong `.lan-collab/history/chat-media/`.
- Bảng chọn emoji, gợi ý `@tên` khi gõ, định dạng `code` và khối mã, liên kết web.
- Giao diện mới: gom tin liên tiếp, vạch chia ngày, avatar thành viên, nút cuộn tới tin mới.
- `@tên` chỉ khớp trọn tên. Tin của mình được nhận đúng sau khi kết nối lại. Nội dung được giữ lại khi gửi không thành công.

### Đồng bộ
- Hub trả lời ngay khi không nhận một file (bị loại trừ, không ghi được) và gửi danh sách loại trừ của mình cho máy khách. Với hub cũ, máy khách ngừng chờ sau 20 giây. Thông báo tiến trình đồng bộ có thể đóng.
- File nhị phân chỉ được xem là đã đồng bộ khi hub xác nhận đã lưu.
- File lớn truyền chậm không còn bị ngắt kết nối sau 35 giây. File lớn hơn khoảng 300 MB được bỏ qua kèm cảnh báo.
- Đồng bộ lại trong lúc một thay đổi đang gửi không còn áp dụng thay đổi đó hai lần.
- Hub luôn trả lời một thay đổi không áp dụng được, thay vì bỏ qua.
- `lanCollab.exclude` bảo vệ cả file nhận về: thay đổi từ máy khác không ghi đè hoặc xoá file mà máy này loại trừ.

### Bảo mật
- Extension từ chối đường dẫn từ hub nằm ngoài thư mục dự án.
- Hub và extension từ chối các cách viết khác của cùng một tên trên Windows (tên ngắn 8.3, tên kết thúc bằng dấu chấm hoặc khoảng trắng, `tên:luồng`, tên thiết bị).
- Hub đóng kết nối chưa đăng nhập sau 15 giây hoặc khi thông điệp vượt 64 KB.

## 0.1.0

Phát hành lần đầu.

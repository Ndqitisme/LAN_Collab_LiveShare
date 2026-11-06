# Changelog

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

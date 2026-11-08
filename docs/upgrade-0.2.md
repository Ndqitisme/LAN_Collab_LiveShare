# Nâng cấp từ LAN Collab 0.1 lên 0.2

Tài liệu này dành cho người quản trị LAN Hub đang chạy hub 0.1 bằng `start-hub.bat` hoặc `start-hub.sh`. Làm xong, LAN Hub 0.2 phục vụ đúng các dự án cũ với cùng token và cùng danh sách tài khoản được phép, và mọi thành viên kết nối lại bằng extension 0.2 mà không phải đồng bộ lại từ đầu.

Extension 0.2 chỉ làm việc với LAN Hub 0.2, và LAN Hub 0.2 chỉ nhận extension 0.2. Extension 0.1.1 kết nối tới LAN Hub 0.2 nhận thông báo cần cập nhật lên 0.2 và không thay đổi file nào. Vì vậy nâng cấp LAN Hub và mọi thành viên trong cùng một đợt.

## Những gì giữ nguyên

- Thư mục dự án và thư mục `.lan-collab/` bên trong nằm nguyên chỗ cũ. LAN Hub 0.2 phục vụ thẳng thư mục đó.
- `.lan-collab/hub.json` giữ nguyên `id`. Extension nhận ra đúng dự án đã đồng bộ, nên thành viên không phải đồng bộ lại từ đầu và không thấy bảng đồng bộ lần đầu.
- Token và danh sách tài khoản được phép được nhập từ thư mục hub 0.1.
- Lịch sử chat trong `.lan-collab/history/chat.jsonl` và ảnh trong `.lan-collab/history/chat-media/` vẫn hiện trong chat.
- Ảnh chụp file 10 phút một lần và bản sao trước khi xoá của hub 0.1 nằm nguyên trong `.lan-collab/history/`. LAN Hub 0.2 không chuyển chúng thành lượt chỉnh sửa. Lịch sử lượt chỉnh sửa bắt đầu từ lúc chạy LAN Hub 0.2.

## Trước khi bắt đầu

- Chọn thời điểm không ai đang sửa. Báo thành viên lưu file và chờ.
- Ghi lại cổng hub 0.1 đang dùng, là dòng `set "PORT=..."` trong `start-hub.bat`. Mặc định là `8200`.
- Lấy sẵn `LanHub_<phiên bản>_x64-setup.exe` (hoặc `LanHub_<phiên bản>_x64-offline-setup.exe` khi máy LAN Hub không có Internet) và `lan-collab-<phiên bản>.vsix` của bản 0.2 từ trang Releases.

## Bước 1. Dừng hub 0.1

Đóng mọi cửa sổ `start-hub.bat` trên máy chủ, hoặc dừng dịch vụ chạy `hub.js` nếu hub chạy như dịch vụ. Hub 0.1 ghi các file đang chờ rồi thoát, và cổng 8200 được giải phóng.

Không xoá thư mục hub 0.1. Bước 3 đọc token và danh sách tài khoản từ đó.

## Bước 2. Cài ứng dụng LAN Hub

Cài trên chính máy đã chạy hub 0.1, để địa chỉ IP mà thành viên đã lưu vẫn đúng.

1. Chạy `LanHub_<phiên bản>_x64-setup.exe`. Bộ cài cài cho tài khoản Windows đang đăng nhập và không cần quyền quản trị.
2. Bộ cài chưa được ký số, nên SmartScreen có thể chặn. Bấm **Thông tin thêm** rồi **Vẫn chạy**.
3. Mở **LAN Hub** từ menu Start. Cửa sổ hiện danh sách dự án trống.

Máy LAN Hub không cần Node.js nữa.

## Bước 3. Nhập dự án từ hub 0.1

1. Bấm **Nhập từ LAN Hub 0.1…**.
2. Bấm **Chọn thư mục…** và chọn thư mục chứa `start-hub.bat` của hub 0.1.
3. LAN Hub đọc thư mục và liệt kê mỗi dự án có file `token-<dự án>.txt`:
   - Token lấy từ `token-<dự án>.txt`.
   - Danh sách tài khoản được phép lấy từ `allowed-accounts-<dự án>.txt`, nếu có.
   - Thư mục dự án lấy từ dòng `set "ROOT=..."` của file `.bat` có `set "PROJECT=<dự án>"`, hiện là **Lấy từ start-hub.bat**.
4. Với dự án không có thư mục lấy được từ file `.bat`, bấm **Chọn thư mục…** cạnh dự án và chọn thư mục dự án.
5. Bỏ chọn dự án không muốn nhập. Dự án đã có trong LAN Hub hiện **Đã có trong LAN Hub** và không bị nhập lại.
6. Bấm **Nhập {n} dự án**.

LAN Hub bắt đầu phục vụ các dự án vừa nhập. Mở từng dự án, tab **Truy cập**, để kiểm tra token và danh sách tài khoản được phép giống hub 0.1.

## Bước 4. Giữ cùng cổng

Nếu hub 0.1 dùng cổng khác `8200`:

1. Bấm biểu tượng bánh răng **Cài đặt LAN Hub**.
2. Đặt **Cổng TCP** bằng cổng của hub 0.1.
3. Bấm **Lưu cài đặt**.

Thành viên đã lưu địa chỉ và cổng cũ, nên LAN Hub phải nghe đúng cổng đó để họ kết nối lại không cần mã mời mới.

## Bước 5. Mở tường lửa

1. Trong **Cài đặt LAN Hub**, ở thẻ **Tường lửa Windows**, bấm **Mở tường lửa**.
2. Windows hỏi quyền quản trị một lần. Chọn **Có**.

Ứng dụng thêm quy tắc `LAN Hub TCP <cổng>` và quy tắc mới `LAN Hub UDP 8201`. Quy tắc UDP cho extension tự tìm lại LAN Hub khi máy LAN Hub đổi địa chỉ IP. Hub 0.1 không có tính năng này, nên quy tắc UDP chưa có. Hai cổng hiện **Đã mở** là xong.

Quy tắc tường lửa cũ cho `node.exe` không còn cần. Xoá nó trong Windows Defender Firewall khi đã chắc không còn chạy hub 0.1.

## Bước 6. Kiểm tra LAN Hub

1. Từ một máy thành viên, mở `http://<IP của máy LAN Hub>:<cổng>/` trong trình duyệt.
2. Trang hiện tên LAN Hub, phiên bản và các dự án đang quảng bá.

Nếu trang không mở, xem lại bước 5 trước khi cập nhật thành viên.

## Bước 7. Bật chạy khi đăng nhập

Trong **Cài đặt LAN Hub**, ở thẻ **Khởi động**, bật **Chạy LAN Hub khi đăng nhập Windows**. LAN Hub chạy ẩn trong khay hệ thống sau mỗi lần đăng nhập, thay cho việc mở `start-hub.bat` bằng tay.

## Bước 8. Cập nhật extension trên mọi máy thành viên

Trên từng máy thành viên:

1. Cài extension 0.2:

   ```
   code --install-extension lan-collab-<phiên bản>.vsix
   ```

2. Khởi động lại VS Code và mở thư mục dự án như mọi khi.

Lần chạy đầu, extension chuyển token từ cài đặt và từ dữ liệu của bản 0.1 vào kho bí mật của hệ điều hành. Extension kết nối tới đúng địa chỉ và cổng cũ, nhận ra dự án qua `id` trong `hub.json`, và thanh trạng thái hiện số thành viên. Không có bảng đồng bộ lần đầu.

Máy nào hiện **Cần xử lý** hoặc **Chưa kết nối được** thì chạy **LAN Collab: Chẩn đoán kết nối** và làm theo kết quả. Bảng xử lý từng lỗi nằm ở mục "Đọc chẩn đoán kết nối" của [README](../README.md#đọc-chẩn-đoán-kết-nối).

## Bước 9. Gửi mã mời mới cho thành viên mới

Mã mời `LC-` của hub 0.1 không dùng được với extension 0.2. Dán mã đó, extension báo mã chỉ dành cho LAN Collab 0.1 và không thay đổi file nào. Thành viên mới lấy mã mời `LC3-` trong ứng dụng LAN Hub: mở dự án, tab **Mã mời**, bấm **Sao chép mã mời**.

## Bước 10. Dọn thư mục hub 0.1

Khi mọi thành viên đã kết nối lại, thư mục hub 0.1 không còn được dùng. Thư mục đó chứa token ở dạng văn bản, nên xoá nó hoặc chuyển vào nơi chỉ người quản trị LAN Hub đọc được.

## Hub 0.1 chạy trên Linux

Với hub 0.1 chạy bằng `start-hub.sh`, dùng `lanhub-cli` thay cho ứng dụng LAN Hub. Viết `lanhub.toml` với mỗi dự án một mục `[[project]]`:

```toml
[hub]
port = 8200

[[project]]
name = "MyProject"
root = "/srv/lan-collab/MyProject"
token = "<nội dung token-MyProject.txt>"
allow_file = "/opt/lan-collab/hub/allowed-accounts-MyProject.txt"
```

`allow_file` đọc thẳng file danh sách tài khoản của hub 0.1. Mở thêm cổng UDP 8201 trên tường lửa của máy chủ, rồi chạy dịch vụ theo [Chạy LAN Hub trên máy chủ](lanhub-server.md). Bước 8 đến bước 10 giữ nguyên.

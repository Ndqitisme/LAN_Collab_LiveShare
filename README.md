<img src="media/icon.png" alt="LAN Collab" width="96" align="right">

# LAN Collab

Tiếng Việt | [English](README.en.md)

LAN Collab cho nhiều thành viên cùng sửa một dự án trong VS Code theo thời gian thực, qua mạng nội bộ. Mỗi máy giữ bản sao thật của mọi file trong dự án, nên mỗi thành viên tự chạy chương trình, dùng debugger và công cụ AI trên máy mình, trong khi thay đổi vẫn đồng bộ ngay tới các máy khác.

LAN Collab gồm hai phần:

- **LAN Hub** là máy chủ đồng bộ. Ứng dụng LAN Hub chạy trên một máy Windows trong mạng LAN và phục vụ nhiều dự án trên một cổng. Bản headless `lanhub-cli` chạy cùng cấu hình trên Windows hoặc Linux, kể cả trên máy chủ ngoài.
- **Extension LAN Collab** cho VS Code. Thành viên dán mã mời là tham gia dự án. Extension tự chẩn đoán khi không kết nối được và giữ lịch sử lượt chỉnh sửa của từng thành viên.

LAN Hub không cần Internet hay dịch vụ bên thứ ba.

## Mục lục

- [Tính năng](#tính-năng)
- [Yêu cầu](#yêu-cầu)
- [Cài ứng dụng LAN Hub](#cài-ứng-dụng-lan-hub)
- [Chạy LAN Hub không giao diện](#chạy-lan-hub-không-giao-diện)
- [Cài extension](#cài-extension)
- [Tham gia dự án bằng mã mời](#tham-gia-dự-án-bằng-mã-mời)
- [Đọc chẩn đoán kết nối](#đọc-chẩn-đoán-kết-nối)
- [Dùng lịch sử lượt chỉnh sửa](#dùng-lịch-sử-lượt-chỉnh-sửa)
- [Chat](#chat)
- [Lệnh và cài đặt của extension](#lệnh-và-cài-đặt-của-extension)
- [Làm việc với Git](#làm-việc-với-git)
- [Cơ chế đồng bộ](#cơ-chế-đồng-bộ)
- [Bảo mật](#bảo-mật)
- [Giới hạn đã biết](#giới-hạn-đã-biết)
- [Xử lý sự cố](#xử-lý-sự-cố)
- [Phát triển](#phát-triển)
- [Giấy phép](#giấy-phép)

## Tính năng

- **Sửa đồng thời theo thời gian thực.** Mỗi thao tác gõ được gửi tới các máy khác ngay. Nhiều thành viên sửa cùng một file vẫn hội tụ về cùng nội dung nhờ Operational Transformation (OT).
- **File thật trên mọi máy.** Thay đổi do công cụ AI, script hay Git ghi thẳng xuống ổ đĩa cũng được phát hiện, gộp với phần đang sửa dở rồi đồng bộ đi.
- **Một LAN Hub, nhiều dự án.** Mỗi dự án có token, danh sách tài khoản được phép và mã mời riêng. Thêm, sửa hay tạm dừng một dự án không làm gián đoạn dự án khác.
- **Kết nối tự chẩn đoán.** Extension thử song song mọi địa chỉ của LAN Hub, tự tìm lại LAN Hub trong mạng LAN khi địa chỉ đổi, và khi không kết nối được thì nói rõ bước nào hỏng và cần làm gì.
- **Lịch sử lượt chỉnh sửa.** LAN Hub ghi lại từng lượt chỉnh sửa của từng thành viên. Thành viên xem nội dung sau một lượt cạnh bản hiện tại, sao chép, hoàn tác riêng lượt đó hoặc khôi phục file đã xoá.
- **Nhận biết hoạt động của nhóm.** Con trỏ và vùng chọn của từng thành viên theo màu riêng, danh sách thành viên kèm file và dòng đang sửa, nhật ký hoạt động, chế độ đi theo một thành viên.
- **Chat trong VS Code.** Nhắc tên bằng `@tên`, tham chiếu `file:dòng` bấm được, gửi ảnh, lịch sử chat lưu trên LAN Hub.
- **Chịu được mất kết nối.** Thành viên tiếp tục sửa khi mất mạng. Khi kết nối lại, thay đổi hai phía được gộp ba chiều. File đổi ở cả hai phía được liệt kê để thành viên chọn bản giữ lại.

## Yêu cầu

| Thành phần | Yêu cầu |
|---|---|
| Ứng dụng LAN Hub | Windows 10 hoặc 11, 64 bit. Bộ cài tự cài WebView2 khi máy chưa có |
| `lanhub-cli` | Windows 64 bit, hoặc Linux x86_64 |
| Extension | VS Code 1.80 trở lên |
| Mạng | Máy thành viên kết nối được tới máy chạy LAN Hub qua cổng TCP 8200. Tìm LAN Hub trong mạng LAN dùng cổng UDP 8201 |

Extension 0.2 chỉ làm việc với LAN Hub 0.2. Nhóm đang dùng LAN Collab 0.1 làm theo [Nâng cấp từ LAN Collab 0.1](docs/upgrade-0.2.md).

## Cài ứng dụng LAN Hub

Cài ứng dụng LAN Hub trên một máy luôn bật trong mạng LAN. Máy này giữ bản trên hub của mọi dự án.

### Cài đặt

1. Tải `LanHub_<phiên bản>_x64-setup.exe` từ trang Releases của repository.
2. Chạy bộ cài. Bộ cài cài cho tài khoản Windows đang đăng nhập và không cần quyền quản trị.
3. Bộ cài chưa được ký số, nên Windows SmartScreen có thể chặn. Bấm **Thông tin thêm** rồi **Vẫn chạy**.
4. Mở **LAN Hub** từ menu Start.

Lần chạy đầu, cửa sổ hiện danh sách dự án trống với hai nút **Thêm dự án** và **Nhập từ LAN Hub 0.1…**. Cấu hình lưu ở `%APPDATA%\LanHub\lanhub.toml`.

### Thêm dự án

1. Bấm **Thêm dự án**.
2. Nhập **Tên dự án**. Thành viên thấy tên này khi tham gia.
3. Bấm **Chọn thư mục…** và chọn thư mục chứa mã nguồn của dự án. LAN Hub đồng bộ mọi file trong thư mục này, trừ các mẫu loại trừ.
4. Giữ **Phục vụ dự án** bật. Giữ **Quảng bá trong mạng LAN** bật nếu muốn tên dự án hiện khi thành viên tìm LAN Hub trong mạng LAN.
5. Bấm **Thêm dự án**.

LAN Hub tạo token ngẫu nhiên cho dự án và bắt đầu phục vụ ngay. Mở dự án để thấy các tab:

| Tab | Nội dung |
|---|---|
| **Tổng quan** | Số thành viên, số file, hoạt động gần nhất, thư mục, trạng thái |
| **Truy cập** | Token (hiện, sao chép, đổi token) và danh sách tài khoản được phép, mỗi dòng một tài khoản dạng `github:tên` hoặc `microsoft:email`. Danh sách trống thì mọi máy có token đều vào được |
| **Đồng bộ** | Mẫu loại trừ, kèm danh sách file khớp mẫu |
| **Lịch sử** | Giới hạn lịch sử lượt chỉnh sửa (thời gian chờ, số ngày giữ, dung lượng tối đa) và nút **Dọn lịch sử ngay** |
| **Mã mời** | Mã mời `LC3-` kèm mã QR và nút **Sao chép mã mời** |
| **Thành viên** | Thành viên đang kết nối, địa chỉ IP, file đang mở, độ trễ |
| **Nhật ký** | Nhật ký của dự án, có tìm kiếm, lọc và **Xuất nhật ký…** |
| **Cài đặt** | Sửa tên, thư mục, tạm dừng hoặc **Xoá dự án**. Xoá dự án không xoá file |

Đổi token làm mọi mã mời cũ của dự án hết hiệu lực. Thành viên đã kết nối cần mã mời mới.

### Mở tường lửa

Windows chặn kết nối từ máy khác tới LAN Hub cho tới khi có quy tắc tường lửa.

1. Trong ứng dụng LAN Hub, bấm biểu tượng bánh răng **Cài đặt LAN Hub** ở đầu cửa sổ.
2. Ở thẻ **Tường lửa Windows**, bấm **Mở tường lửa**.
3. Windows hỏi quyền quản trị một lần. Chọn **Có**.

Ứng dụng thêm quy tắc `LAN Hub TCP 8200` cho cổng kết nối và `LAN Hub UDP 8201` cho tìm LAN Hub trong mạng LAN, theo cổng đang cấu hình. Thẻ hiện trạng thái từng cổng: **Đã mở**, **Chưa mở**, **Quy tắc đang tắt** hoặc **Bị chặn**. **Sao chép lệnh** cho lệnh `netsh` tương ứng để chạy tay. Máy thành viên không cần mở cổng nào.

### Chạy khi đăng nhập và khay hệ thống

- Ở thẻ **Khởi động** của màn hình **Cài đặt LAN Hub**, bật **Chạy LAN Hub khi đăng nhập Windows**. LAN Hub chạy ẩn trong khay hệ thống và phục vụ dự án mà không mở cửa sổ.
- Đóng cửa sổ thì LAN Hub thu xuống khay hệ thống và vẫn phục vụ dự án. Menu khay có **Mở LAN Hub**, tạm dừng hoặc tiếp tục từng dự án, **Sao chép mã mời** và **Thoát**. **Thoát** ghi mọi file đang chờ rồi mới dừng.
- Mỗi máy chỉ chạy một ứng dụng LAN Hub. Mở lần hai thì cửa sổ đang chạy hiện lên.

### Cài đặt LAN Hub

Màn hình **Cài đặt LAN Hub** áp dụng thay đổi ngay khi bấm **Lưu cài đặt**, không cần khởi động lại:

- **Tên LAN Hub**. Để trống thì dùng tên máy.
- **Địa chỉ nhận kết nối** và **Cổng TCP**, mặc định `0.0.0.0` và `8200`.
- **Cho máy khác tự tìm LAN Hub** và **Cổng UDP để tìm LAN Hub**, mặc định bật và `8201`.
- **Địa chỉ công khai** và **Mã hoá kết nối bằng TLS**, dùng khi thành viên kết nối từ ngoài mạng LAN. Xem [Chạy LAN Hub trên máy chủ](docs/lanhub-server.md).

**Thêm LAN Hub từ xa** quản lý một `lanhub-cli` trên máy chủ khác như LAN Hub trên máy này. Cách bật quản trị từ xa nằm ở [Chạy LAN Hub trên máy chủ](docs/lanhub-server.md).

### Kiểm tra từ trình duyệt

Khi LAN Hub chạy, mở `http://<IP của máy LAN Hub>:8200/` trong trình duyệt của máy thành viên. Trang hiện tên LAN Hub, phiên bản và các dự án đang quảng bá. Trang mở được nghĩa là mạng và tường lửa đã thông, lỗi còn lại nằm ở phía extension. LAN Hub bật TLS vẫn trả trang này qua `http://`.

## Chạy LAN Hub không giao diện

`lanhub-cli` là LAN Hub không có cửa sổ, dùng trên máy chủ hoặc khi không muốn cài ứng dụng. Nó đọc cùng định dạng `lanhub.toml` với ứng dụng LAN Hub và áp dụng lại file mỗi khi file đổi.

1. Tải `lanhub-cli-<phiên bản>-<nền tảng>.zip` (Windows) hoặc `lanhub-cli-<phiên bản>-x86_64-unknown-linux-gnu.tar.gz` (Linux) từ trang Releases và giải nén.
2. Viết `lanhub.toml` theo bảng dưới đây.
3. Kiểm tra cấu hình, cổng và tường lửa mà không thay đổi gì:

   ```
   lanhub-cli --diagnose --config lanhub.toml
   ```

4. Chạy LAN Hub:

   ```
   lanhub-cli --config lanhub.toml
   ```

   Mỗi dự án in một dòng `Mã mời: LC3-...` khi khởi động. Gửi mã đó cho thành viên.

Không có `--config`, `lanhub-cli` đọc `%APPDATA%\LanHub\lanhub.toml` trên Windows và `$XDG_CONFIG_HOME/lanhub/lanhub.toml` (mặc định `~/.config/lanhub/lanhub.toml`) trên Linux. Chạy như dịch vụ systemd hoặc dịch vụ Windows, bật TLS, địa chỉ công khai và quản trị từ xa: xem [Chạy LAN Hub trên máy chủ](docs/lanhub-server.md).

### Tham chiếu `lanhub.toml`

Ví dụ đầy đủ có chú thích: [`lanhub/examples/lanhub.toml`](lanhub/examples/lanhub.toml). Khoá không có trong bảng là lỗi. Đường dẫn tương đối tính từ thư mục chứa file.

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `[hub] name` | tên máy | Tên LAN Hub thành viên thấy |
| `[hub] bind` | `"0.0.0.0"` | Địa chỉ nhận kết nối |
| `[hub] port` | `8200` | Cổng TCP dùng chung cho mọi dự án |
| `[hub] discovery` | `true` | Trả lời khi extension tìm LAN Hub trong mạng LAN |
| `[hub] discovery_port` | `8201` | Cổng UDP để tìm LAN Hub |
| `[hub] public_address` | `[]` | Tên miền hoặc IP công khai. Mã mời đặt các địa chỉ này lên đầu |
| `[hub.tls] enabled` | `false` | Bật TLS. Mã mời mang vân tay chứng chỉ |
| `[hub.tls] cert`, `key` | không có | Chứng chỉ và khoá PEM có sẵn, luôn đi cùng nhau. Không đặt thì LAN Hub tự tạo chứng chỉ tự ký một lần |
| `[hub.admin] remote` | `false` | Bật quản trị từ xa |
| `[hub.admin] token`, `token_sha256` | không có | Token quản trị (ít nhất 16 ký tự) hoặc SHA-256 của nó. Chỉ đặt một trong hai |
| `[[project]] name` | bắt buộc | Tên dự án, không phân biệt chữ hoa và chữ thường |
| `[[project]] root` | bắt buộc | Thư mục dự án |
| `[[project]] enabled` | `true` | `false` thì tạm dừng dự án |
| `[[project]] token` | `""` | Token của dự án. Chuỗi rỗng cho mọi máy trong mạng vào |
| `[[project]] allow` | `[]` | Danh sách tài khoản được phép. Rỗng thì mọi máy có token đều vào |
| `[[project]] allow_file` | không có | File danh sách tài khoản của LAN Collab 0.1, cộng thêm vào `allow` |
| `[[project]] exclude` | `[]` | Mẫu loại trừ, cộng thêm vào danh sách mặc định |
| `[[project]] advertise` | `true` | Hiện tên dự án khi tìm LAN Hub trong mạng LAN |
| `[project.history] enabled` | `true` | Ghi lịch sử lượt chỉnh sửa |
| `[project.history] idle_minutes` | `15` | Lượt chỉnh sửa kết thúc sau từng này phút không sửa |
| `[project.history] keep_days` | `30` | Lượt chỉnh sửa cũ hơn bị xoá |
| `[project.history] max_mb` | `2048` | Dung lượng lịch sử tối đa của dự án |

Danh sách loại trừ mặc định: `.git`, `.lan-collab`, `.venv`, `venv`, `node_modules`, `__pycache__`, `*.pyc`, `*.lc-tmp`, `~$*`, `.DS_Store`, `Thumbs.db`.

## Cài extension

1. Tải `lan-collab-<phiên bản>.vsix` từ trang Releases.
2. Cài bằng lệnh:

   ```
   code --install-extension lan-collab-<phiên bản>.vsix
   ```

   Hoặc trong VS Code: **Extensions**, menu `···`, **Install from VSIX…**.

Thanh hoạt động bên trái có thêm biểu tượng **LAN Collab**. Khi chưa kết nối, mục **Bắt đầu** có hai liên kết **Thiết lập kết nối** và **Tham gia bằng mã mời**. Trang **Bắt đầu với LAN Collab** trong phần Walkthroughs của VS Code đi qua các bước lấy mã mời, tham gia, kiểm tra kết nối, chat và xem lịch sử.

Cập nhật bằng cách cài file `.vsix` mới theo cùng cách. VS Code thay bản cũ.

## Tham gia dự án bằng mã mời

Mã mời bắt đầu bằng `LC3-`. Mã chứa mọi địa chỉ IPv4 của máy LAN Hub, cổng, tên dự án, token, và vân tay chứng chỉ khi LAN Hub bật TLS.

1. Lấy mã mời ở một trong các nơi sau:
   - Ứng dụng LAN Hub: mở dự án, tab **Mã mời**, bấm **Sao chép mã mời**.
   - Menu khay của LAN Hub: **Sao chép mã mời**.
   - Một thành viên đã kết nối: chạy **LAN Collab: Sao chép mã mời**.
2. Trên máy mới, mở một thư mục trống trong VS Code, hoặc không mở thư mục nào.
3. Nhấn `Ctrl+Shift+P`, chạy **LAN Collab: Tham gia bằng mã mời** và dán mã.
4. Extension kiểm tra mã với LAN Hub trước khi ghi bất kỳ file nào.
5. Nếu thư mục đang mở không trống, chọn hoặc tạo một thư mục trống cho dự án. VS Code mở thư mục đó.
6. Extension kết nối và tải toàn bộ dự án. Thanh trạng thái hiện **Đang đồng bộ**, rồi số thành viên khi đã sẵn sàng.

Thư mục đã tham gia ghi nhớ LAN Hub của nó trên máy đó, nên lần mở sau tự kết nối. Token được lưu trong kho bí mật của hệ điều hành, không nằm trong cài đặt.

Tham gia vào một thư mục đã có file thì extension mở bảng đồng bộ trước khi ghi gì. Bảng liệt kê từng file khác bản trên hub, mỗi file chọn được **Bản trên hub**, **Bản trên máy này** hoặc **Gộp**, kèm nút **So sánh**. File bị thay được sao lưu vào `.lan-collab/backup/`. Lệnh **LAN Collab: Khôi phục từ bản sao lưu** lấy lại các bản đó.

Mã mời bắt đầu bằng `LC-` là mã của LAN Collab 0.1. Extension 0.2 không đọc mã này và không thay đổi file nào. Lấy mã mời mới trong ứng dụng LAN Hub.

Khi không dùng được mã mời, mở **LAN Collab: Thiết lập kết nối**. Bảng này cho dán mã mời, chọn một LAN Hub tìm thấy trong mạng LAN, hoặc nhập địa chỉ, cổng, dự án và token bằng tay.

## Đọc chẩn đoán kết nối

### Thanh trạng thái

| Chữ trên thanh trạng thái | Ý nghĩa |
|---|---|
| `LAN Collab` | Chưa kết nối |
| **Đang tìm LAN Hub**, **Đang kết nối**, **Đang đồng bộ** | Đang kết nối tới LAN Hub |
| **4 thành viên** | Đã kết nối, đang đồng bộ theo thời gian thực |
| **Mất kết nối** | Đang kết nối lại sau 1, 2, 5, 10 rồi 30 giây. Thay đổi trên máy này được gửi khi kết nối lại |
| **Chưa kết nối được** | Chưa lần nào kết nối được trong phiên này, extension vẫn đang thử lại |
| **Cần xử lý** | LAN Hub từ chối kết nối. Thông báo kèm theo nói lý do và có nút xử lý |

Bấm thanh trạng thái để mở menu LAN Collab.

### Chẩn đoán kết nối

Mỗi lần kết nối lại, extension thử song song mọi địa chỉ đã biết. Khi không địa chỉ nào trả lời, extension tìm LAN Hub trong mạng LAN theo mã định danh trong mã mời, tìm thấy ở địa chỉ mới thì tự cập nhật và kết nối tiếp.

Khi vẫn không kết nối được, chạy **LAN Collab: Chẩn đoán kết nối**, hoặc bấm **Chẩn đoán** trên thông báo lỗi hay trong bảng **Kết nối LAN Hub**. Lệnh chạy tám bước theo thứ tự và hiện kết quả từng bước là **Đạt**, **Đã tự khắc phục**, **Không đạt** hoặc **Bỏ qua**:

1. **Cấu hình thư mục**: thư mục đã gắn với LAN Hub chưa.
2. **Kết nối tới địa chỉ đã biết**: thử mọi địa chỉ trong mã mời và địa chỉ kết nối được lần trước, mỗi địa chỉ chờ 3 giây.
3. **Tìm LAN Hub trong mạng LAN**: tìm qua UDP khi bước 2 không thành công.
4. **Đường mạng tới LAN Hub**: phân loại lỗi mạng.
5. **Vân tay TLS**: so chứng chỉ của LAN Hub với vân tay trong mã mời.
6. **Phiên bản, dự án, token và tài khoản**: LAN Hub có nhận máy này không.
7. **Thư mục dự án**: có ghi được không, có phải thư mục của dự án khác không.
8. **Độ trễ tới LAN Hub**.

**Sao chép báo cáo** sao chép kết quả kèm phiên bản và card mạng, đã che token và mã mời, để gửi cho người quản trị LAN Hub.

### Từng lỗi và cách xử lý

| Kết quả chẩn đoán | Nguyên nhân | Cách xử lý |
|---|---|---|
| Thư mục này chưa gắn với LAN Hub nào | Thư mục chưa tham gia dự án | Chạy **Tham gia bằng mã mời** |
| LAN Hub chưa chạy hoặc sai cổng | Máy LAN Hub từ chối kết nối ở cổng đó | Mở ứng dụng LAN Hub và kiểm tra dự án đang chạy. Kiểm tra cổng trong mã mời trùng với **Cổng TCP** của LAN Hub |
| Cổng không phản hồi sau 3 giây | Tường lửa trên máy LAN Hub chặn cổng, hai máy khác mạng con, hoặc VPN đang bật | Bấm **Mở tường lửa** trong ứng dụng LAN Hub. Tắt VPN. Mở `http://<IP>:8200/` trong trình duyệt để kiểm tra mạng |
| Máy này không có đường mạng tới địa chỉ | Hai máy không cùng mạng | Nối hai máy vào cùng mạng LAN và tắt VPN |
| Không tìm thấy LAN Hub trong mạng LAN | LAN Hub chưa chạy, đã tắt tìm kiếm trong mạng LAN, hoặc tường lửa chặn cổng UDP 8201 | Kiểm tra LAN Hub đang chạy và quy tắc `LAN Hub UDP 8201`. Hoặc dán mã mời mới có địa chỉ hiện tại |
| Chưa tìm được LAN Hub vì thư mục chưa có mã định danh | Thư mục được thiết lập bằng tay và chưa kết nối lần nào | Dán mã mời mới |
| Chứng chỉ TLS khác vân tay trong mã mời | LAN Hub đổi chứng chỉ, hoặc có máy khác đứng giữa | Extension dừng và không tự bỏ qua. Lấy mã mời mới từ người quản trị LAN Hub |
| Cổng nhận kết nối nhưng không trả lời theo giao thức LAN Hub | Một chương trình khác dùng cổng đó | Kiểm tra địa chỉ và cổng trong mã mời |
| LAN Hub từ chối token của máy này | Token đã đổi hoặc mã mời đã cũ | **Dán mã mời mới** hoặc **Nhập token** |
| LAN Hub không có dự án | Tên dự án sai, hoặc dự án đã bị xoá hay tạm dừng | **Chọn dự án** trong danh sách LAN Hub đang phục vụ, hoặc dán mã mời mới |
| LAN Hub chỉ nhận tài khoản trong danh sách tài khoản được phép | Dự án có danh sách tài khoản và VS Code chưa đăng nhập | **Đăng nhập** GitHub hoặc Microsoft trong VS Code |
| Tài khoản chưa có trong danh sách tài khoản được phép | Người quản trị LAN Hub chưa thêm tài khoản | **Sao chép dòng** và gửi cho người quản trị LAN Hub để thêm vào tab **Truy cập**, hoặc **Đổi tài khoản** |
| LAN Hub dùng phiên bản giao thức mới hơn hoặc cũ hơn | Extension và LAN Hub khác phiên bản | Cập nhật bên cũ hơn. Extension 0.2 cần LAN Hub 0.2 |
| Không ghi được vào thư mục | Thư mục chỉ đọc | Cấp quyền ghi hoặc chọn thư mục khác |
| Thư mục là thư mục dự án của một LAN Hub khác | Thư mục đã gắn với LAN Hub khác | Chọn một thư mục trống |

Khi bước mạng không đạt, bảng **Kết nối LAN Hub** có thêm **Thử lại**, **Tìm lại LAN Hub** và **Hướng dẫn mở tường lửa** với lệnh PowerShell cho máy LAN Hub.

## Dùng lịch sử lượt chỉnh sửa

Một lượt chỉnh sửa là chuỗi thay đổi liên tục của một thành viên trên một file. Lượt chỉnh sửa kết thúc khi thành viên khác sửa file đó, khi thành viên ngừng sửa quá 15 phút, khi file bị xoá hoặc đổi tên, hoặc khi LAN Hub dừng. LAN Hub ghi nội dung file ở đầu và cuối mỗi lượt, kèm nguồn thay đổi: gõ trong editor, công cụ ngoài editor, hoàn tác hay gộp khi kết nối lại.

Mở mục **Lịch sử chỉnh sửa** trong thanh LAN Collab, chạy **LAN Collab: Xem lịch sử chỉnh sửa**, hoặc nhấn `Ctrl+Alt+L` rồi `H`. Chọn **File đang mở** hoặc **Toàn dự án**. Mỗi dòng hiện tác giả, thời gian, nguồn, số ký tự thêm và bớt. Lượt đang diễn ra có nhãn **Đang sửa**.

Chọn một lượt chỉnh sửa để có các thao tác:

- **Mở bản sau lượt chỉnh sửa**: mở nội dung file ngay sau lượt đó ở cửa sổ chỉ đọc. Nhấp đúp vào dòng cũng mở bản này.
- **So sánh với bản hiện tại** và **So sánh với bản trước đó**: mở trình so sánh song song của VS Code.
- **Sao chép nội dung**: sao chép toàn bộ nội dung sau lượt đó. Trong cửa sổ chỉ đọc, chọn và sao chép bất kỳ đoạn nào.
- **Hoàn tác lượt chỉnh sửa này**: bỏ riêng thay đổi của lượt đó và giữ thay đổi đến sau, giống `git revert`. Extension mở bản xem trước, rồi hỏi xác nhận. Kết quả đồng bộ tới mọi thành viên và thành một lượt chỉnh sửa mới có nguồn hoàn tác. Đoạn đã bị sửa lại sau đó được giữ nguyên và được đếm trong hộp xác nhận.
- **Khôi phục file**: với lượt xoá file, tạo lại file từ nội dung lúc bị xoá.
- **Khôi phục phiên bản này**: với file nhị phân, thay bản hiện tại bằng phiên bản đó. Bản hiện tại vẫn còn trong lịch sử.

Lịch sử nằm ở `.lan-collab/history/` trong thư mục dự án trên máy LAN Hub. Mặc định giữ 30 ngày và tối đa 2 GB mỗi dự án. Người quản trị LAN Hub đổi giới hạn ở tab **Lịch sử**.

## Chat

Mở mục **Chat** trong thanh LAN Collab, hoặc nhấn `Ctrl+Alt+L` rồi `C`.

- Enter để gửi, Shift+Enter để xuống dòng. Tin nhắn dài tối đa 4000 ký tự.
- Gõ `@` để chọn thành viên cần nhắc. Thành viên được nhắc nhận thông báo.
- Mọi chuỗi dạng `đường/dẫn.ext:dòng` mở được file tại dòng đó. Nút chèn vị trí file và dòng đang mở đưa vị trí hiện tại vào tin nhắn.
- Gửi ảnh PNG, JPEG, GIF hoặc WebP bằng Ctrl+V hoặc chọn file, tối đa 4 MB. Ảnh lớn được thu nhỏ trước khi gửi.
- Hỗ trợ liên kết web, `code`, khối mã và bảng chọn emoji.

Lịch sử chat lưu trong `.lan-collab/history/` của dự án trên máy LAN Hub.

## Lệnh và cài đặt của extension

| Lệnh | Việc làm |
|---|---|
| **LAN Collab: Tham gia bằng mã mời** | Tham gia dự án bằng mã mời |
| **LAN Collab: Sao chép mã mời** | Sao chép mã mời của dự án đang mở |
| **LAN Collab: Thiết lập kết nối** | Mở bảng **Kết nối LAN Hub** |
| **LAN Collab: Chẩn đoán kết nối** | Chạy tám bước chẩn đoán |
| **LAN Collab: Kết nối**, **Ngắt kết nối** | Kết nối hoặc ngắt kết nối thư mục đang mở |
| **LAN Collab: Xem lịch sử chỉnh sửa** | Mở mục **Lịch sử chỉnh sửa** |
| **LAN Collab: Mở chat** | Mở mục **Chat** |
| **LAN Collab: Đi theo thành viên**, **Thôi đi theo** | Editor mở theo file và dòng của một thành viên |
| **LAN Collab: Đặt trạng thái** | Ghi một dòng trạng thái hiện với thành viên khác |
| **LAN Collab: Chọn tài khoản VS Code** | Chọn tài khoản GitHub hoặc Microsoft làm tên hiển thị |
| **LAN Collab: Khôi phục từ bản sao lưu** | Lấy lại file từ `.lan-collab/backup/` |
| **LAN Collab: Xem nhật ký** | Mở kênh Output "LAN Collab" |
| **LAN Collab: Mở menu** | Menu tổng hợp, cũng mở khi bấm thanh trạng thái |

| Cài đặt | Mặc định | Ý nghĩa |
|---|---|---|
| `lanCollab.server` | `""` | Địa chỉ LAN Hub dạng `IP:cổng`. Không cần khi thư mục đã tham gia bằng mã mời |
| `lanCollab.project` | `""` | Tên dự án trên LAN Hub |
| `lanCollab.token` | `""` | Token của LAN Hub. Khi khởi động, extension chuyển token này vào kho bí mật của hệ điều hành và xoá khỏi cài đặt |
| `lanCollab.name` | `""` | Tên hiển thị. Để trống thì dùng tên tài khoản VS Code, hoặc `tài-khoản-Windows@tên-máy` |
| `lanCollab.autoConnect` | `true` | Tự kết nối khi mở thư mục đã gắn với LAN Hub |
| `lanCollab.autoSave` | `true` | Tự lưu file đang mở khoảng 0,4 giây sau mỗi thay đổi, để bản trên ổ đĩa của mọi máy luôn mới |
| `lanCollab.exclude` | `[]` | Mẫu glob không đồng bộ, cộng thêm vào danh sách mặc định |

Nên loại trừ file mà mỗi máy tự sinh khi chạy chương trình, như kết quả chạy và thư mục build, để kết quả của các máy không ghi đè lên nhau.

## Làm việc với Git

Thư mục `.git` không được đồng bộ. Mọi máy có cùng thư mục làm việc, nên chỉ cần một thành viên commit:

1. Thành viên commit chạy `git add`, `git commit`, `git push` như bình thường.
2. Các máy khác chạy `git fetch` rồi `git reset origin/<nhánh>`, không dùng `--hard`. Lệnh này chỉ dời HEAD và index tới commit mới, vì thư mục làm việc đã giống nội dung commit đó.

`git checkout`, `git pull` hay `git stash` trên một máy thay đổi nhiều file, và mọi thay đổi đó đồng bộ tới các máy khác. Muốn làm việc riêng trên nhánh khác thì ngắt kết nối trước. Khi kết nối lại, file chỉ đổi trên máy đó được gửi lên, còn file đổi ở cả hai phía hiện trong bảng đồng bộ để chọn.

## Cơ chế đồng bộ

| Loại dữ liệu | Cách đồng bộ |
|---|---|
| File văn bản UTF-8 tối đa 1 MB | Theo từng thao tác, dùng OT. LAN Hub xếp thứ tự các thao tác |
| File nhị phân hoặc lớn hơn 1 MB | Thay cả file khi lưu. Phiên bản trước còn trong lịch sử lượt chỉnh sửa |
| Thay đổi trên ổ đĩa từ công cụ bên ngoài | Phát hiện qua file watcher và gộp ba chiều với nội dung đang sửa |
| Kiểu xuống dòng | Mỗi file dùng một kiểu, CRLF hoặc LF theo kiểu chiếm đa số |
| BOM UTF-8 | Giữ nguyên |
| Mất kết nối khi VS Code vẫn mở | Thay đổi hai phía được gộp ba chiều khi kết nối lại |
| Thay đổi khi extension không chạy | Lần kết nối sau, file chỉ đổi trên máy được gửi lên, file chỉ đổi trên LAN Hub được tải về, file đổi ở cả hai phía hiện trong bảng đồng bộ |
| Xoá file khi thành viên khác đang sửa | File được tạo lại để không mất phần đang sửa |
| Đổi tên file | Xử lý như xoá file cũ và tạo file mới, kể cả khi chỉ khác chữ hoa và chữ thường |

## Bảo mật

- **Mã hoá.** Mặc định kết nối trong mạng LAN không được mã hoá. Chỉ dùng trong mạng tin cậy, qua VPN, hoặc bật TLS. Khi bật TLS, mã mời mang vân tay chứng chỉ và extension kiểm tra vân tay trước khi gửi token.
- **Token.** Token là cơ chế chính giới hạn truy cập. Mã mời chứa token, nên chỉ gửi mã mời cho thành viên trong nhóm. Đổi token ở tab **Truy cập** khi mã mời lọt ra ngoài.
- **Danh sách tài khoản được phép.** LAN Hub không xác minh tài khoản với GitHub hay Microsoft, vì LAN Hub không cần Internet và extension không gửi token đăng nhập. Danh sách này ngăn vào nhầm, nhưng không ngăn một người có token khai báo tài khoản giả.
- **Token trên máy thành viên** nằm trong kho bí mật của hệ điều hành qua SecretStorage của VS Code. Token từ LAN Collab 0.1 được chuyển vào đó ở lần chạy đầu.
- **Dữ liệu extension gửi đi.** Ngoài nội dung file, extension chỉ gửi tên hiển thị, tên tài khoản nếu có, vị trí con trỏ, trạng thái và tin nhắn chat.
- **Đường dẫn.** LAN Hub và extension từ chối đường dẫn ra ngoài thư mục dự án và các cách viết khác của cùng một tên trên Windows, như tên ngắn 8.3 `GIT~1`, tên kết thúc bằng dấu chấm, `tên:luồng`, hay tên thiết bị `CON`, `NUL`.
- **Kết nối chưa đăng nhập.** LAN Hub đóng kết nối không gửi lời chào hợp lệ trong 15 giây, hoặc gửi thông điệp lớn hơn 64 KB trước khi đăng nhập.
- **Quản trị từ xa** tắt theo mặc định. Khi bật, kênh quản trị dùng token riêng, bắt buộc TLS khi kết nối từ máy khác, và chặn một địa chỉ sau năm lần sai token trong một phút.

## Giới hạn đã biết

- Ctrl+Z hoàn tác theo lịch sử editor của từng máy, nên có thể hoàn tác cả thay đổi vừa nhận từ thành viên khác ở cùng vị trí. Muốn bỏ thay đổi của một thành viên thì dùng **Hoàn tác lượt chỉnh sửa này**.
- Mỗi cửa sổ VS Code chỉ đồng bộ thư mục gốc đầu tiên của workspace.
- LAN Hub ghi thay đổi xuống ổ đĩa sau mỗi 0,5 giây. Máy LAN Hub mất điện đột ngột có thể mất thay đổi trong khoảng đó. Thoát LAN Hub bình thường thì không mất.
- Giao diện extension và ứng dụng LAN Hub chỉ có tiếng Việt.
- File có tên dạng tên ngắn 8.3, tên kết thúc bằng dấu chấm hoặc khoảng trắng, hay trùng tên thiết bị của Windows không được đồng bộ.
- File lớn hơn khoảng 300 MB không truyền được, vì nội dung file đi trong một thông điệp.
- Bộ cài LAN Hub chưa được ký số, nên SmartScreen có thể cảnh báo.
- Ảnh chụp file 10 phút một lần của LAN Collab 0.1 không còn được tạo và không được chuyển thành lượt chỉnh sửa. File cũ vẫn nằm trong `.lan-collab/history/`.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Thanh trạng thái hiện **Mất kết nối** hoặc **Chưa kết nối được** | Chạy **LAN Collab: Chẩn đoán kết nối** và làm theo bảng [Từng lỗi và cách xử lý](#từng-lỗi-và-cách-xử-lý) |
| Thành viên ở máy khác không kết nối được, máy LAN Hub thì được | Bấm **Mở tường lửa** trong ứng dụng LAN Hub. Mở `http://<IP>:8200/` từ máy thành viên |
| Mã mời báo dành cho LAN Collab 0.1 | Lấy mã mời mới trong ứng dụng LAN Hub, tab **Mã mời** |
| Máy LAN Hub đổi địa chỉ IP | Extension tự tìm lại LAN Hub qua UDP 8201. Nếu tường lửa chặn UDP 8201, dán mã mời mới |
| Không thấy tài khoản khi chọn tài khoản | Đăng nhập GitHub hoặc Microsoft qua biểu tượng tài khoản của VS Code, rồi chạy **Chọn tài khoản VS Code** |
| Mục **Lịch sử chỉnh sửa** báo LAN Hub chưa hỗ trợ | Dự án tắt lịch sử, hoặc thư mục dự án nằm trên ổ mạng mà SQLite không mở được. Xem tab **Nhật ký** của dự án |
| Ứng dụng LAN Hub không mở cửa sổ | LAN Hub đang chạy ẩn trong khay hệ thống. Bấm biểu tượng LAN Hub ở khay |
| Cần thêm chi tiết | **LAN Collab: Xem nhật ký** trên máy thành viên, tab **Nhật ký** trong ứng dụng LAN Hub |

## Phát triển

Cần Node.js 22 trở lên và Rust theo `lanhub/rust-toolchain.toml` (bộ công cụ Windows GNU trên Windows).

```
npm ci
cargo build -p lanhub-cli --release --manifest-path lanhub/Cargo.toml
npm test
```

| Lệnh | Việc làm |
|---|---|
| `npm test` | Kiểm thử Node, rồi bộ kiểm thử hộp đen `test/conformance/` chạy với `lanhub-cli` bản release |
| `LANHUB_TLS=1 npm run test:conformance` | Bộ kiểm thử hộp đen kèm các ca TLS |
| `npm run test:vscode` | Chạy trong VS Code thật với profile tạm, LAN Hub là `lanhub-cli` bản release |
| `npm run build:webviews`, `npm run test:webviews`, `npm run check:webviews` | Build, vitest và svelte-check cho webview của extension |
| `cargo test --workspace --manifest-path lanhub/Cargo.toml` | Kiểm thử Rust |
| `npm run hub -- --config <file>` | Chạy `lanhub-cli` từ mã nguồn |
| `npm run package` | Đóng gói extension vào `dist/lan-collab-<phiên bản>.vsix` |
| `npm run package:hub` | Đóng gói bộ cài LAN Hub và `lanhub-cli` vào `dist/` |
| `npm run package:all` | Cả hai |

Kiểm thử tìm `lanhub-cli` ở `lanhub/target/release/`, hoặc ở `$CARGO_TARGET_DIR/release/` khi biến này được đặt. `LANHUB_CMD` trỏ kiểm thử tới bản build khác. Đặt `LAN_COLLAB_DEBUG=1` trước khi mở VS Code để extension ghi nhật ký ra console của extension host.

| Đường dẫn | Nội dung |
|---|---|
| `lanhub/` | Cargo workspace của LAN Hub: `lanhub-ot`, `lanhub-protocol`, `lanhub-core`, `lanhub-cli`, ứng dụng Tauri trong `app/` |
| `extension/src/` | Host của extension |
| `extension/webview-src/` | Webview viết bằng Svelte: chat, thành viên, kết nối, lịch sử |
| `extension/i18n/vi.json` | Mọi chuỗi giao diện của extension |
| `lib/` | Mã dùng chung của client: OT, đồng bộ, máy trạng thái kết nối, chẩn đoán |
| `packages/ui-kit/` | Token CSS và thành phần Svelte dùng chung cho extension và ứng dụng LAN Hub |
| `packages/protocol/` | Kiểu TypeScript sinh từ `lanhub-protocol` |
| `test/` | Kiểm thử Node, kiểm thử hộp đen và kiểm thử trong VS Code |
| `tools/` | Lint câu chữ, máy tạo tải, đóng gói, điều khiển VS Code và LAN Hub qua CDP |
| `docs/protocol.md` | Đặc tả giao thức |
| `docs/copy-guide.md` | Quy tắc câu chữ |

## Giấy phép

Phát hành theo giấy phép [MIT](LICENSE).

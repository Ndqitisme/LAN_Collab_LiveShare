# Chạy LAN Hub trên máy chủ

Tài liệu này hướng dẫn chạy `lanhub-cli`, bản headless của LAN Hub, trên một máy chủ Linux bằng systemd hoặc trên Windows Server bằng dịch vụ tạo bằng `sc.exe`, rồi quản lý máy chủ đó từ ứng dụng LAN Hub trên máy người quản trị LAN Hub. Mặc định LAN Hub chạy trong mạng LAN. Chỉ cần làm theo tài liệu này khi nhóm muốn đặt LAN Hub trên một máy chủ có sẵn, ví dụ một VM cloud hoặc máy chủ trong văn phòng mà thành viên kết nối qua Internet.

Kết quả sau khi làm xong:

- `lanhub-cli` chạy như một dịch vụ, tự khởi động cùng máy chủ và ghi mọi file trước khi dừng.
- Kết nối tới LAN Hub được mã hoá bằng TLS. Mã mời mang vân tay chứng chỉ, VS Code kiểm tra vân tay trước khi gửi token.
- Ứng dụng LAN Hub trên máy người quản trị thêm máy chủ này vào danh sách LAN Hub và quản lý dự án, token, thành viên, nhật ký như LAN Hub trên máy mình.

Chi tiết giao thức của kênh quản trị nằm ở `docs/protocol.md` mục 13.3. Định dạng `lanhub.toml` nằm ở `docs/plans/README.md` mục 5.5.

## Chuẩn bị

- Một máy chủ Linux x86_64 có systemd, hoặc Windows Server 2016 trở lên. Bạn cần quyền root hoặc quyền quản trị trên máy chủ.
- Gói `lanhub-cli` của bản phát hành 0.2: `lanhub-cli-0.2.0-x86_64-unknown-linux-gnu.tar.gz` cho Linux, `lanhub-cli-0.2.0-x86_64-pc-windows-gnu.zip` cho Windows.
- Một cổng TCP mở từ Internet tới máy chủ. Tài liệu dùng cổng 8200.
- Tên miền hoặc IP công khai của máy chủ. Tài liệu dùng `hub.example.com`.
- Ứng dụng LAN Hub 0.2 trên máy Windows của người quản trị.

LAN Hub chỉ cần một cổng TCP. Cổng UDP 8201 dùng để tìm LAN Hub trong mạng LAN, không đi qua Internet, nên máy chủ ngoài không cần mở cổng này.

## Bước 1. Tạo token quản trị

Token quản trị cho phép ứng dụng LAN Hub sửa cấu hình của máy chủ, nên nó phải dài và ngẫu nhiên. LAN Hub từ chối token ngắn hơn 16 ký tự.

Tạo token trên Linux:

```sh
openssl rand -hex 24
```

Tạo token trên Windows, trong PowerShell:

```powershell
-join ((1..24) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

Giữ token này để nhập vào ứng dụng LAN Hub ở bước 7. Để file cấu hình không chứa token, chuyển token thành giá trị băm SHA-256 bằng `lanhub-cli`:

```sh
lanhub-cli --hash-admin-token 'TOKEN_VỪA_TẠO'
```

Lệnh in một dòng `token_sha256 = "..."` để chép vào `lanhub.toml`. Token gõ trên dòng lệnh có thể nằm lại trong lịch sử shell. Xoá dòng đó khỏi lịch sử sau khi chạy, hoặc chạy lệnh trên máy của bạn rồi chỉ chép dòng `token_sha256` lên máy chủ.

## Bước 2. Cài `lanhub-cli` trên Linux

Các lệnh dưới đây chạy bằng root.

1. Tạo tài khoản hệ thống chạy LAN Hub và các thư mục:

   ```sh
   useradd --system --home-dir /var/lib/lanhub --shell /usr/sbin/nologin lanhub
   mkdir -p /opt/lanhub /etc/lanhub /srv/lanhub
   ```

2. Giải nén gói vào `/opt/lanhub`:

   ```sh
   tar -xzf lanhub-cli-0.2.0-x86_64-unknown-linux-gnu.tar.gz -C /opt/lanhub --strip-components=1
   /opt/lanhub/lanhub-cli --version
   ```

   Gói chứa thư mục `lanhub-cli/`, nên `--strip-components=1` đặt `lanhub-cli` thẳng vào `/opt/lanhub`. Lệnh cuối in `lanhub-cli 0.2.0`.

3. Cho tài khoản `lanhub` ghi được thư mục cấu hình và thư mục dự án. Kênh quản trị ghi lại `lanhub.toml` khi bạn sửa dự án từ ứng dụng, và LAN Hub lưu chứng chỉ tự ký trong `/etc/lanhub/.lan-collab`:

   ```sh
   chown -R lanhub:lanhub /etc/lanhub /srv/lanhub
   chmod 750 /etc/lanhub
   ```

Mỗi dự án là một thư mục con của `/srv/lanhub`, ví dụ `/srv/lanhub/web-portal`. Lịch sử và chat của dự án nằm trong thư mục `.lan-collab` bên trong thư mục dự án.

## Bước 3. Viết `lanhub.toml`

Tạo `/etc/lanhub/lanhub.toml`:

```toml
[hub]
name = "LAN Hub văn phòng"
bind = "0.0.0.0"
port = 8200
# Tìm LAN Hub bằng UDP chỉ có ích trong mạng LAN.
discovery = false
# Địa chỉ thành viên dùng để kết nối. Mã mời đặt các địa chỉ này lên đầu.
public_address = ["hub.example.com"]

[hub.tls]
enabled = true

[hub.admin]
remote = true
token_sha256 = "DÒNG_IN_RA_Ở_BƯỚC_1"

[[project]]
name = "web-portal"
root = "/srv/lanhub/web-portal"
```

Giải thích các mục:

- `public_address` nhận tên miền hoặc IP, không kèm cổng và không kèm `https://`. Máy chủ sau NAT hoặc VM cloud cần mục này, vì địa chỉ card mạng của máy chủ thường là địa chỉ nội bộ mà thành viên không tới được.
- `[hub.tls] enabled = true` không kèm `cert` và `key` làm LAN Hub tự tạo chứng chỉ tự ký một lần trong `/etc/lanhub/.lan-collab/tls-selfsigned.pem` và dùng lại sau mỗi lần khởi động, nên vân tay không đổi. Muốn dùng chứng chỉ có sẵn, thêm `cert = "/đường/dẫn/fullchain.pem"` và `key = "/đường/dẫn/privkey.pem"`. Thành viên ghim vân tay của chứng chỉ, nên khi gia hạn chứng chỉ, vân tay đổi và mọi mã mời cũ phải được gửi lại.
- `[hub.admin] remote = true` bật kênh quản trị trên cùng cổng 8200. Có thể dùng `token = "..."` thay cho `token_sha256`, nhưng khi đó file chứa token ở dạng rõ.
- Dự án có thể để trống: thêm dự án từ ứng dụng ở bước 7.

Khi TLS tắt, LAN Hub chỉ nhận kênh quản trị từ chính máy chủ qua địa chỉ loopback. Quản trị từ máy khác luôn cần TLS.

Bạn cũng có thể bật quản trị từ xa mà không sửa file: tham số `--admin-token TOKEN` hoặc biến môi trường `LANHUB_ADMIN_TOKEN` ghi đè mục `[hub.admin]`.

## Bước 4. Kiểm tra trước khi chạy

Chạy bản tự kiểm tra bằng tài khoản `lanhub`. Lệnh chỉ đọc, không mở cổng:

```sh
sudo -u lanhub /opt/lanhub/lanhub-cli --diagnose --config /etc/lanhub/lanhub.toml
```

Mỗi dòng là một bước kiểm tra với `ok`, `fail` hoặc `skip`. Sửa mọi dòng `fail` theo gợi ý trên dòng đó. Trước lần chạy đầu tiên, dòng `tls` báo chứng chỉ tự ký sẽ được tạo khi LAN Hub chạy lần đầu. Từ lần chạy sau, dòng này in vân tay `fingerprint SHA256 ...`.

## Bước 5. Tạo dịch vụ systemd

1. Tạo `/etc/systemd/system/lanhub.service`:

   ```ini
   [Unit]
   Description=LAN Hub
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   User=lanhub
   Group=lanhub
   ExecStart=/opt/lanhub/lanhub-cli --config /etc/lanhub/lanhub.toml
   Restart=on-failure
   RestartSec=5
   # LAN Hub ghi mọi file đang chờ khi nhận SIGTERM rồi mới thoát.
   KillSignal=SIGTERM
   TimeoutStopSec=60
   NoNewPrivileges=true
   ProtectSystem=strict
   ProtectHome=true
   PrivateTmp=true
   ReadWritePaths=/etc/lanhub /srv/lanhub

   [Install]
   WantedBy=multi-user.target
   ```

   `ReadWritePaths` liệt kê mọi thư mục LAN Hub được ghi. Khi thêm dự án nằm ngoài `/srv/lanhub`, thêm thư mục đó vào dòng này rồi chạy lại `systemctl daemon-reload`.

2. Nạp và bật dịch vụ:

   ```sh
   systemctl daemon-reload
   systemctl enable --now lanhub
   systemctl status lanhub
   ```

   Dòng `Active: active (running)` cho biết LAN Hub đang chạy.

3. Đọc vân tay chứng chỉ trong nhật ký:

   ```sh
   journalctl -u lanhub | grep "TLS fingerprint"
   ```

   Dòng có dạng `TLS fingerprint SHA256 3f9a...`. Giữ 64 ký tự hex này để đối chiếu ở bước 7.

4. Kiểm tra dịch vụ khởi động lại được:

   ```sh
   systemctl restart lanhub
   systemctl is-active lanhub
   ```

   Lệnh cuối in `active`. Dòng `TLS fingerprint` mới trong nhật ký mang cùng vân tay như trước.

## Bước 6. Mở tường lửa

Mở cổng TCP 8200 trên máy chủ. Chọn lệnh theo tường lửa máy chủ dùng:

```sh
# ufw (Ubuntu, Debian)
ufw allow 8200/tcp

# firewalld (RHEL, Rocky, Fedora)
firewall-cmd --permanent --add-port=8200/tcp
firewall-cmd --reload
```

Với VM cloud, mở thêm cổng TCP 8200 trong security group hoặc firewall rule của nhà cung cấp. Kiểm tra từ máy của bạn bằng trình duyệt: mở `https://hub.example.com:8200/`. Trình duyệt cảnh báo chứng chỉ tự ký, rồi hiện trang chẩn đoán của LAN Hub với tên LAN Hub và vân tay chứng chỉ.

## Chạy trên Windows Server

`lanhub-cli` chạy được như một dịch vụ Windows với tham số `--service`. Các lệnh dưới đây chạy trong PowerShell mở bằng quyền quản trị.

1. Giải nén gói vào `C:\LanHub` và tạo thư mục dự án:

   ```powershell
   Expand-Archive lanhub-cli-0.2.0-x86_64-pc-windows-gnu.zip -DestinationPath $env:TEMP\lanhub-cli-zip
   New-Item -ItemType Directory -Force C:\LanHub\projects
   Copy-Item $env:TEMP\lanhub-cli-zip\lanhub-cli\* C:\LanHub
   C:\LanHub\lanhub-cli.exe --version
   ```

2. Viết `C:\LanHub\lanhub.toml` như ở bước 3. Trong TOML, đường dẫn Windows đặt trong nháy đơn để dấu `\` giữ nguyên:

   ```toml
   [[project]]
   name = "web-portal"
   root = 'C:\LanHub\projects\web-portal'
   ```

3. Cho tài khoản `LocalService` ghi được thư mục `C:\LanHub`, rồi kiểm tra cấu hình:

   ```powershell
   icacls C:\LanHub /grant "NT AUTHORITY\LocalService:(OI)(CI)M"
   C:\LanHub\lanhub-cli.exe --diagnose --config C:\LanHub\lanhub.toml
   ```

4. Tạo và chạy dịch vụ. `sc.exe` cần một khoảng trắng sau mỗi dấu `=`:

   ```powershell
   sc.exe create LanHub binPath= "C:\LanHub\lanhub-cli.exe --service --config C:\LanHub\lanhub.toml" start= delayed-auto obj= "NT AUTHORITY\LocalService" DisplayName= "LAN Hub"
   sc.exe description LanHub "LAN Hub: máy chủ đồng bộ của LAN Collab"
   sc.exe failure LanHub reset= 86400 actions= restart/5000/restart/5000/restart/60000
   sc.exe start LanHub
   sc.exe query LanHub
   ```

   `STATE : 4 RUNNING` cho biết LAN Hub đang chạy. Khi nhận lệnh dừng, dịch vụ ghi mọi file đang chờ rồi mới báo đã dừng.

5. Mở cổng trong Windows Defender Firewall:

   ```powershell
   netsh advfirewall firewall add rule name="LAN Hub" dir=in action=allow protocol=TCP localport=8200
   ```

Dịch vụ không có cửa sổ dòng lệnh. Sau lần chạy đầu tiên, đọc vân tay trên dòng `tls` của `C:\LanHub\lanhub-cli.exe --diagnose --config C:\LanHub\lanhub.toml`, và xem nhật ký trong ứng dụng LAN Hub sau khi thêm máy chủ ở bước 7. Gỡ dịch vụ bằng `sc.exe stop LanHub` rồi `sc.exe delete LanHub`.

## Bước 7. Kết nối từ ứng dụng LAN Hub

1. Mở ứng dụng LAN Hub trên máy của bạn. Thanh bên trái liệt kê "Máy này" và các LAN Hub từ xa.
2. Bấm "Thêm LAN Hub từ xa".
3. Nhập:
   - "Tên hiển thị": tên để nhận ra máy chủ trong danh sách, ví dụ `Máy chủ văn phòng`.
   - "Địa chỉ": `hub.example.com`.
   - "Cổng TCP": `8200`.
   - "Token quản trị": token tạo ở bước 1, không phải giá trị băm.
   - "Vân tay SHA-256": để trống, hoặc dán vân tay đọc ở bước 5.
4. Bấm "Kết nối".
   - Khi để trống vân tay, ứng dụng đọc chứng chỉ của máy chủ mà chưa gửi token, rồi hiện vân tay. So từng ký tự với vân tay trong nhật ký máy chủ. Khớp thì bấm "Tin cậy và kết nối".
   - Khi đã dán vân tay mà chứng chỉ máy chủ khác, ứng dụng không kết nối và hiện cả hai vân tay. Đừng tin cậy vân tay lạ: kiểm tra lại địa chỉ và nhật ký máy chủ.
5. Ứng dụng lưu địa chỉ, cổng và vân tay trong `remote-hubs.json` cạnh `lanhub.toml` của máy bạn. Token quản trị nằm trong Windows Credential Manager, mục `remote-admin:<mã>.LanHub`, không nằm trong file nào.

Sau khi kết nối, máy chủ được chọn trong thanh bên trái và mọi màn hình làm việc với máy chủ đó: danh sách dự án với trạng thái trực tiếp, thêm và sửa dự án, đổi token, mã mời, thành viên, nhật ký và cài đặt LAN Hub. Thư mục dự án là đường dẫn trên máy chủ, ví dụ `/srv/lanhub/mobile-app`, và thư mục đó phải có sẵn trên máy chủ. Mỗi thay đổi được máy chủ kiểm tra, ghi vào `lanhub.toml` của chính nó rồi áp dụng ngay. Tường lửa và chế độ chạy khi đăng nhập là của máy bạn, nên không hiện khi đang xem máy chủ.

Bấm "Máy này" để quay lại LAN Hub trên máy bạn. Để bỏ máy chủ khỏi danh sách, chọn máy chủ rồi bấm nút "Xoá khỏi danh sách" hình thùng rác trên thanh trên cùng. Ứng dụng xoá token khỏi Credential Manager. LAN Hub trên máy chủ vẫn chạy.

## Xử lý sự cố

| Ứng dụng báo | Nguyên nhân thường gặp | Cách sửa |
|---|---|---|
| Không kết nối được LAN Hub tại ... LAN Hub chưa chạy, sai cổng hoặc tường lửa chặn cổng. | Dịch vụ dừng, sai cổng, tường lửa hoặc security group chưa mở cổng. | `systemctl status lanhub` hoặc `sc.exe query LanHub`. Kiểm tra bước 6. |
| LAN Hub tại ... từ chối token quản trị. | Token nhập sai, hoặc `token_sha256` không phải băm của token đó. | Chạy lại `--hash-admin-token` với token đúng và so với `lanhub.toml`. |
| LAN Hub tại ... tạm chặn máy này vì sai token quản trị nhiều lần. | Năm lần sai token trong một phút từ cùng một địa chỉ IP. LAN Hub chặn địa chỉ đó 5 phút. | Đợi hết thời gian, sửa token rồi bấm "Thử lại". Nhật ký máy chủ ghi địa chỉ bị chặn. |
| LAN Hub tại ... chỉ nhận quản trị từ xa qua kết nối mã hoá. | `[hub.tls]` đang tắt trên máy chủ. | Bật `[hub.tls] enabled = true`, rồi thêm lại máy chủ để xác nhận vân tay. |
| LAN Hub tại ... đã bật TLS. | Máy chủ được thêm lúc chưa bật TLS. | Xoá khỏi danh sách rồi thêm lại. |
| LAN Hub tại ... chưa bật quản trị từ xa. | Thiếu `[hub.admin] remote = true`, hoặc máy đích là ứng dụng LAN Hub chứ không phải `lanhub-cli`. | Thêm mục `[hub.admin]` như bước 3. Chỉ `lanhub-cli` nhận kênh quản trị. |
| Vân tay chứng chỉ của LAN Hub tại ... khác vân tay đã nhập. | Chứng chỉ đã đổi, sai địa chỉ, hoặc có máy khác đứng giữa. | So với dòng `TLS fingerprint` trong nhật ký máy chủ. Chỉ thêm lại khi chắc chắn chứng chỉ đổi do bạn. |
| LAN Hub này chạy bằng tham số dòng lệnh. Không có file cấu hình để sửa. | Máy chủ chạy `lanhub-cli --root ...` thay cho `--config`. | Chạy bằng `--config lanhub.toml` như bước 5. |

## Ghi chú bảo mật

- Người giữ token quản trị đọc được token của mọi dự án và trỏ dự án tới bất kỳ thư mục nào tài khoản `lanhub` đọc được. Chỉ đưa token quản trị cho người quản trị LAN Hub.
- Kênh quản trị dùng chung cổng với thành viên. Ngoài TLS và giới hạn sai token, có thể giới hạn địa chỉ IP được vào cổng 8200 bằng tường lửa nếu thành viên có IP cố định.
- Đổi token quản trị: tạo token mới, sửa `token_sha256` trong `lanhub.toml`. LAN Hub áp cấu hình mới khi file đổi và đóng các phiên quản trị đang mở bằng token cũ. Trong ứng dụng, xoá máy chủ khỏi danh sách rồi thêm lại với token mới.
- `lanhub.toml` chứa token của từng dự án. Giữ quyền thư mục `/etc/lanhub` như bước 2 để chỉ tài khoản `lanhub` và root đọc được.

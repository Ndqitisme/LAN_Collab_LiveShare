# Chương trình nâng cấp LAN Collab 0.2 và 0.3

Tài liệu này là điểm vào của bộ kế hoạch. Nó ghi mục tiêu, mô hình nhánh, bản đồ phạm vi ảnh hưởng và mọi quyết định kỹ thuật dùng chung. Các file kế hoạch chi tiết (checklist từng PR) nằm cùng thư mục và tham chiếu về đây.

Ngày lập: 07/11/2026. Trạng thái: kế hoạch, chưa triển khai.

## 1. Mục tiêu

Người dùng cuối là nhóm lập trình viên cùng làm một repo trên LAN, mỗi máy giữ bản file thật. Người quản trị là người dựng hub trên một máy trong mạng.

Kết quả cần đạt:

1. **LAN Hub** thay hub Node.js. Đây là ứng dụng desktop viết bằng Rust, có giao diện đồ hoạ, cấu hình được nhiều dự án chạy song song trên một cổng. Không còn sửa file `.bat`. Backend đa luồng, độ trễ đồng bộ tính bằng mili giây như hiện tại hoặc tốt hơn. Mặc định chạy LAN nội bộ, có tuỳ chọn chạy trên máy chủ ngoài (bản headless, TLS).
2. **Extension LAN Collab 0.2** có luồng cài đặt và kết nối mới. Mọi lỗi kết nối được tự chẩn đoán theo thứ tự, tự thử các phương án khắc phục trước, chỉ yêu cầu người dùng thao tác khi không tự xử lý được, và luôn kèm hướng dẫn cụ thể. Người dùng không bị kẹt ở bước nào.
3. **Lịch sử theo lượt chỉnh sửa.** Mỗi chuỗi thao tác liên tục của một người trên một file là một lượt. Lượt kết thúc khi người khác sửa file đó. Người dùng xem được trạng thái file sau từng lượt trong cửa sổ song song, so sánh, sao chép lại phần đã bị xoá, hoặc hoàn tác đúng lượt của một người mà không mất thay đổi của người khác.
4. **Giao diện chỉnh chu** trên cả LAN Hub và mọi webview của extension: thanh cuộn, nút, ô nhập, danh sách, thông báo dùng chung một bộ thành phần.
5. **Câu chữ chuẩn nghiệp vụ.** Mọi caption theo một bảng thuật ngữ, giọng trung tính, không cảm xúc, không đưa dòng log kỹ thuật lên giao diện.
6. **Các tính năng cộng tác nhóm** được chọn từ khảo sát công cụ cùng loại, mỗi tính năng một PR có kiểm chứng riêng (giai đoạn 0.3).

## 2. Bộ kế hoạch

| File | Nội dung | Nhánh đích |
|---|---|---|
| `README.md` (file này) | Mục tiêu, phạm vi, quyết định chung | không áp dụng |
| `P0-foundation.md` | Nền móng chung trước khi tách nhánh: bộ kiểm thử hộp đen, giao thức v2, bộ UI dùng chung, công cụ chụp màn hình qua CDP | `main` |
| `A-lanhub.md` | Nhánh A: LAN Hub bằng Rust, ứng dụng Tauri | `upgrade/hub` |
| `B-extension.md` | Nhánh B: extension 0.2, kết nối và chẩn đoán, webview mới, câu chữ | `upgrade/extension` |
| `I-integration.md` | Hợp nhất hai nhánh, gỡ hub Node.js, phát hành 0.2.0 | `main` |
| `C-collab.md` | Tính năng cộng tác giai đoạn 0.3 | `main` |

Các file P0, A, B, I, C theo đúng khung "Multi-phase or multi-PR plan" của pStack và qua được `check-plan.mjs` (xem mục 8).

## 3. Mô hình nhánh và thứ tự

```
main ── P0-1 ── P0-2 ── P0-3 ── P0-4 ─┬─────────────────────────────── I1 ── I2 (0.2.0) ── C1 … C7 (0.3.x)
                                      ├── upgrade/hub:       A1 … A10 ──┘
                                      └── upgrade/extension: B1 … B9 ───┘
```

- P0 đi thẳng vào `main` theo thứ tự. Sau P0, hai nhánh tách ra cùng lúc và chạy song song.
- Ranh giới file của hai nhánh không giao nhau. Nhánh A chỉ sửa `lanhub/**`, `packages/protocol/**` (sinh tự động) và `docs/protocol.md` khi thêm tính năng vào giao thức. Nhánh B chỉ sửa `extension/**`, `lib/**`, `package.json`, `test/**`, `tools/check-strings.mjs`. Ngoại lệ chung cho cả hai nhánh: các file dùng chung `packages/ui-kit/**`, `test/support/**`, `test/conformance/**`, `tools/loadgen.mjs` và mục `scripts` của `package.json` được sửa theo kiểu chỉ thêm (thêm cờ, thêm test, thêm script, không đổi hành vi có sẵn) bởi PR nào cần, và PR đó liệt kê thay đổi trong mô tả để I1 thấy khi hợp nhất. Hợp đồng chung giữa hai nhánh là `docs/protocol.md` cùng bộ kiểm thử hộp đen `test/conformance/`.
- Nhánh B kiểm thử với hub Node.js đã nâng lên giao thức v2 ở P0-2. Riêng B7 (bảng lịch sử) cần hub Rust từ A5, nên B7 build `lanhub-cli` từ `upgrade/hub` tại một SHA ghi rõ trong PR.
- I1 hợp nhất hai nhánh vào `main`, chạy toàn bộ kiểm thử với hub Rust rồi xoá hub Node.js. I2 phát hành 0.2.0.
- Giai đoạn C bắt đầu từ `main` sau 0.2.0, mỗi tính năng một PR, đánh số phiên bản 0.3.x.

## 4. Bản đồ phạm vi ảnh hưởng

Mỗi file đang theo dõi trong repo đều có đích đến dưới đây. Không file nào nằm ngoài bảng.

| File hiện tại | Vai trò hiện tại | Đích đến | PR |
|---|---|---|---|
| `hub/hub.js` (600 dòng) | Toàn bộ hub: TCP, OT, ghi đĩa, chat, lịch sử | P0-2 nâng lên giao thức v2 làm bản tham chiếu tạm. Bị thay bởi `lanhub/`. Xoá ở I1 | P0-2, A2 đến A6, I1 |
| `hub/start-hub.bat`, `hub/start-hub.sh` | Khởi động hub, sinh token, tạo file allow | Bị thay bởi LAN Hub app và `lanhub-cli`. Xoá ở I1 | I1 |
| `tools/package-hub.js` | Tự viết ZIP để đóng gói hub | Bị thay bởi `cargo tauri build` và `tools/package-lanhub.mjs`. Xoá ở I1 | A9, I1 |
| `lib/common.js` | Hằng số, exclude, `safeRel`, `LineSocket`, mã mời | Giữ phía client. P0-2 thêm hằng số v2 và mã mời v3. I1 xoá giải mã mời v1, v2 | P0-2, I1 |
| `lib/ot.js` | OT dùng chung | Giữ phía client. A1 port sang Rust, kiểm bằng vector sinh từ chính file này | A1 |
| `lib/client-core.js` (1066 dòng) | Đồng bộ, OT client, gộp ba chiều, chat | B3 nối máy trạng thái, B4 lỗi có mã và chẩn đoán, B7 API lịch sử, B8 chọn xung đột từng file, C1 undo riêng | B3, B4, B7, B8, C1 |
| `lib/editor-binding.js` | Gắn editor với OT | C1 thêm ngăn xếp undo riêng từng người | C1 |
| `extension/extension.js` (799 dòng) | Toàn bộ host extension | B3 tách thành module trong `extension/src/`. File gốc bị xoá sau khi tách | B1, B3 đến B9 |
| `extension/chat-view.js` | Host của webview chat | Chuyển vào `extension/src/views/chat.js`, giữ giao thức tin nhắn | B2 |
| `extension/webview/chat.js`, `chat.css` | Webview chat viết tay | Viết lại bằng Svelte trong `extension/webview-src/chat/`. Xoá bản cũ | B2 |
| `package.json` | Manifest extension | P0-3 thêm workspaces và devDependencies. B1 chuyển chuỗi. B5, B6, B9 khai báo view, walkthrough | P0-3, B1, B5, B6, B9 |
| `test/*.test.js` | Test nạp `startHub` trong process | P0-1 chuyển thành kiểm thử hộp đen qua TCP trong `test/conformance/` | P0-1 |
| `test/vscode/*` | Test chạy trong VS Code | P0-4 thêm cổng CDP để chụp màn hình. B1 cập nhật chuỗi bị ghim | P0-4, B1 |
| `README.md`, `README.en.md` | Tài liệu người dùng | I1 viết lại phần hub, cài đặt, xử lý sự cố | I1 |
| `CHANGELOG.md` | Nhật ký phiên bản | Cập nhật ở I2 và từng PR giai đoạn C | I2, C |
| `.gitignore`, `.vscodeignore` | Loại trừ | `.gitignore` thêm `target/`, `node_modules/`, `extension/webview/dist/`, `docs/plans/media/`. `.vscodeignore` thêm `packages/**`, `lanhub/**`, `docs/**`, `extension/webview-src/**` | P0-3 |
| `media/icon.png`, `media/icon.svg` | Biểu tượng | Giữ. A7 sinh biểu tượng ứng dụng từ `icon.svg` | A7 |
| `LICENSE`, `.gitattributes` | Giấy phép, EOL | Giữ. P0-3 thêm `*.rs text eol=lf` | P0-3 |

Thư mục và file mới:

| Đường dẫn | Nội dung | PR tạo |
|---|---|---|
| `test/conformance/`, `test/support/hub-process.js` | Kiểm thử hộp đen chạy với mọi hub qua biến `LANHUB_CMD` | P0-1 |
| `tools/loadgen.mjs` | Máy tạo tải, đo độ trễ op p50 và p99 | P0-1 |
| `.github/workflows/ci.yml` | CI chạy Node test, sau đó thêm `cargo test` | P0-1, A1 |
| `docs/protocol.md` | Đặc tả giao thức v2, hợp đồng giữa hai nhánh | P0-2 |
| `packages/ui-kit/` | Token CSS, theme VS Code, theme ứng dụng, thành phần Svelte 5 | P0-3 |
| `docs/copy-guide.md` | Bảng thuật ngữ và quy tắc câu chữ | P0-3 |
| `tools/cdp/` | Điều khiển và chụp màn hình VS Code và LAN Hub qua Chrome DevTools Protocol | P0-4 |
| `lanhub/` | Cargo workspace: `lanhub-ot`, `lanhub-protocol`, `lanhub-core`, `lanhub-cli`, `app/` (Tauri) | A1 đến A10 |
| `packages/protocol/` | Kiểu TypeScript sinh từ Rust bằng `ts-rs` | A2 |
| `extension/src/`, `extension/webview-src/`, `extension/i18n/vi.json` | Host extension tách module, mã nguồn webview, bảng chuỗi | B1 đến B9 |
| `tools/check-strings.mjs` | Lint chặn chuỗi giao diện nằm ngoài bảng chuỗi | B1 |

## 5. Quyết định kỹ thuật

Mỗi quyết định ghi lựa chọn và lý do. Phương án bị loại ghi ở mục 5.11.

### 5.1 Hub viết bằng Rust, chạy trên tokio

- Cargo workspace `lanhub/` gồm `lanhub-ot` (port của `lib/ot.js`), `lanhub-protocol` (kiểu thông điệp serde), `lanhub-core` (máy chủ), `lanhub-cli` (bản headless) và `app/` (ứng dụng Tauri nhúng `lanhub-core`).
- Mô hình đồng thời: mỗi dự án là một actor (một task tokio sở hữu toàn bộ trạng thái file và OT của dự án). Mỗi kết nối có một task đọc và một task ghi. Ghi đĩa và ghi lịch sử chạy trên luồng blocking riêng, nhận việc qua channel. Không có khoá dùng chung giữa các dự án.
- OT giữ nguyên ngữ nghĩa từng bit với `lib/ot.js`: vị trí tính theo đơn vị UTF-16, insert của op đến được ưu tiên khi trùng vị trí. Văn bản lưu dạng `Vec<u16>` trong actor để chỉ số khớp với client JavaScript.
- Khung truyền vẫn là NDJSON trên TCP. Giới hạn dòng giữ 64 KiB trước xác thực và 15 giây chờ `hello`.
- Rev vẫn đặt lại về 0 sau mỗi lần khởi động. Client đối chiếu bằng hash như hiện tại.
- `id` trong `<root>/.lan-collab/hub.json` của từng dự án được giữ nguyên và gửi trong `welcome.hubId`. Lý do: client dùng giá trị này làm khoá `workspaceState` (`lanCollab.known:<hubId>`). Đổi giá trị sẽ buộc mọi máy đồng bộ lại từ đầu.

### 5.2 Ứng dụng LAN Hub dùng Tauri 2 và Svelte 5

- Tauri 2 (bản ổn định mới nhất đã phát hành ít nhất hai tuần khi bắt đầu A7, hiện là nhánh 2.11) dùng WebView2 có sẵn trên Windows 10. Bộ cài NSIS kèm bootstrapper WebView2 cho máy thiếu runtime.
- Giao diện viết bằng Svelte 5, TypeScript, Vite, dùng chung `packages/ui-kit` với webview của extension.
- Ứng dụng chạy `lanhub-core` trong cùng process. Đóng cửa sổ thì ứng dụng thu xuống khay hệ thống, hub vẫn chạy. Chỉ cho chạy một instance.
- Giao diện gọi core qua một tầng `AdminApi` duy nhất. Bản cục bộ gọi hàm trực tiếp qua Tauri command. Bản từ xa (A10) gọi qua kênh quản trị TCP. Cùng một giao diện quản lý được hub trên máy này và hub headless trên máy chủ ngoài.

### 5.3 Bộ thành phần giao diện dùng chung

`packages/ui-kit` gồm:

- `tokens.css`: token ngữ nghĩa `--lc-bg`, `--lc-surface`, `--lc-fg`, `--lc-muted`, `--lc-accent`, `--lc-ok`, `--lc-warn`, `--lc-danger`, thang khoảng cách, bán kính, thời lượng chuyển động.
- `theme-vscode.css`: ánh xạ token sang biến `--vscode-*`, nên webview tự đổi theo theme VS Code và chế độ tương phản cao.
- `theme-app.css`: bảng màu sáng và tối riêng của LAN Hub, theo `prefers-color-scheme` và có nút chuyển.
- Thanh cuộn tuỳ biến (mảnh, bo tròn, nở ra khi rê chuột), vòng focus thống nhất, kiểu chữ dùng font hệ thống (không tải webfont vì có thể không có Internet).
- Thành phần Svelte: Button, IconButton, Input, Textarea, Select, Switch, Checkbox, Badge, Avatar, StatusDot, Tooltip, Toast, Dialog, Tabs, Card, List, VirtualList, ProgressBar, EmptyState, CodeBlock, Icon (bộ Lucide, giấy phép ISC, nhúng SVG).
- Phần giao diện gốc của VS Code (thanh trạng thái, quick pick, thông báo) không tuỳ biến được bằng CSS. Các phần đó dùng codicon thống nhất và câu chữ theo `docs/copy-guide.md`. Mọi bảng nhiều thông tin chuyển sang webview để tuỳ biến được hoàn toàn.

### 5.4 Giao thức v2

P0-2 viết đặc tả đầy đủ vào `docs/protocol.md`. Các thay đổi so với v1:

1. `hello.proto` bằng 2. Hub Node.js sau P0-2 chấp nhận 1 và 2. `lanhub` chỉ chấp nhận 2.
2. Lỗi có mã: `{t:"error", code, data}`. Bảng mã: `protocol_version {hubMin, hubMax}`, `token_invalid`, `project_unknown {projects}`, `account_required`, `account_denied {account, entry}`, `tls_required` (kết nối TCP thường tới hub đang bật TLS). Thông điệp `error` luôn là lỗi chặn, hub đóng kết nối ngay sau đó. Lỗi chỉ áp cho một thông điệp (ví dụ `role_denied` ở C5) dùng thông điệp riêng `rejected {code, path}` và giữ kết nối.
   - Thứ tự kiểm tra khi bắt tay: phiên bản giao thức, dự án, token, tài khoản. Token theo từng dự án nên phải xác định dự án trước.
   - Client 0.1 gửi `proto` 1 tới `lanhub` nhận một ngoại lệ duy nhất ở biên: `error` kèm trường `message` tiếng Việt báo cần cập nhật extension lên 0.2, vì client 0.1 chỉ đọc `message`. Hub không gửi câu chữ hiển thị. Client dựng câu từ bảng chuỗi.
3. `welcome` thêm `proto`, `instanceId`, `hubName`, `hubVersion`, `features` (ví dụ `history`, `discovery`, `tls`, `http-diag`).
4. Hoạt động có cấu trúc: `{ts, who, color, kind, path?, text?}` với `kind` thuộc `join`, `leave`, `edit`, `edit_disk`, `create`, `delete`, `debug_start`, `debug_stop`, `status_set`, `status_clear`. Hub không còn ghép câu tiếng Việt.
5. Thăm dò có kết quả từng bước: `{t:"hello", probe:true}` nhận `probe_result {proto_ok, token_ok, project_ok, account_ok, projects, hubId, hubName}`. Thay cơ chế cũ coi lỗi `account` là thành công.
6. `pong` mang `ts` của hub để client đo RTT. Client gửi RTT đo được trong `presence.p.rtt` mỗi 5 giây, hub chuyển tiếp cho thành viên khác và cho màn hình Thành viên của LAN Hub.
   - `op.src` nhận `editor`, `disk`, `revert` (kèm `op.reverts` là id lượt bị hoàn tác) và `merge` (op gửi lại khi gộp lúc kết nối lại). P0-2 ghi vào đặc tả và cho `lib/client-core.js` gửi `merge`. B7 gửi `revert`.
7. Tìm hub trên LAN qua UDP cổng 8201: client gửi `{"t":"lanhub_discover","v":2}` tới địa chỉ broadcast của từng card mạng, hub trả `lanhub_here {instanceId, hubName, port, tls, projects}`. `projects` chỉ có khi dự án bật quảng bá.
8. Mã mời v3: `LC3-` cộng base64url của JSON `{v:3, i:instanceId, a:[địa chỉ], p:cổng, n:dự án, t:token, f:vân tay TLS nếu có}`. Mã mời chứa mọi địa chỉ IPv4 của hub, nên client thử song song nhiều địa chỉ.
9. Lịch sử (A5): `history_list`, `history_runs`, `history_blob`, `history_changed`, `checkpoint_create`, `checkpoint_list`.
10. Tính năng riêng của `lanhub`, khai báo qua `features`: TLS tuỳ chọn và trang chẩn đoán HTTP. Khi một kết nối mở đầu bằng `GET `, hub trả trang HTML cho biết hub hoạt động, phiên bản, danh sách dự án công khai. Người dùng mở `http://<ip>:8200/` trong trình duyệt để tách lỗi mạng khỏi lỗi extension.
11. Hợp đồng CLI cho kiểm thử (không thuộc giao thức), cả hai hub đều làm đúng. Với `--port 0 --log-format json`, hub in `{"event":"listening","port":N}` ra stdout. Với `--stop-on-stdin-close`, khi stdin đóng hub ghi hết file đang chờ rồi thoát mã 0 (trên Windows, SIGINT gửi từ Node là kill cưỡng bức nên không dùng được). `--discovery-port <n>` đổi cổng UDP, `--no-discovery` tắt hẳn. Bộ kiểm thử mặc định chạy hub với `--no-discovery`.

### 5.5 Nhiều dự án và file cấu hình

- Một hub, một cổng TCP, nhiều dự án. Client chọn dự án bằng `hello.project` như hiện tại. Lợi ích: một quy tắc tường lửa dùng cho mọi dự án.
- Cấu hình lưu ở `lanhub.toml`. Đường dẫn mặc định là `%APPDATA%\LanHub\lanhub.toml` trên Windows và `$XDG_CONFIG_HOME/lanhub/lanhub.toml` trên Linux. Tham số `--config` ghi đè. Ứng dụng và bản headless đọc cùng định dạng.

```toml
[hub]
name = "LAN Hub phòng phát triển"
bind = "0.0.0.0"
port = 8200
discovery = true

[hub.tls]
enabled = false

[[project]]
name = "MyProject"
root = 'D:\workspaces\MyProject'
enabled = true
token = "5f0c..."
allow = ["github:alice", "microsoft:bob@example.com"]
exclude = ["build/**"]
advertise = true

[project.history]
idle_minutes = 15
keep_days = 30
max_mb = 2048
```

- Thêm, sửa, tắt hoặc xoá một dự án áp dụng ngay, không khởi động lại dự án khác. Thao tác áp cấu hình là idempotent: core so sánh cấu hình mới với trạng thái đang chạy và chỉ áp phần khác.
- Ứng dụng có nút nhập từ hub 0.1: chọn thư mục hub cũ, đọc `token-<dự án>.txt` và `allowed-accounts-<dự án>.txt`, tạo mục dự án tương ứng.
- Dữ liệu dự án (lịch sử, chat) vẫn nằm trong `<root>/.lan-collab/`, nên chuyển hub sang máy khác chỉ cần chép thư mục dự án.

### 5.6 Mô hình lượt chỉnh sửa

- **Lượt** là chuỗi op liên tục của một người trên một file. Hub là nơi duy nhất ghi lượt vì hub giữ thứ tự op.
- Lượt kết thúc khi xảy ra một trong các sự kiện sau. Người khác sửa file đó (quy tắc chính). Người đó ngừng sửa file quá `idle_minutes` (mặc định 15 phút). Có người tạo điểm khôi phục. File bị xoá hoặc đổi tên. Hub khởi động lại.
- Mỗi lượt ghi nguồn thay đổi: `editor` (gõ trong VS Code), `disk` (công cụ AI hay script ghi thẳng ra đĩa trên máy người đó), `revert` (hoàn tác một lượt khác, kèm id lượt gốc), `merge` (gộp khi kết nối lại).
- Lưu trữ: SQLite (`rusqlite`, bản bundled) tại `<root>/.lan-collab/history/history.db` giữ chỉ mục lượt. Nội dung file ở đầu và cuối mỗi lượt lưu dạng blob định danh theo SHA-256, nén zstd, trong `history/blobs/`. Không lưu log op. Một luồng ghi duy nhất cho mỗi dự án.
- Bản ghi lượt: `id, path, author_uid, author_name, color, source, started_at, ended_at, op_count, chars_added, chars_removed, start_blob, end_blob, reverts`.
- Giữ lịch sử: mặc định 30 ngày và tối đa 2 GB mỗi dự án. Lượt cũ nhất bị xoá trước, blob không còn ai tham chiếu thì dọn.
- Cơ chế chụp file 10 phút một lần và bản sao trước khi xoá của hub 0.1 bị bỏ, vì lượt chỉnh sửa đã bao trùm cả hai. Thư mục lịch sử cũ được giữ nguyên trên đĩa, không chuyển đổi.
- **Xem lượt:** client mở trạng thái file sau lượt ở cửa sổ song song chỉ đọc (URI `lancollab-history:`), so sánh với bản hiện tại hoặc với trước lượt bằng trình diff có sẵn của VS Code. Người dùng sao chép bất kỳ đoạn nào.
- **Hoàn tác một lượt:** gộp ba chiều giống `git revert`. Gốc là nội dung cuối lượt, "của họ" là nội dung đầu lượt, "của ta" là bản hiện tại. Kết quả hiện ở diff xem trước, người dùng xác nhận thì áp dụng như một chỉnh sửa bình thường, nên đồng bộ cho mọi người và tạo một lượt mới có nguồn `revert`. Không có rủi ro hội tụ OT vì không biến đổi op lịch sử.
- **Khôi phục file đã xoá:** lượt có nguồn xoá giữ blob cuối, client tạo lại file từ blob đó.

### 5.7 Kết nối và chẩn đoán phía client

- Trạng thái kết nối là một máy trạng thái thuần trong `lib/connection-machine.js`. Các trạng thái: `idle`, `resolving`, `connecting`, `handshaking`, `syncing`, `live`, `reconnecting`, `needs_action`, `stopped`. Mọi phần giao diện đọc trạng thái từ một nguồn. Các biến boolean rời rạc hiện nay bị xoá.
- `needs_action` luôn kèm lý do có mã và danh sách hành động. Không có trạng thái nào thiếu lối ra.
- Bộ chẩn đoán chạy các bước theo thứ tự, tự khắc phục trước khi hỏi người dùng:
  1. Có cấu hình cho thư mục này không. Nếu không có, mở màn hình thiết lập.
  2. Thử song song mọi địa chỉ đã biết (địa chỉ trong mã mời, địa chỉ kết nối được lần trước), mỗi địa chỉ chờ tối đa 3 giây.
  3. Nếu không địa chỉ nào trả lời, tìm hub trên LAN bằng UDP theo `instanceId`. Tìm thấy ở địa chỉ mới thì tự cập nhật và tiếp tục.
  4. Phân loại lỗi mạng: bị từ chối (hub chưa chạy hoặc sai cổng), quá thời gian (tường lửa, khác mạng con, VPN), không có đường đi.
  5. Kiểm tra vân tay TLS nếu có. Sai vân tay thì dừng và cảnh báo, không tự bỏ qua.
  6. Bắt tay: sai phiên bản giao thức thì nói rõ bên nào cần cập nhật. Sai token thì mời dán mã mời mới hoặc nhập token. Dự án không tồn tại thì liệt kê dự án hub đang phục vụ để chọn. Tài khoản chưa được phép thì hiện đúng dòng cần thêm vào danh sách để gửi người quản trị, kèm nút đổi tài khoản.
  7. Kiểm tra thư mục: quyền ghi, thư mục có thuộc dự án khác không.
  8. Khi đang làm việc: đo RTT qua `pong`, mất tín hiệu thì kết nối lại với backoff 1, 2, 5, 10, 30 giây có jitter, mỗi lần chạy lại bước 2 và 3.
- Lệnh **LAN Collab: Chẩn đoán kết nối** chạy toàn bộ các bước và hiện kết quả từng bước. Báo cáo sao chép được, đã che token và mã mời.
- Token chuyển sang `SecretStorage`. Lần chạy đầu của 0.2 chuyển token từ `globalState` và từ setting `lanCollab.token` sang `SecretStorage` rồi xoá bản cũ.

### 5.8 Câu chữ

`docs/copy-guide.md` (P0-3) là nguồn duy nhất. Tóm tắt:

- Tiếng Việt, giọng trung tính nghiệp vụ. Lệnh và nút là động từ mệnh lệnh ngắn ("Kết nối lại", "Sao chép mã mời"). Không dấu chấm than, không emoji, không câu trấn an, không đại từ "bạn" khi câu đứng được mà không cần nó.
- Thông báo lỗi theo mẫu: hiện tượng, nguyên nhân nếu biết, rồi nút hành động. Ví dụ: "Không kết nối được LAN Hub tại 192.168.1.10:8200. Cổng không phản hồi sau 3 giây." kèm nút "Chẩn đoán" và "Thử lại".
- Không đưa tên setting (`lanCollab.token`), thông điệp lỗi gốc của Node (`ECONNREFUSED`) hay thẻ `[LỖI]` lên thông báo. Chi tiết kỹ thuật chỉ nằm trong kênh Output.
- Bảng thuật ngữ cố định: **LAN Hub** (máy chủ đồng bộ), **dự án** (thay "phòng"), **thành viên** (thay "đồng đội", "người"), **mã mời**, **đồng bộ**, **bản trên hub** và **bản trên máy này**, **lượt chỉnh sửa**, **điểm khôi phục**, **chẩn đoán kết nối**, **danh sách tài khoản được phép**.
- Mọi chuỗi giao diện của extension nằm trong `extension/i18n/vi.json`, của ứng dụng nằm trong `lanhub/app/ui/src/i18n/vi.json`. `tools/check-strings.mjs` báo lỗi khi có chuỗi tiếng Việt nằm ngoài hai file này.

### 5.9 Máy chủ ngoài

- Mặc định: LAN, `bind = "0.0.0.0"`, không TLS.
- Khi cần chạy trên máy chủ ngoài: khai báo `[hub] public_address` (tên miền hoặc IP công khai, có thể nhiều giá trị). Mã mời v3 đặt các địa chỉ này lên đầu danh sách `a`, trước địa chỉ card mạng, nên máy chủ sau NAT hay VM cloud vẫn cho mã mời dùng được. A6 thêm khoá cấu hình, A9 hiện trên màn hình cài đặt hub.
- Dùng `lanhub-cli` headless (Windows hoặc Linux) với cùng `lanhub.toml`. Bật `[hub.tls]`: hub tự sinh chứng chỉ tự ký (`rcgen`) hoặc dùng chứng chỉ có sẵn. Vân tay SHA-256 nằm trong mã mời v3, client ghim vân tay đó.
- Quản trị từ xa (A10): bật `[hub.admin] remote = true` với token quản trị riêng. Ứng dụng LAN Hub trên máy người quản trị thêm "hub từ xa" và quản lý như hub cục bộ.

### 5.10 Công cụ kiểm chứng

- `test/conformance/`: kiểm thử hộp đen qua TCP. Chạy với hub Node.js (mặc định) hoặc hub Rust (`LANHUB_CMD`). Hai hub phải cùng qua một bộ test.
- `tools/gen-ot-vectors.mjs` (A1): sinh vector biến đổi OT từ `lib/ot.js`, crate Rust phải cho kết quả giống hệt.
- `tools/loadgen.mjs`: N client ảo gửi op theo nhịp cố định, đo RTT op tới `ack` và độ trễ tới client khác (p50, p99), thông lượng, bộ nhớ hub.
- `tools/cdp/`: mở VS Code (Electron) và LAN Hub (WebView2) với cổng remote debugging, điều khiển giao diện, chụp màn hình, quay video (khung hình screencast mã hoá mp4 bằng `ffmpeg-static`, vì máy không có ffmpeg).
- `tools/check-strings.mjs` (B1): lint câu chữ.

### 5.11 Phương án đã loại

| Phương án | Lý do loại |
|---|---|
| Go với Wails | Wails v3 vẫn ở alpha và beta theo các nguồn năm 2026. Rust có kiểu chặt hơn cho mã OT, và Tauri 2 ổn định từ 10/2024 |
| egui, Slint, Iced | Không dùng chung được bộ thành phần với webview VS Code. Tuỳ biến thanh cuộn và kiểu chữ kém linh hoạt hơn CSS |
| Electron | Bộ cài trên 100 MB, tốn RAM, trái yêu cầu "nhẹ" |
| Đổi OT sang CRDT (Yjs, Automerge) | Phải viết lại cả client lẫn hub, mất tương thích dữ liệu. OT hiện tại đã hội tụ đúng qua 8 seed kiểm thử |
| WebSocket thay TCP | Chỉ cần khi đi qua reverse proxy HTTP. Máy chủ ngoài dùng TCP với TLS là đủ |
| mDNS thay UDP broadcast | Cổng 5353 trên Windows bị dịch vụ hệ thống giữ. Multicast bị chặn ở nhiều mạng như broadcast |
| Hoàn tác lượt bằng biến đổi op nghịch đảo | Tài liệu (Cherif và Imine 2015, Yorkie #652) ghi nhận nhiều thuật toán selective undo sai. Gộp ba chiều trên blob đơn giản và không đụng tới hội tụ OT |
| Lưu log op làm nguồn lịch sử | Blob đầu và cuối lượt đủ cho xem, so sánh, hoàn tác và blame. Log op tăng dung lượng mà không có người dùng |
| Giữ hub Node.js song song lâu dài | Hai bản hub phải bảo trì cùng lúc. Nhóm dùng nội bộ nên phát hành đồng thời extension và hub được |
| `vscode.l10n` với chuỗi nguồn tiếng Anh | Giao diện hiện chỉ có tiếng Việt. Bảng chuỗi một file đạt cùng mục đích kiểm soát câu chữ mà không phải dịch hai chiều |
| TypeScript cho toàn bộ host extension | Tốn công chuyển đổi 2900 dòng. `// @ts-check` cùng kiểu sinh từ Rust bắt được lỗi giao thức với chi phí nhỏ |

## 6. Tính năng cộng tác (giai đoạn 0.3)

Nguồn: khảo sát Live Share, Code With Me, Zed, Replit, Figma, Google Docs, Etherpad, Tuple, CodeTogether, Open Collaboration Tools, và tài liệu về undo chọn lọc trong OT. Ghi chú thị trường: Live Share đã vào chế độ chỉ bảo trì, Code With Me ngừng hỗ trợ từ quý 1/2027.

| PR | Tính năng | Lý do chọn |
|---|---|---|
| C1 | Undo riêng từng người: Ctrl+Z chỉ hoàn tác chỉnh sửa của chính mình | Hiện nay sửa từ xa đi qua `workspace.applyEdit` nên lọt vào ngăn undo của VS Code. Ctrl+Z có thể xoá chữ người khác vừa gõ |
| C2 | Tác giả từng dòng (blame) và lượt chỉnh sửa trong Timeline của VS Code | Suy ra từ lượt chỉnh sửa, gần như không tốn thêm lưu trữ. File thật không mang thông tin tác giả |
| C3 | Điểm khôi phục có tên, tự tạo điểm trước mỗi lần hoàn tác | Lưới an toàn cho tính năng hoàn tác. Figma và JetBrains Local History đều có |
| C4 | Bình luận gắn vào đoạn mã, có luồng trả lời, đánh dấu đã xử lý | Neo bình luận biến đổi theo op giống con trỏ từ xa. Dùng Comments API có sẵn của VS Code |
| C5 | Vai trò xem và sửa theo tài khoản, đường dẫn chỉ đọc | File thật nằm trên đĩa mọi máy, một chỉnh sửa sai lan ra toàn nhóm |
| C6 | Kiểm tra lệch workspace: so nhánh git, HEAD, trạng thái file của từng thành viên | Riêng có với mô hình file thật. Một lệnh `git checkout` bên ngoài làm hỏng phiên cộng tác mà không ai biết |
| C7 | Gọi mọi người tới vị trí của mình, huy hiệu thành viên trên Explorer, trạng thái kết nối từng thành viên | Mở rộng nhỏ trên chế độ đi theo đã có |

Hoãn: tạm dừng đồng bộ một file, quy kết tác giả "công cụ ngoài", chế độ đề xuất thay đổi, ghi chú chung, công bố URL dịch vụ đang chạy, thanh trượt thời gian.

Loại: debug chung, terminal chung, âm thanh và chia sẻ màn hình, điều khiển máy từ xa, kênh riêng, chia sẻ AI rule, chia sẻ language service. Lý do chung: mỗi máy đã có dự án thật nên tự debug, tự chạy terminal được. Phần còn lại là bề mặt bảo mật lớn hoặc cần hạ tầng media.

## 7. Phiên bản và phát hành

- 0.2.0: LAN Hub (ứng dụng và `lanhub-cli`) cùng extension 0.2, phát hành đồng thời ở I2. Extension 0.2 không làm việc với hub 0.1 và ngược lại. Thông báo lỗi `protocol_version` nói rõ bên cần cập nhật.
- 0.3.x: mỗi PR giai đoạn C tăng một bản vá hoặc bản nhỏ.
- Gói phát hành: `lan-collab-<ver>.vsix`, `LanHub_<ver>_x64-setup.exe` (NSIS), `lanhub-cli-<ver>-x86_64-pc-windows-msvc.zip`, `lanhub-cli-<ver>-x86_64-unknown-linux-gnu.tar.gz`.

## 8. Áp dụng pStack

Quy trình phiên này theo pStack của Lauren Tan (`cursor/plugins/pstack`, đọc tại commit `6b03002`). Playbook dùng: `figure-it-out` cho việc lớn chưa có playbook sẵn, và `multi-phase-plan` cho bộ kế hoạch. Các nguyên tắc định hình quyết định:

| Nguyên tắc | Quyết định nó thay đổi |
|---|---|
| Foundational Thinking | P0 dựng bộ kiểm thử hộp đen, công cụ CDP và bộ UI trước mọi tính năng |
| Redesign from First Principles | Nhiều dự án và lịch sử theo lượt được thiết kế như giả định gốc: actor theo dự án, cấu hình TOML, kho lịch sử riêng, thay vì vá thêm vào hub một dự án |
| Separate Before Serializing Shared State | Một actor sở hữu một dự án, một luồng ghi lịch sử. Hai nhánh có ranh giới file tách biệt và chỉ chung hợp đồng giao thức |
| Model the Domain | Máy trạng thái kết nối thay các boolean. Bảng mã lỗi thay câu chữ từ hub. Lượt chỉnh sửa là kiểu dữ liệu riêng |
| Boundary Discipline | Hub gửi mã, client dựng câu. TOML được parse thành kiểu ngay ở biên |
| Outcome-Oriented Execution | Không giữ hub Node.js song song. `lanhub` chỉ nói giao thức v2. Xoá giải mã mời v1, v2 ở I1 |
| Subtract Before You Add | Bỏ chụp file định kỳ, bỏ cây "Đồng đội", bỏ webview chat viết tay, bỏ mẹo coi lỗi `account` là thăm dò thành công, bỏ bộ ghi ZIP tự viết |
| Experience First | Chẩn đoán tự khắc phục, bảng chuyển sang webview, câu chữ chuẩn |
| Build the Lever | Bộ kiểm thử hộp đen, vector OT, máy tạo tải, công cụ CDP, lint câu chữ |
| Make Operations Idempotent | Áp cấu hình, dọn lịch sử, thêm quy tắc tường lửa đều so trạng thái thật rồi chỉ áp phần khác |
| Type System Discipline | Kiểu thông điệp định nghĩa một lần trong Rust, sinh TypeScript cho client |
| Migrate Callers Then Delete Legacy APIs | Mỗi API mới thay xong chỗ gọi thì xoá API cũ trong cùng đợt |
| Prove It Works, Sequence Verifiable Units | Mỗi PR có kiểm chứng unit, live, perf riêng và chỉ tính là xong khi đủ cả ba |
| Never Block on the Human | Mọi lựa chọn kỹ thuật trong tài liệu này đã chốt, không chờ hỏi |

Điều chỉnh pStack cho môi trường này (máy Windows 10, Claude Code, không có `gh`):

- Toolchain Rust: máy đang đặt mặc định `stable-x86_64-pc-windows-gnu`. A1 ghim `stable-x86_64-pc-windows-msvc` trong `lanhub/rust-toolchain.toml`, vì Tauri 2 và tên gói phát hành cần MSVC.
- Làn Linux: máy có WSL nhưng chưa có bản phân phối nào, và không có Docker. Làn cần Linux chạy trên job `ubuntu-latest` của CI hoặc trên máy Linux người vận hành cung cấp (cách nhanh nhất là `wsl --install -d Ubuntu-24.04`, người vận hành tự chạy vì đây là thay đổi hệ thống). Thiếu máy Linux thì làn đó ghi NOT VERIFIED và chặn PR.
- Model: pStack mặc định dùng slug của Cursor. Ở đây chủ PR viết mã chạy `claude-opus-5-5` (effort `medium`, riêng A2, A5, B4, C1 chạy `high`), agent dò mã chạy Sonnet hoặc Haiku, các làn kiểm chứng chạy `claude-opus-5-5`.
- Làn kiểm chứng: pStack chạy 10 làn trên 10 máy ảo cloud. Ở đây một agent kiểm chứng chạy tuần tự 10 làn trên máy này. Làn cần nhiều máy dùng nhiều instance VS Code với `--user-data-dir` riêng qua loopback. Làn cần hai máy vật lý thật ghi rõ là người vận hành hỗ trợ.
- Kỹ năng điều khiển: thay `control-ui` của `cursor-team-kit` bằng `tools/cdp/` (P0-4).
- Bugbot: không có. PR chạm giao thức, lưu trữ, xác thực hoặc đồng thời được một reviewer Opus effort `high` duyệt ở context riêng. PR khác tự soát diff.
- Hợp nhất: người vận hành tự merge (playbook `autopilot-stack`). Agent không push, không merge.
- Nhật ký quyết định: mỗi đợt một file TSV trong `docs/plans/trail/` theo skill `show-me-your-work` (`planning.tsv` cho phiên lập kế hoạch này, `P0.tsv`, `A.tsv`, `B.tsv`, `I.tsv`, `C.tsv` khi triển khai).
- Ảnh và video duyệt PR lưu ở `docs/plans/media/`, thư mục này nằm trong `.gitignore` (P0-3 thêm) để repo không phình theo video.

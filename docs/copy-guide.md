# Hướng dẫn câu chữ LAN Collab

Tài liệu này là nguồn duy nhất cho mọi chữ người dùng đọc thấy trong extension LAN Collab và ứng dụng LAN Hub: thông báo, nút, lệnh, thanh trạng thái, quick pick, webview, mô tả setting, hoạt động thành viên và thông báo lỗi từ LAN Hub. Kênh Output là ngoại lệ duy nhất, xem mục [Chi tiết kỹ thuật chỉ nằm trong kênh Output](#chi-tiết-kỹ-thuật-chỉ-nằm-trong-kênh-output).

Chuỗi giao diện của extension nằm trong `extension/i18n/vi.json`, của ứng dụng nằm trong `lanhub/app/ui/src/i18n/vi.json`. `tools/check-strings.mjs` báo lỗi khi có chuỗi tiếng Việt nằm ngoài hai file này. Khi thêm hoặc sửa một chuỗi, đối chiếu với bảng thuật ngữ, quy tắc giọng văn, mẫu thông báo lỗi và danh sách mẫu cấm dưới đây.

## Bảng thuật ngữ

Mỗi khái niệm có đúng một tên. Dùng tên trong cột **Thuật ngữ** ở mọi nơi, kể cả tiêu đề, nút và tooltip. Từ trong cột **Không dùng** là từ 0.1.1 đã dùng cho cùng khái niệm.

| Thuật ngữ | Nghĩa | Không dùng | Ví dụ |
|---|---|---|---|
| **LAN Hub** | Máy chủ đồng bộ chạy trong mạng nội bộ, gồm ứng dụng LAN Hub và bản headless `lanhub-cli`. | hub, máy chủ, server, LAN Collab hub | Không kết nối được LAN Hub tại 192.168.1.10:8200. |
| **dự án** | Một thư mục mà LAN Hub phục vụ và đồng bộ. Một LAN Hub phục vụ được nhiều dự án. | phòng | Ngắt kết nối khỏi dự án web-portal? |
| **thành viên** | Một người đang kết nối hoặc đã từng kết nối vào dự án. | đồng đội, người, người dùng, ai | 4 thành viên đang trực tuyến |
| **mã mời** | Chuỗi bắt đầu bằng `LC` chứa địa chỉ LAN Hub, tên dự án và token. Dán mã mời là cách tham gia dự án. | mã, invite code | Đã sao chép mã mời. |
| **đồng bộ** | Đưa file trên máy này và file trên LAN Hub về cùng nội dung. Dùng được làm động từ và danh từ. | sync, tải về và gửi lên | Đang đồng bộ 12/40 file |
| **bản trên hub** | Nội dung file mà LAN Hub đang giữ. Đây là cụm cố định. Ngoài cụm này, luôn viết "LAN Hub". | bản chung, bản server | Dùng bản trên hub |
| **bản trên máy này** | Nội dung file trên ổ đĩa của máy đang dùng. | bản máy này, bản cục bộ, local | Giữ bản trên máy này |
| **lượt chỉnh sửa** | Chuỗi thay đổi liên tục của một thành viên trên một file, do LAN Hub ghi vào lịch sử. Lượt chỉnh sửa kết thúc khi thành viên khác sửa file đó, khi thành viên ngừng sửa quá thời gian chờ, hoặc khi có điểm khôi phục. | lượt, phiên sửa | Hoàn tác lượt chỉnh sửa này |
| **điểm khôi phục** | Mốc có tên do thành viên tạo, ghi lại nội dung mọi file của dự án tại thời điểm đó để so sánh hoặc khôi phục sau này. | checkpoint, bản chụp, snapshot | Tạo điểm khôi phục |
| **chẩn đoán kết nối** | Lệnh chạy theo thứ tự các bước kiểm tra kết nối tới LAN Hub và hiện kết quả từng bước. Trên nút, dùng dạng ngắn "Chẩn đoán". | kiểm tra kết nối, debug kết nối | LAN Collab: Chẩn đoán kết nối |
| **danh sách tài khoản được phép** | Danh sách tài khoản GitHub hoặc Microsoft mà LAN Hub cho vào dự án. | allow file, danh sách, allowed-accounts | Tài khoản github:quy chưa có trong danh sách tài khoản được phép. |

Các từ phụ dưới đây cũng giữ một nghĩa:

| Từ | Nghĩa | Không dùng |
|---|---|---|
| **file** | Một file trong dự án. | tệp, tập tin |
| **token** | Chuỗi bí mật LAN Hub dùng để nhận máy được phép kết nối. | mật khẩu, khoá |
| **tài khoản** | Tài khoản GitHub hoặc Microsoft đăng nhập trong VS Code, viết dạng `github:tên`. | account |
| **người quản trị LAN Hub** | Người chạy LAN Hub và sửa cấu hình của nó. | người quản lý hub, admin |
| **kết nối**, **ngắt kết nối**, **kết nối lại** | Động từ cho kết nối giữa máy này và LAN Hub. | vào hub, thoát, nối lại |
| **trực tuyến** | Thành viên đang kết nối. | online |
| **nhật ký** | Kênh Output "LAN Collab" trong VS Code, hoặc màn hình nhật ký của ứng dụng LAN Hub. | log, Output |
| **xung đột** | File đã đổi cả trên máy này lẫn trên LAN Hub trong lúc mất kết nối. | conflict, lệch |

## Giọng văn

Giọng trung tính, nghiệp vụ, như một đồng nghiệp nắm rõ hệ thống. Câu chữ nói điều đang xảy ra và việc cần làm, không nói cảm xúc.

- Viết lệnh và nút bằng động từ mệnh lệnh ngắn, từ một đến bốn từ: "Kết nối lại", "Sao chép mã mời", "Dùng bản trên hub". Nút nói tên hành động, không dùng "OK", "Có" hay "Đồng ý".
- Viết câu khẳng định, ở thì hiện tại: "LAN Hub từ chối token của máy này." Không viết "Có vẻ như token đã bị từ chối."
- Bỏ đại từ "bạn" khi câu vẫn đủ nghĩa. "Đang làm gì" thay cho "Bạn đang làm gì?".
- Mỗi câu một ý. Câu thông báo dài quá khoảng 20 từ thì tách thành hai câu.
- Viết hoa chữ đầu câu và tên riêng: LAN Hub, LAN Collab, VS Code, GitHub, Microsoft. Không viết hoa cả chữ.
- Viết số bằng chữ số. Dùng dấu phẩy thập phân: "0,4 giây". Đơn vị đứng sau số và cách một khoảng trắng: "3 giây", "4 MB", "12 file".
- Tiến trình dùng "Đang …": "Đang đồng bộ web-portal". Kết quả dùng "Đã …": "Đã đồng bộ 128 file". Không thêm "thành công".
- Nhãn mở thêm một bước nhập (quick pick, hộp nhập) kết thúc bằng dấu ba chấm một ký tự "…": "Tham gia bằng mã mời…".
- Tiêu đề hộp xác nhận được phép là câu hỏi, và nút chính lặp lại động từ trong câu hỏi: tiêu đề "Ngắt kết nối khỏi web-portal?", nút "Ngắt kết nối".
- Tên lệnh, nút và màn hình khác nhắc tới trong câu đặt trong ngoặc kép: Chạy "Tham gia bằng mã mời".
- Hoạt động thành viên viết thường, bắt đầu bằng động từ, đứng sau tên thành viên: "Minh Anh đang sửa src/app.ts".

### Từng loại chỗ hiển thị

| Chỗ hiển thị | Quy tắc | Ví dụ |
|---|---|---|
| Tiêu đề lệnh | Động từ mệnh lệnh. VS Code tự thêm "LAN Collab:" từ `category`, nên tiêu đề không lặp lại. | Chẩn đoán kết nối |
| Thông báo (toast) | Theo mẫu thông báo lỗi khi là lỗi. Tối đa hai câu và ba nút. | Đã sao chép mã mời. |
| Thanh trạng thái | Chữ trên thanh ngắn nhất có thể. Tooltip là câu đầy đủ. | 4 thành viên |
| Placeholder | Một câu mô tả nội dung cần nhập, không dùng câu hỏi. | Dán mã mời bắt đầu bằng LC |
| Tooltip | Một câu, không chấm cuối khi chỉ là cụm từ. | Sao chép mã mời |
| Trạng thái trống | Tiêu đề nói điều đang thiếu, một câu nói điều sẽ xuất hiện, một nút hành động nếu có. | Chưa có tin nhắn. Tin nhắn gửi trong dự án hiện ở đây. |
| Mô tả setting | Câu đầy đủ. Được nhắc tên setting khác và dùng Markdown. | Địa chỉ LAN Hub dạng `IP:cổng`. |

## Mẫu thông báo lỗi

Thông báo lỗi có ba phần, theo đúng thứ tự:

1. Hiện tượng. Một câu nói việc gì không làm được, thường có dạng "Không … được …", kèm địa chỉ hoặc tên khi có. Khi LAN Hub từ chối kết nối, câu nói LAN Hub từ chối điều gì.
2. Nguyên nhân, nếu biết. Một câu nói vì sao, bằng từ người dùng hiểu được.
3. Nút hành động. Tối đa ba nút, nút giải quyết vấn đề đứng đầu. Lỗi kết nối luôn có nút "Chẩn đoán".

Ví dụ:

> Không kết nối được LAN Hub tại 192.168.1.10:8200. Cổng không phản hồi sau 3 giây.
>
> Nút: **Chẩn đoán**, **Thử lại**

Khi không biết nguyên nhân, bỏ phần 2 và giữ phần 1 và phần 3. Không đoán nguyên nhân, không viết "lỗi không xác định".

Lỗi mà người dùng tự sửa được thì nút dẫn tới đúng chỗ sửa. Lỗi chỉ người quản trị LAN Hub sửa được thì thông báo đưa ra đúng thông tin cần gửi, kèm nút sao chép thông tin đó.

### Chi tiết kỹ thuật chỉ nằm trong kênh Output

Thông báo, nút và webview không chứa chi tiết kỹ thuật. Chi tiết kỹ thuật ghi vào nhật ký, và thông báo có nút "Xem nhật ký" khi chi tiết đó giúp được người dùng.

Kênh Output được phép chứa mã lỗi gốc (`ECONNREFUSED`), nội dung `e.message`, stack trace, tên setting và mức độ như `[LỖI]`. Câu trong kênh Output vẫn dùng bảng thuật ngữ.

## Mẫu cấm

Mỗi mẫu dưới đây làm câu chữ khó đọc hoặc lộ chi tiết nội bộ. `tools/check-strings.mjs` và người duyệt PR chặn các mẫu này.

| Mẫu cấm | Lý do | Thay bằng |
|---|---|---|
| "phòng", "đồng đội", "bản chung", "hub" đứng một mình | Trái bảng thuật ngữ. | dự án, thành viên, bản trên hub, LAN Hub |
| Tiền tố "LAN Collab:" ở đầu thông báo | VS Code đã ghi nguồn của thông báo. | Bỏ tiền tố. |
| Tên setting như `lanCollab.token` trong thông báo hoặc nút | Người dùng không cần biết tên setting để sửa lỗi. | Nút mở đúng màn hình thiết lập. |
| Thông điệp lỗi gốc của Node hoặc hệ điều hành, như `ECONNREFUSED`, `e.message` | Người dùng không đọc được, và nó thay đổi theo phiên bản Node. | Câu nguyên nhân theo mẫu thông báo lỗi. Bản gốc ghi vào nhật ký. |
| Thẻ `[LỖI]`, `[CẢNH BÁO]` ngoài kênh Output | Loại thông báo (lỗi, cảnh báo) đã thể hiện mức độ. | Bỏ thẻ. |
| Dấu chấm than | Làm câu nghe như la lên. | Dấu chấm. |
| Emoji trong câu chữ giao diện | Không hợp giọng nghiệp vụ. Bảng chọn emoji của chat là nội dung người dùng, không phải câu chữ. | Biểu tượng Lucide hoặc codicon. |
| "bạn" khi câu đứng được mà không cần nó | Thừa chữ. | Bỏ đại từ. |
| Câu trấn an: "Đừng lo", "yên tâm", "bạn vẫn sửa được" | Không cho người dùng thông tin mới. | Nói điều sẽ xảy ra: "Thay đổi trên máy này được gửi khi kết nối lại." |
| "Vui lòng", "xin", "hãy" đứng đầu lệnh | Thừa chữ trong câu mệnh lệnh. | Động từ đứng đầu: "Dán mã mời mới." |
| "thành công", "Rất tiếc", "Có vẻ như", "Oops" | Thừa chữ hoặc đoán mò. | "Đã …", hoặc nói thẳng hiện tượng. |
| Gạch ngang dài "—" và dấu chấm phẩy trong câu | Ghép hai ý vào một câu. | Tách thành hai câu. |
| Dấu gạch chéo giữa hai lựa chọn: "GitHub/Microsoft", "file/dòng" | Đọc được nhiều cách. | "GitHub hoặc Microsoft", "file và dòng". |
| Ngoặc đơn chứa lời giải thích thêm | Người đọc dễ bỏ qua đúng phần quan trọng. | Câu thứ hai. |
| Câu hỏi làm placeholder hoặc nhãn: "Đi theo ai?" | Câu hỏi không cho biết cần nhập gì. | Câu mô tả: "Chọn thành viên để đi theo". |
| Từ tiếng Anh khi đã có từ trong bảng thuật ngữ: online, Settings, clipboard, log | Hai tên cho một khái niệm. | trực tuyến, cài đặt, bộ nhớ tạm, nhật ký |

## Ví dụ trước và sau

Cột **Trước** chép nguyên chuỗi 0.1.1, giá trị trong ngoặc nhọn là biến. Cột **Sau** là chuỗi viết lại theo hướng dẫn này. B1 dùng bảng này làm mẫu khi viết lại toàn bộ chuỗi.

### Kết nối và lỗi từ LAN Hub

| Nguồn | Trước | Sau |
|---|---|---|
| `extension/extension.js:121` | hub {host}:{port} không phản hồi. Kiểm tra hub đang chạy và tường lửa đã mở cổng {port}. | Không kết nối được LAN Hub tại {host}:{port}. Cổng không phản hồi sau 3 giây. Nút: **Chẩn đoán**, **Thử lại** |
| `extension/extension.js:128` | không kết nối được {host}:{port}: {e.message} | Không kết nối được LAN Hub tại {host}:{port}. LAN Hub chưa chạy hoặc sai cổng. Nút: **Chẩn đoán**, **Thử lại**. Nội dung `e.message` ghi vào nhật ký. |
| `extension/extension.js:112` | hub {host}:{port} đóng kết nối | LAN Hub tại {host}:{port} đã đóng kết nối. Nút: **Kết nối lại** |
| `hub/hub.js:483` | Sai lanCollab.token. | LAN Hub từ chối token của máy này. Token đã đổi hoặc mã mời đã cũ. Nút: **Dán mã mời mới**, **Nhập token** |
| `hub/hub.js:482` | Phiên bản giao thức khác hub (máy: {a}, hub: {b}) — cập nhật extension. | LAN Hub dùng phiên bản giao thức mới hơn extension này. Cập nhật LAN Collab để kết nối. Nút: **Cập nhật** |
| `hub/hub.js:484` | Hub này phục vụ dự án "{project}", máy đang mở "{m.project}". | LAN Hub tại {host}:{port} không có dự án "{m.project}". Nút: **Chọn dự án** |
| `hub/hub.js:417` | Hub chỉ cho các tài khoản trong danh sách vào. Đăng nhập GitHub hoặc Microsoft trong VS Code (biểu tượng tài khoản ở góc dưới bên trái), rồi chạy lệnh "LAN Collab: Dùng tài khoản VS Code". | LAN Hub chỉ nhận tài khoản trong danh sách tài khoản được phép. Đăng nhập GitHub hoặc Microsoft trong VS Code để kết nối. Nút: **Đăng nhập** |
| `hub/hub.js:421` | Tài khoản {provider}:{label} chưa được phép vào. Nhờ người quản lý hub thêm dòng "{provider}:{label}" vào {allowFile}. | Tài khoản {provider}:{label} chưa có trong danh sách tài khoản được phép. Gửi dòng {provider}:{label} cho người quản trị LAN Hub. Nút: **Sao chép dòng**, **Đổi tài khoản** |
| `extension/extension.js:665` | LAN Collab: không đăng nhập được {provider}: {e.message} | Không đăng nhập được tài khoản {provider}. Nút: **Thử lại**, **Xem nhật ký** |

### Tham gia, mã mời và đồng bộ

| Nguồn | Trước | Sau |
|---|---|---|
| `extension/extension.js:142` | LAN Collab: đang ở trong một phòng. Ngắt kết nối trước khi tham gia phòng khác. | Đang kết nối với dự án {project}. Ngắt kết nối trước khi tham gia dự án khác. Nút: **Ngắt kết nối** |
| `extension/extension.js:146` | Dán mã mời (bắt đầu bằng LC-). Lấy mã ở cửa sổ hub, hoặc nhờ người đã vào phòng bấm "Sao chép mã mời". | Dán mã mời bắt đầu bằng LC. Mã mời có trong ứng dụng LAN Hub, hoặc lấy từ một thành viên của dự án. |
| `extension/extension.js:149` | Mã không hợp lệ | Mã mời không đúng định dạng. |
| `extension/extension.js:198` | LAN Collab: đã chép mã mời vào clipboard: {code}. Người nhận chạy "LAN Collab: Tham gia bằng mã". Mã có chứa token, chỉ gửi cho người trong nhóm. | Đã sao chép mã mời. Mã mời có chứa token, chỉ gửi cho thành viên trong nhóm. |
| `extension/extension.js:270` | LAN Collab: thư mục này chưa gắn với hub nào. Dán mã mời, hoặc đặt lanCollab.server và lanCollab.project. Nút: Tham gia bằng mã, Mở Settings | Thư mục này chưa gắn với LAN Hub nào. Nút: **Tham gia bằng mã mời**, **Thiết lập** |
| `extension/extension.js:171` | Thư mục {path} đã có file. File khác bản chung sẽ bị thay (bản cũ sao lưu vào .lan-collab/backup); file chỉ có ở đây sẽ được gửi lên hub. Tiếp tục? Nút: Tiếp tục | Thư mục {path} đã có file. File khác bản trên hub được thay bằng bản trên hub, bản trên máy này được sao lưu. File chỉ có trên máy này được gửi lên LAN Hub. Nút: **Đồng bộ** |
| `extension/extension.js:229` | LAN Collab: đã đồng bộ {n}/{total} file. {skipped} file không được hub nhận, xem chi tiết trong nhật ký (LAN Collab: Xem nhật ký). | Đã đồng bộ {n}/{total} file. LAN Hub không nhận {skipped} file. Nút: **Xem nhật ký** |
| `extension/extension.js:392` | Nút: Lấy bản chung, Giữ bản máy này | Nút: **Dùng bản trên hub**, **Giữ bản trên máy này** |
| `extension/extension.js:344` | LAN Collab: bản khác bản chung trên máy này đã được sao lưu vào {dir} | Đã sao lưu bản trên máy này của các file khác bản trên hub. Nút: **Mở thư mục sao lưu** |

### Thanh trạng thái, danh sách thành viên và quick pick

| Nguồn | Trước | Sau |
|---|---|---|
| `extension/extension.js:724` | Chưa kết nối — bấm để mở menu | Chưa kết nối. Bấm để mở menu. |
| `extension/extension.js:726` | Đang thử kết nối lại; bạn vẫn sửa được, sẽ gộp khi có mạng | Mất kết nối LAN Hub. Đang kết nối lại. Thay đổi trên máy này được gửi khi kết nối lại. |
| `extension/extension.js:727` | {n} người | {n} thành viên |
| `extension/extension.js:605` | Chưa có ai khác trong phòng. | Dự án chưa có thành viên nào khác trực tuyến. |
| `extension/extension.js:608` | Đi theo ai? (màn hình của bạn sẽ nhảy theo file/dòng của họ) | Chọn thành viên để đi theo. Editor mở theo file và dòng của thành viên đó. |
| `extension/extension.js:617` | Bạn đang làm gì? (để trống để xoá) | Đang làm gì, ví dụ "Sửa trang đăng nhập". Để trống để xoá trạng thái. |
| `extension/extension.js:656` | Dùng tài khoản nào để đồng đội nhận ra bạn? (chỉ gửi tên tài khoản lên hub) | Chọn tài khoản hiển thị với thành viên khác. LAN Hub chỉ nhận tên tài khoản. |
| `extension/extension.js:786` | Bấm để nhảy tới chỗ người này đang đứng | Bấm để mở file và dòng thành viên này đang sửa |
| `extension/extension.js:577` | {name} không mở file nào trong dự án. | {name} chưa mở file nào trong dự án. |

### Chat

| Nguồn | Trước | Sau |
|---|---|---|
| `extension/chat-view.js:170` | Nhắn cả phòng · @ để nhắc tên · dán ảnh bằng Ctrl+V | Nhắn cho dự án. Gõ @ để nhắc tên, Ctrl+V để dán ảnh. |
| `extension/webview/chat.js:62` | Chỉ có bạn trong phòng | Chưa có thành viên khác trực tuyến |
| `extension/webview/chat.js:62` | {n} người khác đang online | {n} thành viên khác đang trực tuyến |
| `extension/webview/chat.js:337` | Kết nối hub để xem và gửi tin nhắn. | Kết nối LAN Hub để xem và gửi tin nhắn. |
| `extension/chat-view.js:63` | LAN Collab: ảnh không còn trên hub. | Ảnh không còn trên LAN Hub. |
| `lib/client-core.js:741` | Hub đang chạy bản cũ, chưa nhận ảnh. Cập nhật hub trên máy chủ để gửi ảnh. | LAN Hub này chưa nhận ảnh. Cập nhật LAN Hub để gửi ảnh. |
| `extension/webview/chat.js:219` | Ảnh lớn hơn 4 MB, không gửi được. | Không gửi được ảnh. Ảnh lớn hơn 4 MB. |

### Hoạt động thành viên và nhật ký

| Nguồn | Trước | Sau |
|---|---|---|
| `hub/hub.js:515` | vào phòng ({remoteAddress}) | vào dự án. Địa chỉ IP chỉ ghi vào nhật ký của LAN Hub. |
| `hub/hub.js:532` | rời phòng | rời dự án |
| `hub/hub.js:167` | đang sửa {rel} (AI/công cụ ngoài editor) | đang sửa {rel} bằng công cụ ngoài editor |
| `lib/client-core.js:394` (kênh Output) | Đã vào phòng "{project}": giữ {a}, gộp {b}, tải {c}, gửi {d}, xoá {e}. | Đã vào dự án "{project}": giữ {a}, gộp {b}, tải {c}, gửi {d}, xoá {e}. |
| `lib/client-core.js:93` (thông báo) | [CẢNH BÁO] Không đồng bộ {path}: file quá lớn để truyền qua hub. File vẫn giữ nguyên trên máy này. | Không đồng bộ được {path}. File lớn hơn giới hạn của LAN Hub và vẫn giữ nguyên trên máy này. |

### Lệnh và view trong `package.json`

| Lệnh hoặc view | Trước | Sau |
|---|---|---|
| `lanCollab.follow` | Đi theo một người | Đi theo thành viên |
| `lanCollab.join` | Tham gia bằng mã | Tham gia bằng mã mời |
| `lanCollab.signIn` | Dùng tài khoản VS Code (GitHub/Microsoft) | Chọn tài khoản VS Code |
| `lanCollab.setStatus` | Đặt trạng thái (đang làm gì) | Đặt trạng thái |
| `lanCollab.people` | Đồng đội | Thành viên |

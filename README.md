# iphone-themes (ThemeKit) — v1.4.0

Sửa trên PC → tăng "version" ở CẢ themes.json và version.json → Commit + Push (GitHub Desktop).
iPhone: widget kiểm tra phiên bản mỗi 60 phút; mở app Theme để lấy ngay.

Quay về bản cũ: trong script Theme trên iPhone, sửa dòng `const PIN = ""` thành `const PIN = "1.3.0"`.
Các bản lưu ở thư mục releases/.

Tham số widget: `<theme>:<hud|launch>:<top|middle|bottom>` — ví dụ `fox:hud:middle`.
Widget phải nằm đúng hàng ghi trong tham số.

Giới hạn đã biết (không làm theo cách cũ):
- Scriptable không đọc được số bước chân (không có API Health).
- Widget màn hình khóa chỉ đơn sắc, không vẽ ảnh/màu theme.
- Widget không chuyển động được. iOS tự quyết thời điểm làm mới.
- Chạm nút trong widget luôn mở Scriptable thoáng qua rồi mới sang app (giới hạn iOS).
- Hình nền không để trong repo (tranh của tác giả khác).

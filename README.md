# iphone-themes (ThemeKit)

Widget Scriptable đổi theo theme. Sửa trên PC → Commit + Push trong GitHub Desktop → iPhone tự nhận (tối đa ~30 phút, hoặc mở app Theme để lấy ngay).

- `themes.json` — màu, chữ, hàng đặt widget, danh sách app (nhãn, biểu tượng SF Symbol, URL mở app). Tăng `version` mỗi lần sửa.
- `engine.js` — code vẽ widget.
- `Theme.js` — loader, dán vào Scriptable một lần.

Tham số widget: `<theme>:hud` hoặc `<theme>:launch` (ví dụ `fox:hud`).
Hình nền KHÔNG để trong repo (tranh của tác giả khác).

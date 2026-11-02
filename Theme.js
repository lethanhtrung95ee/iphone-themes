// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: magic;

// ThemeKit loader v2 — dán vào Scriptable MỘT LẦN, đặt tên "Theme".
// Widget chạy bản đã lưu trên máy; cứ 60 phút mới hỏi GitHub xem có phiên bản mới không.
const REPO = "lethanhtrung95ee/iphone-themes";
const BRANCH = "main";
const PIN = "";            // để trống = bản mới nhất. Muốn quay về bản cũ: gõ "1.3.0" (thư mục releases/1.3.0)
const CHECK_MIN = 60;      // bao lâu kiểm tra phiên bản một lần (phút)
const LOADER_VERSION = "2";

const BASE = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/" + (PIN ? "releases/" + PIN + "/" : "");
const fm = FileManager.local();
const dir = fm.joinPath(fm.documentsDirectory(), "themekit");
if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
const P = n => fm.joinPath(dir, n);

async function fetchText(name, timeoutSec) {
  const r = new Request(BASE + name + "?t=" + Date.now()); r.timeoutInterval = timeoutSec;
  const s = await r.loadString();
  if (!r.response || r.response.statusCode !== 200 || s.length < 10) throw new Error(name + " HTTP " + (r.response && r.response.statusCode));
  return s;
}
function readMeta() { try { return JSON.parse(fm.readString(P("meta.json"))); } catch (e) { return { checkedAt: 0, version: "", pin: "" }; } }

async function sync(force) {
  const meta = readMeta(), hasCache = fm.fileExists(P("engine.js")) && fm.fileExists(P("themes.json"));
  const due = force || !hasCache || meta.pin !== PIN || Date.now() - meta.checkedAt > CHECK_MIN * 60000;
  if (!due) return "cache";
  try {
    const remote = JSON.parse(await fetchText("version.json", 4)).version;
    if (remote !== meta.version || !hasCache || meta.pin !== PIN) {
      const eng = await fetchText("engine.js", 6), th = await fetchText("themes.json", 6);
      JSON.parse(th); // kiểm tra hợp lệ trước khi ghi đè
      fm.writeString(P("engine.js"), eng); fm.writeString(P("themes.json"), th);
    }
    fm.writeString(P("meta.json"), JSON.stringify({ checkedAt: Date.now(), version: remote, pin: PIN }));
    return "net";
  } catch (e) {
    if (hasCache) return "offline";
    throw new Error("Chưa tải được dữ liệu lần đầu (cần mạng). " + e.message);
  }
}

try {
  const src = await sync(!config.runsInWidget);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction("ENV", fm.readString(P("engine.js")))({
    themes: JSON.parse(fm.readString(P("themes.json"))), src, dir, args, config, loaderVersion: LOADER_VERSION,
  });
} catch (e) {
  if (config.runsInWidget) {
    const w = new ListWidget(); w.backgroundColor = new Color("#14051f");
    const t = w.addText("Theme: " + e.message); t.font = Font.systemFont(11); t.textColor = new Color("#ff9ae8");
    Script.setWidget(w);
  } else {
    const a = new Alert(); a.title = "Theme lỗi"; a.message = String(e.message || e); a.addAction("OK"); await a.present();
  }
  Script.complete();
}

// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: magic;

// ThemeKit loader — dán vào Scriptable MỘT LẦN, đặt tên "Theme".
// Tải engine + cấu hình mới nhất từ GitHub, lưu bản sao để chạy khi mất mạng.
const REPO = "__REPO__";          // ví dụ: ten-ban/iphone-themes
const BRANCH = "main";
const LOADER_VERSION = "1";

const BASE = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/";
const fm = FileManager.local();
const dir = fm.joinPath(fm.documentsDirectory(), "themekit");
if (!fm.fileExists(dir)) fm.createDirectory(dir, true);

async function get(name, maxAgeMin) {
  const p = fm.joinPath(dir, name);
  const has = fm.fileExists(p);
  const fresh = has && (Date.now() - fm.modificationDate(p).getTime()) < maxAgeMin * 60000;
  if (!fresh) {
    try {
      const r = new Request(BASE + name + "?t=" + Date.now());
      r.timeoutInterval = 6;
      const s = await r.loadString();
      if (r.response && r.response.statusCode === 200 && s.length > 20) { fm.writeString(p, s); return { s, src: "net" }; }
    } catch (e) {}
  }
  if (has) return { s: fm.readString(p), src: fresh ? "cache" : "offline" };
  throw new Error("Chưa tải được " + name + ". Lần đầu cần có mạng.");
}

try {
  const age = config.runsInWidget ? 30 : 0;
  const eng = await get("engine.js", age);
  const th = await get("themes.json", age);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction("ENV", eng.s)({
    themes: JSON.parse(th.s), src: eng.src === "net" || th.src === "net" ? "net" : eng.src,
    dir, args, config, loaderVersion: LOADER_VERSION,
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

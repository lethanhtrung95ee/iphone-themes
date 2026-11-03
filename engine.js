// ThemeKit engine — chạy bên trong loader "Theme" trên iPhone.
// Không sửa trực tiếp trên điện thoại: sửa trên PC rồi push lên GitHub.
// Biến ENV do loader truyền vào: { themes, src, dir, args, config, loaderVersion }
const ENGINE_VERSION = "1.4.3";
const T = ENV.themes;
const fm = FileManager.local();
const DIR = ENV.dir;

// Vị trí widget trên màn hình chính, đơn vị pixel của ảnh chụp màn hình.
// Khóa = "rộng x cao" của Device.screenResolution(). Máy không có trong bảng sẽ bị báo lỗi, không cắt bừa.
const POS = {
  "1179x2556": { model: "iPhone 15 Pro", small: 474, medium: 1017, left: 81, right: 624, rows: [240, 828, 1416] },
  "1290x2796": { model: "iPhone 15 Pro Max", small: 510, medium: 1092, left: 99, right: 681, rows: [282, 918, 1554] },
};
const ROW_NAMES = { top: 1, tren: 1, "1": 1, middle: 2, giua: 2, "2": 2, bottom: 3, duoi: 3, "3": 3 };
const ROW_LABEL = { 1: "top", 2: "middle", 3: "bottom" };
const ROW_VI = { 1: "hàng trên", 2: "hàng giữa", 3: "hàng dưới" };

// ---------------- tiện ích ----------------
function C(hex, a) { return new Color(hex, a === undefined ? 1 : a); }
function p(...a) { return fm.joinPath(...a); }
function ensureDir(d) { if (!fm.fileExists(d)) fm.createDirectory(d, true); }
function bgPath(theme, size, row) { return p(DIR, "bg", theme, size + "-" + row + ".png"); }
// Scriptable: readString trả về null (không ném lỗi) khi file chưa có → phải tự kiểm tra
function readJSON(name, dflt) { try { const f = p(DIR, name); if (!fm.fileExists(f)) return dflt; const v = JSON.parse(fm.readString(f)); return v == null ? dflt : v; } catch (e) { return dflt; } }
function writeJSON(name, v) { try { fm.writeString(p(DIR, name), JSON.stringify(v)); } catch (e) {} }
function pad2(n) { return String(n).padStart(2, "0"); }
function hhmm(ms) { const d = new Date(ms); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
async function withTimeout(promise, sec, fallback) { // sec = giây; Timer.schedule nhận mili-giây
  let t; const timer = new Promise(res => { t = Timer.schedule(sec * 1000, false, () => res(fallback)); });
  const r = await Promise.race([promise.catch(() => fallback), timer]); try { t.invalidate(); } catch (e) {} return r;
}
// cài đặt riêng trên máy (font, URL dự phòng, chỉnh lệch nền)
function settings() { return readJSON("settings.json", { fontMode: "serif", appOverride: {}, offset: { dx: 0, dy: 0 } }); }
function saveSettings(v) { writeJSON("settings.json", v); }
function deviceKey() { const r = Device.screenResolution(); return Math.round(r.width) + "x" + Math.round(r.height); }
function devicePos() { return POS[deviceKey()] || null; }
// hạt giống ngẫu nhiên theo NGÀY (không đổi theo phút, vì iOS tự quyết lúc làm mới)
function daySeed(extra) { const d = new Date(); return (d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate()) ^ hashStr(extra || ""); }

// Font có chân + dự phòng font hệ thống (chọn trong app: Kiểm tra font chữ)
let _fontMode = null;
function SERIF(name, size) {
  if (_fontMode === null) _fontMode = settings().fontMode || "serif";
  if (_fontMode === "system") {
    if (/Italic/.test(name)) return Font.italicSystemFont(size);
    if (/SemiBold|Bold/.test(name)) return Font.semiboldSystemFont(size);
    return /Didot/.test(name) ? Font.lightSystemFont(size) : Font.systemFont(size);
  }
  return new Font(name, size);
}

// ---------------- dữ liệu ----------------
// Widget KHÔNG dùng GPS. Vị trí lấy từ lần cập nhật trong app (loc.json), nếu chưa có thì dùng tọa độ trong themes.json.
function getLocation() {
  const W = T.weather || {};
  const last = readJSON("loc.json", null);
  return last && last.lat ? last : { lat: W.lat, lon: W.lon, name: W.name || "" };
}

async function getWeather() {
  const cache = readJSON("weather.json", null);
  if (cache && Date.now() - cache.at < 30 * 60000) return Object.assign({ offline: false }, cache);
  try {
    const L = getLocation();
    const unit = (T.weather && T.weather.unit) === "fahrenheit" ? "fahrenheit" : "celsius";
    const r = new Request("https://api.open-meteo.com/v1/forecast?latitude=" + L.lat.toFixed(3) + "&longitude=" + L.lon.toFixed(3) +
      "&current=temperature_2m,weather_code,relative_humidity_2m&hourly=temperature_2m&forecast_hours=12&daily=precipitation_probability_max&forecast_days=1&timezone=auto&temperature_unit=" + unit);
    r.timeoutInterval = 5;
    const j = await withTimeout(r.loadJSON(), 6, null);
    if (!j || !j.current) throw new Error("no data");
    const w = { temp: j.current.temperature_2m, code: j.current.weather_code, hum: j.current.relative_humidity_2m,
      rain: (j.daily && j.daily.precipitation_probability_max) ? j.daily.precipitation_probability_max[0] : null,
      hourly: (j.hourly && j.hourly.temperature_2m) ? j.hourly.temperature_2m.slice(0, 12) : [], at: Date.now() };
    writeJSON("weather.json", w);
    return Object.assign({ offline: false }, w);
  } catch (e) {
    return cache ? Object.assign({ offline: true }, cache) : null;
  }
}

async function getNextEvent() {
  try {
    const evs = await withTimeout(CalendarEvent.today([]), 3, []);
    const now = Date.now();
    const next = (evs || []).filter(e => !e.isAllDay && e.endDate.getTime() > now).sort((a, b) => a.startDate - b.startDate)[0];
    if (!next) return null;
    return { time: pad2(next.startDate.getHours()) + ":" + pad2(next.startDate.getMinutes()), title: next.title || "" };
  } catch (e) { return null; }
}

const WMO = [
  [[0], "sun.max.fill", "CLEAR", "Trời quang", "clear"],
  [[1, 2], "cloud.sun.fill", "PARTLY", "Ít mây", "partly"],
  [[3], "cloud.fill", "CLOUDY", "Nhiều mây", "cloudy"],
  [[45, 48], "cloud.fog.fill", "FOG", "Sương mù", "fog"],
  [[51, 53, 55, 56, 57], "cloud.drizzle.fill", "DRIZZLE", "Mưa phùn", "drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "cloud.rain.fill", "RAIN", "Mưa", "rain"],
  [[71, 73, 75, 77, 85, 86], "cloud.snow.fill", "SNOW", "Tuyết", "snow"],
  [[95, 96, 99], "cloud.bolt.rain.fill", "STORM", "Dông", "storm"],
];
function wdesc(code) { for (const r of WMO) if (r[0].indexOf(code) >= 0) return { sf: r[1], cyber: r[2], fantasy: r[3], minimal: r[4] }; return { sf: "thermometer", cyber: "N/A", fantasy: "", minimal: "" }; }

// ---------------- nền widget ----------------
function cropFrom(img, x, y, w, h) {
  const c = new DrawContext(); c.size = new Size(w, h); c.opaque = true; c.respectScreenScale = false;
  c.drawImageAtPoint(img, new Point(-x, -y)); return c.getImage();
}

function chamfer(x, y, w, h, cut) {
  const pa = new Path();
  pa.move(new Point(x + cut, y)); pa.addLine(new Point(x + w, y)); pa.addLine(new Point(x + w, y + h - cut));
  pa.addLine(new Point(x + w - cut, y + h)); pa.addLine(new Point(x, y + h)); pa.addLine(new Point(x, y + cut)); pa.closeSubpath();
  return pa;
}
function glowStroke(c, pathFn, color, k, core) {
  [[9, 0.07], [6, 0.13], [3.5, 0.25]].forEach(([wd, a]) => { c.setStrokeColor(C(color, a)); c.setLineWidth(wd * k); c.addPath(pathFn()); c.strokePath(); });
  c.setStrokeColor(C(color, 1)); c.setLineWidth((core || 1.4) * k); c.addPath(pathFn()); c.strokePath();
}
function line(c, x1, y1, x2, y2) { const pa = new Path(); pa.move(new Point(x1, y1)); pa.addLine(new Point(x2, y2)); c.addPath(pa); c.strokePath(); }

// Lưới nút mở app (đơn vị point) — dùng chung cho vẽ khung và bố trí widget
function launchGrid(wPt, hPt) {
  const padX = 8, headH = 22, rowH = (hPt - headH - 6) / 2, cellW = (wPt - padX * 2) / 4;
  const cells = [];
  for (let i = 0; i < 8; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const x = padX + col * cellW, y = headH + row * rowH;
    cells.push({ x, y, w: cellW, h: rowH, cx: x + cellW / 2, cy: y + 15 + 11 });
  }
  return { padX, headH, rowH, cellW, cells };
}

// ---------------- hiệu ứng trang trí (đổi ngẫu nhiên mỗi lần làm mới) ----------------
function makeRng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function hashStr(t) { let h = 2166136261; for (const ch of t) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function dot(c, x, y, r, hex, a) { c.setFillColor(C(hex, a)); c.fillEllipse(new Rect(x - r, y - r, 2 * r, 2 * r)); }
function glowDot(c, x, y, r, hex, core) {
  [[4.5, 0.05], [3, 0.09], [2, 0.16], [1.3, 0.3]].forEach(([m, a]) => dot(c, x, y, r * m, hex, a));
  dot(c, x, y, r, core || "#ffffff", 0.95);
}
function sparkle(c, x, y, r, hex, a) { // ngôi sao 4 cánh
  const pa = new Path(), q = r * 0.22;
  pa.move(new Point(x, y - r)); pa.addLine(new Point(x + q, y - q)); pa.addLine(new Point(x + r, y)); pa.addLine(new Point(x + q, y + q));
  pa.addLine(new Point(x, y + r)); pa.addLine(new Point(x - q, y + q)); pa.addLine(new Point(x - r, y)); pa.addLine(new Point(x - q, y - q)); pa.closeSubpath();
  dot(c, x, y, r * 0.9, hex, 0.12 * (a || 1)); c.setFillColor(C(hex, a || 1)); c.addPath(pa); c.fillPath();
}
function gear(c, cx, cy, R, teeth, hex, k, rot) {
  const pa = new Path(), rIn = R * 0.78, n = teeth * 2;
  for (let i = 0; i <= n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2, outer = Math.floor(i / 2) % 2 === 0, r = outer ? R : rIn;
    const pt = new Point(cx + Math.cos(a) * r, cy + Math.sin(a) * r); i === 0 ? pa.move(pt) : pa.addLine(pt);
  }
  pa.closeSubpath();
  c.setFillColor(C("#05020c", 0.35)); c.addPath(pa); c.fillPath();
  glowStroke(c, () => pa, hex, k * 0.6, 1.2);
  c.setStrokeColor(C(hex, 0.8)); c.setLineWidth(1 * k);
  c.strokeEllipse(new Rect(cx - R * 0.42, cy - R * 0.42, R * 0.84, R * 0.84));
  for (let s = 0; s < 4; s++) { const a = rot + s * Math.PI / 2; line(c, cx + Math.cos(a) * R * 0.14, cy + Math.sin(a) * R * 0.14, cx + Math.cos(a) * R * 0.42, cy + Math.sin(a) * R * 0.42); }
  dot(c, cx, cy, R * 0.12, hex, 0.9);
}
function sparks(c, x, y, k, rnd, hot, cool) { // chùm tia lửa
  const n = 9 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, len = (10 + rnd() * 26) * k, x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len + len * 0.25;
    c.setStrokeColor(C(hot, 0.3)); c.setLineWidth(4 * k); line(c, x, y, x2, y2);
    c.setStrokeColor(C(i % 3 ? "#fff3c4" : hot, 1)); c.setLineWidth(1.3 * k); line(c, x + Math.cos(a) * len * 0.3, y + Math.sin(a) * len * 0.3, x2, y2);
    if (rnd() < 0.5) dot(c, x2 + Math.cos(a) * 3 * k, y2 + 2 * k, 0.9 * k, i % 2 ? "#ffe9a8" : cool, 0.9);
  }
  glowDot(c, x, y, 3.2 * k, hot, "#fffbe8");
  for (let i = 0; i < 6; i++) dot(c, x + (rnd() - 0.5) * 70 * k, y + (rnd() - 0.5) * 40 * k, (0.6 + rnd() * 0.9) * k, rnd() < 0.5 ? "#ffb15a" : "#fff1c2", 0.85);
}
function zap(c, x1, y1, x2, y2, k, rnd, hex) { // tia điện zíc zắc
  const pts = [], n = 7;
  for (let i = 0; i <= n; i++) { const t = i / n, j = (i === 0 || i === n) ? 0 : (rnd() - 0.5) * 9 * k; pts.push(new Point(x1 + (x2 - x1) * t + (y2 === y1 ? 0 : j), y1 + (y2 - y1) * t + (y2 === y1 ? j : 0))); }
  const mk = () => { const pa = new Path(); pa.move(pts[0]); pts.slice(1).forEach(p2 => pa.addLine(p2)); return pa; };
  glowStroke(c, mk, hex, k * 0.7, 1);
}
function curveTrail(c, pts, k, hex) { // vệt bay: nhiều chấm nhỏ dần
  const n = 26;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), u = 1 - t;
    const x = u * u * u * pts[0].x + 3 * u * u * t * pts[1].x + 3 * u * t * t * pts[2].x + t * t * t * pts[3].x;
    const y = u * u * u * pts[0].y + 3 * u * u * t * pts[1].y + 3 * u * t * t * pts[2].y + t * t * t * pts[3].y;
    dot(c, x, y, (0.5 + t * 1.6) * k, hex, 0.12 + t * 0.7);
  }
}
function petal(c, x, y, s, rot, hex) {
  const pt = (dx, dy) => new Point(x + dx * Math.cos(rot) - dy * Math.sin(rot), y + dx * Math.sin(rot) + dy * Math.cos(rot));
  const pa = new Path(); pa.move(pt(-s, 0));
  pa.addCurve(pt(s, 0), pt(-s * 0.4, -s * 0.9), pt(s * 0.5, -s * 0.7));
  pa.addCurve(pt(-s, 0), pt(s * 0.5, s * 0.7), pt(-s * 0.4, s * 0.9));
  pa.closeSubpath();
  c.setFillColor(C(hex, 0.85)); c.addPath(pa); c.fillPath();
  c.setStrokeColor(C("#ffffff", 0.6)); c.setLineWidth(s * 0.12); line(c, x, y, pt(s * 0.7, 0).x, pt(s * 0.7, 0).y);
}
function coin(c, x, y, r, tilt, k) {
  const w = r * 2 * Math.max(0.5, Math.abs(Math.cos(tilt))), h = r * 2;
  dot(c, x, y, r * 2.2, "#ffd36b", 0.08);
  c.setFillColor(C("#8a6116", 1)); c.fillEllipse(new Rect(x - w / 2 + 1.2 * k, y - h / 2, w, h));
  c.setFillColor(C("#f7cf5a", 1)); c.fillEllipse(new Rect(x - w / 2, y - h / 2, w, h));
  c.setStrokeColor(C("#fff1b8", 0.9)); c.setLineWidth(0.8 * k); c.strokeEllipse(new Rect(x - w * 0.32, y - h * 0.32, w * 0.64, h * 0.64));
  dot(c, x - w * 0.18, y - h * 0.22, Math.max(0.6 * k, w * 0.08), "#ffffff", 0.9);
}

// Vùng an toàn để trang trí: dọc viền và các góc, tránh chữ ở giữa
function edgePoint(W, H, k, rnd, inset) {
  const side = Math.floor(rnd() * 4), m = (inset || 3) * k;
  if (side === 0) return { x: 30 * k + rnd() * (W - 60 * k), y: m };
  if (side === 1) return { x: W - m, y: 26 * k + rnd() * (H - 52 * k) };
  if (side === 2) return { x: 30 * k + rnd() * (W - 60 * k), y: H - m };
  return { x: m, y: 26 * k + rnd() * (H - 52 * k) };
}

const FX = {
  gears(c, W, H, k, th, kind, rnd) {
    const col = th.colors, rot = rnd() * Math.PI;
    gear(c, W - 4 * k, H - 2 * k, 40 * k, 14, col.accent2, k, rot);
    gear(c, W - 54 * k, H + 6 * k, 22 * k, 10, col.accent, k, -rot * 1.3);
    gear(c, -2 * k, -2 * k, 30 * k, 12, col.accent, k, rot * 0.7);
    gear(c, 34 * k, -10 * k, 16 * k, 8, col.accent2, k, -rot);
    // mạch điện ở góc
    c.setStrokeColor(C(col.accent2, 0.55)); c.setLineWidth(0.9 * k);
    [[W * 0.62, H - 3 * k, W * 0.62, H - 14 * k, W * 0.74, H - 14 * k], [W * 0.3, 3 * k, W * 0.3, 11 * k, W * 0.42, 11 * k]].forEach(([a, b, d, e, f, g]) => {
      line(c, a, b, d, e); line(c, d, e, f, g); dot(c, f, g, 1.6 * k, col.accent2, 1);
    });
    // tia điện chạy dọc một cạnh
    const zy = rnd() < 0.5 ? 2 * k : H - 2 * k, zx = 40 * k + rnd() * (W * 0.4);
    zap(c, zx, zy, zx + (60 + rnd() * 50) * k, zy, k, rnd, col.accent2);
    // 2–3 chùm tia lửa trên viền
    const n = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) { const p0 = edgePoint(W, H, k, rnd, 2); sparks(c, p0.x, p0.y, k, rnd, i % 2 ? "#ff7a2b" : col.accent, col.accent2); }
  },
  fairies(c, W, H, k, th, kind, rnd) {
    const col = th.colors, n = 3;
    for (let i = 0; i < n; i++) {
      const fromLeft = rnd() < 0.5, x0 = fromLeft ? -10 * k : W + 10 * k, y0 = (20 + rnd() * (H / k - 40)) * k;
      const p3 = edgePoint(W, H, k, rnd, 6 + rnd() * 4);
      const p1 = new Point(x0 + (fromLeft ? 1 : -1) * 60 * k, y0 - 40 * k * rnd());
      const p2 = new Point(p3.x + (rnd() - 0.5) * 80 * k, p3.y + (rnd() - 0.5) * 50 * k);
      const hue = i % 2 ? "#fff4b0" : col.accent2;
      curveTrail(c, [new Point(x0, y0), p1, p2, new Point(p3.x, p3.y)], k, hue);
      glowDot(c, p3.x, p3.y, 3.4 * k, hue, "#fffef0");
      sparkle(c, p3.x, p3.y, 9 * k, "#ffffff", 0.9);
      sparkle(c, p3.x + 8 * k, p3.y - 9 * k, 3.5 * k, "#ffffff", 0.8);
    }
    for (let i = 0; i < 14; i++) { const p0 = edgePoint(W, H, k, rnd, 4 + rnd() * 14); rnd() < 0.4 ? sparkle(c, p0.x, p0.y, (2 + rnd() * 3) * k, "#fffbe0", 0.85) : dot(c, p0.x, p0.y, (0.6 + rnd()) * k, "#fff6c8", 0.7); }
  },
  petals(c, W, H, k, th, kind, rnd) {
    const blues = ["#5f8ff0", "#8fb4ff", "#3d6fd8", "#b9d0ff"];
    for (let i = 0; i < 11; i++) { const p0 = edgePoint(W, H, k, rnd, 2 + rnd() * 12); petal(c, p0.x, p0.y, (3.5 + rnd() * 4.5) * k, rnd() * Math.PI * 2, blues[i % 4]); }
    for (let i = 0; i < 8; i++) { const p0 = edgePoint(W, H, k, rnd, 6 + rnd() * 10); sparkle(c, p0.x, p0.y, (1.8 + rnd() * 2.5) * k, "#ffffff", 0.85); }
    // vệt gió
    c.setStrokeColor(C("#ffffff", 0.35)); c.setLineWidth(0.8 * k);
    for (let i = 0; i < 4; i++) { const y = (12 + rnd() * (H / k - 24)) * k, x = rnd() < 0.5 ? 4 * k : W - 70 * k; line(c, x, y, x + (30 + rnd() * 30) * k, y - 6 * k); }
  },
  gold(c, W, H, k, th, kind, rnd, data) {
    // đồng vàng rơi: pin càng đầy, vàng càng nhiều
    const nCoins = data && data.battery !== undefined ? 3 + Math.round(data.battery * 8) : 9;
    for (let i = 0; i < nCoins; i++) {
      const p0 = edgePoint(W, H, k, rnd, 3 + rnd() * 5), r = (4.5 + rnd() * 4) * k;
      for (let j = 1; j <= 3; j++) dot(c, p0.x, p0.y - r * (1.2 + j * 1.1), r * (0.5 - j * 0.12), "#ffd36b", 0.32 - j * 0.08);
      coin(c, p0.x, p0.y, r, rnd() * Math.PI, k);
    }
    for (let i = 0; i < 12; i++) { const p0 = edgePoint(W, H, k, rnd, 3 + rnd() * 7); sparkle(c, p0.x, p0.y, (1.8 + rnd() * 3.2) * k, i % 3 ? "#ffe9a0" : th.colors.accent2, 0.95); }
  },
};

const STYLE = {
  cyber: {
    frame(c, W, H, k, th, kind) {
      const col = th.colors, cut = 14 * k, i = 5 * k;
      const shape = () => {
        const pa = new Path(), x = i, y = i, w = W - 2 * i, h = H - 2 * i, tab = w * 0.6;
        pa.move(new Point(x, y + cut)); pa.addLine(new Point(x + cut, y)); pa.addLine(new Point(x + tab, y));
        pa.addLine(new Point(x + tab + 8 * k, y + 5 * k)); pa.addLine(new Point(x + w, y + 5 * k));
        pa.addLine(new Point(x + w, y + h - cut)); pa.addLine(new Point(x + w - cut, y + h)); pa.addLine(new Point(x, y + h)); pa.closeSubpath();
        return pa;
      };
      c.setFillColor(C(col.panel, col.panelAlpha)); c.addPath(shape()); c.fillPath();
      c.setFillColor(C("#000000", 0.10)); for (let y = 0; y < H; y += 3 * k) c.fillRect(new Rect(0, y, W, 1 * k));
      glowStroke(c, shape, col.accent, k);
      c.setStrokeColor(C(col.accent2, 1)); c.setLineWidth(2 * k); line(c, W * 0.6 + 12 * k, 2.5 * k, W * 0.6 + 70 * k, 2.5 * k);
      c.setLineWidth(1.6 * k); line(c, 6 * k, H - 6 * k, 6 * k, H - 22 * k); line(c, 6 * k, H - 6 * k, 22 * k, H - 6 * k);
      if (kind === "hud") { c.setStrokeColor(C(col.sub, 0.25)); c.setLineWidth(1 * k); line(c, W * 0.52, 28 * k, W * 0.52, H - 16 * k); }
      if (kind === "launch") {
        const g = launchGrid(W / k, H / k);
        g.cells.forEach((cell, n) => {
          const s = 40 * k, x = cell.cx * k - s / 2, y = cell.cy * k - s / 2, clr = n % 2 ? col.accent2 : col.accent;
          c.setFillColor(C("#05020c", 0.55)); c.addPath(chamfer(x, y, s, s, 9 * k)); c.fillPath();
          glowStroke(c, () => chamfer(x, y, s, s, 9 * k), clr, k * 0.7, 1.6);
        });
      }
    },
  },
  fantasy: {
    frame(c, W, H, k, th, kind) {
      const col = th.colors, i = 5 * k, r = 18 * k;
      const rr = (inset, rad) => { const pa = new Path(); pa.addRoundedRect(new Rect(inset, inset, W - 2 * inset, H - 2 * inset), rad, rad); return pa; };
      c.setFillColor(C(col.panel, col.panelAlpha)); c.addPath(rr(i, r)); c.fillPath();
      c.setStrokeColor(C(col.accent, 0.25)); c.setLineWidth(4 * k); c.addPath(rr(i, r)); c.strokePath();
      c.setStrokeColor(C(col.accent, 0.95)); c.setLineWidth(1.2 * k); c.addPath(rr(i, r)); c.strokePath();
      c.setStrokeColor(C(col.accent, 0.45)); c.setLineWidth(0.6 * k); c.addPath(rr(i + 5 * k, r - 4 * k)); c.strokePath();
      const diamond = (cx, cy, s) => { const pa = new Path(); pa.move(new Point(cx, cy - s)); pa.addLine(new Point(cx + s, cy)); pa.addLine(new Point(cx, cy + s)); pa.addLine(new Point(cx - s, cy)); pa.closeSubpath(); c.setFillColor(C(col.accent, 1)); c.addPath(pa); c.fillPath(); };
      diamond(W / 2, i, 5 * k); diamond(W / 2, H - i, 4 * k);
      c.setStrokeColor(C(col.accent, 0.9)); c.setLineWidth(1 * k); line(c, W / 2 - 60 * k, i, W / 2 - 9 * k, i); line(c, W / 2 + 9 * k, i, W / 2 + 60 * k, i);
      if (kind === "hud") {
        const cx = 64 * k, cy = H / 2 + 4 * k;
        c.setStrokeColor(C(col.accent, 0.35)); c.setLineWidth(1 * k);
        [58, 50].forEach(rd => c.strokeEllipse(new Rect(cx - rd * k, cy - rd * k, 2 * rd * k, 2 * rd * k)));
        for (let a = 0; a < 360; a += 15) { const t = a * Math.PI / 180; line(c, cx + Math.cos(t) * 50 * k, cy + Math.sin(t) * 50 * k, cx + Math.cos(t) * (a % 45 ? 54 : 58) * k, cy + Math.sin(t) * (a % 45 ? 54 : 58) * k); }
        c.setStrokeColor(C(col.accent, 0.4)); line(c, W * 0.5, 30 * k, W * 0.5, H - 30 * k);
      }
      if (kind === "launch") {
        launchGrid(W / k, H / k).cells.forEach(cell => {
          const rd = 21 * k, x = cell.cx * k, y = cell.cy * k;
          c.setFillColor(C(col.panel, 0.45)); c.fillEllipse(new Rect(x - rd, y - rd, 2 * rd, 2 * rd));
          c.setStrokeColor(C(col.accent, 0.3)); c.setLineWidth(3.5 * k); c.strokeEllipse(new Rect(x - rd, y - rd, 2 * rd, 2 * rd));
          c.setStrokeColor(C(col.accent, 0.95)); c.setLineWidth(1 * k); c.strokeEllipse(new Rect(x - rd, y - rd, 2 * rd, 2 * rd));
          diamond(x, y - rd, 2.5 * k);
        });
      }
    },
  },
  minimal: {
    frame(c, W, H, k, th, kind) {
      const col = th.colors, m = 6 * k, L = 16 * k;
      if (col.panelAlpha > 0) { c.setFillColor(C(col.panel, col.panelAlpha)); c.fillRect(new Rect(0, 0, W, H)); }
      c.setStrokeColor(C(col.accent, 0.85)); c.setLineWidth(1.2 * k);
      [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => { line(c, x, y, x + sx * L, y); line(c, x, y, x, y + sy * L); });
      if (kind === "hud") { c.setStrokeColor(C(col.accent2, 0.3)); c.setLineWidth(0.8 * k); line(c, W * 0.52, 26 * k, W * 0.52, H - 26 * k); }
      if (kind === "launch") {
        launchGrid(W / k, H / k).cells.forEach(cell => {
          const s = 38 * k, x = cell.cx * k - s / 2, y = cell.cy * k - s / 2;
          const pa = new Path(); pa.addRoundedRect(new Rect(x, y, s, s), 11 * k, 11 * k);
          c.setStrokeColor(C(col.accent2, 0.55)); c.setLineWidth(1 * k); c.addPath(pa); c.strokePath();
        });
      }
    },
  },
};

// ---------------- ngữ cảnh: giờ, thời tiết, pin, lịch ----------------
function context(d) {
  const h = d.now.getHours();
  const period = h >= 5 && h < 11 ? "morning" : h < 14 && h >= 11 ? "noon" : h >= 14 && h < 18 ? "afternoon" : h >= 18 && h < 22 ? "evening" : "night";
  const code = d.weather ? d.weather.code : -1;
  const rainy = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].indexOf(code) >= 0;
  const bat = Math.round((d.battery || 0) * 100);
  let soon = null;
  if (d.ev) { const [hh, mm] = d.ev.time.split(":").map(Number); const t = new Date(d.now); t.setHours(hh, mm, 0, 0); const diff = (t - d.now) / 60000; if (diff >= -5 && diff <= 60) soon = d.ev; }
  return { period, rainy, night: period === "night" || period === "evening", lowBat: bat <= 20 && !d.charging, charging: !!d.charging, bat, soon };
}
function voiceLine(th, cx, rnd) {
  const V = th.voice || {}; let key = cx.period;
  if (cx.lowBat) key = "lowbat"; else if (cx.soon) key = "event"; else if (cx.charging && rnd() < 0.5) key = "charging"; else if (cx.rainy && rnd() < 0.7) key = "rain";
  const pool = V[key] && V[key].length ? V[key] : (V[cx.period] || [""]);
  const line0 = pool[Math.floor(rnd() * pool.length)] || "";
  return line0.replace("{b}", cx.bat).replace("{t}", cx.soon ? cx.soon.time : "").replace("{e}", cx.soon ? cx.soon.title : "");
}
// lớp phủ phản ứng theo ngữ cảnh
function react(c, W, H, k, th, cx, rnd) {
  const col = th.colors;
  if (cx.night) { c.setFillColor(C("#000010", cx.period === "night" ? 0.22 : 0.1)); c.fillRect(new Rect(0, 0, W, H)); }
  if (cx.period === "morning") { [[200, 0.05], [120, 0.07], [60, 0.08]].forEach(([r, a]) => dot(c, 0, 0, r * k, "#ffcf8a", a)); }
  if (cx.night && th.style === "fantasy") {
    for (let i = 0; i < 18; i++) { const p0 = edgePoint(W, H, k, rnd, 4 + rnd() * 20); dot(c, p0.x, p0.y, (0.5 + rnd() * 0.8) * k, "#ffffff", 0.5 + rnd() * 0.5); }
    drawMoon(c, W - 22 * k, 20 * k, 8 * k, moonPhase(new Date()), C("#fff6d6", 0.95), C("#000000", 0.25));
  }
  if (cx.night && th.style === "cyber") { // đèn neon chập chờn: vài đoạn viền tối đi
    for (let i = 0; i < 3; i++) { const x = 30 * k + rnd() * (W - 80 * k); c.setFillColor(C("#000000", 0.75)); c.fillRect(new Rect(x, 0, (14 + rnd() * 30) * k, 4 * k)); }
  }
  if (cx.rainy) {
    c.setStrokeColor(C(th.style === "cyber" ? col.accent2 : "#dfe9ff", 0.22)); c.setLineWidth(0.8 * k);
    for (let i = 0; i < 46; i++) { const x = rnd() * W, y = rnd() * H, l = (8 + rnd() * 14) * k; line(c, x, y, x - l * 0.25, y + l); }
  }
  if (cx.lowBat) {
    [[8, 0.08], [4, 0.16], [1.5, 0.6]].forEach(([wd, a]) => { c.setStrokeColor(C("#ff2a2a", a)); c.setLineWidth(wd * k); const pa = new Path(); pa.addRect(new Rect(2 * k, 2 * k, W - 4 * k, H - 4 * k)); c.addPath(pa); c.strokePath(); });
  }
}

function buildBackground(themeId, th, kind, row, data) {
  const scale = Device.screenScale();
  const path = bgPath(themeId, "medium", row);
  let slice = null;
  if (fm.fileExists(path)) slice = fm.readImage(path);
  const W = slice ? slice.size.width : 1017, H = slice ? slice.size.height : 474;
  const k = W / (1017 / scale); // pixel trên mỗi point
  const c = new DrawContext(); c.size = new Size(W, H); c.opaque = true; c.respectScreenScale = false;
  if (slice) c.drawImageInRect(slice, new Rect(0, 0, W, H));
  else { c.setFillColor(C(th.colors.panel, 1)); c.fillRect(new Rect(0, 0, W, H)); }
  STYLE[th.style].frame(c, W, H, k, th, kind);
  if (th.fx && FX[th.fx]) {
    const seed = daySeed(themeId + kind);
    try { FX[th.fx](c, W, H, k, th, kind, makeRng(seed), data || {}); } catch (e) { console.log("fx: " + e); }
  }
  if (data && data.now) { try { react(c, W, H, k, th, context(data), makeRng(daySeed(themeId))); } catch (e) { console.log("react: " + e); } }
  if (kind === "hud" && data) { try { HUD[th.style](c, W, H, k, th, data); } catch (e) { console.log("hud: " + e); } }
  return { img: c.getImage(), missing: !slice, wPt: W / k, hPt: H / k };
}

// ---------------- vẽ HUD vào nền (vòng đo, biểu đồ, lịch tuần, trăng) ----------------
function arcPath(cx, cy, r, a0, a1) {
  const pa = new Path(), step = Math.PI / 90, n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step));
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, pt = new Point(cx + Math.cos(a) * r, cy + Math.sin(a) * r); i ? pa.addLine(pt) : pa.move(pt); }
  return pa;
}
function dtext(c, s, x, y, w, h, font, color, align) {
  c.setFont(font); c.setTextColor(color);
  if (align === "c") c.setTextAlignedCenter(); else if (align === "r") c.setTextAlignedRight(); else c.setTextAlignedLeft();
  c.drawTextInRect(s, new Rect(x, y, w, h));
}
function scaledFont(f, k) { return f(k); }
function ring(c, cx, cy, r, frac, fg, bg, wd, k, opt) {
  opt = opt || {};
  c.setStrokeColor(bg); c.setLineWidth(wd); c.addPath(arcPath(cx, cy, r, 0, Math.PI * 2)); c.strokePath();
  const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * Math.max(0.001, Math.min(1, frac));
  if (opt.glow) [[3, 0.12], [2, 0.22]].forEach(([m, a]) => { c.setStrokeColor(C(opt.glow, a)); c.setLineWidth(wd * m); c.addPath(arcPath(cx, cy, r, a0, a1)); c.strokePath(); });
  c.setStrokeColor(fg); c.setLineWidth(wd); c.addPath(arcPath(cx, cy, r, a0, a1)); c.strokePath();
  if (opt.ticks) { c.setStrokeColor(C(opt.ticks, 0.45)); c.setLineWidth(0.8 * k);
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, r1 = r + wd * 0.9, r2 = r1 + (i % 6 ? 2 : 4) * k; line(c, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); } }
  if (opt.endGem) { const x = cx + Math.cos(a1) * r, y = cy + Math.sin(a1) * r, s = wd * 1.4;
    const pa = new Path(); pa.move(new Point(x, y - s)); pa.addLine(new Point(x + s, y)); pa.addLine(new Point(x, y + s)); pa.addLine(new Point(x - s, y)); pa.closeSubpath(); c.setFillColor(C(opt.endGem, 1)); c.addPath(pa); c.fillPath(); }
}
function dayFrac(d) { return (d.getHours() * 60 + d.getMinutes()) / 1440; }
function moonPhase(d) { const jd = d.getTime() / 86400000 + 2440587.5; let p = ((jd - 2451550.1) / 29.530588853) % 1; return p < 0 ? p + 1 : p; }
function drawMoon(c, cx, cy, r, phase, lit, dark) {
  c.setFillColor(dark); c.fillEllipse(new Rect(cx - r, cy - r, 2 * r, 2 * r));
  const illum = (1 - Math.cos(phase * 2 * Math.PI)) / 2; // 0 = trăng non, 1 = trăng tròn
  const pa = new Path(), n = 48, waxing = phase < 0.5;
  for (let i = 0; i <= n; i++) { const t = -Math.PI / 2 + Math.PI * i / n, x = Math.cos(t) * r * (waxing ? 1 : -1), y = Math.sin(t) * r; i ? pa.addLine(new Point(cx + x, cy + y)) : pa.move(new Point(cx + x, cy + y)); }
  const term = (1 - 2 * illum) * (waxing ? 1 : -1);
  for (let i = n; i >= 0; i--) { const t = -Math.PI / 2 + Math.PI * i / n, x = Math.cos(t) * r * term, y = Math.sin(t) * r; pa.addLine(new Point(cx + x, cy + y)); }
  pa.closeSubpath(); c.setFillColor(lit); c.addPath(pa); c.fillPath();
}
function chartPts(vals, x, y, w, h) {
  const mn = Math.min(...vals), mx = Math.max(...vals), span = Math.max(1, mx - mn);
  return vals.map((v, i) => new Point(x + w * i / (vals.length - 1), y + h - (v - mn) / span * h));
}

const HUD_FONT = {
  cyber: { num: k => Font.boldMonospacedSystemFont(8.5 * k), lab: k => Font.boldMonospacedSystemFont(6.5 * k), big: k => Font.lightSystemFont(25 * k), tiny: k => Font.mediumMonospacedSystemFont(6.5 * k), glitch: k => Font.boldMonospacedSystemFont(9 * k) },
  fantasy: { num: k => SERIF("Didot", 10 * k), lab: k => SERIF("Baskerville-Italic", 8.5 * k), big: k => SERIF("Didot", 26 * k), tiny: k => SERIF("Baskerville", 7.5 * k) },
  minimal: { num: k => Font.mediumMonospacedSystemFont(8.5 * k), lab: k => Font.regularMonospacedSystemFont(6.5 * k), big: k => Font.thinSystemFont(25 * k), tiny: k => Font.regularMonospacedSystemFont(6.5 * k) },
};

// vùng phải của HUD (point): x từ RX đến W-14
function hudRight(c, W, H, k, th, d, look) {
  const F = HUD_FONT[th.style], col = th.colors, RX = (W / k) * 0.5 + 6, RW = W / k - 16 - RX;
  // pin: một vòng duy nhất, số % ở giữa
  const r = 19 * k, cx = (RX + 22) * k, cy = 42 * k, lvl = Math.round(d.battery * 100);
  ring(c, cx, cy, r, d.battery, look.ringFg(0), look.ringBg, look.ringW * 1.2 * k, k, look.ringOpt(0));
  dtext(c, lvl + "%", cx - r, cy - 6 * k, 2 * r, 12 * k, F.num(k), C(col.text), "c");
  dtext(c, look.batLabel + (d.charging ? look.chg : ""), cx - 30 * k, cy + r + 4 * k, 60 * k, 10 * k, F.lab(k), C(col.sub, 0.95), "c");
  // thời tiết hiện tại
  const w = d.weather, tx = (RX + 52) * k;
  if (w) {
    dtext(c, Math.round(w.temp) + "°", tx, 18 * k, 80 * k, 32 * k, F.big(k), C(col.text), "l");
    dtext(c, look.cond(w), tx, 52 * k, RW * k - 52 * k, 10 * k, F.tiny(k), C(look.condColor), "l");
    const vals = (w.hourly && w.hourly.length > 2) ? w.hourly : null;
    if (vals) {
      const hi = Math.round(Math.max(...vals)), lo = Math.round(Math.min(...vals));
      dtext(c, look.hiLo(hi, lo), tx, 64 * k, RW * k - 52 * k, 10 * k, F.tiny(k), C(col.sub, 0.9), "l");
    }
  } else dtext(c, look.noWeather, tx, 30 * k, 140 * k, 12 * k, F.tiny(k), C(col.sub), "l");
  if (w && w.offline) dtext(c, "cập nhật " + hhmm(w.at), W - 92 * k, H - 25 * k, 78 * k, 9 * k, F.tiny(k), C("#ff9a9a"), "r");
  dtext(c, "v" + T.version, W - 52 * k, H - 16 * k, 38 * k, 9 * k, F.tiny(k), C(col.sub, 0.55), "r");
}

const HUD = {
  cyber(c, W, H, k, th, d) {
    const col = th.colors, F = HUD_FONT.cyber;
    // lưới lục giác mờ
    c.setStrokeColor(C(col.accent2, 0.07)); c.setLineWidth(0.7 * k);
    const hs = 9 * k;
    for (let y = 8 * k, row = 0; y < H; y += hs * 1.5, row++) for (let x = (row % 2 ? hs * 0.87 : 0); x < W; x += hs * 1.74) {
      const pa = new Path(); for (let i = 0; i <= 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3, pt = new Point(x + Math.cos(a) * hs, y + Math.sin(a) * hs); i ? pa.addLine(pt) : pa.move(pt); } c.addPath(pa); c.strokePath();
    }
    // dải quét sáng
    const sy = (20 + (makeRng(daySeed("scan"))()) * (H / k - 40)) * k;
    [[10, 0.03], [5, 0.05], [1.5, 0.12]].forEach(([h, a]) => { c.setFillColor(C(col.accent2, a)); c.fillRect(new Rect(3 * k, sy - h * k / 2, W - 6 * k, h * k)); });
    // nhãn glitch
    const lab = "◢ " + th.labels.hud;
    dtext(c, lab, 15 * k, 9 * k, 160 * k, 14 * k, F.glitch(k), C(col.accent2, 0.85), "l");
    dtext(c, lab, 17.5 * k, 10 * k, 160 * k, 14 * k, F.glitch(k), C(col.accent, 0.9), "l");
    dtext(c, lab, 16 * k, 9.5 * k, 160 * k, 14 * k, F.glitch(k), C("#ffffff"), "l");
    // mã vạch
    const rnd = makeRng(hashStr(th.name)); let bx = 16 * k;
    while (bx < 70 * k) { const bw = (0.6 + rnd() * 2) * k; c.setFillColor(C(col.sub, 0.55)); c.fillRect(new Rect(bx, H - 15 * k, bw, 7 * k)); bx += bw + (0.8 + rnd() * 1.6) * k; }
    hudRight(c, W, H, k, th, d, {
      batLabel: "BATTERY", chg: " ⚡", hiLo: (h, l) => "HI " + h + "° · LO " + l + "°", chartLabel: "TEMP · NEXT 12H",
      ringFg: i => C(i === 1 ? col.accent2 : col.accent), ringBg: C("#ffffff", 0.08), ringW: 3.2,
      ringOpt: i => ({ glow: i === 1 ? col.accent2 : col.accent, ticks: col.accent2 }),
      cond: w => wdesc(w.code).cyber, condColor: col.accent,
      noWeather: "ATMOS: NO SIGNAL",
      chart(c, pts, x, y, w, h, k) {
        const bw = w / pts.length * 0.55;
        pts.forEach((p0, i) => { const hh = y + h - p0.y + 3 * k; [[1, 0.18], [0.6, 0.35]].forEach(([f, a]) => { c.setFillColor(C(i % 2 ? col.accent : col.accent2, a)); c.fillRect(new Rect(p0.x - bw / 2, y + h + 3 * k - hh * f, bw, hh * f)); }); });
        const mk = () => { const pa = new Path(); pts.forEach((p0, i) => i ? pa.addLine(p0) : pa.move(p0)); return pa; };
        glowStroke(c, mk, col.accent2, k * 0.6, 1.3);
        dot(c, pts[0].x, pts[0].y, 2.2 * k, "#ffffff", 1);
      },
    });
  },
  fantasy(c, W, H, k, th, d) {
    const col = th.colors, F = HUD_FONT.fantasy;
    // dải lịch tuần
    const VI = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"], today = d.now.getDay(), mon = new Date(d.now); mon.setDate(d.now.getDate() - ((today + 6) % 7));
    const sx = 24 * k, sw = (W / k * 0.5 - 30) * k / 7, sy = H - 30 * k;
    for (let i = 0; i < 7; i++) {
      const dd = new Date(mon); dd.setDate(mon.getDate() + i); const x = sx + i * sw, isT = dd.toDateString() === d.now.toDateString();
      if (isT) { dot(c, x + sw / 2, sy + 8 * k, 10 * k, col.accent, 0.18); c.setStrokeColor(C(col.accent, 0.95)); c.setLineWidth(1 * k); c.strokeEllipse(new Rect(x + sw / 2 - 9 * k, sy - 1 * k, 18 * k, 18 * k)); }
      dtext(c, VI[dd.getDay()], x, sy - 9 * k, sw, 9 * k, F.tiny(k), C(col.sub, 0.85), "c");
      dtext(c, String(dd.getDate()), x, sy + 2 * k, sw, 12 * k, F.num(k), C(isT ? "#ffffff" : col.text, isT ? 1 : 0.85), "c");
    }
    hudRight(c, W, H, k, th, d, {
      batLabel: "Pin", chg: " · sạc", hiLo: (h, l) => "Cao " + h + "° · Thấp " + l + "°", chartLabel: "Nhiệt độ 12 giờ tới",
      ringFg: () => C(col.accent, 0.95), ringBg: C("#ffffff", 0.18), ringW: 1.6,
      ringOpt: () => ({ endGem: col.accent }),
      cond: w => wdesc(w.code).fantasy, condColor: col.sub, noWeather: "Không có tin thời tiết",
      chart(c, pts, x, y, w, h, k) {
        pts.forEach((p0, i) => { if (i) { const a = pts[i - 1]; for (let t = 0; t < 1; t += 0.2) dot(c, a.x + (p0.x - a.x) * t, a.y + (p0.y - a.y) * t, 0.9 * k, col.accent, 0.9); } });
        pts.forEach((p0, i) => { c.setStrokeColor(C(col.accent, 0.18)); c.setLineWidth(1 * k); line(c, p0.x, p0.y + 3 * k, p0.x, y + h + 2 * k); if (i % 3 === 0) sparkle(c, p0.x, p0.y, 3 * k, "#ffffff", 0.95); });
      },
    });
  },
  minimal(c, W, H, k, th, d) {
    const col = th.colors;
    hudRight(c, W, H, k, th, d, {
      batLabel: "battery", chg: " +", hiLo: (h, l) => "hi " + h + "° lo " + l + "°", chartLabel: "temp · next 12h",
      ringFg: i => C(i === 0 ? col.accent : col.accent2, 0.95), ringBg: C("#ffffff", 0.1), ringW: 1.4,
      ringOpt: () => ({}),
      cond: w => wdesc(w.code).minimal, condColor: col.sub, noWeather: "no signal",
      chart(c, pts, x, y, w, h, k) { pts.forEach((p0, i) => { dot(c, p0.x, p0.y, (i ? 1.1 : 1.8) * k, i ? col.accent2 : col.accent, i ? 0.85 : 1); }); },
    });
  },
};

// ---------------- chữ theo style ----------------
function fonts(style) {
  if (style === "cyber") return {
    label: Font.boldMonospacedSystemFont(9), time: Font.ultraLightSystemFont(48), date: Font.mediumMonospacedSystemFont(11),
    small: Font.regularMonospacedSystemFont(9), big: Font.lightSystemFont(28), body: Font.mediumMonospacedSystemFont(10), icon: Font.boldMonospacedSystemFont(8),
  };
  if (style === "fantasy") return {
    label: SERIF("Didot-Italic", 13), time: SERIF("Didot", 42), date: SERIF("Baskerville-Italic", 12),
    small: SERIF("Baskerville", 10), big: SERIF("Didot", 28), body: SERIF("Baskerville", 12), icon: SERIF("Baskerville-SemiBold", 9),
  };
  return {
    label: Font.mediumMonospacedSystemFont(9), time: Font.thinSystemFont(48), date: Font.regularMonospacedSystemFont(10),
    small: Font.regularMonospacedSystemFont(9), big: Font.thinSystemFont(28), body: Font.regularMonospacedSystemFont(10), icon: Font.mediumMonospacedSystemFont(8),
  };
}
function txt(stack, s, font, color, glow) {
  const t = stack.addText(s); t.font = font; t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  if (glow) { t.shadowColor = glow; t.shadowRadius = 6; t.shadowOffset = new Point(0, 0); }
  return t;
}

const VI_DAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const EN_DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// ---------------- widget HUD ----------------
async function hudWidget(themeId, th, row) {
  const st = th.style, col = th.colors, F = fonts(st);
  const [weather, ev] = await Promise.all([getWeather(), getNextEvent()]);
  const now = new Date();
  const data = { weather, ev, now, battery: Device.batteryLevel(), charging: Device.isCharging() };
  const bg = buildBackground(themeId, th, "hud", row, data);
  const glowA = st === "fantasy" ? C("#000000", 0.55) : C(col.accent, 0.9);
  const glowB = st === "fantasy" ? C("#000000", 0.55) : C(col.accent2, 0.9);
  const text = C(col.text), sub = C(col.sub), acc = C(col.accent), acc2 = C(col.accent2);

  const w = new ListWidget(); w.backgroundImage = bg.img; w.setPadding(0, 0, 0, 0);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60000);
  const root = w.addStack(); root.size = new Size(bg.wPt, bg.hPt); root.layoutHorizontally();
  const L = root.addStack(); L.layoutVertically(); L.size = new Size(bg.wPt * 0.5, bg.hPt);
  L.setPadding(st === "fantasy" ? 20 : 14, st === "fantasy" ? 24 : 16, st === "fantasy" ? 40 : 22, 4);
  if (st === "cyber") L.addSpacer(14); else txt(L, th.labels.hud, F.label, acc, glowA);
  L.addSpacer(st === "fantasy" ? 0 : 2);
  const d = L.addDate(now); d.applyTimeStyle(); d.font = F.time; d.textColor = text; d.lineLimit = 1; d.minimumScaleFactor = 0.5;
  d.shadowColor = glowA; d.shadowRadius = st === "fantasy" ? 4 : 10; d.shadowOffset = new Point(0, 0);
  const dateStr = st === "fantasy" ? VI_DAYS[now.getDay()] + ", " + now.getDate() + " tháng " + (now.getMonth() + 1)
    : EN_DAYS[now.getDay()] + " · " + pad2(now.getDate()) + "." + pad2(now.getMonth() + 1) + "." + now.getFullYear();
  txt(L, dateStr, F.date, st === "cyber" ? acc2 : sub, glowB);
  L.addSpacer();
  if (st !== "fantasy") {
    const evs = ev ? (st === "cyber" ? "> " : "") + ev.time + " " + ev.title : (st === "cyber" ? "> NO EVENTS_" : "free day");
    txt(L, evs, F.small, ev ? text : sub, null);
  }
  if (bg.missing) txt(L, "Chưa cài nền → mở Theme", F.small, C("#ff5a5a"));
  root.addSpacer();
  return w;
}

// ---------------- widget nút mở app ----------------
async function launchWidget(themeId, th, row) {
  const st = th.style, col = th.colors, F = fonts(st);
  const [weather, ev] = await Promise.all([getWeather(), getNextEvent()]);
  const data = { weather, ev, now: new Date(), battery: Device.batteryLevel(), charging: Device.isCharging() };
  const bg = buildBackground(themeId, th, "launch", row, data);
  const say = voiceLine(th, context(data), makeRng(daySeed(themeId + "voice" + context(data).period)));
  const g = launchGrid(bg.wPt, bg.hPt);
  const w = new ListWidget(); w.backgroundImage = bg.img; w.setPadding(0, 0, 0, 0);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60000);
  const root = w.addStack(); root.layoutVertically(); root.size = new Size(bg.wPt, bg.hPt);
  const head = root.addStack(); head.size = new Size(bg.wPt, g.headH); head.setPadding(6, 18, 0, 18); head.centerAlignContent();
  const sayTxt = st === "cyber" ? "◢ " + say : st === "minimal" ? "> " + say : "“" + say + "”";
  const sf = st === "fantasy" ? SERIF("Didot-Italic", 12) : st === "cyber" ? Font.boldMonospacedSystemFont(9.5) : Font.mediumMonospacedSystemFont(9.5);
  txt(head, say ? sayTxt : th.labels.launch, sf, C(st === "cyber" ? col.text : col.accent), st === "fantasy" ? C("#000", 0.6) : C(col.accent, 0.9));
  head.addSpacer();
  txt(head, bg.missing ? "chưa cài nền" : "", F.small, C("#ff5a5a"));
  const ov = settings().appOverride || {};
  const apps = (T.apps || []).slice(0, 8).map(a => Object.assign({}, a, ov[a.label] ? { url: ov[a.label] } : {}));
  for (let r = 0; r < 2; r++) {
    const rs = root.addStack(); rs.size = new Size(bg.wPt, g.rowH); rs.setPadding(0, g.padX, 0, g.padX);
    for (let c = 0; c < 4; c++) {
      const a = apps[r * 4 + c]; const cell = rs.addStack(); cell.size = new Size(g.cellW, g.rowH); cell.layoutVertically(); cell.centerAlignContent();
      if (!a) continue;
      if (a.url) cell.url = a.url;
      cell.addSpacer(15);
      const sym = SFSymbol.named(a.sf || "app.fill");
      const ir = cell.addStack(); ir.size = new Size(g.cellW, 22); ir.addSpacer();
      const im = ir.addImage((sym || SFSymbol.named("app.fill")).image); im.imageSize = new Size(22, 22); ir.addSpacer();
      im.tintColor = st === "cyber" ? C((r * 4 + c) % 2 ? col.accent2 : col.accent) : st === "fantasy" ? C(col.text) : C(col.accent);
      cell.addSpacer(st === "fantasy" ? 12 : 10);
      const lr = cell.addStack(); lr.size = new Size(g.cellW, 12); lr.addSpacer();
      const lb = lr.addText(st === "fantasy" ? a.label.charAt(0) + a.label.slice(1).toLowerCase() : a.label); lr.addSpacer();
      lb.font = F.icon; lb.textColor = C(col.text); lb.lineLimit = 1; lb.minimumScaleFactor = 0.7; lb.centerAlignText();
      if (st !== "minimal") { lb.shadowColor = C("#000000", 0.8); lb.shadowRadius = 3; lb.shadowOffset = new Point(0, 0); }
      cell.addSpacer();
    }
  }
  root.addSpacer();
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget(); w.backgroundColor = C("#14051f");
  const t = w.addText("ThemeKit lỗi"); t.font = Font.boldSystemFont(13); t.textColor = C("#ff5ad6");
  const m = w.addText(String(msg).slice(0, 160)); m.font = Font.systemFont(10); m.textColor = C("#e6dcff");
  const v = w.addText("engine " + ENGINE_VERSION + " · themes " + (T && T.version)); v.font = Font.systemFont(8); v.textColor = C("#8a7aa8");
  return w;
}

function parseParam(s) {
  const parts = String(s || "").trim().toLowerCase().split(/[:\s,]+/).filter(Boolean);
  const themeId = parts[0] || Object.keys(T.themes)[0];
  const th = T.themes[themeId];
  if (!th) throw new Error("Không có theme '" + themeId + "'. Có: " + Object.keys(T.themes).join(", "));
  const kind = parts[1] === "launch" || parts[1] === "app" || parts[1] === "apps" ? "launch" : "hud";
  const row = parts[2] ? ROW_NAMES[parts[2]] : th.rows[kind];
  if (!row) throw new Error("Vị trí '" + parts[2] + "' không hợp lệ. Dùng top, middle hoặc bottom.");
  return { themeId, th, kind, row };
}

async function makeWidget(param) {
  const q = parseParam(param);
  return q.kind === "launch" ? await launchWidget(q.themeId, q.th, q.row) : await hudWidget(q.themeId, q.th, q.row);
}

// ---------------- cài đặt trong app ----------------
async function pick(title, msg, options) {
  const a = new Alert(); a.title = title; if (msg) a.message = msg;
  options.forEach(o => a.addAction(o)); a.addCancelAction("Huỷ");
  return await a.presentSheet();
}
async function info(title, msg) { const a = new Alert(); a.title = title; a.message = msg; a.addAction("OK"); await a.present(); }
async function confirm(title, msg, yes) { const a = new Alert(); a.title = title; a.message = msg; a.addAction(yes || "Tiếp tục"); a.addCancelAction("Huỷ"); return (await a.present()) === 0; }
function shotPath(id) { return p(DIR, "shots", id + ".jpg"); }
// Ghi ảnh: thử writeImage, nếu lỗi thì ghi bằng Data PNG/JPEG; trả về true/false thay vì làm dừng cả quy trình
function saveImage(path, img, jpeg) {
  try { if (fm.fileExists(path)) fm.remove(path); } catch (e) {}
  try { fm.writeImage(path, img); return true; } catch (e1) {
    try { fm.write(path, jpeg ? Data.fromJPEG(img) : Data.fromPNG(img)); return true; } catch (e2) { console.log("save " + path + ": " + e1 + " / " + e2); return false; }
  }
}

// Cắt 3 hàng widget Vừa từ ẢNH CHỤP MÀN HÌNH trang trống (chế độ rung icon).
function cropRows(id, img, P) {
  const o = settings().offset || { dx: 0, dy: 0 };
  ensureDir(p(DIR, "bg", id));
  let ok = 0;
  for (let r = 1; r <= 3; r++) {
    if (saveImage(bgPath(id, "medium", r), cropFrom(img, P.left + o.dx, P.rows[r - 1] + o.dy, P.medium, P.small), false)) ok++;
  }
  return ok;
}

async function installBackground() {
  const P = devicePos();
  if (!P) { await info("Máy chưa được hỗ trợ", "Màn hình " + deviceKey() + " không có trong bảng vị trí. Gửi con số này cho người làm theme để bổ sung. Chưa cắt gì cả."); return; }
  const ids = Object.keys(T.themes);
  const i = await pick("Cài nền cho theme", "Máy: " + P.model + " (" + deviceKey() + ")", ids.map(id => T.themes[id].name));
  if (i < 0) return;
  const id = ids[i];
  const ok = await confirm("Chuẩn bị ảnh chụp màn hình",
    "1. Đặt hình nền " + T.themes[id].name + " cho màn hình chính.\n" +
    "2. Vuốt tới một TRANG TRỐNG, nhấn giữ chỗ trống cho icon rung lên.\n" +
    "3. Chụp màn hình (nút nguồn + tăng âm lượng).\n" +
    "4. Quay lại đây, bấm Tiếp tục và chọn ảnh vừa chụp.", "Chọn ảnh chụp");
  if (!ok) return;
  let img = null;
  try { img = await Photos.latestScreenshot(); } catch (e) {}
  if (img) {
    const a = new Alert(); a.title = "Dùng ảnh chụp màn hình mới nhất?"; a.message = "Đây phải là ảnh chụp TRANG TRỐNG của Home Screen, chụp ngay sau khi đặt hình nền " + T.themes[id].name + ".";
    a.addAction("Dùng ảnh mới nhất"); a.addAction("Tự chọn ảnh khác"); a.addCancelAction("Huỷ");
    const r = await a.present(); if (r === -1) return; if (r === 1) img = null;
  }
  if (!img) img = await Photos.fromLibrary();
  const w = Math.round(img.size.width), h = Math.round(img.size.height), sc = Device.screenScale();
  let src = img;
  if (w + "x" + h !== deviceKey()) {
    if (Math.round(w * sc) + "x" + Math.round(h * sc) === deviceKey()) {
      const c = new DrawContext(); c.size = new Size(w * sc, h * sc); c.respectScreenScale = false; c.drawImageInRect(img, new Rect(0, 0, w * sc, h * sc)); src = c.getImage();
    } else { await info("Ảnh không đúng", "Ảnh " + w + "×" + h + ", màn hình máy " + deviceKey() + ".\nHãy chọn ảnh CHỤP MÀN HÌNH của chính máy này (không phải ảnh nền gốc). Chưa cắt gì cả."); return; }
  }
  const n = cropRows(id, src, P);
  if (n < 3) { await info("Không ghi được nền", "Chỉ lưu được " + n + "/3 mảnh nền. Kiểm tra bộ nhớ trống của iPhone rồi chạy lại mục 1."); return; }
  ensureDir(p(DIR, "shots")); saveImage(shotPath(id), src, true); // để dành cho mục 8, lỗi cũng không sao
  const t = T.themes[id];
  await info("Xong: " + t.name, "Thêm 2 widget Scriptable cỡ VỪA, chọn script Theme, nhập Tham số:\n\n• " + id + ":hud:" + ROW_LABEL[t.rows.hud] + "  → đặt ở " + ROW_VI[t.rows.hud] +
    "\n• " + id + ":launch:" + ROW_LABEL[t.rows.launch] + "  → đặt ở " + ROW_VI[t.rows.launch] + "\n\nWidget phải nằm đúng hàng ghi trong tham số, nếu không nền sẽ lệch.");
}

async function adjustOffset() {
  const st0 = settings(); const o = st0.offset || { dx: 0, dy: 0 };
  const a = new Alert(); a.title = "Chỉnh lệch nền (pixel)"; a.message = "Chỉ dùng khi nền widget lệch so với hình nền. Dương = dịch phải/xuống. Bước nhỏ: 3–10.";
  a.addTextField("dx", String(o.dx)); a.addTextField("dy", String(o.dy)); a.addAction("Lưu và cắt lại"); a.addCancelAction("Huỷ");
  if ((await a.present()) !== 0) return;
  st0.offset = { dx: parseInt(a.textFieldValue(0), 10) || 0, dy: parseInt(a.textFieldValue(1), 10) || 0 }; saveSettings(st0);
  const P = devicePos(); let n = 0;
  if (P) for (const id of Object.keys(T.themes)) if (fm.fileExists(shotPath(id))) { cropRows(id, fm.readImage(shotPath(id)), P); n++; }
  await info("Đã lưu", "Lệch dx=" + st0.offset.dx + ", dy=" + st0.offset.dy + ". Đã cắt lại " + n + " theme. Widget cập nhật ở lần làm mới tới.");
}

async function updateLocation() {
  try {
    Location.setAccuracyToThreeKilometers();
    const loc = await withTimeout(Location.current(), 8, null);
    if (!loc) throw new Error("timeout");
    writeJSON("loc.json", { lat: loc.latitude, lon: loc.longitude, at: Date.now() });
    try { fm.remove(p(DIR, "weather.json")); } catch (e) {}
    await info("Đã lưu vị trí", loc.latitude.toFixed(2) + ", " + loc.longitude.toFixed(2) + "\nWidget thời tiết dùng vị trí này cho tới khi bạn cập nhật lại.");
  } catch (e) { await info("Không lấy được vị trí", "Kiểm tra Cài đặt → Quyền riêng tư → Dịch vụ định vị → Scriptable → Khi dùng app. Widget sẽ dùng tọa độ mặc định."); }
}

async function askCalendar() {
  try { await CalendarEvent.today([]); await info("Lịch", "Đã có quyền đọc Lịch."); }
  catch (e) { await info("Lịch", "Chưa có quyền. Vào Cài đặt → Scriptable → Lịch để bật."); }
}

async function fontTest() {
  const sample = "Đường ướt, trời ẩm ướt — Ỷ Ỹ Ợ Ữ";
  const fonts = [["Didot", 20], ["Didot-Italic", 20], ["Baskerville", 18], ["Baskerville-Italic", 18], ["Baskerville-SemiBold", 18]];
  const tb = new UITable(); tb.showSeparators = true;
  const head = new UITableRow(); head.isHeader = true; head.addText("Kiểm tra dấu tiếng Việt", "Dấu bị lệch/mất ở dòng nào thì chọn font hệ thống ở cuối"); tb.addRow(head);
  for (const [n, sz] of fonts) { const r = new UITableRow(); r.height = 64; const c = r.addText(sample, n); c.titleFont = new Font(n, sz); c.subtitleFont = Font.systemFont(11); tb.addRow(r); }
  const sys = new UITableRow(); sys.height = 64; const c2 = sys.addText(sample, "Font hệ thống (dự phòng)"); c2.titleFont = Font.systemFont(18); tb.addRow(sys);
  const mode = settings().fontMode || "serif";
  [["serif", "Dùng font có chân (Didot/Baskerville)"], ["system", "Dùng font hệ thống cho theme Frieren"]].forEach(([m, label]) => {
    const r = new UITableRow(); r.addText((mode === m ? "✓ " : "   ") + label); r.dismissOnSelect = true;
    r.onSelect = () => { const st0 = settings(); st0.fontMode = m; saveSettings(st0); }; tb.addRow(r);
  });
  await tb.present();
}

async function appTest() {
  const apps = T.apps || [], ov = settings().appOverride || {};
  const tb = new UITable(); tb.showSeparators = true;
  const head = new UITableRow(); head.isHeader = true; head.addText("Kiểm tra nút mở app", "Chạm để thử. App không mở → chạm 'Dùng dự phòng'"); tb.addRow(head);
  for (const a of apps) {
    const cur = ov[a.label] || a.url;
    const r = new UITableRow(); r.height = 56; r.addText((a.unsure ? "⚠ " : "") + a.label, cur); r.dismissOnSelect = false;
    r.onSelect = () => { Safari.open(cur); }; tb.addRow(r);
    if (a.fallback) {
      const f = new UITableRow(); const using = ov[a.label] === a.fallback;
      f.addText(using ? "   ↺ Đang dùng dự phòng · chạm để về mặc định" : "   ↳ Dùng dự phòng: " + a.fallback);
      f.dismissOnSelect = true; f.onSelect = () => { const st0 = settings(); st0.appOverride = st0.appOverride || {}; if (using) delete st0.appOverride[a.label]; else st0.appOverride[a.label] = a.fallback; saveSettings(st0); };
      tb.addRow(f);
    }
  }
  await tb.present();
}

function paramGuide() {
  return Object.keys(T.themes).map(id => {
    const t = T.themes[id];
    return t.name + "\n  " + id + ":hud:" + ROW_LABEL[t.rows.hud] + " (" + ROW_VI[t.rows.hud] + ")\n  " + id + ":launch:" + ROW_LABEL[t.rows.launch] + " (" + ROW_VI[t.rows.launch] + ")";
  }).join("\n\n");
}

async function appMenu() {
  const P = devicePos();
  const ver = "Phiên bản " + T.version + " (engine " + ENGINE_VERSION + ", loader " + ENV.loaderVersion + ", " + ENV.src + ")\nMáy: " + (P ? P.model : "CHƯA HỖ TRỢ " + deviceKey());
  const opts = ["1. Cài nền từ ảnh chụp màn hình", "2. Cập nhật vị trí (thời tiết)", "3. Cấp quyền Lịch", "4. Kiểm tra font chữ", "5. Kiểm tra nút mở app", "6. Xem trước widget", "7. Tham số widget", "8. Chỉnh lệch nền"];
  const i = await pick("ThemeKit", ver, opts);
  if (i === 0) await installBackground();
  if (i === 1) await updateLocation();
  if (i === 2) await askCalendar();
  if (i === 3) await fontTest();
  if (i === 4) await appTest();
  if (i === 5) {
    const ids = Object.keys(T.themes); const t = await pick("Theme", null, ids.map(id => T.themes[id].name)); if (t < 0) return;
    const k = await pick("Loại widget", null, ["HUD (giờ, pin, thời tiết)", "Nút mở app"]); if (k < 0) return;
    const th = T.themes[ids[t]], kind = k ? "launch" : "hud";
    const w = await makeWidget(ids[t] + ":" + kind + ":" + ROW_LABEL[th.rows[kind]]); await w.presentMedium();
  }
  if (i === 6) await info("Tham số widget", paramGuide());
  if (i === 7) await adjustOffset();
}

// ---------------- chạy ----------------
ensureDir(DIR);
if (ENV.config.runsInWidget || ENV.forceWidget) {
  let w;
  try { w = await makeWidget(ENV.args.widgetParameter); } catch (e) { w = errorWidget(e.message || e); }
  Script.setWidget(w);
} else {
  await appMenu();
}
Script.complete();

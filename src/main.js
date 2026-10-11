import { createAudio } from './audio.js'
import { createSim, MAX_TILT } from './sim.js'
import { STAGES } from './stages.js'

// 画面は 320x240、32色（ENDESGA 32）のパレット番号で持つ
const W = 320, H = 240
const PPM = 14 // 1mあたりのピクセル数
const CX = W / 2, CY = H / 2

const PAL_HEX = [
  'be4a2f', 'd77643', 'ead4aa', 'e4a672', 'b86f50', '733e39', '3e2731', 'a22633',
  'e43b44', 'f77622', 'feae34', 'fee761', '63c74d', '3e8948', '265c42', '193c3e',
  '124e89', '0099db', '2ce8f5', 'ffffff', 'c0cbdc', '8b9bb4', '5a6988', '3a4466',
  '262b44', '181425', 'ff0044', '68386c', 'b55088', 'f6757a', 'e8b796', 'c28569',
]
const PAL32 = new Uint32Array(PAL_HEX.map((h) => {
  const n = parseInt(h, 16)
  return 0xff000000 | ((n & 0xff) << 16) | (n & 0xff00) | (n >> 16)
}))

const canvas = document.getElementById('c')
canvas.width = W
canvas.height = H
const ctx = canvas.getContext('2d')
const img = ctx.createImageData(W, H)
const out32 = new Uint32Array(img.data.buffer)
const fb = new Uint8Array(W * H)

function px(x, y, c) {
  if (x >= 0 && x < W && y >= 0 && y < H) fb[y * W + x] = c
}
function rect(x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c)
}
function line(x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    px(x0, y0, c)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
}
function flush() {
  for (let i = 0; i < fb.length; i++) out32[i] = PAL32[fb[i]]
  ctx.putImageData(img, 0, 0)
}

// 表示サイズ：縦横比を保ったまま、ブラウザいっぱいに広げる（余ったほうが余白になる）
function resize() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H)
  canvas.style.width = `${W * s}px`
  canvas.style.height = `${H * s}px`
}
window.addEventListener('resize', resize)
resize()

// --- 背景（外の風景）。動かない部分は一度だけ作って、毎フレームコピーする ---
const bg = new Uint8Array(W * H)
const stars = []
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
function bpx(x, y, c) {
  x = Math.round(x); y = Math.round(y)
  if (x >= 0 && x < W && y >= 0 && y < H) bg[y * W + x] = c
}
function brect(x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) bpx(x + i, y + j, c)
}
// 円。checker が true なら市松に塗って、下の色と混ぜる
function bcircle(cx, cy, r, c, checker = false) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y > r * r + r * 0.5) continue
    if (checker && ((x + y + cx + cy) & 1)) continue
    bpx(cx + x, cy + y, c)
  }
}
function buildBackground() {
  // 空：上は夜、地平線へ向かって紫からピンクへ。色の間は市松で混ぜる
  const seq = [25, 25, 24, 23, 27, 28]
  for (let y = 0; y < H; y++) {
    const v = Math.min(seq.length - 1.001, (y / 200) * (seq.length - 1))
    const i = Math.floor(v), f = v - i
    for (let x = 0; x < W; x++) {
      const thr = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16
      bg[y * W + x] = f > thr ? seq[i + 1] : seq[i]
    }
  }
  // 星
  let seed = 4242
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
  for (let k = 0; k < 70; k++) {
    const x = Math.floor(rnd() * W), y = Math.floor(rnd() * 120)
    const c = rnd() < 0.3 ? 19 : rnd() < 0.5 ? 20 : 21
    bpx(x, y, c)
    stars.push({ x, y, c, ph: rnd() * 6 })
  }
  // 月
  bcircle(278, 36, 15, 23, true)
  bcircle(278, 36, 11, 20)
  bcircle(274, 32, 3, 21)
  bcircle(283, 42, 3, 21)
  bcircle(272, 43, 1, 21)
  for (let a = 0; a < 6.28; a += 0.12) bpx(278 + Math.cos(a) * 11, 36 + Math.sin(a) * 11, 19)
  // なだらかな稜線（低い周波数だけ重ねて丸くする）
  const ridge = (x, base, amp) => base - amp * (0.55 * Math.sin(x * 0.03 + 1) + 0.3 * Math.sin(x * 0.07 + 2) + 0.15 * Math.sin(x * 0.12 + 0.5) + 0.6)
  for (let x = 0; x < W; x++) for (let y = Math.round(ridge(x, 178, 30)); y < H; y++) bpx(x, y, 24)
  // 右の雪山：丸い山頂と、ふちが波打つ雪
  for (let dx = -64; dx <= 64; dx++) {
    const yTop = Math.round(136 + 66 * Math.pow(Math.min(1, Math.abs(dx) / 62), 1.7))
    const snowEdge = yTop + 15 + Math.round(Math.sin(dx * 0.45) * 2 + Math.sin(dx * 0.17) * 2)
    for (let y = yTop; y < 205; y++) {
      const snow = y < snowEdge
      bpx(268 + dx, y, snow ? (dx < 0 ? 20 : 21) : dx < 0 ? 23 : 24)
    }
  }
  // 火山：左。肩がなだらかで、頂上に丸い火口
  const px0 = 62, top = 120
  const flank = (dx) => Math.round(top + 98 * Math.pow(Math.max(0, Math.abs(dx) - 7) / 84, 1.25))
  for (let dx = -92; dx <= 92; dx++) {
    const yTop = flank(dx)
    for (let y = yTop; y < 215; y++) bpx(px0 + dx, y, y < yTop + 2 ? 5 : dx < 0 ? 6 : 25)
  }
  for (let dx = -8; dx <= 8; dx++) {
    const rim = top + Math.round(Math.abs(dx) * Math.abs(dx) * 0.05) - 1
    for (let y = rim; y < rim + 3; y++) bpx(px0 + dx, y, Math.abs(dx) < 4 ? 11 : Math.abs(dx) < 6 ? 10 : 9)
  }
  for (const dx of [-16, -8, 9, 18]) {
    const y0 = flank(dx)
    for (let k = 0; k < 26; k++) {
      bpx(px0 + dx + Math.round(Math.sin(k * 0.3 + dx) * 1.5), y0 + 1 + k, k % 6 === 5 ? 7 : k < 15 ? 9 : 8)
    }
  }
  for (const [x, y, r] of [[62, 108, 6], [70, 96, 8], [82, 82, 10], [97, 68, 12], [114, 56, 13], [130, 48, 12]]) {
    bcircle(x, y, r, 22, true)
    bcircle(x, y, r - 3, 23, true)
  }
  // 手前の丘と、丸い木
  for (let x = 0; x < W; x++) for (let y = Math.round(ridge(x, 204, 16)); y < H; y++) bpx(x, y, 15)
  const tree = (x, y, r, dark) => {
    brect(x, y - 3, 1, 4, 6)
    bcircle(x, y - 3 - r, r, dark ? 14 : 13)
    bcircle(x - 1, y - 4 - r, Math.max(1, r - 3), dark ? 13 : 12)
  }
  // 木は丘の全体にばらまく。奥（稜線の近く）ほど小さく、手前ほど大きい。奥から順に描く
  const spots = []
  for (let k = 0; k < 29; k++) {
    const x = Math.floor(rnd() * W)
    const base = Math.round(ridge(x, 204, 16))
    const y = base + 3 + Math.floor(rnd() * (H - base - 6))
    const depth = (y - base) / (H - base)
    spots.push({ x, y, r: 3 + Math.round(depth * 3 + rnd()), dark: rnd() < 0.5 })
  }
  spots.sort((a, b) => a.y - b.y)
  for (const t of spots) tree(t.x, t.y, t.r, t.dark)
  // 丘の緑は下へ続けて、いちばん下は暗くなじませる（市松で混ぜる）
  for (let y = 214; y < H; y++) {
    const f = (y - 214) / (H - 214)
    for (let x = 0; x < W; x++) {
      const thr = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16
      if (f > thr) bpx(x, y, 25)
    }
  }
}
buildBackground()

function drawBackground(t) {
  fb.set(bg)
  // 星のまたたき
  for (const st of stars) {
    if (Math.sin(t * 2 + st.ph) > 0.85) px(st.x, st.y, 25)
  }
  // 火口のゆらめき
  px(60 + Math.floor((t * 6) % 5), 115, 11)
  px(64 + Math.floor((t * 5) % 3), 114, 10)
}

// --- 家のビットマップ（ローカル座標、家の中心が (HS/2, HS/2)）。回すときは最近傍で引く ---
const HS = 200, HC = HS / 2
const NONE = 255
let hbmp = new Uint8Array(HS * HS).fill(NONE)
const houseMask = new Uint8Array(W * H) // 家のドットがある場所（マグマの透かしに使う）
function hrect(x0, y0, x1, y1, c) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hbmp[y * HS + x] = c
}
function makeHouse(stage, phase = 0) {
  hbmp = new Uint8Array(HS * HS).fill(NONE)
  const th = stage.theme
  // 壁紙：しま模様に小さな柄
  const x0 = Math.round(HC - stage.hw * PPM), x1 = Math.round(HC + stage.hw * PPM)
  const y0 = Math.round(HC - stage.hh * PPM), y1 = Math.round(HC + stage.hh * PPM)
  hrect(x0, y0, x1, y1, th.base)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (((x - x0) & 7) < 2) hbmp[y * HS + x] = th.stripe
  }
  for (let y = y0 + 6; y < y1 - 2; y += 14) {
    for (let x = x0 + 7; x < x1 - 2; x += 16) {
      const k = (((y - y0) / 14) | 0) & 1 ? 8 : 0
      const cx = x + k
      if (cx > x1 - 3) continue
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) hbmp[(y + dy) * HS + cx + dx] = th.dot
    }
  }
  // 飾り（ローカル座標 m）：窓と絵
  const box = (cx, cy, w, h, c) => {
    const a = Math.round(HC + (cx - w / 2) * PPM), b = Math.round(HC - (cy + h / 2) * PPM)
    hrect(a, b, a + Math.round(w * PPM), b + Math.round(h * PPM), c)
  }
  const windowAt = (cx, cy) => {
    box(cx, cy, 1.5, 1.5, 3)
    box(cx, cy, 1.3, 1.3, 16)
    box(cx, cy - 0.2, 1.3, 0.5, 23)
    box(cx, cy, 0.1, 1.3, 3)
    box(cx, cy, 1.3, 0.1, 3)
    hbmp[Math.round(HC - (cy + 0.35) * PPM) * HS + Math.round(HC + (cx - 0.35) * PPM)] = 19
    hbmp[Math.round(HC - (cy - 0.4) * PPM) * HS + Math.round(HC + (cx + 0.4) * PPM)] = 20
  }
  const painting = (cx, cy) => {
    box(cx, cy, 1.3, 1.0, 5)
    box(cx, cy, 1.1, 0.8, 17)
    box(cx, cy - 0.25, 1.1, 0.3, 13)
    box(cx - 0.2, cy - 0.05, 0.3, 0.3, 14)
    box(cx + 0.25, cy + 0.15, 0.2, 0.2, 11)
  }
  // 各階に窓と絵を並べる（はしご、背の高い家具、仕切りの近くは避ける）
  stage.tops.forEach((bottom, L) => {
    const clear = stage.clear[L]
    const cy = bottom + Math.min(2.0, clear * 0.55)
    ;[-0.77, -0.27, 0.23, 0.73].map((f) => f * stage.hw).forEach((x, k) => {
      if ((k + L) % 2) return
      if (stage.ladders.some((l) => l.y1 > bottom && l.y0 < bottom + clear && Math.abs(l.x - x) < 1.4)) return
      if (stage.furniture.some((f) => f.floor === bottom && f.h > 0.9 && x > f.x0 - 1 && x < f.x1 + 1)) return
      if (stage.dividers.some((d) => d.level === L && Math.abs(d.x - x) < 1.0)) return
      if (Math.abs(x - stage.exitX) < 1.6 && L === stage.tops.length - 1) return
      if (L % 2) painting(x, cy)
      else windowAt(x, cy)
    })
  })
  // 家具
  for (const f of stage.furniture) {
    const x0 = Math.round(HC + f.x0 * PPM), x1 = Math.round(HC + f.x1 * PPM)
    const y1 = Math.round(HC - f.floor * PPM), y0 = Math.round(HC - (f.floor + f.h) * PPM)
    const w = x1 - x0, h = y1 - y0, cx = x0 + (w >> 1)
    if (f.type === 'wardrobe') {
      hrect(x0, y0, x1, y1, 5)
      hrect(x0 + 1, y0 + 2, x1 - 1, y1 - 2, 4)
      hrect(x0, y0, x1, y0 + 1, 3)
      hrect(cx, y0 + 2, cx + 1, y1 - 2, 5)
      hrect(cx - 3, y0 + (h >> 1), cx - 2, y0 + (h >> 1) + 2, 11)
      hrect(cx + 2, y0 + (h >> 1), cx + 3, y0 + (h >> 1) + 2, 11)
    } else if (f.type === 'bed') {
      hrect(x0, y1 - 2, x1, y1, 5) // 台
      hrect(x0, y0 - 2, x0 + 2, y1, 5) // ヘッドボード
      hrect(x1 - 2, y1 - 5, x1, y1, 5) // フットボード
      hrect(x0 + 2, y1 - 4, x1 - 2, y1 - 2, 20) // シーツ
      hrect(x0 + 8, y1 - 5, x1 - 2, y1 - 2, 17) // 掛け布団
      hrect(x0 + 8, y1 - 3, x1 - 2, y1 - 2, 16)
      hrect(x0 + 3, y1 - 6, x0 + 8, y1 - 4, 19) // まくら
    } else if (f.type === 'sofa') {
      hrect(x0 + 1, y0, x1 - 1, y1 - 3, 27) // 背もたれ
      hrect(x0, y0 + 3, x0 + 3, y1, 27) // ひじ掛け
      hrect(x1 - 3, y0 + 3, x1, y1, 27)
      hrect(x0 + 3, y1 - 5, x1 - 3, y1 - 1, 28) // 座面
      hrect(cx, y1 - 5, cx + 1, y1 - 1, 27)
      hrect(x0 + 1, y1 - 1, x0 + 3, y1, 6)
      hrect(x1 - 3, y1 - 1, x1 - 1, y1, 6)
    } else if (f.type === 'chest') {
      hrect(x0, y0, x1, y1, 5)
      hrect(x0 + 1, y0 + 3, x1 - 1, y1 - 1, 4)
      hrect(x0, y0, x1, y0 + 2, 3)
      hrect(cx - 1, y0 + 3, cx + 1, y0 + 5, 11)
    } else if (f.type === 'dresser') {
      hrect(x0, y0, x1, y1, 5)
      hrect(x0 + 1, y0 + 2, x1 - 1, y1 - 1, 4)
      hrect(x0, y0, x1, y0 + 2, 3)
      for (const dy of [h / 3, (h * 2) / 3]) hrect(x0 + 1, y0 + Math.round(dy), x1 - 1, y0 + Math.round(dy) + 1, 5)
      for (const dy of [h / 6 + 1, h / 2 + 1, (h * 5) / 6]) hrect(cx - 1, y0 + Math.round(dy), cx + 1, y0 + Math.round(dy) + 1, 11)
    }
  }
  // 坂：三角形を塗る（斜めの面にふちを付ける）
  for (const r of stage.ramps) {
    const P = r.pts.map(([x, y]) => [HC + x * PPM, HC - y * PPM])
    const xs = P.map((q) => q[0]), ys = P.map((q) => q[1])
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        const px_ = x + 0.5, py_ = y + 0.5
        const side = (a, b) => (px_ - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py_ - b[1])
        const d1 = side(P[0], P[1]), d2 = side(P[1], P[2]), d3 = side(P[2], P[0])
        const inside = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
        if (!inside) continue
        // 斜めの辺からの距離が小さければ、ふち
        const slope = r.up === 'right' ? [P[0], P[2]] : [P[1], P[2]]
        const dx = slope[1][0] - slope[0][0], dy = slope[1][1] - slope[0][1]
        const dist = Math.abs((px_ - slope[0][0]) * dy - (py_ - slope[0][1]) * dx) / Math.hypot(dx, dy)
        hbmp[y * HS + x] = dist < 1.2 ? 3 : (x + y) & 1 ? 4 : 31
      }
    }
  }
  // ロープ：端の金具と、少したるんだ縄
  for (const r of stage.ropes) {
    const ya = Math.round(HC - r.y * PPM)
    const xa = Math.round(HC + r.x0 * PPM), xb = Math.round(HC + r.x1 * PPM)
    for (let x = xa; x <= xb; x++) {
      const sag = Math.round(Math.sin(((x - xa) / (xb - xa)) * Math.PI) * 2)
      hbmp[(ya + sag) * HS + x] = (x >> 1) & 1 ? 2 : 31
      hbmp[(ya + sag + 1) * HS + x] = (x >> 1) & 1 ? 3 : 4
    }
    for (const x of [xa, xb]) hrect(x - 1, ya - 2, x + 2, ya + 4, 6)
  }
  // はしご：両側の縦材と、4ドットおきの横木
  for (const l of stage.ladders) {
    const cx = Math.round(HC + l.x * PPM)
    const top = Math.round(HC - l.y1 * PPM), bottom = Math.round(HC - l.y0 * PPM)
    hrect(cx - 3, top, cx - 2, bottom, 3)
    hrect(cx + 2, top, cx + 3, bottom, 3)
    for (let y = bottom - 2; y > top; y -= 4) hrect(cx - 2, y, cx + 2, y + 1, 31)
  }
  const boxes = stage.walls.map(([cx, cy, w, h]) => [
    Math.round(HC + (cx - w / 2) * PPM), Math.round(HC - (cy + h / 2) * PPM),
    Math.round(HC + (cx + w / 2) * PPM), Math.round(HC - (cy - h / 2) * PPM),
  ])
  for (const [x0, y0, x1, y1] of boxes) hrect(x0, y0, x1, y1, 5)
  for (const [x0, y0, x1, y1] of boxes) hrect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, 4)
  // 動く床：床の上面に、流れる矢印の縞（phase でずらして動かす）
  for (const b of stage.belts) {
    const xa = Math.round(HC + b.x0 * PPM), xb = Math.round(HC + b.x1 * PPM)
    const ya = Math.round(HC - b.floor * PPM)
    hrect(xa, ya, xb, ya + 3, 22)
    const dir = b.speed >= 0 ? 1 : -1
    for (let x = xa; x < xb; x++) {
      const m = (((x - xa) - dir * phase * 2) % 8 + 8) % 8
      if (m < 2) hbmp[ya * HS + x] = 20
      if (m === 2) hbmp[(ya + 1) * HS + x] = 20
      if (m === 3) hbmp[(ya + 2) * HS + x] = 21
    }
    hrect(xa - 1, ya, xa + 1, ya + 4, 6)
    hrect(xb - 1, ya, xb + 1, ya + 4, 6)
  }
  // 出口の両端のランプ
  for (const sx of [stage.exitX - 1.2, stage.exitX + 1.2]) {
    const x = Math.round(HC + sx * PPM), y = Math.round(HC - stage.roofY * PPM)
    hrect(x - 2, y - 2, x + 2, y + 2, 12)
    hbmp[y * HS + x] = 11
  }
  return hbmp
}
// 面ごとに一度だけ作って持たせる。今の面の家の絵に切り替える。動く床がある面は、4 つの位相を作って切り替える
function useStage(stage, t = 0) {
  if (stage.belts.length) {
    const ph = Math.floor(t * 8) & 3
    stage.bmps = stage.bmps || []
    if (!stage.bmps[ph]) stage.bmps[ph] = makeHouse(stage, ph)
    hbmp = stage.bmps[ph]
  } else {
    if (!stage.bmp) stage.bmp = makeHouse(stage)
    hbmp = stage.bmp
  }
}

function drawHouse(angle) {
  houseMask.fill(0)
  const c = Math.cos(angle), s = Math.sin(angle)
  const R = 110
  for (let dy = CY - R; dy < CY + R; dy++) {
    for (let dx = CX - R; dx < CX + R; dx++) {
      const u = dx + 0.5 - CX, v = -(dy + 0.5 - CY)
      const sx = Math.floor(HC + u * c + v * s), sy = Math.floor(HC - (-u * s + v * c))
      if (sx < 0 || sy < 0 || sx >= HS || sy >= HS) continue
      const col = hbmp[sy * HS + sx]
      if (col !== NONE && dx >= 0 && dx < W && dy >= 0 && dy < H) {
        fb[dy * W + dx] = col
        houseMask[dy * W + dx] = 1
      }
    }
  }
}

// --- 人 ---
// 見た目：肌・髪・服・ズボンの組み合わせ
const SKINS = [3, 30, 31]
const HAIRS = [6, 5, 10, 9, 25, 22, 4]
const SHIRTS = [8, 17, 12, 28, 19, 11, 29, 18, 0]
const PANTS = [16, 27, 23, 15]
const LOOKS = Array.from({ length: 24 }, (_, i) => ({
  skin: SKINS[i % 3],
  hair: HAIRS[(i * 3 + 1) % HAIRS.length],
  shirt: SHIRTS[(i * 5) % SHIRTS.length],
  pants: PANTS[(i * 7 + 2) % PANTS.length],
}))

// fx, fy は足もとの中心。高さ12px・幅5pxのちびキャラ
function drawPerson(fx, fy, look, state, face, climb, t) {
  const L = LOOKS[look % LOOKS.length]
  if (state === 'rope') {
    // ロープ：両手を上げてぶら下がり、足を交互にぶらぶらさせる
    const f = Math.floor(t * 3 + look) & 1
    rect(fx - 1, fy - 3, 1, f ? 3 : 2, L.pants)
    rect(fx + 1, fy - 3, 1, f ? 2 : 3, L.pants)
    rect(fx - 1, fy - 7, 3, 4, L.shirt)
    for (const x of [fx - 2, fx + 2]) {
      rect(x, fy - 14, 1, 6, L.skin)
      px(x, fy - 8, L.shirt)
    }
    rect(fx - 2, fy - 12, 5, 5, L.skin)
    rect(fx - 2, fy - 12, 5, 2, L.hair)
    px(fx + (face > 0 ? 1 : -1), fy - 10, 25)
    return
  }
  if (state === 'ladder') {
    // はしご：背中を向けて、手足を交互に動かす
    const f = Math.floor(t * 4 + look) & 1
    rect(fx - 1, fy - 3, 1, f ? 3 : 2, L.pants)
    rect(fx + 1, fy - 3, 1, f ? 2 : 3, L.pants)
    rect(fx - 1, fy - 7, 3, 4, L.shirt)
    for (const [x, up] of [[fx - 2, f], [fx + 2, !f]]) {
      const top = fy - (up ? 11 : 9)
      rect(x, top, 1, 3, L.skin)
      px(x, top + 3, L.shirt)
    }
    rect(fx - 2, fy - 12, 5, 5, L.hair)
    rect(fx - 1, fy - 8, 3, 1, L.skin)
    return
  }
  const fr = Math.floor((t + look * 0.3) * (state === 'fall' ? 10 : 8)) & 1
  const lean = climb ? face : 0

  // 脚
  let l1 = 3, l2 = 3, x1 = fx - 1, x2 = fx + 1
  if (state === 'walk') { if (fr) l1 = 2; else l2 = 2 }
  if (state === 'fall') { x1 = fx - 2; x2 = fx + 2; if (fr) l1 = 2; else l2 = 2 }
  if (state === 'slide') { x1 = fx - 1; x2 = fx + 2 }
  for (const [x, l] of [[x1, l1], [x2, l2]]) {
    rect(x, fy - 3, 1, l, L.pants)
    px(x, fy - 4 + l, 6)
  }
  // 胴
  rect(fx - 1 + lean, fy - 7, 3, 4, L.shirt)
  // 腕
  const armX = [fx - 2 + lean, fx + 2 + lean]
  const arm = (x, top, len = 3) => {
    px(x, top, L.shirt)
    rect(x, top + 1, 1, len - 1, L.skin)
  }
  if (state === 'fall') {
    arm(fx - 3 + lean, fr ? fy - 10 : fy - 8)
    arm(fx + 3 + lean, fr ? fy - 8 : fy - 10)
  } else if (state === 'slide') {
    arm(armX[face > 0 ? 1 : 0] + face, fy - 10)
    arm(armX[face > 0 ? 0 : 1], fy - 7)
  } else if (state === 'walk') {
    arm(armX[0], fr ? fy - 7 : fy - 6)
    arm(armX[1], fr ? fy - 6 : fy - 7)
  } else {
    arm(armX[0], fy - 7)
    arm(armX[1], fy - 7)
  }
  // 頭
  rect(fx - 2 + lean, fy - 12, 5, 5, L.skin)
  rect(fx - 2 + lean, fy - 12, 5, 2, L.hair)
  const back = face > 0 ? fx - 2 + lean : fx + 2 + lean
  px(back, fy - 10, L.hair)
  px(back, fy - 9, L.hair)
  px(fx - 1 + face + lean, fy - 10, 25)
  px(fx + 1 + face + lean, fy - 10, 25)
}

// 数字の小さなフォント（3x5）
const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001',
  8: '111101111101111', 9: '111101111001111', '/': '001001010100100',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111', ':': '000010000010000', '.': '000000000000010', '-': '000000111000000', '!': '010010010000010', '?': '111001011000010', '<': '001010100010001',
}
function text(str, x, y, c, sc = 1) {
  x = Math.round(x)
  y = Math.round(y)
  for (const ch of String(str)) {
    const g = FONT[ch]
    if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') rect(x + (i % 3) * sc, y + ((i / 3) | 0) * sc, sc, sc, c)
    x += 4 * sc
  }
}
const textWidth = (str, sc = 1) => String(str).length * 4 * sc - sc

// --- マグマ ---
function drawLava(level, t) {
  const base = Math.round(CY - level * PPM)
  for (let x = 0; x < W; x++) {
    const wave = Math.round(1.6 * Math.sin(x * 0.13 + t * 2.1) + 1.1 * Math.sin(x * 0.29 - t * 1.4))
    const top = base + wave
    if (top - 1 >= 0 && top - 1 < H && x % 2 === 0) fb[(top - 1) * W + x] = 7
    for (let y = Math.max(0, top); y < H; y++) {
      const d = y - top
      const k = y * W + x
      if (houseMask[k] && d > 0 && ((x + y) & 1)) continue // 家の壁が透けて見える
      fb[k] = d < 1 ? 11 : d < 3 ? 10 : d < 7 ? 9 : d < 14 ? 8 : d < 28 ? 7 : 6
    }
    // ぷつぷつ泡
    const seed = (x * 7919 + Math.floor(t * 3 + x * 0.37) * 104729) % 97
    if (seed === 0) px(x, top + 3 + (seed + x) % 9, 11)
  }
}

// --- 空の精（妖精）：出口の外で待って、助けた人を空へ連れて行く ---
function drawHeli(cx, cy, t) {
  const bob = Math.round(Math.sin(t * 3) * 1.5)
  const y = cy + bob
  const flap = Math.floor(t * 8) & 1
  // うっすらした光（市松）
  for (let dy = -12; dy <= 10; dy++) {
    for (let dx = -14; dx <= 14; dx++) {
      if ((dx * dx) / 196 + (dy * dy) / 121 > 1 || ((dx + dy) & 1)) continue
      px(cx + dx, y + dy, 23)
    }
  }
  // 羽：上の大きな羽と、下の小さな羽。透けた感じ（市松）で、はばたく
  const wing = (s, ox, oy, rx, ry) => {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
        if (d > 1) continue
        px(cx + s * (ox + dx), y + oy + dy, d > 0.62 ? 20 : (dx + dy) & 1 ? 18 : 19)
      }
    }
  }
  for (const s of [-1, 1]) {
    wing(s, 8, flap ? -11 : -8, 5, 4) // 上の羽
    wing(s, 6, flap ? -3 : -1, 3, 2) // 下の羽
  }
  // 体：白いワンピース（すそが広い）と、足
  rect(cx - 1, y - 4, 3, 2, 19)
  rect(cx - 2, y - 2, 5, 2, 19)
  rect(cx - 3, y, 7, 2, 19)
  rect(cx - 3, y + 2, 7, 1, 18) // すその青いふち
  rect(cx - 1, y - 3, 3, 1, 18) // 胸の飾り
  px(cx - 1, y + 3, 30)
  px(cx + 1, y + 3, 30)
  px(cx - 1, y + 4, flap ? 30 : 0 === 1 ? 30 : 25)
  // 腕：右手に星の杖
  px(cx - 3, y - 3, 30)
  px(cx - 4, y - 2, 30)
  px(cx + 3, y - 4, 30)
  line(cx + 4, y - 5, cx + 8, y - 11, 31)
  const tw = Math.floor(t * 6) & 1
  rect(cx + 8, y - 14, 1, 5, 11)
  rect(cx + 6, y - 12, 5, 1, 11)
  if (tw) { px(cx + 7, y - 13, 19); px(cx + 9, y - 13, 19); px(cx + 7, y - 11, 19); px(cx + 9, y - 11, 19) }
  // 頭：金の髪、顔、リボン
  rect(cx - 2, y - 10, 5, 5, 30)
  rect(cx - 3, y - 11, 7, 3, 10)
  rect(cx - 3, y - 8, 1, 4, 10)
  rect(cx + 3, y - 8, 1, 3, 10)
  rect(cx - 1, y - 12, 3, 1, 11)
  px(cx - 1, y - 8, 25)
  px(cx + 1, y - 8, 25)
  px(cx - 2, y - 7, 29)
  px(cx + 2, y - 7, 29)
  px(cx, y - 6, 8)
  px(cx + 3, y - 11, 28) // 髪のリボン
  px(cx + 4, y - 11, 28)
  // こぼれる光の粒
  for (let i = 0; i < 5; i++) {
    const ph = (t * 1.5 + i * 0.21) % 1
    const sx = Math.round(cx + Math.sin(t * 4 + i * 2.1) * 4)
    const sy = Math.round(y + 6 + ph * 13)
    px(sx, sy, ph < 0.5 ? 19 : 18)
    if (i % 2) px(sx + 1, sy, 11)
  }
}

// --- 演出 ---
function drawFx(f, heli) {
  const k = f.age / f.dur
  if (f.kind === 'saved') {
    const sx = CX + f.x * PPM, sy = CY - f.y * PPM
    const hx = CX + heli.x * PPM, hy = CY - heli.y * PPM
    const FLY = 0.7 // 空の精へ飛ぶ時間。そのあと、光がはじける
    const smooth = (a) => { const q = Math.min(1, a / FLY); return q * q * (3 - 2 * q) }
    const e = smooth(f.age)
    if (f.age < FLY) {
      // 光の粒の尾を引きながら、空の精へ
      for (let j = 3; j >= 1; j--) {
        const ee = smooth(Math.max(0, f.age - j * 0.06))
        px(Math.round(sx + (hx - sx) * ee), Math.round(sy + (hy - sy) * ee) + 2 + j, j === 1 ? 19 : j === 2 ? 18 : 17)
      }
      drawPerson(Math.round(sx + (hx - sx) * e), Math.round(sy + (hy - sy) * e) + 5, f.look, 'fall', f.face, false, f.age)
    } else {
      // 着いた：空の精の位置で、光が放射状にはじける（外へ広がる粒の輪が 2 重と、十字の星）
      const u = (f.age - FLY) / (f.dur - FLY)
      const bx = Math.round(hx), by = Math.round(hy)
      for (const [n, R0, R1, off] of [[16, 4, 22, 0.1], [10, 3, 12, 0.35]]) {
        const R = R0 + u * (R1 - R0)
        for (let i = 0; i < n; i++) {
          const ang = (i * Math.PI * 2) / n + off
          const x = Math.round(bx + Math.cos(ang) * R), y = Math.round(by + Math.sin(ang) * R * 0.85)
          const c = i % 3 === 0 ? 19 : i % 3 === 1 ? 18 : 11
          if (u < 0.35) rect(x, y, 3, 3, c)
          else if (u < 0.7) rect(x, y, 2, 2, c)
          else px(x, y, c)
        }
      }
      if (u < 0.85) {
        const L = Math.round(10 * (1 - u * 0.8))
        rect(bx - L, by, 2 * L + 1, 1, 19)
        rect(bx, by - L, 1, 2 * L + 1, 19)
        rect(bx - 1, by - 1, 3, 3, 19)
      }
    }
  } else {
    const sx = Math.round(CX + f.x * PPM), sy = Math.round(CY - f.y * PPM)
    for (let i = 0; i < 8; i++) {
      const ang = i * 0.785 + 0.3
      const r = 3 + k * 9
      px(Math.round(sx + Math.cos(ang) * r), Math.round(sy - Math.sin(ang) * r - k * 8), i % 3 === 0 ? 11 : i % 3 === 1 ? 9 : 8)
    }
  }
}

// --- 結果、タイトル、面選択 ---
// 評価ごとの言葉は、家の心（プレイヤー）の気持ち
const RANKS = {
  S: { color: 11, msg: 'THE HOUSE SMILES' },
  A: { color: 12, msg: 'THE HOUSE IS GLAD' },
  B: { color: 17, msg: 'THE HOUSE HOLDS ON' },
  C: { color: 19, msg: 'THE HOUSE WEEPS A LITTLE' },
  D: { color: 8, msg: 'THE HOUSE GOES QUIET' },
}
const rankOf = (saved, total) => {
  const r = saved / total
  return saved === total ? 'S' : r >= 0.85 ? 'A' : r >= 0.7 ? 'B' : r >= 0.5 ? 'C' : 'D'
}

// 進み具合（面ごとの最高の脱出人数）。半分以上助けると、次の面が開く。?unlock を付けると全部開く
const PROGRESS_KEY = 'lava-house-progress'
function loadProgress() {
  try {
    const j = JSON.parse(localStorage.getItem(PROGRESS_KEY))
    return { best: Array.isArray(j && j.best) ? j.best : [], times: Array.isArray(j && j.times) ? j.times : [] }
  } catch { return { best: [], times: [] } }
}
function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)) } catch { /* 保存できなくてもよい */ }
}
const progress = loadProgress()
const unlockAll = typeof location !== 'undefined' && /[?&]unlock/.test(location.search)
const bestOf = (i) => progress.best[i] || 0
const timeOf = (i) => progress.times[i] || 0 // 最高の人数を助けたときの、いちばん速いクリアタイム（秒。0 は記録なし）
const fmtTime = (sec) => sec.toFixed(1)
const isCleared = (i) => bestOf(i) >= Math.ceil(STAGES[i].total * 0.5)
const isUnlocked = (i) => unlockAll || i === 0 || isCleared(i - 1)
const clearedCount = () => STAGES.filter((_, i) => isCleared(i)).length

let result = null // { rank, isNew, cleared, firstClear }: 結果が決まったときに作る

const centered = (str, y, c, sc = 1) => text(str, CX - textWidth(str, sc) / 2, y, c, sc)

function panel(w, h, cy = CY) {
  const x0 = CX - w / 2, y0 = cy - h / 2
  rect(x0 - 2, y0 - 2, w + 4, h + 4, 19)
  rect(x0, y0, w, h, 25)
  return [x0, y0]
}

function button(b, c = 19) {
  rect(b.x - 1, b.y - 1, b.w + 2, b.h + 2, c)
  rect(b.x, b.y, b.w, b.h, 24)
  text(b.label, b.x + Math.round((b.w - textWidth(b.label)) / 2), b.y + Math.round((b.h - 5) / 2), c)
}

// 結果画面のボタン：もう一度、面選択、（クリアしたら）次へ
const RESULT_W = 184, RESULT_H = 128
function resultButtons() {
  const list = [{ id: 'retry', label: 'RETRY' }, { id: 'stages', label: 'STAGES' }]
  if (result && result.cleared && stageIdx + 1 < STAGES.length) list.push({ id: 'next', label: 'NEXT' })
  const w = 54, gap = 6, h = 16
  const total = list.length * w + (list.length - 1) * gap
  const y = CY - RESULT_H / 2 + RESULT_H - 24
  return list.map((b, i) => ({ ...b, w, h, y, x: Math.round(CX - total / 2) + i * (w + gap) }))
}

// 王冠（S ランクのしるし）。13 × 7 ドット。1 = 金、2 = 影になる下の部分、3 = 宝石（中央が赤、左右が青）
const CROWN = [
  '.1....1....1.',
  '.11..111..11.',
  '111.11111.111',
  '1111111111111',
  '1131118111311',
  '2222222222222',
  '2222222222222',
]
// mono を渡すと、その 1 色だけで塗る（影に使う）
function drawCrown(x, y, sc = 1, mono = -1) {
  for (let j = 0; j < CROWN.length; j++) {
    for (let i = 0; i < CROWN[j].length; i++) {
      const ch = CROWN[j][i]
      if (ch === '.') continue
      let c = ch === '1' ? 11 : ch === '2' ? 10 : ch === '3' ? 17 : 8
      if (mono >= 0) c = mono
      rect(x + i * sc, y + j * sc, sc, sc, c)
    }
  }
}

function drawResult(t) {
  const total = sim.total
  const [x0, y0] = panel(RESULT_W, RESULT_H)
  const rk = RANKS[result.rank]
  if (result.rank === 'S') {                         // S は王冠（影つき）
    drawCrown(x0 + 17, y0 + 25, 2, 6)
    drawCrown(x0 + 15, y0 + 23, 2)
  } else {
    text(result.rank, x0 + 18, y0 + 12, 6, 8)         // 評価の文字（影つき）
    text(result.rank, x0 + 16, y0 + 10, rk.color, 8)
  }
  text(`${sim.saved}/${total}`, x0 + 64, y0 + 12, result.rank === 'S' ? 11 : 19, 4)
  const allClear = result.cleared && stageIdx === STAGES.length - 1
  text(allClear ? 'ALL STAGES CLEAR!' : rk.msg, x0 + 64, y0 + 38, allClear ? 11 : 20)
  // クリアタイム（最後に助けた時刻）と、ベスト
  if (result.time !== null) {
    const tm = `TIME ${fmtTime(result.time)}`
    text(tm, x0 + 64, y0 + 46, result.isNewTime || result.isNew ? 11 : 19)
    const bt = timeOf(stageIdx)
    if (bt) text(`BEST ${fmtTime(bt)}`, x0 + 64 + textWidth(tm) + 6, y0 + 46, 21)
  }
  // 1 人ずつの結果：緑は脱出、赤はマグマ
  const gap = 1
  const size = Math.min(8, Math.floor((RESULT_W - 16 - (total - 1) * gap) / total))
  const row = total * size + (total - 1) * gap
  for (let i = 0; i < total; i++) {
    rect(Math.round(CX - row / 2) + i * (size + gap), y0 + 56, size, size, sim.outcomes[i] === 'saved' ? 12 : 8)
  }
  const blink = Math.floor(t * 2) & 1
  if ((result.isNew || result.isNewTime) && blink) centered(result.isNew ? 'NEW RECORD!' : 'NEW TIME!', y0 + 70, 11, 2)
  else centered(`BEST ${bestOf(stageIdx)}/${total}`, y0 + 74, 21)
  if (result.firstClear && stageIdx + 1 < STAGES.length) centered(`STAGE ${stageIdx + 2} OPEN`, y0 + 90, 12)
  else if (!result.cleared) centered('SAVE HALF TO OPEN THE NEXT', y0 + 90, 22)
  for (const b of resultButtons()) button(b, b.id === 'next' ? 11 : 19)
}

function drawTitle(t) {
  const pw = 200, ph = 96
  const [, y0] = panel(pw, ph)
  const logo = 'HOUSEHEART'
  text(logo, CX - textWidth(logo, 4) / 2 + 1, y0 + 13, 9, 4)   // 影
  text(logo, CX - textWidth(logo, 4) / 2, y0 + 12, 11, 4)
  centered('TURN THE HOUSE TO SAVE EVERYONE', y0 + 40, 21)
  if (Math.floor(t * 2) & 1) centered('TAP TO START', y0 + 54, 19, 2)
  const n = clearedCount()
  if (n > 0) centered(`CLEARED ${n}/${STAGES.length}`, y0 + 78, 20)
}

// 面選択：5 × 2 のマス。番号と、最高の評価。閉じている面は灰色
const CELL = { w: 50, h: 50 }
let cursor = 0
function cellRect(i) {
  const col = i % 5, row = Math.floor(i / 5)
  return { x: Math.round(CX - (5 * CELL.w) / 2) + col * CELL.w + 2, y: 70 + row * (CELL.h + 4), w: CELL.w - 4, h: CELL.h }
}
const BACK = { x: W - 54, y: H - 14, w: 48, h: 11, label: '< TITLE' }
function drawSelect(t) {
  const [, y0] = panel(280, 176, CY + 6)
  centered('SELECT STAGE', y0 + 8, 11, 2)
  STAGES.forEach((st, i) => {
    const r = cellRect(i)
    const open = isUnlocked(i)
    const c = i === cursor ? 11 : open ? 19 : 22
    rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, c)
    if (i === cursor) rect(r.x, r.y, r.w, r.h, 25), rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, c), rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 25)
    else rect(r.x, r.y, r.w, r.h, 25)
    const num = String(i + 1)
    text(num, r.x + Math.round((r.w - textWidth(num, 3)) / 2), r.y + 4, open ? 19 : 22, 3)
    if (!open) centered2('LOCK', r.x, r.w, r.y + 28, 22)
    else if (bestOf(i) > 0) {
      const rk = rankOf(bestOf(i), st.total)
      if (rk === 'S') drawCrown(r.x + ((r.w - 13) >> 1), r.y + 22, 1)
      else centered2(rk, r.x, r.w, r.y + 21, RANKS[rk].color, 2)
      centered2(`${bestOf(i)}/${st.total}`, r.x, r.w, r.y + 32, 21)
      if (timeOf(i)) centered2(fmtTime(timeOf(i)), r.x, r.w, r.y + 41, 22)
    } else centered2('NEW', r.x, r.w, r.y + 28, 12)
  })
  centered(STAGES[cursor].name, y0 + 150, 20)
  if (bestOf(cursor) > 0) {
    const bt = timeOf(cursor)
    centered(`BEST ${bestOf(cursor)}/${STAGES[cursor].total}${bt ? `  TIME ${fmtTime(bt)}` : ''}`, y0 + 162, 21)
  }
  button(BACK, 21)
}
const centered2 = (str, x, w, y, c, sc = 1) => text(str, x + Math.round((w - textWidth(str, sc)) / 2), y, c, sc)

const audio = createAudio()
// --- 左下の一時停止ボタンと、メニュー ---
// 押すとゲームが止まって、メニューが開く（続ける・ステージ選択へ戻る・音のオン/オフ・スコアのリセット）
let menu = null // null | 'main' | 'confirm'
const PAUSE_BTN = { x: 3, y: H - 25, w: 24, h: 22 } // 押せる範囲（スマホでも押しやすい大きさ）
const menuIconShown = () => screen === 'play' || screen === 'title'
function drawMenuIcon() {
  if (!menuIconShown()) return
  const b = PAUSE_BTN
  const c = menu ? 11 : 21
  rect(b.x, b.y, b.w, b.h, c === 11 ? 11 : 22)
  rect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 25)
  if (screen === 'play') {
    // 一時停止（2 本線）
    rect(b.x + 6, b.y + 4, 4, 14, c)
    rect(b.x + 14, b.y + 4, 4, 14, c)
    rect(b.x + 6, b.y + 4, 1, 14, 19) // 左のふちを明るく
    rect(b.x + 14, b.y + 4, 1, 14, 19)
  } else {
    // 設定（歯車）：輪と、8 方向の歯
    const cx = b.x + 12, cy = b.y + 11
    for (let dy = -7; dy <= 7; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        const d = Math.hypot(dx, dy)
        if (d < 2.6) continue
        let on = d <= 4.8
        if (!on && d <= 7.2) {
          const a = Math.atan2(dy, dx)
          const k = Math.round(a / (Math.PI / 4))
          on = Math.abs(a - k * (Math.PI / 4)) < 0.3
        }
        if (on) px(cx + dx, cy + dy, dx + dy < -1 ? 19 : c)
      }
    }
  }
}
function menuItems() {
  if (menu === 'confirm') return [{ id: 'yes', label: 'YES ERASE' }, { id: 'no', label: 'NO' }]
  const list = [{ id: 'resume', label: screen === 'play' ? 'CONTINUE' : 'CLOSE' }]
  if (screen === 'play') list.push({ id: 'stages', label: 'STAGE SELECT' })
  list.push({ id: 'sound', label: audio.muted ? 'SOUND OFF' : 'SOUND ON' })
  list.push({ id: 'reset', label: 'RESET SCORES' })
  return list
}
function menuLayout() {
  const items = menuItems()
  const bw = 150, bh = 20, gap = 6
  const head = menu === 'confirm' ? 40 : 30
  const ph = head + items.length * (bh + gap) + 4
  const pw = 184
  const x0 = CX - pw / 2, y0 = CY - ph / 2
  return {
    pw, ph, x0, y0,
    buttons: items.map((it, i) => ({ ...it, w: bw, h: bh, x: Math.round(CX - bw / 2), y: y0 + head + i * (bh + gap) })),
  }
}
function drawMenu() {
  const L = menuLayout()
  panel(L.pw, L.ph)
  if (menu === 'confirm') {
    centered('ERASE ALL RECORDS?', L.y0 + 10, 19)
    centered('THIS CANNOT BE UNDONE', L.y0 + 21, 8)
  } else centered(screen === 'play' ? 'PAUSED' : 'SETTINGS', L.y0 + 8, 11, 2)
  for (const b of L.buttons) {
    const c = b.id === 'yes' ? 8 : b.id === 'sound' ? (audio.muted ? 22 : 12) : b.id === 'resume' ? 11 : 19
    button(b, c)
  }
}
function openMenu() {
  menu = 'main'
  drag = null
}
function menuTap(px, py) {
  const L = menuLayout()
  const b = L.buttons.find((q) => inRect(px, py, q))
  if (!b) {
    // 枠の外を押したら、閉じる（確認のときは、ひとつ前へ）
    if (px < L.x0 || px > L.x0 + L.pw || py < L.y0 || py > L.y0 + L.ph) menu = menu === 'confirm' ? 'main' : null
    return
  }
  if (b.id === 'resume') menu = null
  else if (b.id === 'stages') { menu = null; showSelect() }
  else if (b.id === 'sound') audio.toggleMute()
  else if (b.id === 'reset') menu = 'confirm'
  else if (b.id === 'no') menu = 'main'
  else if (b.id === 'yes') {
    progress.best = []
    progress.times = []
    saveProgress()
    menu = null
    if (screen === 'play') showSelect()
  }
}

// 人を床の上に立たせてから始める
function newSim(stage) {
  const s = createSim(stage)
  s.settle(1.5)
  return s
}
let stageIdx = 0
useStage(STAGES[0])
let sim = newSim(STAGES[0])
let screen = 'title' // 'title' → 'select' → 'play'（結果は play の続きで出る）
let combo = 0
function startStage(i) {
  stageIdx = i
  useStage(STAGES[i])
  sim = newSim(STAGES[i])
  screen = 'play'
  result = null
  combo = 0
  drag = null
  audio.bgm(true)
}
function showSelect() {
  screen = 'select'
  sim.targetAngle = 0
  let first = STAGES.findIndex((_, i) => isUnlocked(i) && !isCleared(i))
  if (first < 0) first = stageIdx
  cursor = first
  audio.bgm(false, 0.4)
}
function showTitle() {
  screen = 'title'
  stageIdx = 0
  useStage(STAGES[0])
  sim = newSim(STAGES[0])
}
// 音の許可：スマホ（タッチ）は、指を触れた瞬間ではなく、離したとき（pointerup / touchend）が「操作」に数えられる
function wakeAudio() {
  const first = !audio.unlocked
  audio.unlock()
  if (first && screen === 'play') audio.bgm(true)
}
const resultShown = () => screen === 'play' && sim.over && sim.time - sim.overAt > 1.2
let debug = false

// --- 入力：家の中心まわりの角度差をそのまま目標角度に足す ---
let drag = null
function pointerAngle(e) {
  const r = canvas.getBoundingClientRect()
  return Math.atan2(-(e.clientY - (r.top + r.height / 2)), e.clientX - (r.left + r.width / 2))
}
const inRect = (x, y, r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
function resultAction(id) {
  if (id === 'retry') startStage(stageIdx)
  else if (id === 'next') startStage(stageIdx + 1)
  else if (id === 'stages') showSelect()
}
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect()
  const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H
  wakeAudio()
  if (menu) { menuTap(px, py); return }
  if (menuIconShown() && inRect(px, py, PAUSE_BTN)) { openMenu(); return } // 左下の一時停止（ゲーム中）・設定（タイトル）ボタン
  if (screen === 'title') { showSelect(); return }
  if (screen === 'select') {
    if (inRect(px, py, BACK)) { showTitle(); return }
    for (let i = 0; i < STAGES.length; i++) {
      if (inRect(px, py, cellRect(i)) && isUnlocked(i)) { cursor = i; startStage(i); return }
    }
    return
  }
  if (resultShown()) {
    const b = resultButtons().find((q) => inRect(px, py, q))
    if (b) resultAction(b.id)
    return
  }
  canvas.setPointerCapture(e.pointerId)
  drag = { last: pointerAngle(e) }
})
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return
  const a = pointerAngle(e)
  let d = a - drag.last
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  sim.targetAngle = Math.max(-MAX_TILT, Math.min(MAX_TILT, sim.targetAngle + d))
  drag.last = a
})
canvas.addEventListener('pointerup', () => { drag = null; wakeAudio() })
window.addEventListener('touchend', wakeAudio, { passive: true })
window.addEventListener('click', wakeAudio)
window.addEventListener('keydown', (e) => {
  wakeAudio()
  const k = e.key
  if (k === 'm') audio.toggleMute()
  if (k === 'd') debug = !debug
  if (k === 'Escape') {
    if (menu === 'main') menu = null
    else if (menu === 'confirm') menu = 'main'
    else if (screen === 'select') showTitle()
    else openMenu()
    return
  }
  if (menu) return
  if (screen === 'title') {
    if (k === 'Enter' || k === ' ') showSelect()
  } else if (screen === 'select') {
    if (k === 'ArrowRight') cursor = Math.min(STAGES.length - 1, cursor + 1)
    else if (k === 'ArrowLeft') cursor = Math.max(0, cursor - 1)
    else if (k === 'ArrowDown') cursor = Math.min(STAGES.length - 1, cursor + 5)
    else if (k === 'ArrowUp') cursor = Math.max(0, cursor - 5)
    else if ((k === 'Enter' || k === ' ') && isUnlocked(cursor)) startStage(cursor)
  } else {
    if (k === 'r') startStage(stageIdx)
    else if (k === 's') showSelect()
    else if (resultShown() && (k === 'n' || k === 'Enter' || k === ' ')) resultAction(result.cleared && stageIdx + 1 < STAGES.length ? 'next' : 'retry')
  }
})

function draw(t) {
  drawBackground(t)

  if (screen === 'select') {
    useStage(STAGES[cursor], t)
    drawHouse(0)
    drawSelect(t)
    flush()
    return
  }

  useStage(STAGES[stageIdx], t)
  drawHouse(sim.house.getAngle())

  drawLava(sim.lava, t)

  for (const p of sim.people) {
    const { x, y } = p.getPosition()
    const sx = Math.round(CX + x * PPM), sy = Math.round(CY - y * PPM)
    drawPerson(sx, sy + 5, p.look, p.state, p.face, p.climb, t)
    if (p.warn && (Math.floor(t * 8) & 1)) { rect(sx, sy - 17, 2, 5, 8); rect(sx, sy - 10, 2, 2, 8) }
    if (debug && p.intent) line(sx, sy, Math.round(sx + p.intent[0] * PPM), Math.round(sy - p.intent[1] * PPM), 12)
  }

  drawHeli(Math.round(CX + sim.heli.x * PPM), Math.round(CY - sim.heli.y * PPM), t)
  for (const f of sim.fx) drawFx(f, sim.heli)

  if (screen === 'title') {
    drawMenuIcon()
    if (menu) drawMenu()
    else drawTitle(t) // メニューを開いている間は、タイトルの枠を出さない
    flush()
    return
  }

  // 脱出した人数 / 全員、面の番号
  drawPerson(8, 22, 0, 'idle', 1, false, 0)
  text(`${sim.saved}/${sim.total}`, 16, 12, 19)
  text(`STAGE ${stageIdx + 1}`, 16, 24, 21)
  text(`TIME ${fmtTime(sim.over ? (sim.lastSavedAt || sim.overAt) : sim.time)}`, 16, 33, 21)
  if (sim.time < 8 && !sim.over && STAGES[stageIdx].hint) {
    const msg = STAGES[stageIdx].hint
    text(msg, W - 6 - textWidth(msg), 6, 21)
  }
  drawMenuIcon()
  if (audio.failed) text('NO SOUND', 30, H - 10, 8)
  if (resultShown()) drawResult(t)
  if (menu) drawMenu()
  flush()
}

// シミュレーションからの知らせを、音にする
let lastSaved = -10
function playEvents(now) {
  for (const ev of sim.events.splice(0)) {
    if (ev.type === 'jump') audio.se('jump', { rate: 0.92 + Math.random() * 0.2 })
    else if (ev.type === 'slip') audio.se('slip')
    else if (ev.type === 'burn') audio.se('burn')
    else if (ev.type === 'saved') {
      // 続けて助けると、1 つずつ高くなる
      combo = now - lastSaved < 0.8 ? Math.min(combo + 1, 7) : 0
      lastSaved = now
      audio.se('rescue', { rate: Math.pow(2, (combo * 2) / 12) })
    } else if (ev.type === 'over') {
      audio.bgm(false, 0.6)
      const total = sim.total
      const rank = rankOf(sim.saved, total)
      const prevBest = bestOf(stageIdx), prevTime = timeOf(stageIdx)
      const isNew = sim.saved > prevBest
      const wasCleared = isCleared(stageIdx)
      const time = sim.lastSavedAt // 最後に助けた時刻（誰も助けていなければ null）
      // 同じ人数を助けたときに、より速ければ、タイムの新記録
      const isNewTime = !isNew && time !== null && sim.saved === prevBest && (!prevTime || time < prevTime)
      if (isNew) { progress.best[stageIdx] = sim.saved; progress.times[stageIdx] = time || 0; saveProgress() }
      else if (isNewTime) { progress.times[stageIdx] = time; saveProgress() }
      const cleared = sim.saved >= Math.ceil(total * 0.5)
      result = { rank, isNew, isNewTime, time, cleared, firstClear: cleared && !wasCleared }
      audio.se(rank === 'S' || rank === 'A' ? 'win' : rank === 'D' ? 'lose' : 'ok')
    }
  }
}

let prev = performance.now()
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000)
  prev = now
  if (screen === 'play' && !menu) {
    sim.step(dt)
    playEvents(now / 1000)
  }
  draw(now / 1000)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

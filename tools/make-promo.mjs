#!/usr/bin/env node
// 紹介動画（promo/househeart.mp4）を書き出す。ゲームの画面をそのまま 60fps で撮り、BGM と脱出の音を重ねる。ffmpeg が要る
//   node tools/make-promo.mjs
// 流れ：タイトル → 面1（簡単）→ 面選択 → 面8（壁とロープ。傾けて助ける）→ 結果 → 終わりのカード
import { spawn, execFileSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const out = join(root, 'promo')
mkdirSync(out, { recursive: true })

// --- ブラウザの代わり ---
let captured, cb
const handlers = {}
const hook = {}
globalThis.__HH_HOOK = hook
globalThis.window = { innerWidth: 960, innerHeight: 720, addEventListener() {} }
const progress = { best: [4, 6, 7, 6, 8, 12, 18, 15, 16, 15], times: [8.7, 12.4, 16.9, 12.0, 20.1, 22.0, 29.3, 33.2, 30.5, 0], scores: [] }
let stored = JSON.stringify(progress)
globalThis.localStorage = { getItem: () => stored, setItem: (k, v) => { stored = v } }
globalThis.requestAnimationFrame = (f) => { cb = f }
const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: (img) => { captured = img.data } }
globalThis.document = { getElementById: () => ({ getContext: () => ctx, style: {}, addEventListener(t, f) { handlers[t] = f }, getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 240 } }, setPointerCapture() {} }) }
await import(join(root, 'src/main.js'))

// --- 映像：生の RGBA を ffmpeg へ送る（最近傍で 3 倍、左右に余白をつけて 1280x720）---
const STEP_MS = 17                  // 1 コマ 17ms ちょうど（コマの間隔が整数なら、同じ操作は必ず同じ結果になる）
const FPS = 1000 / STEP_MS
const video = join(out, 'video-only.mp4')
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '320x240', '-r', FPS.toFixed(4), '-i', '-',
  '-vf', 'scale=960:720:flags=neighbor,pad=1280:720:160:0:color=0x181425', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', video], { stdio: ['pipe', 'inherit', 'inherit'] })
const done = new Promise((res) => ff.on('close', res))
let now = 1000, nFrames = 0, recording = true
const sounds = [] // { t, name }
async function frame(caption, keep = true) {
  now += STEP_MS
  const f = cb; cb = null; f(now)
  if (!recording || !keep) return
  if (caption) {
    const lines = Array.isArray(caption) ? caption : [caption]
    lines.forEach((line, i) => {
      const w = hook.textWidth(line, 2)
      const x = Math.round((hook.W - w) / 2), y = hook.H - 24 - (lines.length - 1 - i) * 14
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) hook.text(line, x + dx, y + dy, 25, 2) // 縁取り
      hook.text(line, x, y, 11, 2)
    })
    hook.flush()
  }
  if (!ff.stdin.write(Buffer.from(captured.buffer, captured.byteOffset, captured.byteLength))) await new Promise((r) => ff.stdin.once('drain', r))
  nFrames++
}
const seconds = () => nFrames / FPS
async function hold(sec, caption) { for (let i = 0; i < Math.round(sec * FPS); i++) await frame(caption) }

// 1 面分を遊ぶ。plan(t) が傾ける角度（度）、captions は [秒, 文字] の並び（その秒から次まで）
async function play(stageIndex, plan, captions, tail = 2.5, speed = () => 1) {
  hook.startStage(stageIndex)
  const s = hook.sim
  let saved = 0, shown = 0, acc = 0
  while (!(hook.resultShown && shown > tail * FPS)) {
    s.targetAngle = (plan(s.time) * Math.PI) / 180
    const cap = [...captions].reverse().find(([t]) => s.time >= t)
    // 倍速：コマを間引く（結果が出たら等倍）
    acc += hook.resultShown ? 1 : 1 / speed(s.time)
    const keep = acc >= 1
    if (keep) acc -= 1
    await frame(s.over ? null : cap && cap[1], keep)
    if (!recording) { if (hook.resultShown) shown++; continue }
    if (s.saved > saved) { for (let i = saved; i < s.saved; i++) sounds.push({ t: seconds(), name: 'rescue', rate: Math.pow(2, (Math.min(i - saved, 7) * 2) / 12) }); saved = s.saved }
    if (hook.resultShown) { if (shown === 0) sounds.push({ t: seconds(), name: s.saved === s.total ? 'win' : s.saved / s.total >= 0.5 ? 'ok' : 'lose' }); shown++ }
  }
  return { saved: s.saved, total: s.total, time: s.time }
}

// --- 台本 ---
await hold(2)                                                         // タイトル
const r1 = await play(0, (t) => (t >= 1.5 && t < 3.5 ? 25 : t >= 3.5 && t < 5 ? -25 : 0),
  [[0, 'TURN THE HOUSE'], [4, 'PEOPLE WALK ON THEIR OWN']], 1.2, () => 2.2)
hook.showSelect(); await hold(1.4, 'TEN HOUSES. EVERY ONE DIFFERENT.')  // 面選択
// 面 8 の傾け方は、下見（映像なし）でいちばん良いものを選ぶ
const cands = [[30, 2, 9], [30, 4, 11], [18, 4, 11], [60, 1, 8], [30, 3, 10], [25, 2, 9], [35, 2, 9], [30, 2, 8]]
recording = false
let bestPlan = null
for (const [sg, a, b] of cands) {
  const r = await play(7, (t) => (t >= a && t < b ? sg : 0), [], 0)
  console.log('下見', sg, a, b, r)
  if (!bestPlan || r.saved > bestPlan.r.saved || (r.saved === bestPlan.r.saved && r.time < bestPlan.r.time)) bestPlan = { sg, a, b, r }
}
recording = true
const r8 = await play(7, (t) => (t >= bestPlan.a && t < bestPlan.b ? bestPlan.sg : 0),
  [[0, 'LAVA IS RISING'], [2, 'TILT TO CLIMB THE WALLS'], [10, 'MIND THE ROPE!'], [18, 'SAVE EVERYONE']], 1.8,
  (t) => (t < 2 ? 3 : t < 9 ? 2 : 2.6))
hook.showTitle(); await hold(3.5, ['PLAY FREE IN YOUR BROWSER', 'NAGA3.GITHUB.IO/HOUSEHEART'])   // 終わりのカード
console.log('面1', r1, '面8', r8)
ff.stdin.end()
await done

// --- 音：BGM（繰り返し）と脱出の音を、1 本の WAV に混ぜる ---
const RATE = 48000
const readWav = (name) => { const b = readFileSync(join(root, 'public/audio', name + '.wav')); return new Int16Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length - ((b.length - 44) & 1))) }
const total = Math.ceil(seconds() * RATE)
const mix = new Float32Array(total)
const bgm = readWav('bgm')
for (let i = 0; i < total; i++) mix[i] += (bgm[i % bgm.length] / 32768) * 0.5
const GAIN = { rescue: 0.25, win: 0.35, ok: 0.35, lose: 0.35 }
for (const s of sounds) {
  const w = readWav(s.name), start = Math.round(s.t * RATE)
  for (let i = 0; i < w.length / s.rate; i++) {
    const j = start + i
    if (j >= total) break
    mix[j] += (w[Math.floor(i * s.rate)] / 32768) * GAIN[s.name]
  }
}
// 終わりに 1 秒でフェードアウト
for (let i = 0; i < RATE; i++) mix[total - 1 - i] *= i / RATE
let peak = 0
for (const v of mix) peak = Math.max(peak, Math.abs(v))
const norm = peak ? 0.8 / peak : 1 // 動画サイトで小さく聞こえないよう、最大を 0.8 にそろえる
const pcm = Int16Array.from(mix.map((v) => v * norm), (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767))))
const h = Buffer.alloc(44)
h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12)
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28)
h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length * 2, 40)
writeFileSync(join(out, 'audio.wav'), Buffer.concat([h, Buffer.from(pcm.buffer)]))
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', join(out, 'audio.wav'), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', join(out, 'househeart.mp4')])
console.log(`promo/househeart.mp4  ${seconds().toFixed(1)} 秒`)

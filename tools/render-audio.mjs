#!/usr/bin/env node
// 効果音と BGM を、PX-13h の音源（ブラウザの Studio と同じ engine.wasm）で鳴らして public/audio/*.ogg（と、ogg が使えない端末用の *.wav）に書き出す。
//   node tools/render-audio.mjs            全部
//   node tools/render-audio.mjs bgm jump   指定したものだけ
// PX-13h の場所は環境変数 PX13H（既定は ../px13h）。ffmpeg が要る
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { ENVELOPES, SE, BGM, SONGS } from './sounds.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const px = resolve(process.env.PX13H || join(here, '../../px13h'))
const { Engine } = await import(join(px, 'tools/studio/web/engine.js'))
const { parseMML, initialState } = await import(join(px, 'tools/studio/web/mml.js'))
const wasm = readFileSync(join(px, 'tools/studio/web/engine.wasm'))
const out = join(here, '../public/audio')
mkdirSync(out, { recursive: true })
const RATE = 48000

async function render(tracks, { loop = false, seconds = 0 } = {}) {
  const e = await Engine.load(wasm)
  e.setSong({ mode: 0, tracks, envelopes: ENVELOPES })
  e.play()
  const chunks = []
  let n = 0
  const limit = (seconds || 60) * RATE
  while (n < limit && (loop || e.playing())) {
    chunks.push(Int16Array.from(e.render(800)))
    n += 800
  }
  const all = new Int16Array(n)
  let o = 0
  for (const c of chunks) { all.set(c, o); o += c.length }
  return all
}

function trimSilence(s) {
  let end = s.length
  while (end > 0 && Math.abs(s[end - 1]) < 60) end--
  return s.slice(0, Math.min(s.length, end + 480))
}
function normalize(s, peak) {
  let p = 0
  for (const v of s) p = Math.max(p, Math.abs(v))
  const g = p ? (peak * 32767) / p : 1
  return Int16Array.from(s, (v) => Math.round(v * g))
}
function writeOgg(name, s) {
  const data = Buffer.from(s.buffer, s.byteOffset, s.byteLength)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  const wav = `/tmp/lava-house-${name}.wav`
  writeFileSync(wav, Buffer.concat([h, data]))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '4', join(out, `${name}.ogg`)])
  copyFileSync(wav, join(out, `${name}.wav`)) // ogg を再生できない端末（古い Safari など）用
  console.log(`${name}.ogg / .wav  ${(s.length / RATE).toFixed(2)} 秒`)
}

// BGM の小節の長さが全パートでそろっているか確かめる（全音符 = 1）
function checkBgm(BGM = BGMDEF) {
  let ok = true
  BGM.perBar.forEach((bars, p) => {
    let st = initialState(p, p === 3)
    bars.forEach((b, i) => {
      const r = parseMML(b, st)
      st = r.state
      if (Math.abs(r.length - 1) > 1e-6 || r.errors.length) {
        ok = false
        console.error(`パート ${p} の ${i + 1} 小節目: 長さ ${r.length}${r.errors.length ? ' ' + r.errors.join(' ') : ''}  ${b}`)
      }
    })
  })
  if (!ok) process.exit(1)
}

// 繰り返しの 1 周分を取り出す。2 周目を切り出すので、1 周目の余韻が頭に重なって、つなぎ目が自然になる
async function renderLoop(BGM = BGMDEF) {
  const once = await render(BGM.tracks.map((t) => t.replace(/^L /, '')))   // 長さをはかる（L なし）
  const t = (BGM.bars * 4 * 60) / (BGM.tempo || 160)
  const period = Math.round(t * RATE)
  const two = await render(BGM.tracks, { loop: true, seconds: (period * 2 + 2400) / RATE })
  console.log(`1 周: 計算上 ${t.toFixed(3)} 秒、L なしで鳴らした長さ ${(once.length / RATE).toFixed(3)} 秒`)
  return two.slice(period, period * 2)
}

const BGMDEF = BGM
const want = process.argv.slice(2)
const all = want.length === 0
if (all || want.includes('bgm')) {
  checkBgm()
  const loop = normalize(await renderLoop(), BGM.peak)
  writeOgg('bgm', loop)
}
for (const [name, def] of Object.entries(SONGS)) {
  if (!want.includes(name) && !want.includes('songs')) continue
  checkBgm(def)
  writeOgg(name, normalize(await renderLoop(def), def.peak))
}
for (const [name, def] of Object.entries(SE)) {
  if (!all && !want.includes(name)) continue
  const s = trimSilence(await render(def.tracks))
  writeOgg(name, normalize(s, def.peak))
}

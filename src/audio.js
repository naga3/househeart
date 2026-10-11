// 効果音と BGM の再生。tools/render-audio.mjs で書き出した ogg / wav（PX-13h の音源で鳴らしたもの）を、AudioBuffer で鳴らすだけ
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
const NAMES = ['bgm', 'rescue', 'burn', 'jump', 'slip', 'win', 'ok', 'lose']
const GAIN = { bgm: 0.5, rescue: 0.25, burn: 0.3, jump: 0.3, slip: 0.28, win: 0.35, ok: 0.35, lose: 0.35 }
const MUTE_KEY = 'lava-house-muted'
// ogg を再生できる端末は ogg、できなければ wav（古い Safari など）
const EXT = typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'wav'

export function createAudio() {
  let ctx = null, master = null, bgm = null
  let ready = false, wantBgm = false
  const buffers = {}
  let muted = false
  try { muted = localStorage.getItem(MUTE_KEY) === '1' } catch { /* 保存できなくてもよい */ }
  let failed = ''
  let active = 0 // 鳴っている効果音の数
  let lastJump = 0

  async function load(name) {
    const res = await fetch(`${BASE}audio/${name}.${EXT}`)
    buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer())
  }

  // 最初の操作（クリックなど）の後でないと音が出ない（ブラウザの決まり）。
  // 触れた瞬間（pointerdown）は操作に数えられないので、離したときにも呼ばれる。止まっていたら、そのたびに再開する
  function unlock() {
    if (typeof AudioContext === 'undefined') return
    if (!ctx) {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.gain.value = muted ? 0 : 1
      master.connect(ctx.destination)
      Promise.all(NAMES.map(load)).then(() => {
        ready = true
        if (wantBgm) startBgm()
      }).catch((e) => {
        failed = String(e && e.message || e)
        console.error('音を読めなかった', e)
      })
      document.addEventListener('visibilitychange', () => {
        if (!ctx) return
        if (document.hidden) ctx.suspend()
        else ctx.resume()
      })
    }
    if (ctx.state !== 'running') {
      ctx.resume().catch((e) => { failed = 'RESUME ' + String(e && e.message || e) })
      // 無音の短い音を鳴らして、鳴らす許可を確実にする（スマホの定番の手順）
      const src = ctx.createBufferSource()
      src.buffer = ctx.createBuffer(1, 1, 22050)
      src.connect(ctx.destination)
      src.start(0)
    }
  }

  function startBgm() {
    stopBgm(0)
    const src = ctx.createBufferSource()
    src.buffer = buffers.bgm
    src.loop = true
    const g = ctx.createGain()
    g.gain.value = 0
    g.gain.setTargetAtTime(GAIN.bgm, ctx.currentTime, 0.08)
    src.connect(g).connect(master)
    src.start()
    bgm = { src, g }
  }

  function stopBgm(fade = 0.5) {
    if (!bgm) return
    const { src, g } = bgm
    bgm = null
    g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3)
    src.stop(ctx.currentTime + fade + 0.1)
  }

  return {
    unlock,
    get unlocked() { return !!ctx },
    get muted() { return muted },
    get failed() { return failed }, // 読み込みに失敗したときの理由（画面に出す）
    // BGM を頭から鳴らす / 止める
    bgm(on, fade) {
      wantBgm = on
      if (!ctx || !ready) return
      if (on) startBgm()
      else stopBgm(fade)
    },
    se(name, { rate = 1, vol = 1 } = {}) {
      if (!ready || muted || !buffers[name] || active >= 8) return
      if (name === 'jump') {
        const now = ctx.currentTime
        if (now - lastJump < 0.1) return
        lastJump = now
      }
      const src = ctx.createBufferSource()
      src.buffer = buffers[name]
      src.playbackRate.value = rate
      const g = ctx.createGain()
      g.gain.value = GAIN[name] * vol
      src.connect(g).connect(master)
      active++
      src.onended = () => { active-- }
      src.start()
    },
    toggleMute() {
      muted = !muted
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* 同上 */ }
      if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02)
      return muted
    },
  }
}

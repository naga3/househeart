// 効果音と BGM の定義（PX-13h の MML）。tools/render-audio.mjs が、PX-13h の音源で鳴らして public/audio/*.ogg に書き出す。
// 実行時のゲームは書き出した ogg を再生するだけ。曲の好みは ~/src/etc/px13h/docs/taste.md

// 音量などの動き（エンベロープ）。0〜26 は PX-13h の jukebox と同じ。27 から後ろはこのゲーム用
// 0 メロディ、1 ハモり、2 ハイハット、3 スネア、4 キック、7 短く切る、8 しゃくり上げ（@p）、10 すばやく下がる（@p）、
// 21 シンバル、23 デチューン 1/8 半音（@p）、24 しゃくり上げ + デチューン（@p）
export const ENVELOPES = [
  '15 14 13 12 12 11 11 10 | 10 / 8 6 5 4 3 2 1 1 0', '12 12 11 10 | 10 / 8 6 4 2 1 0', '12 8 5 3 1 0',
  '15 12 10 8 6 5 4 3 2 1 0', '15 11 7 4 2 0', '15 11 8 6 5 4 3 2 1 1 0',
  '15 15 14 14 13 13 12 12 11 11 10 10 9 9 8 8 7 7 6 6 6 5 5 5 4 4 4 3 3 3 2 2 2 1 1 1 1 0',
  '13 10 7 4 2 1 0',
  '-10 -6 -3 -1 0', '0 | 0 / 0 -2 -5 -9 -14 -20 -28 -38 -50 -64', '0 -40 -80 -120 -160 -200',
  '2 2 2 1 | 1', '1 1 1 1 1 1 1 1 0 | 0', '| 0 4 7', '| 0 3 7', '| 0 12', '| 0 7 12',
  '15 15 13 12 11 10 10 9 | 9 / 7 5 3 2 1 0', '4 6 8 10 11 12 13 14 | 14 / 11 8 5 3 1 0', '0',
  '16 8 0', '14 13 12 11 10 10 9 9 8 8 7 7 6 6 5 5 5 4 4 4 3 3 3 2 2 2 1 1 1 0',
  '', '1', '-9 -5 -2 0 1', '2', '-8 -4 -1 1 2',
  '0 6 12 18 24 30 36 | 36', // 27 ジャンプ：すばやく上へ
  '0 -8 -16 -24 -32 -40 -48 -56 -64 | -64', // 28 手を離す：下へ滑る
  '0 16 32 48 64 80 72 62 52 46 44 48 56 64 72', // 29 ジャンプ「ぴよーん」：上がって、少し下がって、また上がる（1/8 半音単位）
  '13 13 13 13 13 12 12 12 11 11 | 10 / 8 6 4 2 0', // 30 ジャンプの音量
]

// 効果音：[矩形波1, 矩形波2, 三角波, ノイズ]。peak は書き出すときの音の大きさ（0〜1）
export const SE = {
  rescue: { peak: 0.7, tracks: [
    't210 @1 v13 @v1 q8 o5 c16 e16 g16 >c8', '@2 v9 @v1 q8 o5 r16 c16 e16 g16 >c16', '', '',
  ] },
  burn: { peak: 0.7, tracks: [
    '', '', 'q8 @p10 o3 c4', 't200 @0 @v6 v13 o6 c8 o5 a8 f8 d8 <b8',
  ] },
  jump: { peak: 0.45, tracks: ['t240 @2 v12 @v30 q8 @p29 o4 c4', '', '', ''] },
  slip: { peak: 0.55, tracks: ['t200 @2 v12 @v1 q8 @p28 o5 g8', '', '', '@v2 v9 o5 f16'] },
  win: { peak: 0.75, tracks: [
    't170 @1 v13 @v0 q7 o5 c8 e8 g8 >c4 <g8 >c2',
    '@1 v10 @v0 q7 o4 e8 g8 >c8 e4 c8 e2',
    'q6 o3 c8 c8 c8 c4 c8 c2', '',
  ] },
  ok: { peak: 0.7, tracks: [
    't150 @1 v13 @v0 q7 o5 e8 g8 e8 c4 e4',
    '@1 v10 @v0 q7 o4 c8 e8 c8 <g4 g4',
    'q6 o3 c4 c4 g4', '',
  ] },
  lose: { peak: 0.7, tracks: [
    't110 @2 v12 @v1 q8 o4 e4 d4 c4 <b2',
    '@1 v8 @v1 q8 o4 c4 <b4 a4 g+2',
    'q8 o2 a4 g4 f4 e2', '',
  ] },
}

// BGM：A の 1 周目（薄く）→ A の 2 周目（エコー、スネア）→ B（1 小節ずつ高く、ドラムが増える）→ サビ（デチューン、シンバル）。
// イ短調、テンポ 160、（旧 BGM_OLD）。末尾から頭へつなげて繰り返す。各小節は 1 小節ちょうど
const D_thin = 'l8 @v4 o4 g @v2 o5 f f f @v4 o4 g @v2 o5 f f f'
const D_rock1 = 'l8 @v4 o4 g @v2 o5 f @v3 c+ @v2 f @v4 o4 g g @v3 o5 c+ @v2 f'
const D_rock2 = 'l8 @v4 o4 g @v2 o5 f @v3 c+ @v2 f @v4 o4 g @v2 o5 f @v3 c+ @v4 o4 g'
const D_fill = 'l16 @v3 o5 c+ c+ c+ c+ c+ c+ c+ c+ c+ c+ c+ c+ c+ c+ c+ c+'
const D_cym = 'l8 @v21 o5 c @v2 f @v3 c+ @v2 f @v4 o4 g g @v3 o5 c+ @v2 f'
const D_end = 'l8 @v21 o5 c r r r r r r r'

// 三角波のベース：根音を 8 分でオクターブ往復。2 つの根音を半小節ずつ（a/e）にもできる
const bass = (r1, r2 = r1) => `o2 l8 ${r1} >${r1} <${r1} >${r1} <${r2} >${r2} <${r2} >${r2}`

const sq1 = [
  // A 1 周目
  'v10 @p8 o4 a2 @p >c4 e4', '@p8 f2 @p e4 c4', '< @p8 b2 @p g+4 b4', '@p8 a1 @p',
  // A 2 周目（シンコペーション）
  'v12 o4 r8 a8 >c4 e8 e8 a4', 'o5 r8 c8 f4. e8 c4', 'o4 r8 b8 >e4. d8 <b4', 'o4 @p8 g+2 @p b4 >e4',
  // B（1 小節ずつ高く）
  'v13 o4 e4 a4 >c4 e4', '<f4 a4 >d4 f4', '<g4 >c4 e4 g4', '<b4 >e4 g+4 b4',
  // サビ（倚音で泣いて、1 つ下へ解決）
  'o5 b4 a4 @p8 e2 @p', 'a4 g4 e2', 'g4 f4 @p8 c2 @p', 'f4 e4 c2',
  'a4 g4 @p8 d2 @p', 'a4 e4 g+4 b4', 'a4 g4 g+4 e4', '@p8 a1 @p',
]
const sq2 = [
  'r1', 'r1', 'r1', 'r1',
  // A 2 周目：8 分遅れのエコー（V5）
  'V5 o4 r8 r8 a8 >c4 e8 e8 a8', 'o5 r8 r8 c8 f4. e8 c8', 'o4 r8 r8 b8 >e4. d8 <b8', 'o4 r8 g+2 b4 >e8',
  // B（エコー）
  'o4 r8 e4 a4 >c4 e8', 'o4 r8 f4 a4 >d4 f8', 'o4 r8 g4 >c4 e4 g8', 'o4 r8 b4 >e4 g+4 b8',
  // サビ：同じメロディを 1/8 半音ずらして重ねる（デチューン）
  'V12 @p23 o5 b4 a4 @p24 e2 @p23', 'a4 g4 e2', 'g4 f4 @p24 c2 @p23', 'f4 e4 c2',
  'a4 g4 @p24 d2 @p23', 'a4 e4 g+4 b4', 'a4 g4 g+4 e4', '@p24 a1 @p23',
]
const tri = [
  bass('a'), bass('f'), bass('e'), bass('a'),
  bass('a'), bass('f'), bass('e'), bass('e'),
  bass('a'), bass('d'), bass('c'), bass('e'),
  bass('a'), bass('e'), bass('f'), bass('c'),
  bass('g'), bass('a', 'e'), bass('f', 'e'), bass('a'),
]
const noi = [
  'v7 ' + D_thin, D_thin, D_thin, D_thin,
  'v9 ' + D_rock1, D_rock1, D_rock1, D_fill,
  'v11 ' + D_rock1, D_rock2, D_rock1, D_fill,
  'v12 ' + D_cym, D_rock1, D_rock2, D_rock1,
  D_cym, D_rock2, D_rock1, D_end,
]
export const BGM_OLD = {
  bars: 20,
  tracks: [
    'L t160 @1 v13 @v0 q7 ~10,8,20 ' + sq1.join(' '),
    'L @1 v10 @v0 q7 ' + sq2.join(' '),
    'L q6 ' + tri.join(' '),
    'L ' + noi.join(' '),
  ],
  // 小節ごとの MML（長さの確認用）
  perBar: [sq1, sq2, tri, noi],
  peak: 0.5,
}

// ---- 候補の 3 曲（public/audio/bgm-*.ogg。まだゲームでは鳴らさない。聴き比べて選ぶ）----
// 各小節は 1 小節ちょうど。音の高さは毎小節 o で指定し直す（途中で切り出しても崩れない）
const D_hat = 'l8 @v2 o5 f f f f f f f f'
const D_hatk = 'l8 @v4 o4 g @v2 o5 f f f @v4 o4 g @v2 o5 f f f'
const D_snr = 'l8 @v4 o4 g @v2 o5 f @v3 c+ @v2 f @v4 o4 g @v2 o5 f @v3 c+ @v2 f'
const D_drive = 'l8 @v4 o4 g @v2 o5 f @v3 c+ @v4 o4 g @v4 g @v2 o5 f @v3 c+ @v2 f'
const D_run = 'l16 @v4 o4 g @v2 o5 f @v2 f @v2 f @v3 c+ @v2 f @v2 f @v2 f @v4 o4 g @v2 o5 f @v4 o4 g @v2 o5 f @v3 c+ @v2 f @v3 c+ @v3 c+'
const D_cym1 = 'l8 @v21 o5 c @v2 f @v3 c+ @v2 f @v4 o4 g @v2 o5 f @v3 c+ @v2 f'

// 1 つ目の矩形波の音を、8 分遅れの小さなエコーにする（小節の最後の音を 8 分ぶん短くする）
const shorten = { 4: '8', 2: '4.', '4.': '4' }
const echoBar = (bar) => {
  const m = [...bar.matchAll(/\b([a-g][+-]?)(4\.|4|2)(?![0-9.])/g)].pop()
  if (!m) throw new Error('エコーにできない小節: ' + bar)
  const cut = bar.slice(0, m.index) + m[1] + shorten[m[2]] + bar.slice(m.index + m[0].length)
  return 'r8 ' + cut
}
const mkSong = ({ tempo, bars, mel, mel2, tri, noi, peak = 0.5, vel = 13 }) => ({
  bars, tempo,
  tracks: [
    `L t${tempo} @1 v${vel} @v0 q7 ~10,8,20 ` + mel.join(' '),
    'L @1 v10 @v0 q7 ' + mel2.join(' '),
    'L q6 ' + tri.join(' '),
    'L ' + noi.join(' '),
  ],
  perBar: [mel, mel2, tri, noi],
  peak,
})

// 1. 神秘（ニ短調のドリア。テンポ 100、16 小節）：長い音をしゃくり上げて、エコーとデチューンで広げる。ドラムは 8 分のハイハットだけ
{
  const mel = [
    'v10 o4 @p8 a2 @p o5 d4 f4', 'o5 @p8 e2 @p d4 c4', 'o4 @p8 a2 @p o5 c4 d4', 'o5 @p8 e2. @p g4',
    'o5 @p8 f2 @p e4 d4', 'o5 @p8 d2 @p f4 g4', 'o5 @p8 g2 @p f4 d4', 'o5 @p8 e2 @p c+4 e4',
    'v12 o5 d4 f4 a4 o6 d4', 'o5 f4 a4 o6 d4 f4', 'o5 a4 o6 c4 e4 d4', 'o6 c4 e4 g4 e4',
    'o6 d4. c8 o5 a2', 'o5 f4. a8 o6 d2', 'o5 g4. a+8 o6 d2', 'o6 @p8 c+2 @p o5 e4 a4',
  ]
  const det = (bar) => bar.replace(/@p8/g, '@p24').replace(/@p(?![0-9])/g, '@p23')
  const mel2 = [
    'r1', 'r1', 'r1', 'r1',
    ...mel.slice(4, 8).map((b) => 'V5 ' + echoBar(b)),
    ...mel.slice(8).map((b) => 'V12 @p23 ' + det(b)),
  ]
  const tri = ['d', 'b-', 'f', 'c', 'd', 'b-', 'g', 'a', 'd', 'b-', 'f', 'c', 'd', 'b-', 'g', 'a'].map((r) => `o2 q6 ${r}1`)
  const noi = ['r1', 'r1', 'r1', 'r1', ...Array(4).fill('v6 ' + D_hat), ...Array(7).fill('v8 ' + D_hatk), 'v8 ' + D_snr]
  var MYSTIC = mkSong({ tempo: 100, bars: 16, mel, mel2, tri, noi, peak: 0.5, vel: 12 })
}

// 2. 明るい（ハ長調。テンポ 140、24 小節）：C G Am F。A → B → A（エコー）→ B（エコー、ドラム増）→ サビ（デチューン）。シンコペーションで弾ませる
{
  const mel0 = [
    'v11 o5 e4 g4 e4 c4', 'o5 d4 g4 b4 g4', 'o5 c4 e4 a2', 'o5 a4 f4 c4 f4',
    'o5 r8 e8 g4 e8 g8 >c4', 'o5 r8 d8 g4 b4 >d4', 'o5 r8 c8 e4 a4 g4', 'o5 f4 a4 >c2',
    'v13 o5 e4. g8 a4 g4', 'o5 g4. f8 d4 g4', 'o5 e4. d8 c4 e4', 'o5 f4 a4 g4 f4',
    'o5 e4. g8 >c4 <g4', 'o5 g4 b4 a4 g4', 'o5 a4 f4 d4 g4', 'o5 @p8 e1 @p',
  ]
  const A = mel0.slice(0, 4), B = mel0.slice(4, 8), C = mel0.slice(8)
  const mel = [...A, ...B, ...A, ...B, ...C]
  const det = (bar) => bar.replace(/@p8/g, '@p24').replace(/@p(?![0-9])/g, '@p23')
  const mel2 = [
    'r1', 'r1', 'r1', 'r1',
    ...B.map((b) => 'V5 ' + echoBar(b)), ...A.map((b) => 'V5 ' + echoBar(b)), ...B.map((b) => 'V5 ' + echoBar(b)),
    ...C.map((b) => 'V11 @p23 ' + det(b)),
  ]
  const b = (r1, r2 = r1) => `o2 l8 ${r1} >${r1} <${r1} >${r1} <${r2} >${r2} <${r2} >${r2}`
  const tri0 = [b('c'), b('g'), b('a'), b('f'), b('c'), b('g'), b('a'), b('f'), b('c'), b('g'), b('a'), b('f'), b('c'), b('g'), b('f', 'g'), b('c')]
  const tri = [...tri0.slice(0, 8), ...tri0.slice(0, 8), ...tri0.slice(8)]
  const noi = [
    ...Array(4).fill('v7 ' + D_hatk), ...Array(3).fill('v9 ' + D_snr), 'v9 ' + D_run,
    ...Array(4).fill('v9 ' + D_snr), ...Array(3).fill('v10 ' + D_snr), 'v10 ' + D_run,
    'v12 ' + D_cym1, ...Array(6).fill('v11 ' + D_snr), 'v11 ' + D_run,
  ]
  var BRIGHT = mkSong({ tempo: 140, bars: 24, mel, mel2, tri, noi, peak: 0.5 })
}

// 3. 疾走感（イ短調。テンポ 176、16 小節）：Am F C G を 4 周。16 分の駆け上がりと、休みなく進む 8 分のベース
{
  const mel = [
    'v12 o5 a8 a8 >c8 e8 a4 e8 c8', 'o5 f8 f8 a8 >c8 f4 c8 <a8', 'o5 g8 g8 >c8 e8 g4 e8 c8', 'o5 g8 g8 b8 >d8 g4 d8 <b8',
    'o5 a8 a8 >c8 e8 a4 g8 e8', 'o5 f8 a8 >c8 f8 a4 g8 f8', 'o5 e8 g8 >c8 e8 g4 e8 c8', 'o5 d8 g8 b8 >d8 g2',
    'v13 o6 e4 a4 g8 e8 c8 e8', 'o5 a8 >c8 f8 a8 >c4 a8 f8', 'o6 e8 g8 e8 c8 g4 e8 c8', 'o5 b8 >d8 g8 b8 >d8 b8 g8 d8',
    'o6 a8 g8 e8 c8 a8 g8 e8 c8', 'o6 f8 e8 c8 <a8 >f8 e8 c8 <a8', 'o6 e8 g8 e8 g8 c8 e8 c8 e8', 'o6 d8 b8 g8 d8 <b2',
  ]
  const det = (bar) => bar
  const mel2 = [
    'r1', 'r1', 'r1', 'r1',
    ...mel.slice(4, 8).map((b) => 'V5 ' + echoBar(b)),
    ...mel.slice(8).map((b) => 'V11 @p23 ' + det(b)),
  ]
  const b = (r) => `o2 l8 ${r} ${r} >${r} ${r} <${r} ${r} >${r} ${r}`
  const tri = [b('a'), b('f'), b('c'), b('g'), b('a'), b('f'), b('c'), b('g'), b('a'), b('f'), b('c'), b('g'), b('a'), b('f'), b('c'), b('g')]
  const noi = [
    ...Array(3).fill('v8 ' + D_drive), 'v8 ' + D_run, ...Array(3).fill('v10 ' + D_drive), 'v10 ' + D_run,
    'v12 ' + D_cym1, ...Array(2).fill('v12 ' + D_drive), 'v12 ' + D_run, ...Array(3).fill('v12 ' + D_drive), 'v12 ' + D_run,
  ]
  var RUSH = mkSong({ tempo: 176, bars: 16, mel, mel2, tri, noi, peak: 0.5 })
}
export const BGM = BRIGHT // ゲームの BGM は「明るい」（旧 BGM_OLD は不採用）
export const SONGS = { 'bgm-mystic': MYSTIC, 'bgm-rush': RUSH }

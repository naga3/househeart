// 面の定義。短い書き方で間取りを書いて、buildStage が家の部品（壁、はしご、家具、人の初期位置）を作る。
//
// 家の大きさは面ごとに違う。幅 width と、各階の高さ stories（床の上から天井まで）で決まる。家の中心が原点。
//   width    : 家の幅 m
//   stories  : 各階の高さ m（下から）。家全体の高さは、階の高さの合計 + 床や屋根の厚み
//   floors   : 階と階の間の床。[{ gaps: [[x0, x1], ...] }, ...]（階の数 - 1 個）。穴（はしごを通す所）を空ける
//   dividers : 仕切りの壁。{ x, level, h } 高さ h（1.8m ならジャンプでは越えられない。家を傾けて越える。天井が低い家は 1.2m）
//   ladders  : はしご。{ from, to, x } to は階の番号か 'exit'（屋根の出口）。床の穴のふちから 0.35m に置く
//   furniture: 家具（動かない）。{ type, x0, x1, level, h } h が 0.85m 以下ならジャンプで越えられる
//   ramps    : 坂。{ level, x0, x1, h, up } 床の上に置く三角の坂（x0〜x1 の底、高い側 up: 'right' | 'left' で高さ h）。
//              角度は atan(h / 底の長さ)。45°までは歩いて上れて、60°を超えると上れない。家を傾けると、上れたり上れなかったりする
//   ropes    : ロープ。{ level, x0, x1 } 床の穴や溝の上に横に張る。人はぶら下がって渡る。家を速く回す（角速度が大きい）と手が離れて落ちる
//   belts    : 動く床（ベルトコンベア）。{ level, x0, x1, speed } 床の上を speed m/s（右が +）で押す。逆らうと遅くなる
//   people   : 人の初期位置。{ level, xs, dy } は床から dy（既定 0.5）上から、{ y, xs } は高さを指定（家具の上など）
//   lava     : [上がる速さ m/s, 加速]
//   exitX    : 出口の横の位置（既定 0）
//   mirror   : true なら左右を入れ替える（傾ける向きが逆になる）
// 階の番号 level は 0 が 1 階。x は家の中心から（右が +）。

const T = 0.3 // 床と壁の厚み
export const EXIT_W = 2.4 // 出口の幅

// 見た目の違い（壁紙の色）。面ごとに順に使う
export const THEMES = [
  { base: 24, stripe: 23, dot: 22 }, // 紺
  { base: 15, stripe: 14, dot: 13 }, // 深緑
  { base: 27, stripe: 6, dot: 28 }, // 紫
  { base: 23, stripe: 24, dot: 21 }, // 青灰
  { base: 6, stripe: 5, dot: 4 }, // 茶
]

export function buildStage(def, index) {
  const mir = !!def.mirror
  const mx = (x) => (mir ? -x : x)
  const mrange = ([a, b]) => (mir ? [-b, -a] : [a, b])
  const stories = def.stories
  const n = stories.length
  const width = def.width
  const h = stories.reduce((a, b) => a + b, 0) + (n + 1) * T
  const hw = width / 2, hh = h / 2
  const roofY = hh - T / 2 // 屋根の中心の高さ
  // 各階の床の上面
  const tops = [-hh + T]
  for (let i = 0; i < n - 1; i++) tops.push(tops[i] + stories[i] + T)
  const exitX = mx(def.exitX || 0)

  const walls = [
    [-hw, 0, T, h],
    [hw, 0, T, h],
    [0, -hh + T / 2, width, T],
  ]
  // 屋根：出口の穴をあける
  const g0 = exitX - EXIT_W / 2, g1 = exitX + EXIT_W / 2
  if (g0 + hw > 0.05) walls.push([(-hw + g0) / 2, roofY, g0 + hw, T])
  if (hw - g1 > 0.05) walls.push([(g1 + hw) / 2, roofY, hw - g1, T])
  // 階の間の床：穴をよけて並べる
  for (let i = 0; i < n - 1; i++) {
    const y = tops[i] + stories[i] + T / 2
    const gaps = ((def.floors && def.floors[i] && def.floors[i].gaps) || []).map(mrange).sort((a, b) => a[0] - b[0])
    let x = -hw
    for (const [a, b] of gaps) {
      if (a > x) walls.push([(x + a) / 2, y, a - x, T])
      x = b
    }
    if (x < hw) walls.push([(x + hw) / 2, y, hw - x, T])
  }
  // 仕切り
  for (const d of def.dividers || []) {
    walls.push([mx(d.x), tops[d.level] + (d.h - 0.05) / 2, T, d.h + 0.05]) // 床に 0.05 だけ食い込ませる
  }

  const ladders = (def.ladders || []).map((l) => ({
    x: l.to === 'exit' ? exitX : mx(l.x),
    y0: tops[l.from],
    y1: l.to === 'exit' ? roofY + 0.9 : tops[l.to] + 0.7,
  }))

  const furniture = (def.furniture || []).map((f) => {
    const [x0, x1] = mrange([f.x0, f.x1])
    return { type: f.type, x0, x1, floor: tops[f.level], h: f.h }
  })

  const ramps = (def.ramps || []).map((r) => {
    const [x0, x1] = mrange([r.x0, r.x1])
    const up = mir ? (r.up === 'right' ? 'left' : 'right') : r.up
    const top = tops[r.level]
    const pts = up === 'right'
      ? [[x0, top - 0.05], [x1, top - 0.05], [x1, top + r.h]]
      : [[x0, top - 0.05], [x1, top - 0.05], [x0, top + r.h]]
    return { pts, x0, x1, up, h: r.h, top, angle: (Math.atan2(r.h, x1 - x0) * 180) / Math.PI }
  })
  const ropes = (def.ropes || []).map((r) => {
    const [x0, x1] = mrange([r.x0, r.x1])
    const top = tops[r.level]
    return { x0, x1, top, y: top + 0.9, yHang: top + 0.35 } // ぶら下がると、足場の上に立っているのと同じ高さになる
  })
  const belts = (def.belts || []).map((b) => {
    const [x0, x1] = mrange([b.x0, b.x1])
    return { x0, x1, floor: tops[b.level], speed: mir ? -b.speed : b.speed }
  })

  const spawns = []
  for (const g of def.people || []) {
    const y = g.y !== undefined ? g.y : tops[g.level] + (g.dy ?? 0.5)
    for (const x of g.xs) spawns.push([mx(x), y])
  }

  return {
    index,
    name: def.name,
    hint: def.hint || '',
    width, hw, hh, h,
    walls,
    ladders,
    furniture,
    ramps,
    ropes,
    belts,
    spawns,
    exitX,
    dividers: (def.dividers || []).map((d) => ({ x: mx(d.x), level: d.level, h: d.h })),
    lava: { speed: def.lava[0], accel: def.lava[1] },
    lavaStart: tops[0] - 5.15, // 1 階の床の 5.15m 下から上がってくる
    roofY,
    exitJudgeY: roofY + 0.6, // これより上へ出た人は、出口を出たことにする
    heliY: roofY + 1.5, // ヘリが待つ高さ（家の中心から見て）
    srcY: roofY + 1.0, // 道筋の目的地（出口の外）
    tops,
    clear: stories,
    theme: THEMES[index % THEMES.length],
    total: spawns.length,
  }
}

// --- 面の一覧 ---
// 家具の書き方を短く
const F = (type, x0, x1, level, h) => ({ type, x0, x1, level, h })

// 3 階建て・4 階建ての標準
const ST3 = [3.1, 3.1, 3.0]
const G3 = [{ gaps: [[-6, -3]] }, { gaps: [[3, 6]] }]
const LAD3 = [{ from: 0, to: 1, x: -3.35 }, { from: 1, to: 2, x: 3.35 }, { from: 2, to: 'exit', x: 0 }]
const FURN3 = [
  F('wardrobe', -5.75, -4.85, 0, 1.7), F('bed', -2.2, -0.3, 0, 0.55), F('chest', 2.3, 3.3, 0, 0.7), F('wardrobe', 4.95, 5.8, 0, 1.7),
  F('sofa', -1.9, -0.2, 1, 0.75), F('chest', 1.2, 2.0, 1, 0.6), F('wardrobe', 4.95, 5.8, 1, 2.0),
  F('bed', -5.3, -3.4, 2, 0.55), F('wardrobe', -2.4, -1.5, 2, 1.8), F('dresser', 1.1, 1.9, 2, 0.7),
]
const ST4 = [2.2, 2.2, 2.2, 2.2]
const G4 = [{ gaps: [[-6, -3]] }, { gaps: [[3, 6]] }, { gaps: [[-6, -3]] }]
const LAD4 = [
  { from: 0, to: 1, x: -3.35 }, { from: 1, to: 2, x: 3.35 }, { from: 2, to: 3, x: -3.35 }, { from: 3, to: 'exit', x: 3 },
]
const FURN4 = [
  F('bed', -2.4, -0.5, 0, 0.55), F('chest', 2.0, 3.0, 0, 0.7), F('wardrobe', 4.95, 5.8, 0, 1.7), F('wardrobe', -5.75, -4.85, 0, 1.7),
  F('chest', -1.8, -1.1, 1, 0.6), F('sofa', 1.3, 2.6, 1, 0.75), F('wardrobe', 4.95, 5.8, 1, 1.7),
  F('wardrobe', -5.8, -4.9, 2, 1.8), F('dresser', 1.2, 2.0, 2, 0.7),
  F('sofa', -1.8, -0.1, 3, 0.75), F('chest', 4.9, 5.7, 3, 0.6),
]

const DEFS = [
  // 1: 狭い 1 部屋。はしごが 1 本だけ
  {
    name: 'ONE ROOM',
    hint: 'LEAD EVERYONE TO THE SKY FAIRY',
    width: 6,
    stories: [4.4],
    ladders: [{ from: 0, to: 'exit', x: 0 }],
    furniture: [F('bed', -2.8, -1.3, 0, 0.55)],
    people: [{ level: 0, xs: [-0.9, 0.9, 1.8, 2.5] }],
    lava: [0.1, 0.0003],
  },
  // 2: 少し広い 2 階建て。はしごが 2 本。1 階に、はしごの方へ運ぶ動く床
  {
    name: 'TWO FLOORS',
    hint: 'MOVING FLOORS CARRY YOU',
    width: 7,
    stories: [2.7, 2.7],
    floors: [{ gaps: [[-3.5, -2.2]] }],
    exitX: 1.5,
    ladders: [{ from: 0, to: 1, x: -2.55 }, { from: 1, to: 'exit', x: 1.5 }],
    belts: [{ level: 0, x0: -1.6, x1: 1.4, speed: -1.0 }],
    furniture: [F('chest', 2.55, 3.3, 0, 0.6), F('chest', 2.55, 3.3, 1, 0.6), F('sofa', -0.9, 0.4, 1, 0.75)],
    people: [
      { level: 0, xs: [-1.0, 0.0, 0.9] },
      { level: 1, xs: [-1.6, 0.8, 2.1] },
    ],
    lava: [0.12, 0.0005],
  },
  // 3: 細くて高い 3 階建ての塔。2 階に、はしごから遠ざかる動く床
  {
    name: 'THE TOWER',
    hint: 'THE FLOOR MOVES AGAINST YOU',
    width: 5.4,
    stories: [2.6, 2.6, 2.6],
    floors: [{ gaps: [[-2.7, -1.5]] }, { gaps: [[1.5, 2.7]] }],
    exitX: -0.5,
    ladders: [{ from: 0, to: 1, x: -1.85 }, { from: 1, to: 2, x: 1.85 }, { from: 2, to: 'exit', x: -0.5 }],
    belts: [{ level: 1, x0: -1.4, x1: 1.4, speed: -1.0 }],
    furniture: [F('chest', 0.8, 1.6, 0, 0.6), F('bed', -2.5, -1.0, 2, 0.55)],
    people: [
      { level: 0, xs: [-0.7, 0.2] },
      { level: 1, xs: [-0.5, 0.6, 1.4] },
      { level: 2, xs: [0.2, 0.9] },
    ],
    lava: [0.13, 0.0006],
  },
  // 4: 横に広い平屋。真ん中の壁を、傾けて越えさせる（最初の傾け）。壁の先に、なだらかな坂
  {
    name: 'WIDE HOUSE',
    hint: 'TILT TO CLIMB THE WALL',
    width: 12,
    stories: [4.4],
    exitX: 4.5,
    ladders: [{ from: 0, to: 'exit', x: 4.5 }],
    dividers: [{ x: 0.5, level: 0, h: 3.0 }], // 天井が高いので、人が重なっても越えられない高さにする
    ramps: [
      { level: 0, x0: 1.9, x1: 3.0, h: 0.7, up: 'right' },
      { level: 0, x0: 3.0, x1: 4.1, h: 0.7, up: 'left' },
    ],
    furniture: [F('wardrobe', 5.1, 5.85, 0, 1.7)],
    people: [
      { level: 0, xs: [-3.4, -2.6, -1.8, -1.0, -0.2] },
      { level: 0, xs: [1.25] },
    ],
    lava: [0.14, 0.0007],
  },
  // 5: 2 階建て。1 階の中央に、急な丘（傾けると上れる）。2 階には壁。丘は右へ、壁は左へ越える
  {
    name: 'ZIGZAG',
    hint: 'TILT A LITTLE TO CLIMB THE HILL',
    width: 10,
    stories: [3.0, 3.0],
    floors: [{ gaps: [[3.4, 5.0]] }],
    exitX: -3.5,
    ladders: [{ from: 0, to: 1, x: 3.75 }, { from: 1, to: 'exit', x: -3.5 }],
    dividers: [{ x: 0, level: 1, h: 1.8 }],
    ramps: [
      { level: 0, x0: -1.5, x1: 0, h: 1.8, up: 'right' },
      { level: 0, x0: 0, x1: 1.5, h: 1.8, up: 'left' },
    ],
    furniture: [F('wardrobe', -4.8, -3.95, 0, 1.7), F('bed', -2.6, -1.2, 1, 0.55), F('dresser', 1.4, 2.2, 1, 0.7)],
    people: [
      { level: 0, xs: [-3.4, -2.7] },
      { level: 0, xs: [2.6, 3.2] },
      { level: 1, xs: [0.8, 2.8] },
      { level: 1, xs: [-0.8, -4.3] },
    ],
    lava: [0.15, 0.0009],
  },
  // 6: 3 階建て。1 階が 3 つの部屋。左右の部屋の出口は、急な坂（左右へ少しずつ傾けて上る）
  {
    name: 'THREE ROOMS',
    hint: 'TILT EACH WAY TO CLIMB OUT',
    width: 12,
    stories: ST3,
    floors: [{ gaps: [[-1.6, 1.6]] }, { gaps: [[3, 6]] }],
    ladders: [{ from: 0, to: 1, x: 1.15 }, { from: 1, to: 2, x: 3.35 }, { from: 2, to: 'exit', x: 0 }],
    ramps: [
      { level: 0, x0: -3.2, x1: -1.7, h: 1.8, up: 'right' },
      { level: 0, x0: 1.7, x1: 3.2, h: 1.8, up: 'left' },
    ],
    furniture: [
      F('wardrobe', -5.75, -4.85, 0, 1.7), F('wardrobe', 4.95, 5.8, 0, 1.7),
      F('sofa', -5.8, -4.1, 1, 0.75), F('wardrobe', 4.95, 5.8, 1, 2.0),
      F('bed', -5.8, -3.9, 2, 0.55), F('dresser', 1.1, 1.9, 2, 0.7),
    ],
    people: [
      { level: 0, xs: [-4.5, -3.8] },
      { level: 0, xs: [3.7, 4.4] },
      { level: 0, xs: [-0.6, 0.4] },
      { level: 1, xs: [-3.0, 2.2, 4.4] },
      { level: 2, xs: [-1.0, 0.6, 2.4] },
    ],
    lava: [0.16, 0.001],
  },
  // 7: 4 階建て。1 階の左の部屋（-）と、2 階のポケット（+）。仕切りは低め（1.2m）。左右を入れ替えた作り
  {
    name: 'FOUR FLOORS',
    hint: 'WALLS AND A MOVING FLOOR',
    mirror: true,
    width: 12,
    stories: ST4,
    floors: G4,
    exitX: 3,
    ladders: LAD4,
    dividers: [{ x: 0.5, level: 0, h: 1.2 }, { x: 0.0, level: 1, h: 1.2 }],
    belts: [{ level: 2, x0: -2.4, x1: 1.1, speed: 1.0 }], // 3 階の、はしごへ向かう道に逆らう動く床
    furniture: FURN4,
    people: [
      { level: 0, xs: [-4.5, -3.8] },
      { y: -4.85 + 0.55 + 0.5, xs: [-1.9, -1.1] },
      { level: 0, xs: [1.1, 3.7, 4.5] },
      { level: 1, xs: [-2.4, -0.6] },
      { level: 1, xs: [0.7, 3.5, 4.4] },
      { level: 2, xs: [-0.9, 0.4, 2.5] },
      { level: 3, xs: [-2.5, 0.8, 3.8] },
    ],
    lava: [0.2, 0.0015],
  },
  // 8: 3 階建て。1 階の右の部屋が閉じている（2 階は一本道。人が逆向きに行き来してぶつからないように）。3 階には、長いロープで渡る溝（渡っている間は、家を速く回せない）
  {
    name: 'TWO WALLS',
    hint: 'WATCH THE ROPE WHILE YOU TILT',
    width: 12,
    stories: ST3,
    floors: [{ gaps: [[-6, -3]] }, { gaps: [[3, 6], [-2.0, 2.0]] }],
    exitX: -3.5,
    ladders: LAD3,
    dividers: [{ x: 0.5, level: 0, h: 1.8 }],
    ropes: [{ level: 2, x0: -2.0, x1: 2.0 }],
    furniture: [
      F('wardrobe', -5.75, -4.85, 0, 1.7), F('bed', -2.4, -0.8, 0, 0.55), F('chest', 2.3, 3.3, 0, 0.7), F('wardrobe', 4.95, 5.8, 0, 1.7),
      F('sofa', 1.2, 2.6, 1, 0.75), F('wardrobe', 4.95, 5.8, 1, 2.0),
      F('chest', -5.8, -5.0, 2, 0.6),
    ],
    people: [
      { level: 0, xs: [-4.5, -3.8] },
      { y: -3.8, xs: [-1.7, -1.0] },
      { level: 0, xs: [1.1, 1.9, 4.0] },
      { level: 1, xs: [-1.1, -0.4] },
      { level: 1, xs: [0.8, 3.6, 4.3] },
      { level: 2, xs: [-2.6, -4.4] },
      { level: 2, xs: [2.5] },
    ],
    lava: [0.21, 0.0016],
  },
  // 9: 4 階建て。1 階が 3 つの部屋（左右へ逆向きに傾ける）。3 階と 4 階は、長いロープで渡る 1 本道（落ちると下の階から登り直し）
  {
    name: 'LOCKED ROOMS',
    hint: 'THE ONLY WAY UP IS THE ROPE',
    width: 12,
    stories: ST4,
    floors: [{ gaps: [[-1.6, 1.6]] }, { gaps: [[3, 6], [-2.4, 2.0]] }, { gaps: [[-6, -3], [-1.6, 2.0]] }],
    exitX: 3,
    ladders: [{ from: 0, to: 1, x: 1.15 }, { from: 1, to: 2, x: 3.35 }, { from: 2, to: 3, x: -3.35 }, { from: 3, to: 'exit', x: 3 }],
    dividers: [{ x: -1.7, level: 0, h: 1.35 }, { x: 1.7, level: 0, h: 1.35 }],
    ropes: [{ level: 2, x0: -2.4, x1: 2.0 }, { level: 3, x0: -1.6, x1: 2.0 }],
    furniture: [
      F('wardrobe', -5.75, -4.85, 0, 1.7), F('wardrobe', 4.95, 5.8, 0, 1.7),
      F('sofa', -5.8, -4.1, 1, 0.75), F('wardrobe', 4.95, 5.8, 1, 1.7),
      F('wardrobe', -5.8, -4.9, 2, 1.8),
      F('chest', 4.9, 5.7, 3, 0.6),
    ],
    people: [
      { level: 0, xs: [-4.4, -3.7, -3.0] },
      { level: 0, xs: [-0.9, 0.2] },
      { level: 0, xs: [2.4, 3.2, 4.0] },
      { level: 1, xs: [-2.8, 2.2, 4.4] },
      { level: 2, xs: [-4.2] },
      { level: 2, xs: [2.5] },
      { level: 3, xs: [-2.3] },
      { level: 3, xs: [2.6, 4.0] },
    ],
    lava: [0.34, 0.0035],
  },
  // 10: 最終面。1 階は急な坂の部屋、2 階は動く床、3 階と 4 階は長いロープの 1 本道。人が多くて、マグマも速い
  {
    name: 'LAST ESCAPE',
    hint: 'SAVE AS MANY AS YOU CAN',
    width: 12,
    stories: ST4,
    floors: [{ gaps: [[-1.6, 1.6]] }, { gaps: [[3, 6], [-2.4, 2.0]] }, { gaps: [[-6, -3], [-1.8, 2.2]] }],
    exitX: 3,
    ladders: [{ from: 0, to: 1, x: 1.15 }, { from: 1, to: 2, x: 3.35 }, { from: 2, to: 3, x: -3.35 }, { from: 3, to: 'exit', x: 3 }],
    ramps: [
      { level: 0, x0: -2.6, x1: -1.7, h: 1.2, up: 'right' },
      { level: 0, x0: 1.7, x1: 2.6, h: 1.2, up: 'left' },
    ],
    belts: [{ level: 1, x0: 1.9, x1: 2.9, speed: -1.0 }],
    ropes: [{ level: 2, x0: -2.4, x1: 2.0 }, { level: 3, x0: -1.8, x1: 2.2 }],
    furniture: [
      F('wardrobe', -5.75, -4.85, 0, 1.7), F('wardrobe', 4.95, 5.8, 0, 1.7),
      F('sofa', -5.8, -4.1, 1, 0.75), F('wardrobe', 4.95, 5.8, 1, 1.7),
      F('wardrobe', -5.8, -4.9, 2, 1.8),
      F('chest', 4.9, 5.7, 3, 0.6),
    ],
    people: [
      { level: 0, xs: [-4.4, -3.7] },
      { level: 0, xs: [-0.9, 0.2, 1.0] },
      { level: 0, xs: [3.6, 4.4] },
      { level: 1, xs: [-2.8, 2.2, 3.1, 4.4] },
      { level: 2, xs: [2.5] },
      { level: 2, xs: [-4.2, -2.6] },
      { level: 3, xs: [-2.4] },
      { level: 3, xs: [2.7, 3.6, 4.4] },
    ],
    lava: [0.34, 0.004],
  },
]

export const STAGES = DEFS.map(buildStage)
export const STAGE_COUNT = STAGES.length

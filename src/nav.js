// 出口までの道筋（家のローカル座標。家は剛体なので、距離場は一度だけ作る）
//
// - 幾何の距離場（geom）：重力を考えず、壁を避けて出口へ向かう距離。家が大きく傾いたときに使う
// - 直立用の距離場（upright）：家がほぼ直立のとき、歩く・落ちる・はしご・ジャンプで出口へ向かう時間

export const CS = 0.25
const OX = -7, OY = -6
const NX = 56, NY = 52
const CLEARANCE = 0.32
const INF = 1e9
const LADDER_HW = 0.5 // はしごの左右。広めにして、左右から着いた人が押し合わずに登れるようにする
export const JUMP_CELLS = 3 // 一度に上がれる高さ（セル数）。0.75m の段差の上に乗れる

// 動きにかかる時間（秒/セル）
const T_WALK = 0.125
const T_DIAG = 0.18
const T_FALL = 0.08
const T_LADDER = 0.31
const T_JUMP = 0.6
const T_ROPE = 0.28 // ロープを 1 マス進む時間（約 0.9m/s）
const WALK_MPS = 2 // 歩く速さ（ベルトの影響を計算する）
const RAMP_WALK_MAX = 46 // これより急な坂は、上れない壁として扱う（道筋の計算）

export function createNav(walls, ladders, srcY = 6, extra = {}) {
  const ramps = extra.ramps || [], ropes = extra.ropes || [], belts = extra.belts || []
  const idx = (i, j) => j * NX + i
  const inGrid = (i, j) => i >= 0 && j >= 0 && i < NX && j < NY
  const center = (i, j) => [OX + (i + 0.5) * CS, OY + (j + 0.5) * CS]
  const blocked = new Uint8Array(NX * NY)
  const steepOnly = new Uint8Array(NX * NY) // 急な坂だけで塞がれているセル（立てない）
  const ladder = new Int8Array(NX * NY).fill(-1) // はしごのセルは、はしごの番号
  const rope = new Int8Array(NX * NY).fill(-1) // ロープのセルは、ロープの番号
  const belt = new Float32Array(NX * NY) // ベルトの上のセルは、ベルトの速さ

  // 点と三角形の距離（中なら 0）
  function triDist(px, py, pts) {
    const [a, b, c] = pts
    const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    const P = [px, py]
    const d1 = sign(P, a, b), d2 = sign(P, b, c), d3 = sign(P, c, a)
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return 0
    let best = Infinity
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const dx = v[0] - u[0], dy = v[1] - u[1]
      const t = Math.max(0, Math.min(1, ((px - u[0]) * dx + (py - u[1]) * dy) / (dx * dx + dy * dy)))
      best = Math.min(best, Math.hypot(px - (u[0] + t * dx), py - (u[1] + t * dy)))
    }
    return best
  }

  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const [x, y] = center(i, j)
      for (const [cx, cy, w, h] of walls) {
        if (Math.abs(x - cx) < w / 2 + CLEARANCE && Math.abs(y - cy) < h / 2 + CLEARANCE) {
          blocked[idx(i, j)] = 1
          break
        }
      }
      if (!blocked[idx(i, j)]) {
        // 坂：近くを塞ぐ。急な坂だけで塞がれたセルは、立てない（壁として扱う）
        let gentle = false, steep = false
        for (const r of ramps) {
          if (triDist(x, y, r.pts) < CLEARANCE) { if (r.angle > RAMP_WALK_MAX) steep = true; else gentle = true }
        }
        if (gentle || steep) { blocked[idx(i, j)] = 1; if (!gentle) steepOnly[idx(i, j)] = 1 }
      }
      if (blocked[idx(i, j)]) continue
      // ロープの行：足場に立つときの行（床の上面 + 余裕の、すぐ上の行）。端の足場から、そのまま歩いてぶら下がれる
      ropes.forEach((r, n) => {
        // 人の高さが行の境目に当たってもいいように、その行と、すぐ下の行の 2 行をロープにする
        const row = Math.ceil((r.top + CLEARANCE - OY) / CS - 0.5 - 1e-9)
        if ((j === row || j === row - 1) && x >= r.x0 && x <= r.x1) rope[idx(i, j)] = n
      })
      ladders.forEach((l, n) => {
        // 上端は 1 マス延ばす（家の高さによって、出口の外の目的地との間に 1 マス空いてしまわないように）
        if (Math.abs(x - l.x) <= LADDER_HW && y >= l.y0 && y <= l.y1 + CS) ladder[idx(i, j)] = n
      })
    }
  }

  const free = (i, j) => inGrid(i, j) && !blocked[idx(i, j)]
  const sup = (i, j) => j > 0 && inGrid(i, j) && blocked[idx(i, j - 1)] === 1 && !steepOnly[idx(i, j - 1)] // 真下が壁（急な坂は立てない）
  const isSource = (i, j) => free(i, j) && center(i, j)[1] >= srcY // 出口の外（屋根より上）

  // ベルトの上の足場（床から 0.6m まで）に、速さを持たせる
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      if (blocked[idx(i, j)] || !sup(i, j)) continue
      const [x, y] = center(i, j)
      for (const b of belts) if (x >= b.x0 && x <= b.x1 && y >= b.floor && y <= b.floor + 0.6) belt[idx(i, j)] = b.speed
    }
  }

  // --- 幾何の距離場 ---
  const geom = new Float64Array(NX * NY).fill(INF)
  {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) if (isSource(i, j)) geom[idx(i, j)] = 0
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]
    let changed = true
    while (changed) {
      changed = false
      for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
          const k = idx(i, j)
          if (blocked[k]) continue
          for (const [di, dj, c] of nb) {
            const ni = i + di, nj = j + dj
            if (!inGrid(ni, nj)) continue
            const nk = idx(ni, nj)
            if (blocked[nk] || geom[nk] >= INF) continue
            if (di && dj && (blocked[idx(ni, j)] || blocked[idx(i, nj)])) continue
            if (geom[nk] + c < geom[k]) { geom[k] = geom[nk] + c; changed = true }
          }
        }
      }
    }
  }
  const geomFree = (i, j) => free(i, j) && geom[idx(i, j)] < INF

  // 道がないときの目的地用の「近さ」。上下の動きを軽く数えて、横にどれだけ出口へ近いかを優先する
  // （壁を越えるために上へ登る距離で測ると、壁から離れた家具の上のほうが「近い」ことになり、
  //   壁際の人が、後ろの家具へ跳び乗って戻る、を繰り返してしまう）
  const near = new Float64Array(NX * NY).fill(INF)
  {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) if (isSource(i, j)) near[idx(i, j)] = 0
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 0.25], [0, -1, 0.25], [1, 1, 1.03], [1, -1, 1.03], [-1, 1, 1.03], [-1, -1, 1.03]]
    let changed = true
    while (changed) {
      changed = false
      for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
          const k = idx(i, j)
          if (blocked[k]) continue
          for (const [di, dj, c] of nb) {
            const ni = i + di, nj = j + dj
            if (!inGrid(ni, nj)) continue
            const nk = idx(ni, nj)
            if (blocked[nk] || near[nk] >= INF) continue
            if (di && dj && (blocked[idx(ni, j)] || blocked[idx(i, nj)])) continue
            if (near[nk] + c < near[k]) { near[k] = near[nk] + c; changed = true }
          }
        }
      }
    }
  }

  // --- 直立用：動きの一覧 ---
  // 重力は常にローカルの -y 向きとみなす。emit(行き先 i, j, 時間, 種類, 向き)
  // ベルトの上の歩く時間（流れに乗ると速く、逆らうと遅い）
  const walkCost = (i, j, s, base) => {
    const b = belt[idx(i, j)]
    return b ? base * (WALK_MPS / Math.max(0.3, WALK_MPS + s * b)) : base
  }
  function moves(i, j, emit) {
    const S = sup(i, j)
    const L = ladder[idx(i, j)] >= 0
    const R = rope[idx(i, j)] >= 0
    if (!S && !L && !R) {
      if (free(i, j - 1)) emit(i, j - 1, T_FALL, 'fall', 0)
      for (const s of [-1, 1]) if (free(i + s, j - 1)) emit(i + s, j - 1, T_FALL * 1.3, 'fall', s)
    }
    if (S) {
      for (const s of [-1, 1]) {
        if (free(i + s, j)) emit(i + s, j, walkCost(i, j, s, T_WALK), 'walk', s)
        if (free(i + s, j + 1) && free(i, j + 1) && sup(i + s, j + 1)) emit(i + s, j + 1, walkCost(i, j, s, T_DIAG), 'walk', s)
        if (free(i + s, j - 1) && free(i + s, j) && sup(i + s, j - 1)) emit(i + s, j - 1, walkCost(i, j, s, T_DIAG), 'walk', s)
        // ジャンプ：真上が空いていて、k セル上の足場へ
        for (let k = 2; k <= JUMP_CELLS; k++) {
          if (!free(i, j + k)) break
          if (free(i + s, j + k) && sup(i + s, j + k)) emit(i + s, j + k, T_JUMP + 0.1 * k, 'jump', s)
        }
      }
    }
    if (R) {
      // ロープ：ぶら下がって、横へ進む。端では足場へ戻れる
      for (const s of [-1, 1]) {
        if (rope[idx(i + s, j)] >= 0) emit(i + s, j, T_ROPE, 'rope', s)
        else if (free(i + s, j)) emit(i + s, j, T_WALK, 'walk', s)
      }
      // 2 行あるロープの、もう一方の行へ（向きは 0。今の向きのまま進む）
      if (rope[idx(i, j + 1)] >= 0) emit(i, j + 1, 0.05, 'rope', 0)
      if (rope[idx(i, j - 1)] >= 0) emit(i, j - 1, 0.05, 'rope', 0)
    }
    if (L) {
      if (free(i, j + 1)) emit(i, j + 1, T_LADDER, 'ladder', 1)
      if (free(i, j - 1)) emit(i, j - 1, T_LADDER, 'ladder', -1)
      for (const s of [-1, 1]) if (free(i + s, j)) emit(i + s, j, T_WALK, 'walk', s)
    }
  }

  // 出口へ行く道がなくても（傾けないと越えられない壁など）、できるところまで進むために、各セルの初期値を
  // 「出口までの幾何距離 × 大きな重み」にする。道があれば本当の時間のほうが必ず小さいので影響しない。
  // 道がなければ、到達できる場所のうち、出口に一番近い所が目的地になる
  const FRONTIER_K = 1000
  const FRONTIER_MIN_GAIN = 2 // 近づく価値がある最小の差（マス。2 マス = 0.5m）
  const upright = new Float64Array(NX * NY).fill(INF)
  {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = idx(i, j)
      if (isSource(i, j)) upright[k] = 0
      else if (!blocked[k] && near[k] < INF) upright[k] = FRONTIER_K * near[k]
    }
    let changed = true
    while (changed) {
      changed = false
      for (let pass = 0; pass < 2; pass++) {
        for (let jj = 0; jj < NY; jj++) {
          const j = pass ? NY - 1 - jj : jj
          for (let ii = 0; ii < NX; ii++) {
            const i = pass ? NX - 1 - ii : ii
            if (blocked[idx(i, j)] || isSource(i, j)) continue
            moves(i, j, (ni, nj, cost) => {
              const d = upright[idx(ni, nj)] + cost
              if (d < upright[idx(i, j)]) { upright[idx(i, j)] = d; changed = true }
            })
          }
        }
      }
    }
  }

  // ローカル座標のセル。塞がれていたら近くの空きセルへ寄せる
  function cellOf(lx, ly, ok) {
    const i = Math.floor((lx - OX) / CS), j = Math.floor((ly - OY) / CS)
    if (!inGrid(i, j)) return null
    if (ok(i, j)) return [i, j]
    let best = null
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      if (ok(i + di, j + dj) && (!best || Math.hypot(di, dj) < best[2])) best = [i + di, j + dj, Math.hypot(di, dj)]
    }
    return best && [best[0], best[1]]
  }

  return {
    // 幾何：出口へ向かう単位ベクトル（ローカル）。道がなければ null
    routeGeom(lx, ly) {
      const c = cellOf(lx, ly, geomFree)
      if (!c) return null
      let [i, j] = c
      for (let step = 0; step < 4; step++) {
        let bi = i, bj = j, bd = geom[idx(i, j)]
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue
          if (!geomFree(i + di, j + dj)) continue
          if (di && dj && (!geomFree(i + di, j) || !geomFree(i, j + dj))) continue
          const d = geom[idx(i + di, j + dj)]
          if (d < bd) { bd = d; bi = i + di; bj = j + dj }
        }
        if (bi === i && bj === j) break
        i = bi; j = bj
      }
      const [tx, ty] = center(i, j)
      const dx = tx - lx, dy = ty - ly
      const len = Math.hypot(dx, dy)
      return len < 1e-3 ? null : [dx / len, dy / len]
    },

    // 直立：次の動き { type: walk|fall|jump|ladder, dir }。道がなければ null
    nextMove(lx, ly) {
      const c = cellOf(lx, ly, (i, j) => free(i, j) && upright[idx(i, j)] < INF)
      if (!c) return null
      const [i, j] = c
      let best = null, bd = INF
      const here = upright[idx(i, j)]
      moves(i, j, (ni, nj, cost, type, dir) => {
        // 同じ時間なら、はしごを上る動きを優先する（はしごの前で左右から押し合わないように）
        const d = upright[idx(ni, nj)] + cost - (type === 'ladder' ? 0.02 : 0)
        if (d < bd) { bd = d; best = { type, dir } }
      })
      // これ以上近づけない（壁の前など）。呼ぶ側が、出口の方向へ押す
      // （値が自分の初期値のまま = どの動きでも、出口へ近づけない場所）
      // （さらに、出口へ 0.5m 以上近づけないなら、動く価値がない。わずかな差で、家具の上へ跳び乗って戻る、を繰り返さないように）
      // 道があるとき（here が小さい）には使わない
      if (best && here >= FRONTIER_K * 0.5 && here >= FRONTIER_K * (near[idx(i, j)] - FRONTIER_MIN_GAIN) && !isSource(i, j)) return null
      return best
    },

    // 確認用：その場所の、直立の距離場（出口までの時間。道がなければ「幾何距離 × 重み」）と、幾何の距離
    valueAt(lx, ly) {
      const i = Math.floor((lx - OX) / CS), j = Math.floor((ly - OY) / CS)
      if (!inGrid(i, j)) return null
      return { up: upright[idx(i, j)], geom: geom[idx(i, j)], blocked: blocked[idx(i, j)], sup: sup(i, j) }
    },

    // lx, ly がロープの下にぶら下がれる所なら、その番号。なければ -1
    ropeAt(lx, ly) {
      for (let n = 0; n < ropes.length; n++) {
        const r = ropes[n]
        if (lx >= r.x0 - 0.3 && lx <= r.x1 + 0.3 && Math.abs(ly - r.yHang) < 0.45) return n
      }
      return -1
    },

    // lx, ly が動く床の上なら、その速さ（なければ 0）
    beltAt(lx, ly) {
      for (const b of belts) if (lx >= b.x0 && lx <= b.x1 && ly >= b.floor && ly <= b.floor + 0.8) return b.speed
      return 0
    },

    // lx, ly がはしごの中なら、その番号。なければ -1
    ladderAt(lx, ly) {
      for (let n = 0; n < ladders.length; n++) {
        const l = ladders[n]
        if (Math.abs(lx - l.x) <= LADDER_HW + 0.1 && ly >= l.y0 - 0.2 && ly <= l.y1 + 0.3) return n
      }
      return -1
    },
  }
}

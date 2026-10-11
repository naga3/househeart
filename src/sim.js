import { World, Vec2, Box, Circle, Polygon } from 'planck'
import { createNav } from './nav.js'

const STEP = 1 / 120
const WALL = 0.3
const MAX_OMEGA = 2.5
const FOLLOW = 6
export const MAX_TILT = (60 * Math.PI) / 180 // 家を回せる角度（左右それぞれ）

export const PERSON_R = 0.35

// マグマ：世界の高さ（m）。時間とともに上がる（速さと加速は面ごと）
// ヘリは出口の外側に待つ（屋根の中心から 1.5m 上）。ヘリがマグマより HELI_SAFE 高ければ拾える
const HELI_SAFE = 0.8
const HELI_FOLLOW = 4

// 面ごとの道筋の計算は、最初に使うときに作って面に持たせる
function navOf(stage) {
  if (!stage.nav) stage.nav = createNav([...stage.walls, ...furnitureBoxes(stage)], stage.ladders, stage.srcY, {
    ramps: stage.ramps, ropes: stage.ropes, belts: stage.belts,
  })
  return stage.nav
}
const furnitureBoxes = (stage) => stage.furniture.map((f) => [(f.x0 + f.x1) / 2, f.floor + f.h / 2, f.x1 - f.x0, f.h])

const WALK_SPEED = 2
const LADDER_SPEED = 0.8 // はしごを上り下りする速さ（m/s）
const ROPE_SPEED = 0.9 // ロープを横へ進む速さ（m/s）
export const ROPE_OMEGA = 1.0 // 家の回る速さ（rad/s）がこれを超えると、ロープから手が離れる
const BELT_K = 6 // 動く床が、人を床の速さへ近づける強さ
const BELT_MAX = 12 // その力の上限（m/s²）
const JUMP_SPEED = 4.4 // ジャンプの初速。約0.97m 上がる
const JUMP_FORWARD = 2.2
const JUMP_OVER_WAIT = 30 // 前の人に止められて、頭上を飛び越えるまで待つ時間（1/120秒単位）
const JUMP_COOLDOWN = 100 // 1/120秒単位
const DISMOUNT_FRAMES = 40 // はしごから足場へ移る間
const LADDER_GRIP = Math.cos((55 * Math.PI) / 180) // はしごを握れる傾き（これを超えると手を離す）
const UPRIGHT = (35 * Math.PI) / 180 // これ以内の傾きなら、はしご・ジャンプ込みの道筋を使う
const WALK_ACCEL = 13
const STAND_FRICTION = 0.6
const WALK_FRICTION = 0.2
const AIR_FRAMES = 15 // 接地が途切れて落下とみなすまで（1/120秒単位）
// 地面の傾きに対する歩く力：45°までは全力、60°以上は登れない
const CLIMB_FULL = Math.cos(Math.PI / 4)
const CLIMB_NONE = Math.cos(Math.PI / 3)

export function createSim(stage) {
  const nav = navOf(stage)
  const world = new World({ gravity: new Vec2(0, -10) })

  const house = world.createBody({ type: 'kinematic', position: new Vec2(0, 0) })
  for (const [cx, cy, w, h] of [...stage.walls, ...furnitureBoxes(stage)]) {
    house.createFixture(new Box(w / 2, h / 2, new Vec2(cx, cy), 0), { friction: 0.7 })
  }
  for (const r of stage.ramps) {
    house.createFixture(new Polygon(r.pts.map(([x, y]) => new Vec2(x, y))), { friction: 0.7 })
  }

  // 人の初期位置（少しずらす）
  let seed = 12345
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
  const spawns = stage.spawns.map(([x, y]) => [x + (rnd() - 0.5) * 0.15, y])

  const people = spawns.map(([x, y], i) => {
    const b = world.createBody({ type: 'dynamic', position: new Vec2(x, y), fixedRotation: true, allowSleep: false })
    b.createFixture(new Circle(PERSON_R), { density: 1, friction: STAND_FRICTION, restitution: 0.05 })
    b.intent = null
    b.look = i
    b.face = 1
    b.air = 0
    b.state = 'idle'
    b.climb = false
    b.onLadder = false
    b.onRope = false
    b.warn = false
    b.dismount = 0
    b.dismountDir = 0
    b.jumpCd = 0
    b.jumpT = 0
    b.blockedT = 0
    b.jumpFails = 0
    b.jumpVy = 0
    b.stuckT = 0
    b.stuckClock = 0
    b.checkX = 0
    b.checkY = 0
    b.lastJump = null
    b.wake = Math.round(rnd() * 1.5 * 120) // 気づいて動き出すまで（1/120秒単位）。全員が同時に着いて団子にならないように
    b.jumpDir = 0
    b.noFric = 0
    return b
  })

  // 接地していれば、その地面の接線に沿って出口の方へ歩く。坂がきついと摩擦に負けて滑る
  function groundNormal(p) {
    let best = null
    for (let ce = p.getContactList(); ce; ce = ce.next) {
      const c = ce.contact
      if (!c.isTouching()) continue
      const n = c.getWorldManifold(null).normal
      const sign = c.getFixtureA().getBody() === p ? -1 : 1
      const ny = n.y * sign
      const other = c.getFixtureA().getBody() === p ? c.getFixtureB().getBody() : c.getFixtureA().getBody()
      if (ny > 0.2 && (!best || ny > best.y)) best = { x: n.x * sign, y: ny, person: other !== house }
    }
    return best
  }

  // 摩擦を変える。すでに接している相手との摩擦は自動では変わらないので、接触ごとに更新し直す
  function setFriction(p, f) {
    const fx = p.getFixtureList()
    if (fx.getFriction() === f) return
    fx.setFriction(f)
    for (let ce = p.getContactList(); ce; ce = ce.next) ce.contact.resetFriction()
  }

  // ジャンプ。跳んでも同じ場所のままなら（挟まれて動けない）、次は強く跳ぶ
  function jump(p, dir, c, boost = true) {
    const pos = p.getPosition()
    // 前回の跳びで、進みたい向きに 0.3m 進めたか（跳ね返されて戻ったら、進めていない）
    const progress = p.lastJump ? (pos.x - p.lastJump.x) * dir * c : 9
    if (boost) p.jumpFails = progress < 0.3 ? Math.min(p.jumpFails + 1, 3) : 0
    p.lastJump = { x: pos.x, y: pos.y }
    const power = boost ? Math.min(1.25, 1 + 0.1 * p.jumpFails) : 1
    p.jumpVy = JUMP_SPEED * power // これより速く上へ飛ばない（周りに挟まれて弾き出されても、壁を飛び越えない）
    p.setLinearVelocity(new Vec2(c * dir * JUMP_FORWARD * power, JUMP_SPEED * power))
    p.jumpCd = JUMP_COOLDOWN
    p.jumpT = 90
    p.jumpDir = dir
    p.noFric = 40 // 壁にこすれて高さが落ちないように
    p.blockedT = 0
    sim.events.push({ type: 'jump' })
  }

  function walk(p) {
    if (p.wake > 0) { p.wake--; return }
    const n = groundNormal(p)
    p.air = n ? 0 : p.air + 1
    if (p.jumpCd > 0) p.jumpCd--
    if (p.noFric > 0) p.noFric--
    p.intent = null
    const pos = p.getPosition()
    const a = house.getAngle()
    const c = Math.cos(a), s = Math.sin(a)
    const lx = pos.x * c + pos.y * s, ly = -pos.x * s + pos.y * c
    const upright = Math.abs(Math.atan2(s, c)) < UPRIGHT
    // 跳べる状態：床に立っている。挟まれて床との接触が一瞬切れたときは、直前まで立っていたことにする
    // 挟まれて摩擦だけで止まっているとき（ほぼ動いていない）も、立っているとみなす
    const v0 = p.getLinearVelocity()
    const standing = n ? n.y > 0.7 : p.air < 30 || Math.hypot(v0.x, v0.y) < 0.3

    // 次の動き。直立なら歩く・落ちる・はしご・ジャンプ、傾いていれば距離場の向き
    let move = null
    if (ly <= stage.exitJudgeY) {
      if (upright) move = nav.nextMove(lx, ly)
      // 越えられない壁があって道が見つからないときも、あきらめずに出口の方向へ（壁の前まで）歩く
      if (!move) {
        const d = nav.routeGeom(lx, ly)
        if (d) {
          // 向きがほぼ真上（壁を乗り越える）のときも、出口のある側へ横に歩く力を足す。壁の上で止まらないように
          if (upright && Math.abs(d[0]) < 0.4) {
            const hs = Math.sign(stage.exitX - lx) || p.face
            move = { type: 'geom', d: [hs * 0.5, d[1]] }
          } else move = { type: 'geom', d }
        }
      }
    }
    p.moveType = move ? move.type : null // 動きの種類（確認用）
    let lv = null // ローカルの進みたい向き
    let climbDir = 0
    if (move) {
      if (move.type === 'geom') lv = move.d
      else if (move.type === 'walk' || move.type === 'jump') lv = [move.dir, 0]
      else if (move.type === 'ladder') { lv = [0, move.dir]; climbDir = move.dir }
    }
    const lad = nav.ladderAt(lx, ly)
    if (!upright && lv && lad >= 0 && Math.abs(lv[1]) > 0.7) climbDir = Math.sign(lv[1])

    // ロープ：ぶら下がって横へ進む。家を速く回す（角速度が大きい）と手が離れて落ちる
    const rp = nav.ropeAt(lx, ly)
    const ropeOk = Math.abs(house.getAngularVelocity()) < ROPE_OMEGA && upright
    if (move && move.type === 'rope' && rp >= 0 && ropeOk) {
      p.onRope = true
      p.setGravityScale(0)
      const w = house.getAngularVelocity()
      const vyl = Math.max(-1.5, Math.min(1.5, (stage.ropes[rp].yHang - ly) * 8)) // ロープの下の高さへ寄せる
      const rdir = move.dir || p.face // 向き 0 は、今の向きのまま
      const vxl = rdir * ROPE_SPEED
      p.setLinearVelocity(new Vec2(-w * pos.y + c * vxl - s * vyl, w * pos.x + s * vxl + c * vyl))
      p.intent = [c * rdir, s * rdir]
      p.face = rdir
      p.state = 'rope'
      p.climb = false
      p.warn = Math.abs(w) > ROPE_OMEGA * 0.6 // 限界が近い（画面に「!」を出す）
      setFriction(p, 0)
      return
    }
    if (p.onRope) {
      p.onRope = false
      p.warn = false
      if (move && move.type === 'rope' && rp >= 0 && !ropeOk) sim.events.push({ type: 'slip' }) // 速く回して手が離れた
    }

    // はしご：握れるのは、はしごが縦に近いとき。傾けすぎると手を離して落ちる
    const grip = c >= LADDER_GRIP
    if (climbDir && lad >= 0 && grip && Math.abs(lx - stage.ladders[lad].x) < 0.6) {
      p.onLadder = true
      p.setGravityScale(0)
      const w = house.getAngularVelocity()
      const off = Math.max(-1, Math.min(1, -(lx - stage.ladders[lad].x) * 6))
      // 家が回っているぶんの速さに、上り下りと中心への寄せを足す
      p.setLinearVelocity(new Vec2(
        -w * pos.y + -s * climbDir * LADDER_SPEED + c * off,
        w * pos.x + c * climbDir * LADDER_SPEED + s * off,
      ))
      p.intent = [-s * climbDir, c * climbDir]
      p.state = 'ladder'
      p.climb = false
      setFriction(p, 0)
      return
    }
    if (p.onLadder) {
      p.onLadder = false
      if (climbDir && lad >= 0 && !grip) sim.events.push({ type: 'slip' }) // 傾けすぎて手を離した
      // はしごの上から足場へ移るときは、少しのあいだ横へ進んで乗り移る
      if (move && move.type === 'walk') { p.dismount = DISMOUNT_FRAMES; p.dismountDir = move.dir }
    }
    if (p.dismount > 0) {
      p.dismount--
      p.setGravityScale(0.25)
      const w = house.getAngularVelocity()
      p.setLinearVelocity(new Vec2(-w * pos.y + c * p.dismountDir * 1.8, w * pos.x + s * p.dismountDir * 1.8))
    } else {
      p.setGravityScale(1)
    }

    // ジャンプの間は、壁に押されても横向きの速さを保つ（壁を越えたあとに前へ進むため）
    if (p.jumpT > 0) {
      p.jumpT--
      if (n && p.jumpT < 80) p.jumpT = 0
      else {
        const v = p.getLinearVelocity()
        p.setLinearVelocity(new Vec2(c * p.jumpDir * JUMP_FORWARD, Math.min(v.y, p.jumpVy)))
      }
    }

    // 動く床：その上に立っている人を、床の速さへ近づける
    const belt = n && n.y > 0.7 ? nav.beltAt(lx, ly) : 0
    if (belt) {
      const fb = Math.max(-BELT_MAX, Math.min(BELT_MAX, BELT_K * (belt - (v0.x * c + v0.y * s)))) * p.getMass()
      p.applyForceToCenter(new Vec2(c * fb, s * fb))
    }

    let walking = false, climbing = false
    if (lv) {
      const dx = lv[0] * c - lv[1] * s, dy = lv[0] * s + lv[1] * c
      p.intent = [dx, dy]
      if (Math.abs(dx) > 0.2) p.face = dx > 0 ? 1 : -1
      // ジャンプ：低い壁などを越える。接地していて、間をおいたときだけ
      if (move && move.type === 'jump' && standing && p.jumpCd <= 0) jump(p, move.dir, c)
      const t = n && { x: n.y, y: -n.x }
      const along = n ? dx * t.x + dy * t.y : 0
      if (n && Math.abs(along) >= 0.15 && move.type !== 'jump') {
        const dir = Math.sign(along)
        // 人の頭の上は、接触の向きが急でも坂の制限をかけない（頭の丸みで傾きが大きく出るため）
        const power = n.person ? 1 : Math.max(0, Math.min(1, (n.y - CLIMB_NONE) / (CLIMB_FULL - CLIMB_NONE)))
        // 下り方向へ歩くのは坂がきつくても止めない
        const uphill = dir * t.y > 0
        const f = (uphill ? power : 1) * WALK_ACCEL * p.getMass()
        const v = p.getLinearVelocity()
        // 動く床の上では、床に対する速さで歩く速さを数える
        if (((v.x - belt * c) * t.x + (v.y - belt * s) * t.y) * dir < WALK_SPEED) {
          p.applyForceToCenter(new Vec2(t.x * dir * f, t.y * dir * f))
        }
        walking = true
        climbing = uphill && n.y < CLIMB_FULL
      }
    }
    // 前の人に止められて動けないとき、頭上を飛び越える（正面から向かい合って詰まったときも、互いに越えて抜ける）
    {
      const vv = p.getLinearVelocity()
      let ahead = false
      if (move && move.type === 'walk' && standing && Math.hypot(vv.x, vv.y) < 0.3) {
        for (let ce = p.getContactList(); ce; ce = ce.next) {
          const c2 = ce.contact
          if (!c2.isTouching()) continue
          const other = c2.getFixtureA().getBody() === p ? c2.getFixtureB().getBody() : c2.getFixtureA().getBody()
          if (other === house) continue
          const nn = c2.getWorldManifold(null).normal
          const sg = c2.getFixtureA().getBody() === p ? 1 : -1 // p から相手へ向かう向き
          if (nn.x * sg * c * move.dir > 0.6 && Math.abs(nn.y) < 0.8) { ahead = true; break }
        }
      }
      p.blockedT = ahead ? p.blockedT + 1 : 0
      if (p.blockedT > JUMP_OVER_WAIT && p.jumpCd <= 0) jump(p, move.dir, c)
      // 道が見つからず、出口の方向へ歩いているだけのとき：押しても動かなければ、その場で跳んでみる（低い家具なら越える。高い壁は越えられない）
      // 動けない = 0.25 秒ごとに見て、0.15m も動いていない状態が 0.5 秒続く（壁に押しつけて振動していても数える）
      const trying = move && move.type === 'geom' && upright && standing
      if (trying) {
        if (++p.stuckClock >= 30) {
          p.stuckClock = 0
          p.stuckT = Math.hypot(pos.x - p.checkX, pos.y - p.checkY) < 0.15 ? p.stuckT + 30 : 0
          p.checkX = pos.x
          p.checkY = pos.y
        }
      } else {
        p.stuckClock = 0
        p.stuckT = 0
        p.checkX = pos.x
        p.checkY = pos.y
      }
      // 向きが真上に近い（壁の上へ向かう）ときは、出口のある側へ跳ぶ
      if (p.stuckT >= 60 && p.jumpCd <= 0) { jump(p, Math.abs(move.d[0]) > 0.3 ? Math.sign(move.d[0]) : p.face, c, true); p.stuckT = 0 }
    }
    // 絵の切り替え用の状態。接地の途切れは少し待って落下とみなす
    const v = p.getLinearVelocity()
    p.climb = climbing
    const speed = Math.hypot(v.x, v.y)
    // 歩いているあいだは地面との摩擦を弱める。後ろから押されても登れるように
    setFriction(p, p.noFric > 0 ? 0 : walking ? WALK_FRICTION : STAND_FRICTION)
    p.state = p.air > AIR_FRAMES ? 'fall' : walking && speed > 0.3 ? 'walk' : n && speed > 1 ? 'slide' : 'idle'
  }

  // 出口を出た人：ヘリが出口の外で待っていて、マグマより高ければ脱出。そうでなければ落ちる
  function heliTarget() {
    // 出口の外側（ローカルで (exitX, heliY)）を、家の傾きに合わせて回した位置
    const a = house.getAngle()
    const c = Math.cos(a), s = Math.sin(a)
    const lx = stage.exitX, ly = stage.heliY
    return { x: lx * c - ly * s, y: lx * s + ly * c }
  }

  function judge() {
    const a = house.getAngle()
    const c = Math.cos(a), s = Math.sin(a)
    const target = heliTarget()
    for (const p of [...sim.people]) {
      const { x, y } = p.getPosition()
      if (!p.out && -x * s + y * c > stage.exitJudgeY) {
        const h = sim.heli
        const ok = h.y > sim.lava + HELI_SAFE && Math.hypot(h.x - target.x, h.y - target.y) < 3.5
        if (ok) {
          remove(p)
          sim.saved++
          sim.lastSavedAt = sim.time // クリアタイム：最後に助けた時刻
          sim.outcomes.push('saved')
          sim.events.push({ type: 'saved' })
          sim.fx.push({ kind: 'saved', x, y, look: p.look, face: p.face, age: 0, dur: 1.0 }) // 0.7 秒で空の精へ飛び、残りで光がはじける
          continue
        }
        p.out = true
      }
      if (y < sim.lava) {
        remove(p)
        sim.lost++
        sim.outcomes.push('lost')
        sim.events.push({ type: 'burn' })
        sim.fx.push({ kind: 'burn', x, y, age: 0, dur: 0.6 })
      }
    }
  }

  function remove(p) {
    world.destroyBody(p)
    sim.people.splice(sim.people.indexOf(p), 1)
  }

  const sim = {
    world, house, people,
    targetAngle: 0,
    saved: 0,
    lost: 0,
    outcomes: [],
    events: [], // 音を鳴らすための知らせ（main.js が取り出す）
    fx: [],
    time: 0,
    lava: stage.lavaStart,
    stage,
    total: stage.total,
    heli: { x: stage.exitX, y: stage.heliY },
    over: false,
    overAt: 0,
    hanging: 0,
    omega: 0,
    // 人が歩き出さないまま、物理だけ進めて落ち着かせる（タイトル画面と、始まる前の位置決め）
    settle(seconds) {
      for (let i = 0; i < Math.round(seconds / STEP); i++) world.step(STEP, 8, 3)
    },
    step(dt) {
      // 目標角度へバネで追従。角速度を制限して壁のすり抜けを防ぐ
      sim.targetAngle = Math.max(-MAX_TILT, Math.min(MAX_TILT, sim.targetAngle))
      const err = sim.targetAngle - house.getAngle()
      const w = Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, err * FOLLOW))
      house.setAngularVelocity(w)
      let n = Math.round(dt / STEP)
      n = Math.max(1, Math.min(8, n))
      for (let i = 0; i < n; i++) {
        for (const p of sim.people) walk(p)
        world.step(STEP, 8, 3)
      }
      sim.time += dt
      const t = sim.time
      sim.hanging = sim.people.filter((q) => q.onRope).length // ロープにぶら下がっている人数（画面の目盛りに使う）
      sim.omega = Math.abs(house.getAngularVelocity())
      sim.lava = stage.lavaStart + stage.lava.speed * t + stage.lava.accel * t * t
      const target = heliTarget()
      const k = 1 - Math.exp(-dt * HELI_FOLLOW)
      sim.heli.x += (target.x - sim.heli.x) * k
      sim.heli.y += (target.y - sim.heli.y) * k
      judge()
      for (const f of sim.fx) f.age += dt
      sim.fx = sim.fx.filter((f) => f.age < f.dur)
      if (!sim.over && sim.people.length === 0) {
        sim.over = true
        sim.overAt = t
        sim.events.push({ type: 'over' })
      }
    },
  }
  return sim
}

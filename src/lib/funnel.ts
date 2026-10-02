// Units are centimetres and seconds. The surface is the gravity well's
// Plummer-softened potential, offset so the rim sits at z = 0.
export const rimRadius = 45
export const holeRadius = 4.2
export const softening = 6
export const depthScale = 214
export const gravity = 981
export const tubeLength = 30

const rimOffset = 1 / Math.hypot(rimRadius, softening)

export function surfaceZ(r: number) {
  return -depthScale * (1 / Math.hypot(r, softening) - rimOffset)
}
export function slope(r: number) {
  return (depthScale * r) / (r * r + softening ** 2) ** 1.5
}
export function curvature(r: number) {
  const s2 = softening ** 2
  return (depthScale * (s2 - 2 * r * r)) / (r * r + s2) ** 2.5
}
export const holeDepth = surfaceZ(holeRadius)

export type CoinSpec = {
  id: string
  name: string
  value: number
  diameter: number
  thickness: number
  mass: number
  sides: number
  metal: "copper" | "nickel" | "brass" | "bimetal-gold" | "bimetal-silver"
}
// Real UK coin dimensions (cm, grams). 20p and 50p are Reuleaux heptagons,
// which have constant width and roll like discs.
export const coins: CoinSpec[] = [
  { id: "1p", name: "1p", value: 0.01, diameter: 2.03, thickness: 0.165, mass: 3.56, sides: 48, metal: "copper" },
  { id: "2p", name: "2p", value: 0.02, diameter: 2.59, thickness: 0.203, mass: 7.12, sides: 48, metal: "copper" },
  { id: "5p", name: "5p", value: 0.05, diameter: 1.8, thickness: 0.189, mass: 3.25, sides: 48, metal: "nickel" },
  { id: "10p", name: "10p", value: 0.1, diameter: 2.45, thickness: 0.185, mass: 6.5, sides: 48, metal: "nickel" },
  { id: "20p", name: "20p", value: 0.2, diameter: 2.14, thickness: 0.17, mass: 5, sides: 7, metal: "nickel" },
  { id: "50p", name: "50p", value: 0.5, diameter: 2.73, thickness: 0.178, mass: 8, sides: 7, metal: "nickel" },
  { id: "1", name: "£1", value: 1, diameter: 2.343, thickness: 0.28, mass: 8.75, sides: 12, metal: "bimetal-gold" },
  { id: "2", name: "£2", value: 2, diameter: 2.84, thickness: 0.25, mass: 12, sides: 48, metal: "bimetal-silver" },
]

// A disc rolling on its edge carries half again its translational energy in spin.
const rollingInertia = 1.5
// Exaggerated so a coin's size and weight visibly change how long it lasts.
const airDrag = 0.012
const rollingResistance = 1.6
const slidingFriction = 0.06
export const tipSpeed = 9
const rimRestitution = 0.45

export type Phase = "rolling" | "sliding" | "falling" | "done"
export type Coin = {
  spec: CoinSpec
  phase: Phase
  r: number
  dr: number
  theta: number
  omega: number
  z: number
  vz: number
  roll: number
  age: number
  laps: number
  topSpeed: number
  topSpin: number
  startTheta: number
  fallTime: number
}

export type Launch = { angle: number; speed: number; aim: number; direction: 1 | -1 }

// aim 0 is tangential to the rim; positive aim tips the velocity towards the hole.
export function launchCoin(spec: CoinSpec, launch: Launch): Coin {
  const r = rimRadius - spec.diameter / 2 - 0.3
  const aim = (launch.aim * Math.PI) / 180
  return launchAt(
    spec,
    r,
    launch.angle,
    -launch.speed * Math.sin(aim),
    launch.direction * launch.speed * Math.cos(aim)
  )
}

// Velocities are along the surface: radial (outward positive) and tangential.
export function launchAt(
  spec: CoinSpec,
  r: number,
  theta: number,
  radial: number,
  tangential: number
): Coin {
  const speed = Math.hypot(radial, tangential)
  r = Math.min(Math.max(r, holeRadius + 0.5), rimRadius - spec.diameter / 2)
  return {
    spec,
    phase: speed < tipSpeed ? "sliding" : "rolling",
    r,
    dr: radial / Math.sqrt(1 + slope(r) ** 2),
    theta,
    omega: tangential / r,
    z: surfaceZ(r),
    vz: 0,
    roll: 0,
    age: 0,
    laps: 0,
    topSpeed: speed,
    topSpin: Math.abs(tangential / r) / (Math.PI * 2),
    startTheta: theta,
    fallTime: 0,
  }
}

export function speedOf(coin: Coin) {
  const s = slope(coin.r)
  return Math.hypot(Math.sqrt(1 + s * s) * coin.dr, coin.r * coin.omega)
}

function deceleration(coin: Coin, v: number) {
  const { spec } = coin
  if (coin.phase === "sliding") {
    return (slidingFriction * gravity) / Math.sqrt(1 + slope(coin.r) ** 2)
  }
  const radius = spec.diameter / 2
  // Edge-on frontal area resists the air; a larger wheel rolls more easily.
  const drag = (airDrag * spec.diameter * spec.thickness * v * v) / spec.mass
  return (drag + rollingResistance / radius) / rollingInertia
}

type State = { r: number; dr: number; omega: number }
function derivative(coin: Coin, s: State) {
  const k = coin.phase === "rolling" ? rollingInertia : 1
  const fp = slope(s.r),
    fpp = curvature(s.r),
    metric = 1 + fp * fp
  const ur = Math.sqrt(metric) * s.dr,
    ut = s.r * s.omega
  const v = Math.hypot(ur, ut)
  const a = v > 1e-6 ? deceleration(coin, v) : 0
  const fr = v > 1e-6 ? (-a * ur) / v : 0,
    ft = v > 1e-6 ? (-a * ut) / v : 0
  const ddr =
    (s.r * s.omega * s.omega - (gravity / k) * fp - fp * fpp * s.dr * s.dr) /
      metric +
    fr / Math.sqrt(metric)
  const domega = (-2 * s.dr * s.omega + ft) / s.r
  return { dr: s.dr, ddr, domega, omega: s.omega }
}

export function stepCoin(coin: Coin, dt: number) {
  coin.age += dt
  if (coin.phase === "done") return
  if (coin.phase === "falling") {
    coin.fallTime += dt
    coin.vz -= gravity * dt
    coin.z += coin.vz * dt
    coin.theta += coin.omega * dt
    coin.omega *= Math.exp(-6 * dt)
    coin.r += (holeRadius * 0.15 - coin.r) * Math.min(1, dt * 8)
    if (coin.z < holeDepth - tubeLength) coin.phase = "done"
    return
  }
  const s0: State = { r: coin.r, dr: coin.dr, omega: coin.omega }
  const k1 = derivative(coin, s0)
  const at = (k: typeof k1, h: number): State => ({
    r: s0.r + k.dr * h,
    dr: s0.dr + k.ddr * h,
    omega: s0.omega + k.domega * h,
  })
  const k2 = derivative(coin, at(k1, dt / 2))
  const k3 = derivative(coin, at(k2, dt / 2))
  const k4 = derivative(coin, at(k3, dt))
  const dTheta = ((k1.omega + 2 * k2.omega + 2 * k3.omega + k4.omega) * dt) / 6
  coin.r += ((k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr) * dt) / 6
  coin.dr += ((k1.ddr + 2 * k2.ddr + 2 * k3.ddr + k4.ddr) * dt) / 6
  coin.omega += ((k1.domega + 2 * k2.domega + 2 * k3.domega + k4.domega) * dt) / 6
  coin.theta += dTheta
  coin.laps = Math.abs(coin.theta - coin.startTheta) / (Math.PI * 2)

  const rimLimit = rimRadius - coin.spec.diameter / 2
  if (coin.r > rimLimit) {
    coin.r = rimLimit
    if (coin.dr > 0) coin.dr *= -rimRestitution
    coin.omega *= 0.97
  }
  const v = speedOf(coin)
  coin.roll += (v * dt) / (coin.spec.diameter / 2)
  coin.topSpeed = Math.max(coin.topSpeed, v)
  coin.topSpin = Math.max(coin.topSpin, Math.abs(coin.omega) / (Math.PI * 2))
  if (coin.phase === "rolling" && v < tipSpeed) coin.phase = "sliding"
  coin.z = surfaceZ(coin.r)
  if (coin.r < holeRadius) {
    coin.phase = "falling"
    coin.vz = -Math.abs(slope(coin.r) * coin.dr)
  }
}

// How far a rolling coin leans off the surface normal, towards the centre when
// it is turning faster than the slope alone can hold it.
export function leanOf(coin: Coin) {
  if (coin.phase !== "rolling") return 0
  const alpha = Math.atan(slope(coin.r))
  const centripetal = coin.r * coin.omega * coin.omega
  return Math.max(
    -1.1,
    Math.min(
      1.1,
      Math.atan2(
        centripetal * Math.cos(alpha) - gravity * Math.sin(alpha),
        gravity * Math.cos(alpha) + centripetal * Math.sin(alpha)
      )
    )
  )
}

export function predictPath(start: Coin, maxPoints = 3000) {
  const coin = { ...start }
  const points: { x: number; y: number; z: number }[] = []
  const dt = 1 / 240
  let lastTheta = coin.theta
  for (let i = 0; i < 240 * 300; i++) {
    stepCoin(coin, dt)
    if (coin.phase === "falling" || coin.phase === "done") break
    if (
      points.length < maxPoints &&
      (Math.abs(coin.theta - lastTheta) > 0.06 || i % 24 === 0)
    ) {
      lastTheta = coin.theta
      points.push({
        x: coin.r * Math.cos(coin.theta),
        y: coin.r * Math.sin(coin.theta),
        z: coin.z,
      })
    }
  }
  return {
    points,
    laps: coin.laps,
    time: coin.age,
    topSpin: coin.topSpin,
    holed: coin.phase === "falling" || coin.phase === "done",
  }
}

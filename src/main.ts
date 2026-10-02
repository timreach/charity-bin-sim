import "./styles.css"
import * as THREE from "three"
import {
  coins,
  holeRadius,
  launchAt,
  launchCoin,
  predictPath,
  rimRadius,
  slope,
  speedOf,
  stepCoin,
} from "./lib/funnel"
import type { Coin, CoinSpec, Launch } from "./lib/funnel"
import {
  boxHalf,
  boxFloor,
  boxTop,
  chuteLength,
  createBin,
  createCoinMesh,
  metalColors,
  poseCoin,
  poseOnChute,
  Trail,
  trailColors,
} from "./scene"
import type { Theme } from "./scene"
import { createAudio } from "./audio"

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>("scene")
const bin = createBin(canvas)
const audio = createAudio()

const chuteAngles = [Math.PI / 2, 0, -Math.PI / 2, Math.PI]
const chuteNames = ["Front", "Right", "Back", "Left"]
const metalNames: Record<CoinSpec["metal"], string> = {
  copper: "copper-plated steel",
  nickel: "cupronickel",
  brass: "nickel-brass",
  "bimetal-gold": "bimetallic",
  "bimetal-silver": "bimetallic",
}
const maxInPlay = 250
const maxPile = 400
const chuteTime = 0.32
const step = 1 / 360

const settings = {
  coin: 1,
  mixed: false,
  chute: 0,
  direction: -1 as 1 | -1,
  speed: 48,
  aim: 0,
  auto: false,
  rate: 1.5,
  timeScale: 1,
  guides: true,
  trails: true,
  sound: true,
  paused: false,
}

type Pending = { spec: CoinSpec; launch: Launch; t: number; mesh: THREE.Object3D; chute: number }
type Active = {
  coin: Coin
  mesh: THREE.Object3D
  trail: Trail
  trailClock: number
  entry: string
  holed: boolean
  land?: { x: number; y: number; z: number; start: THREE.Vector3 }
}
const pending: Pending[] = []
let active: Active[] = []
const pile: THREE.Object3D[] = []
const pileHeights = new Float32Array(36)
let raised = 0
let dropped = 0
let best: { laps: number; name: string; spin: number } | null = null
let fade = new THREE.Color()

function pickSpec() {
  return settings.mixed ? coins[Math.floor(Math.random() * coins.length)] : coins[settings.coin]
}
function currentLaunch(chute = settings.chute): Launch {
  return { angle: chuteAngles[chute], speed: settings.speed, aim: settings.aim, direction: settings.direction }
}
function inPlay() {
  return pending.length + active.length
}

function dropFromChute(spec = pickSpec(), launch = currentLaunch(), chute = settings.chute) {
  if (inPlay() >= maxInPlay) return
  audio.ensure()
  const mesh = createCoinMesh(spec)
  bin.scene.add(mesh)
  pending.push({ spec, launch, t: 0, mesh, chute })
  hideHint()
}
function addActive(coin: Coin, entry: string) {
  const mesh = createCoinMesh(coin.spec)
  bin.scene.add(mesh)
  const trail = new Trail(new THREE.Color(trailColors[coin.spec.id]))
  trail.line.visible = settings.trails
  bin.scene.add(trail.line)
  active.push({ coin, mesh, trail, trailClock: 0, entry, holed: false })
}

function stepPending(dt: number) {
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i]
    p.t += dt
    const f = Math.min(1, p.t / chuteTime)
    const r = rimRadius - p.spec.diameter / 2 - 0.3
    // Accelerating down the ramp: distance covered goes as the square of time.
    const distance = chuteLength * (1 - f * f)
    const { point, forward } = bin.chuteFrame(p.launch.angle, p.launch.direction, distance, r)
    poseOnChute(p.mesh, p.spec, point, forward, chuteLength * f * f)
    if (f >= 1) {
      bin.scene.remove(p.mesh)
      pending.splice(i, 1)
      addActive(launchCoin(p.spec, p.launch), chuteNames[p.chute])
    }
  }
}

function landSpot(spec: CoinSpec) {
  const x = (Math.random() * 2 - 1) * (boxHalf - 2.5)
  const z = (Math.random() * 2 - 1) * (boxHalf - 2.5)
  const cell = Math.min(5, Math.floor(((x + boxHalf) / (boxHalf * 2)) * 6)) * 6 + Math.min(5, Math.floor(((z + boxHalf) / (boxHalf * 2)) * 6))
  const y = boxFloor + pileHeights[cell] + spec.thickness / 2
  pileHeights[cell] += spec.thickness * 0.9
  return { x, y, z }
}

function settle(a: Active) {
  const { mesh, coin } = a
  mesh.position.set(a.land!.x, a.land!.y, a.land!.z)
  mesh.quaternion.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.25, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.25))
  pile.push(mesh)
  if (pile.length > maxPile) bin.scene.remove(pile.shift()!)
  bin.scene.remove(a.trail.line)
  a.trail.dispose()
  raised += coin.spec.value
  dropped++
  audio.clink(coin.spec.diameter * 10)
}

function record(a: Active) {
  const { coin } = a
  const li = document.createElement("li")
  li.className = "fresh"
  li.innerHTML = `<span>${coin.spec.name}</span><span>${coin.laps.toFixed(1)} laps</span><span>${coin.age.toFixed(1)} s</span><span>${coin.topSpin.toFixed(1)} rev/s</span>`
  li.title = `Entered at ${a.entry}`
  const list = $("results")
  list.prepend(li)
  while (list.children.length > 6) list.lastElementChild!.remove()
  if (!best || coin.laps > best.laps) best = { laps: coin.laps, name: coin.spec.name, spin: coin.topSpin }
  $("record").textContent = `Most laps: ${best.laps.toFixed(1)} (${best.name}, peak ${best.spin.toFixed(1)} rev/s)`
}

function stepActive(dt: number) {
  const steps = Math.ceil(dt / step - 1e-9)
  const h = dt / steps
  for (const a of active) {
    for (let k = 0; k < steps && a.coin.phase !== "done"; k++) stepCoin(a.coin, h)
    a.trailClock += dt
  }
}

function render() {
  let rolling = 0,
    fastest = 0
  const survivors: Active[] = []
  for (const a of active) {
    const { coin } = a
    if (coin.phase === "falling" && !a.holed) {
      a.holed = true
      record(a)
      audio.rattle(coin.spec.diameter * 10)
    }
    if (coin.phase === "falling" || coin.phase === "done") {
      if (!a.land) a.land = { ...landSpot(coin.spec), start: new THREE.Vector3() }
      poseCoin(a.mesh, coin)
      if (coin.z < boxTop) {
        if (!a.land.start.lengthSq()) a.land.start.copy(a.mesh.position).setY(1)
        const f = Math.min(1, (boxTop - coin.z) / (boxTop - a.land.y))
        a.mesh.position.x = a.land.start.x + (a.land.x - a.land.start.x) * f
        a.mesh.position.z = a.land.start.z + (a.land.z - a.land.start.z) * f
      }
      if (coin.z <= a.land.y || coin.phase === "done") {
        settle(a)
        continue
      }
    } else {
      poseCoin(a.mesh, coin)
      if (coin.phase === "rolling") {
        rolling++
        fastest = Math.max(fastest, Math.abs(coin.omega) / (Math.PI * 2))
      }
    }
    if (a.trailClock >= 0.03) {
      a.trailClock = 0
      a.trail.push(coin.r * Math.cos(coin.theta), coin.z, coin.r * Math.sin(coin.theta), fade)
    }
    survivors.push(a)
  }
  active = survivors
  audio.setWhirr(settings.paused ? 0 : rolling, fastest)

  $("raised").textContent = `£${raised.toFixed(2)}`
  $("in-play").textContent = String(inPlay())
  $("dropped").textContent = String(dropped)
  let latest: Active | undefined
  for (const a of active)
    if (a.coin.phase === "rolling" && (!latest || Math.abs(a.coin.omega) > Math.abs(latest.coin.omega))) latest = a
  latest ??= active.find((a) => a.coin.phase === "sliding")
  if (latest) {
    const c = latest.coin
    const state = c.phase === "sliding" ? "fallen flat, sliding" : `${(Math.abs(c.omega) / (Math.PI * 2)).toFixed(2)} rev/s`
    $("live").textContent = `Fastest: ${c.spec.name} · lap ${c.laps.toFixed(1)} · ${speedOf(c).toFixed(0)} cm/s · ${state}`
  } else $("live").textContent = "No coins rolling"
}

// Prediction guide for the selected chute, or for the flick being dragged.
let guideDirty = true
let flickCoin: Coin | null = null
function updateGuide() {
  if (!guideDirty) return
  guideDirty = false
  const spec = coins[settings.coin]
  const start = flickCoin ?? launchCoin(spec, currentLaunch())
  const path = predictPath(start)
  bin.setGuide(path.points, trailColors[spec.id])
  bin.guide.visible = settings.guides || !!flickCoin
  const text = $("prediction")
  if (start.phase === "sliding" || path.laps < 0.5)
    text.innerHTML = `Predicted: too slow to stay on edge. It <b>falls flat</b> and slides in.`
  else if (!path.holed) text.innerHTML = `Predicted: still rolling after ${path.time.toFixed(0)} s.`
  else
    text.innerHTML = `Predicted for ${spec.name}: <b>${path.laps.toFixed(1)} laps</b> in ${path.time.toFixed(0)} s, peaking at ${path.topSpin.toFixed(1)} rev/s.`
}

// Flicking: press on the funnel, drag out a velocity, release to launch.
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
function hitFunnel(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect()
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, bin.camera)
  const hit = raycaster.intersectObject(bin.sheet)[0]
  if (!hit) return null
  const r = Math.hypot(hit.point.x, hit.point.z)
  if (r < holeRadius + 1 || r > rimRadius - 1) return null
  return hit.point
}
let flick: { id: number; start: THREE.Vector3; end: THREE.Vector3 } | null = null
function flickVelocity(start: THREE.Vector3, end: THREE.Vector3) {
  const r = Math.hypot(start.x, start.z),
    theta = Math.atan2(start.z, start.x)
  const er = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta))
  const tr = er.clone().add(new THREE.Vector3(0, slope(r), 0)).normalize()
  const et = new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta))
  const d = end.clone().sub(start)
  let radial = d.dot(tr) * 5,
    tangential = d.dot(et) * 5
  const speed = Math.hypot(radial, tangential)
  if (speed > 150) {
    radial *= 150 / speed
    tangential *= 150 / speed
  }
  return { r, theta, radial, tangential, length: d.length() }
}
function tapLaunch(start: THREE.Vector3) {
  const r = Math.hypot(start.x, start.z),
    theta = Math.atan2(start.z, start.x),
    aim = (settings.aim * Math.PI) / 180
  return launchAt(pickSpec(), r, theta, -settings.speed * Math.sin(aim), settings.direction * settings.speed * Math.cos(aim))
}
// Registered before OrbitControls so a press on the funnel never starts an orbit.
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || flick) return
  const point = hitFunnel(event)
  if (!point) {
    canvas.classList.add("orbiting")
    return
  }
  event.stopImmediatePropagation()
  canvas.setPointerCapture(event.pointerId)
  flick = { id: event.pointerId, start: point.clone(), end: point.clone() }
  audio.ensure()
})
canvas.addEventListener("pointermove", (event) => {
  if (!flick || event.pointerId !== flick.id) return
  const rect = canvas.getBoundingClientRect()
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, bin.camera)
  // Drag across a plane through the press point so the flick works off the funnel too.
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -flick.start.y)
  raycaster.ray.intersectPlane(plane, flick.end)
  const v = flickVelocity(flick.start, flick.end)
  bin.setFlick(flick.start, flick.end)
  flickCoin = v.length < 1.2 ? tapLaunch(flick.start) : launchAt(coins[settings.coin], v.r, v.theta, v.radial, v.tangential)
  guideDirty = true
})
function endFlick(event: PointerEvent) {
  canvas.classList.remove("orbiting")
  if (!flick || event.pointerId !== flick.id) return
  const v = flickVelocity(flick.start, flick.end)
  if (event.type === "pointerup" && inPlay() < maxInPlay) {
    if (v.length < 1.2) addActive(tapLaunch(flick.start), "a tap")
    else addActive(launchAt(pickSpec(), v.r, v.theta, v.radial, v.tangential), "a flick")
    hideHint()
  }
  flick = null
  flickCoin = null
  bin.setFlick(null)
  guideDirty = true
}
canvas.addEventListener("pointerup", endFlick)
canvas.addEventListener("pointercancel", endFlick)
const controls = bin.controls()

function hideHint() {
  $("hint").style.opacity = "0"
}

// Controls panel
const coinGrid = $("coin-grid")
coins.forEach((spec, i) => {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "coin-button"
  const size = spec.diameter * 9
  const face = document.createElement("span")
  face.className = "coin-face" + (spec.sides > 12 ? " round" : "")
  const color = spec.metal === "copper" ? metalColors.copper : spec.metal === "nickel" ? metalColors.nickel : metalColors.brass
  face.style.cssText = `width:${size}px;height:${size}px;--face:${
    spec.metal.startsWith("bimetal") ? `radial-gradient(circle, ${metalColors.nickel} 0 52%, ${metalColors.brass} 54%)` : color
  }`
  if (spec.sides <= 12) {
    const points = Array.from({ length: spec.sides }, (_, k) => {
      const a = (k / spec.sides) * Math.PI * 2 - Math.PI / 2
      return `${50 + 50 * Math.cos(a)}% ${50 + 50 * Math.sin(a)}%`
    })
    face.style.clipPath = `polygon(${points.join(",")})`
  }
  button.append(face, spec.name)
  button.addEventListener("click", () => selectCoin(i))
  coinGrid.append(button)
})
function selectCoin(i: number) {
  settings.coin = i
  ;[...coinGrid.children].forEach((b, k) => b.classList.toggle("active", k === i))
  const s = coins[i]
  syncQuickCoin()
  $("coin-spec").textContent = `${s.name} · ${(s.diameter * 10).toFixed(1)} mm · ${s.mass.toFixed(2)} g · ${(s.thickness * 10).toFixed(2)} mm thick · ${metalNames[s.metal]}`
  guideDirty = true
}

const chuteBar = $("chutes")
chuteNames.forEach((name, i) => {
  const button = document.createElement("button")
  button.type = "button"
  button.textContent = name
  button.addEventListener("click", () => selectChute(i))
  chuteBar.append(button)
})
function selectChute(i: number) {
  settings.chute = i
  ;[...chuteBar.children].forEach((b, k) => b.classList.toggle("active", k === i))
  bin.placeChutes(chuteAngles, settings.direction, i)
  guideDirty = true
}
$("direction").querySelectorAll("button").forEach((button) =>
  button.addEventListener("click", () => {
    settings.direction = Number(button.dataset.dir) as 1 | -1
    $("direction").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === button))
    selectChute(settings.chute)
  })
)

function slider(id: string, format: (v: number) => string, apply: (v: number) => void) {
  const input = $<HTMLInputElement>(id)
  const out = $(`${id}-out`)
  const sync = () => {
    const v = Number(input.value)
    out.textContent = format(v)
    apply(v)
    guideDirty = true
  }
  input.addEventListener("input", sync)
  sync()
}
slider("speed", (v) => `${v} cm/s`, (v) => (settings.speed = v))
slider(
  "aim",
  (v) => (v === 0 ? "0° along the rim" : v > 0 ? `${v}° inward` : `${-v}° outward`),
  (v) => (settings.aim = v)
)
slider("rate", (v) => `${v.toFixed(1)} coins/s`, (v) => (settings.rate = v))
slider("time", (v) => `${v.toFixed(2)}×`, (v) => (settings.timeScale = v))

function toggle(id: string, apply: (on: boolean) => void) {
  const input = $<HTMLInputElement>(id)
  input.addEventListener("change", () => apply(input.checked))
  apply(input.checked)
  return input
}
function syncQuickCoin() {
  $("quick-coin").textContent = settings.mixed ? "mixed" : coins[settings.coin].name
}
toggle("mixed", (on) => {
  settings.mixed = on
  syncQuickCoin()
})
const autoInput = toggle("auto", (on) => {
  settings.auto = on
  $("quick-auto").setAttribute("aria-pressed", String(on))
})
const guidesInput = toggle("guides", (on) => {
  settings.guides = on
  guideDirty = true
})
toggle("trails", (on) => {
  settings.trails = on
  for (const a of active) a.trail.line.visible = on
})
toggle("sound", (on) => {
  settings.sound = on
  audio.setEnabled(on)
})

$("drop").addEventListener("click", () => dropFromChute())
$("quick-drop").addEventListener("click", () => dropFromChute())
$("quick-auto").addEventListener("click", () => {
  autoInput.checked = !autoInput.checked
  autoInput.dispatchEvent(new Event("change"))
})
let pumpHeld = false
let pumpClock = 0
for (const pump of [$("pump"), $("quick-pump")]) {
  const stopPump = () => {
    pumpHeld = false
    pump.classList.remove("held")
  }
  pump.addEventListener("pointerdown", (e) => {
    e.preventDefault()
    pumpHeld = true
    pumpClock = Infinity
    pump.classList.add("held")
  })
  pump.addEventListener("pointerup", stopPump)
  pump.addEventListener("pointerleave", stopPump)
  pump.addEventListener("pointercancel", stopPump)
  pump.addEventListener("contextmenu", (e) => e.preventDefault())
}
const pauseButton = $("pause")
function togglePause() {
  settings.paused = !settings.paused
  pauseButton.textContent = settings.paused ? "Resume" : "Pause"
}
pauseButton.addEventListener("click", togglePause)
$("clear").addEventListener("click", () => {
  for (const p of pending) bin.scene.remove(p.mesh)
  for (const a of active) {
    bin.scene.remove(a.mesh, a.trail.line)
    a.trail.dispose()
  }
  for (const m of pile) bin.scene.remove(m)
  pending.length = 0
  active = []
  pile.length = 0
  pileHeights.fill(0)
  raised = 0
  dropped = 0
  best = null
  $("results").replaceChildren()
  $("record").textContent = ""
})

// On narrow screens the panel is a bottom drawer that peeks its quick actions.
const panel = $("panel")
const panelBody = $("panel-body")
const grabber = $("panel-toggle")
const drawerQuery = matchMedia("(max-width: 860px)")
function peekHeight() {
  return $("drawer-head").offsetHeight + parseFloat(getComputedStyle(panel).paddingBottom)
}
function setDrawer(open: boolean) {
  panel.classList.toggle("collapsed", !open)
  grabber.setAttribute("aria-expanded", String(open))
  grabber.setAttribute("aria-label", open ? "Hide controls" : "Show all controls")
  panelBody.inert = drawerQuery.matches && !open
}
function syncDrawer() {
  document.documentElement.style.setProperty("--peek", `${peekHeight()}px`)
  setDrawer(!panel.classList.contains("collapsed"))
}
drawerQuery.addEventListener("change", syncDrawer)
window.addEventListener("resize", syncDrawer)
syncDrawer()
let drag: { id: number; y: number; time: number; from: number; offset: number; moved: boolean } | null = null
grabber.addEventListener("pointerdown", (e) => {
  const closed = panel.offsetHeight - peekHeight()
  drag = { id: e.pointerId, y: e.clientY, time: e.timeStamp, from: panel.classList.contains("collapsed") ? closed : 0, offset: 0, moved: false }
  drag.offset = drag.from
  grabber.setPointerCapture(e.pointerId)
})
grabber.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return
  const dy = e.clientY - drag.y
  if (Math.abs(dy) > 5) drag.moved = true
  if (!drag.moved) return
  drag.offset = Math.min(Math.max(drag.from + dy, 0), panel.offsetHeight - peekHeight())
  panel.style.transition = "none"
  panel.style.transform = `translateY(${drag.offset}px)`
})
function endDrag(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  const { moved, offset, y, time } = drag
  drag = null
  panel.style.transition = ""
  panel.style.transform = ""
  if (!moved) return setDrawer(panel.classList.contains("collapsed"))
  // A quick flick wins over where the drawer was let go.
  const velocity = (e.clientY - y) / Math.max(1, e.timeStamp - time)
  const closed = panel.offsetHeight - peekHeight()
  setDrawer(Math.abs(velocity) > 0.5 ? velocity < 0 : offset < closed / 2)
}
grabber.addEventListener("pointerup", endDrag)
grabber.addEventListener("click", (e) => {
  if (e.detail === 0) setDrawer(panel.classList.contains("collapsed"))
})
grabber.addEventListener("pointercancel", endDrag)

let lastSpace = 0
window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.code === "Space") {
    e.preventDefault()
    const now = performance.now()
    if (now - lastSpace > 110) {
      lastSpace = now
      dropFromChute()
    }
  } else if (/^Digit[1-8]$/.test(e.code)) selectCoin(Number(e.code.slice(5)) - 1)
  else if (e.code === "KeyA") {
    autoInput.checked = !autoInput.checked
    autoInput.dispatchEvent(new Event("change"))
  } else if (e.code === "KeyG") {
    guidesInput.checked = !guidesInput.checked
    guidesInput.dispatchEvent(new Event("change"))
  } else if (e.code === "KeyP") togglePause()
  else if (e.code === "Escape" && drawerQuery.matches) setDrawer(false)
})
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") e.preventDefault()
})

// Theme follows the system until toggled, then remembers the choice.
function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("theme")
    if (saved === "light" || saved === "dark") return saved
  } catch {}
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
  fade = bin.setTheme(theme)
}
let theme = readTheme()
applyTheme(theme)
$("theme").addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark"
  applyTheme(theme)
  try {
    localStorage.setItem("theme", theme)
  } catch {}
})

selectCoin(settings.coin)
selectChute(settings.chute)
new ResizeObserver(bin.resize).observe(canvas)
bin.resize()

let last = 0
let autoClock = 0
function tick(now: number) {
  const delta = last ? Math.min((now - last) / 1000, 0.05) : 0
  last = now
  if (!settings.paused) {
    const dt = delta * settings.timeScale
    if (settings.auto) {
      autoClock += dt
      while (autoClock >= 1 / settings.rate) {
        autoClock -= 1 / settings.rate
        const chute = Math.floor(Math.random() * 4)
        dropFromChute(
          coins[Math.floor(Math.random() * coins.length)],
          { angle: chuteAngles[chute], speed: 38 + Math.random() * 26, aim: Math.random() * 14, direction: settings.direction },
          chute
        )
      }
    }
    if (pumpHeld) {
      pumpClock += delta
      if (pumpClock >= 0.2) {
        pumpClock = 0
        dropFromChute()
      }
    }
    if (dt > 0) {
      stepPending(dt)
      stepActive(dt)
    }
  }
  render()
  updateGuide()
  controls.update()
  bin.renderer.render(bin.scene, bin.camera)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

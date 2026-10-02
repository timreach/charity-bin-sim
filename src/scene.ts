import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import {
  holeDepth,
  holeRadius,
  leanOf,
  rimRadius,
  slope,
  surfaceZ,
  tubeLength,
} from "./lib/funnel"
import type { Coin, CoinSpec } from "./lib/funnel"

export const artAccents = {
  orange: "#d76b2d",
  blue: "#517fdb",
  teal: "#348b85",
  gold: "#c49a42",
  violet: "#8b67b0",
  red: "#d44843",
  lime: "#a3b51b",
} as const

export const trailColors: Record<string, string> = {
  "1p": artAccents.orange,
  "2p": artAccents.red,
  "5p": artAccents.teal,
  "10p": artAccents.blue,
  "20p": artAccents.lime,
  "50p": artAccents.violet,
  "1": artAccents.gold,
  "2": "#4aa0c8",
}
export const metalColors = {
  copper: "#b8673a",
  nickel: "#c4c8cc",
  brass: "#d2ab4a",
}

const palettes = {
  light: { background: "#fafafa", sheet: "#d2d2d2", grid: "#8f8f8f", rim: "#9a9a9a", glass: "#9fb4c0" },
  dark: { background: "#151515", sheet: "#2c2c2c", grid: "#5e5e5e", rim: "#5a5a5a", glass: "#5d7280" },
}
export type Theme = keyof typeof palettes

export const chuteLength = 9
export const chuteRise = 0.32
export const boxFloor = holeDepth - tubeLength
export const boxTop = holeDepth - 9
export const boxHalf = 15

// Surface point in world space: y is up, the funnel axis is the y axis.
export function surfacePoint(r: number, a: number, lift = 0) {
  return new THREE.Vector3(r * Math.cos(a), surfaceZ(r) + lift, r * Math.sin(a))
}

function lines(parent: THREE.Object3D, points: number[], color: string) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
  const result = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }))
  parent.add(result)
  return result
}

export function createBin(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.7
  scene.add(new THREE.HemisphereLight("#ffffff", "#888888", 0.8))
  const sun = new THREE.DirectionalLight("#ffffff", 1.6)
  sun.position.set(30, 90, 50)
  scene.add(sun)

  const camera = new THREE.PerspectiveCamera(36, 1, 1, 2000)
  camera.position.set(0, 58, 102)

  // Funnel: the gravity well's surface and grid, cut at the hole and the rim.
  const rings = 28,
    spokes = 72
  const radiusAt = (f: number) => holeRadius + (rimRadius - holeRadius) * f ** 1.6
  const surface: number[] = [],
    indices: number[] = []
  for (let j = 0; j <= rings; j++)
    for (let i = 0; i <= spokes; i++) {
      const p = surfacePoint(radiusAt(j / rings), (i / spokes) * Math.PI * 2)
      surface.push(p.x, p.y, p.z)
    }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < spokes; i++) {
      const a = j * (spokes + 1) + i,
        b = a + spokes + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  const sheetGeometry = new THREE.BufferGeometry()
  sheetGeometry.setAttribute("position", new THREE.Float32BufferAttribute(surface, 3))
  sheetGeometry.setIndex(indices)
  sheetGeometry.computeVertexNormals()
  const sheetMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.48,
    metalness: 0.15,
    side: THREE.DoubleSide,
    // Pushed back so the grid drawn on the same surface never z-fights it.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  const sheet = new THREE.Mesh(sheetGeometry, sheetMaterial)
  scene.add(sheet)

  const grid: number[] = []
  const push = (a: THREE.Vector3, b: THREE.Vector3) => grid.push(a.x, a.y, a.z, b.x, b.y, b.z)
  for (let k = 0; k <= 12; k++) {
    const r = radiusAt(k / 12)
    for (let i = 0; i < 96; i++)
      push(surfacePoint(r, (i / 96) * Math.PI * 2), surfacePoint(r, ((i + 1) / 96) * Math.PI * 2))
  }
  for (let k = 0; k < 24; k++)
    for (let i = 0; i < 40; i++) {
      const a = (k / 24) * Math.PI * 2
      push(surfacePoint(radiusAt(i / 40), a), surfacePoint(radiusAt((i + 1) / 40), a))
    }
  const gridLines = lines(scene, grid, "#8f8f8f")

  const rimMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 })
  const rim = new THREE.Mesh(new THREE.TorusGeometry(rimRadius + 0.6, 0.7, 12, 160), rimMaterial)
  rim.rotation.x = Math.PI / 2
  scene.add(rim)
  const lip = new THREE.Mesh(
    new THREE.CylinderGeometry(rimRadius + 1.2, rimRadius + 1.2, 6, 160, 1, true),
    rimMaterial
  )
  lip.position.y = -3
  scene.add(lip)

  const glassMaterial = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.16,
    roughness: 0.1,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(holeRadius, holeRadius, holeDepth - boxTop, 40, 1, true),
    glassMaterial
  )
  tube.position.y = (holeDepth + boxTop) / 2
  scene.add(tube)
  const tubeEdges = lines(scene, [], "#8f8f8f")
  const box = new THREE.BoxGeometry(boxHalf * 2, boxTop - boxFloor, boxHalf * 2)
  const boxMesh = new THREE.Mesh(box, glassMaterial)
  boxMesh.position.y = (boxTop + boxFloor) / 2
  scene.add(boxMesh)
  const boxEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(box),
    new THREE.LineBasicMaterial({ color: "#8f8f8f" })
  )
  boxEdges.position.copy(boxMesh.position)
  scene.add(boxEdges)
  {
    const pts: number[] = []
    for (const y of [holeDepth, boxTop])
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2,
          b = ((i + 1) / 40) * Math.PI * 2
        pts.push(holeRadius * Math.cos(a), y, holeRadius * Math.sin(a))
        pts.push(holeRadius * Math.cos(b), y, holeRadius * Math.sin(b))
      }
    tubeEdges.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
  }

  // Chutes: short ramps that run over the rim along its tangent.
  const chuteMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 })
  const chuteActive = new THREE.MeshStandardMaterial({ color: artAccents.gold, roughness: 0.5, metalness: 0.2 })
  const chutes = [0, 1, 2, 3].map(() => {
    const group = new THREE.Group()
    const bed = new THREE.Mesh(new THREE.BoxGeometry(chuteLength, 0.35, 3.6), chuteMaterial)
    bed.position.set(chuteLength / 2, -0.18, 0)
    group.add(bed)
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(chuteLength, 1.4, 0.25), chuteMaterial)
      wall.position.set(chuteLength / 2, 0.5, side * 1.9)
      group.add(wall)
    }
    scene.add(group)
    return { group, bed }
  })
  function chuteFrame(angle: number, direction: number, distance: number, r: number) {
    const er = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
    const et = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(direction)
    const back = et.clone().negate()
    const start = er.clone().multiplyScalar(r)
    const point = start.addScaledVector(back, distance)
    point.y = surfaceZ(r) + distance * chuteRise
    return { point, forward: et, er }
  }
  function placeChutes(angles: number[], direction: number, active: number) {
    chutes.forEach(({ group, bed }, i) => {
      const r = rimRadius - 1.6
      const { point, forward } = chuteFrame(angles[i], direction, 0, r)
      group.position.copy(point)
      const back = forward.clone().negate()
      const up = new THREE.Vector3(0, 1, 0)
      const along = back.clone().addScaledVector(up, chuteRise).normalize()
      const side = new THREE.Vector3().crossVectors(along, up).normalize()
      const normal = new THREE.Vector3().crossVectors(side, along)
      group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, normal, side))
      bed.material = i === active ? chuteActive : chuteMaterial
    })
  }

  const guideGeometry = new THREE.BufferGeometry()
  const guide = new THREE.Line(
    guideGeometry,
    new THREE.LineDashedMaterial({ color: artAccents.gold, dashSize: 1.4, gapSize: 1.1 })
  )
  scene.add(guide)
  function setGuide(points: { x: number; y: number; z: number }[], color: string) {
    const flat: number[] = []
    for (const p of points) flat.push(p.x, p.z + 0.25, p.y)
    guideGeometry.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3))
    guideGeometry.computeBoundingSphere()
    guide.computeLineDistances()
    ;(guide.material as THREE.LineDashedMaterial).color.set(color)
  }
  const flickGeometry = new THREE.BufferGeometry()
  const flick = new THREE.Line(flickGeometry, new THREE.LineBasicMaterial({ color: artAccents.red }))
  flick.visible = false
  scene.add(flick)
  function setFlick(from: THREE.Vector3 | null, to?: THREE.Vector3) {
    flick.visible = !!from
    if (!from || !to) return
    const dir = to.clone().sub(from)
    const tip = from.clone().add(dir)
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.9)
    const head = dir.clone().normalize().multiplyScalar(-1.8)
    const a = tip.clone().add(head).add(side),
      b = tip.clone().add(head).sub(side)
    flickGeometry.setFromPoints([from, tip, a, tip, b].map((p) => p.clone().setY(p.y + 0.4)))
  }

  function setTheme(theme: Theme) {
    const p = palettes[theme]
    renderer.setClearColor(p.background)
    sheetMaterial.color.set(p.sheet)
    for (const l of [gridLines, tubeEdges, boxEdges]) (l.material as THREE.LineBasicMaterial).color.set(p.grid)
    rimMaterial.color.set(p.rim)
    chuteMaterial.color.set(p.rim)
    glassMaterial.color.set(p.glass)
    return new THREE.Color(p.sheet)
  }

  const controls = () => {
    const c = new OrbitControls(camera, canvas)
    c.target.set(0, -20, 0)
    c.enableDamping = true
    c.enablePan = false
    c.minDistance = 40
    c.maxDistance = 260
    c.maxPolarAngle = Math.PI * 0.62
    c.update()
    return c
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // Keep the whole funnel in frame on tall, narrow screens.
    camera.zoom = Math.min(1, camera.aspect / 1.15)
    camera.updateProjectionMatrix()
  }

  return { renderer, scene, camera, sheet, controls, chuteFrame, placeChutes, setGuide, guide, setFlick, setTheme, resize }
}

const geometryCache = new Map<string, THREE.BufferGeometry[]>()
const materials = {
  copper: new THREE.MeshStandardMaterial({ color: metalColors.copper, metalness: 1, roughness: 0.34 }),
  nickel: new THREE.MeshStandardMaterial({ color: metalColors.nickel, metalness: 1, roughness: 0.3 }),
  brass: new THREE.MeshStandardMaterial({ color: metalColors.brass, metalness: 1, roughness: 0.3 }),
}
function coinGeometry(spec: CoinSpec) {
  let cached = geometryCache.get(spec.id)
  if (!cached) {
    // A regular heptagon's width across is about 1.9 times its circumradius.
    const radius = spec.sides === 7 ? spec.diameter / 1.9 : spec.diameter / 2
    const outer = new THREE.CylinderGeometry(radius, radius, spec.thickness, spec.sides)
    if (spec.sides === 7) outer.rotateY(Math.PI / 14)
    cached = [outer]
    if (spec.metal.startsWith("bimetal"))
      cached.push(new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, spec.thickness * 1.06, 40))
    geometryCache.set(spec.id, cached)
  }
  return cached
}
export function createCoinMesh(spec: CoinSpec) {
  const group = new THREE.Group()
  const [outer, inner] = coinGeometry(spec)
  const outerMaterial = spec.metal === "copper" ? materials.copper : spec.metal === "nickel" ? materials.nickel : materials.brass
  group.add(new THREE.Mesh(outer, outerMaterial))
  if (inner) group.add(new THREE.Mesh(inner, materials.nickel))
  return group
}

const up = new THREE.Vector3(0, 1, 0)
const er = new THREE.Vector3(),
  et = new THREE.Vector3(),
  tr = new THREE.Vector3(),
  normal = new THREE.Vector3(),
  velocity = new THREE.Vector3(),
  inward = new THREE.Vector3(),
  upright = new THREE.Vector3(),
  axis = new THREE.Vector3(),
  third = new THREE.Vector3(),
  basis = new THREE.Matrix4(),
  spin = new THREE.Quaternion()

// Rolling coins stand on edge, banked off the surface normal by their lean and
// turned about their axle by the distance rolled.
export function poseCoin(object: THREE.Object3D, coin: Coin) {
  const { r, theta, spec } = coin
  const radius = spec.diameter / 2
  if (coin.phase === "falling") {
    object.position.set(r * Math.cos(theta), coin.z + radius, r * Math.sin(theta))
    spin.setFromAxisAngle(up, coin.omega * 0.016)
    object.quaternion.premultiply(spin)
    return
  }
  const s = slope(r)
  er.set(Math.cos(theta), 0, Math.sin(theta))
  et.set(-Math.sin(theta), 0, Math.cos(theta))
  tr.copy(er).addScaledVector(up, s).normalize()
  normal.copy(up).addScaledVector(er, -s).normalize()
  object.position.set(r * Math.cos(theta), coin.z, r * Math.sin(theta))
  if (coin.phase === "sliding") {
    third.crossVectors(tr, normal)
    basis.makeBasis(tr, normal, third)
    object.quaternion.setFromRotationMatrix(basis)
    object.quaternion.multiply(spin.setFromAxisAngle(up, coin.roll * 0.3))
    object.position.addScaledVector(normal, spec.thickness / 2 + 0.03)
    return
  }
  velocity
    .copy(tr)
    .multiplyScalar(Math.sqrt(1 + s * s) * coin.dr)
    .addScaledVector(et, r * coin.omega)
  if (velocity.lengthSq() < 1e-8) velocity.copy(et)
  velocity.normalize()
  inward.copy(tr).negate()
  inward.addScaledVector(velocity, -inward.dot(velocity)).normalize()
  const lean = leanOf(coin)
  upright.copy(normal).multiplyScalar(Math.cos(lean)).addScaledVector(inward, Math.sin(lean))
  axis.crossVectors(velocity, upright).normalize()
  third.crossVectors(velocity, axis)
  basis.makeBasis(velocity, axis, third)
  object.quaternion.setFromRotationMatrix(basis)
  object.quaternion.multiply(spin.setFromAxisAngle(up, -coin.roll))
  object.position.addScaledVector(upright, radius).addScaledVector(normal, 0.02)
}

export function poseOnChute(
  object: THREE.Object3D,
  spec: CoinSpec,
  point: THREE.Vector3,
  forward: THREE.Vector3,
  rolled: number
) {
  const radius = spec.diameter / 2
  axis.crossVectors(forward, up).normalize().negate()
  third.crossVectors(forward, axis)
  basis.makeBasis(forward, axis, third)
  object.quaternion.setFromRotationMatrix(basis)
  object.quaternion.multiply(spin.setFromAxisAngle(up, -rolled / radius))
  object.position.copy(point).addScaledVector(up, radius)
}

export class Trail {
  static length = 110
  readonly line: THREE.Line
  private positions = new Float32Array(Trail.length * 3)
  private colors = new Float32Array(Trail.length * 3)
  private count = 0
  constructor(private color: THREE.Color) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3))
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3))
    geometry.setDrawRange(0, 0)
    this.line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ vertexColors: true }))
    this.line.frustumCulled = false
  }
  push(x: number, y: number, z: number, fade: THREE.Color) {
    const n = Trail.length
    if (this.count === n) this.positions.copyWithin(0, 3)
    else this.count++
    const i = (this.count - 1) * 3
    this.positions[i] = x
    this.positions[i + 1] = y + 0.12
    this.positions[i + 2] = z
    this.recolor(fade)
  }
  // Older samples fade into the surface, as the gravity well's trails do.
  recolor(fade: THREE.Color) {
    const c = new THREE.Color()
    for (let k = 0; k < this.count; k++) {
      c.copy(fade).lerp(this.color, 0.06 + (0.84 * (k + 1)) / this.count)
      this.colors[k * 3] = c.r
      this.colors[k * 3 + 1] = c.g
      this.colors[k * 3 + 2] = c.b
    }
    const g = this.line.geometry
    g.setDrawRange(0, this.count)
    g.attributes.position.needsUpdate = true
    g.attributes.color.needsUpdate = true
  }
  dispose() {
    this.line.geometry.dispose()
    ;(this.line.material as THREE.Material).dispose()
  }
}

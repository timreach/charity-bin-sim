import { describe, expect, it } from "vitest"
import {
  coins,
  holeRadius,
  launchCoin,
  leanOf,
  predictPath,
  rimRadius,
  slope,
  stepCoin,
  surfaceZ,
} from "./funnel"
import type { Coin } from "./funnel"

const penny = coins[0]
function run(coin: Coin, seconds = 300) {
  for (let t = 0; t < seconds && coin.phase !== "done"; t += 1 / 480)
    stepCoin(coin, 1 / 480)
  return coin
}
const tangential = { angle: 0, speed: 50, aim: 0, direction: 1 } as const

describe("funnel surface", () => {
  it("sits at z = 0 on the rim and falls monotonically to the hole", () => {
    expect(surfaceZ(rimRadius)).toBeCloseTo(0)
    for (let r = holeRadius; r < rimRadius; r += 1)
      expect(surfaceZ(r)).toBeLessThan(surfaceZ(r + 1))
  })
  it("matches its slope to the derivative of the height", () => {
    for (const r of [5, 12, 30])
      expect(slope(r)).toBeCloseTo((surfaceZ(r + 1e-4) - surfaceZ(r - 1e-4)) / 2e-4, 4)
  })
})

describe("rolling coins", () => {
  it("spirals a tangential penny down for many laps, spinning up as it goes", () => {
    const coin = run(launchCoin(penny, tangential))
    expect(coin.phase).toBe("done")
    expect(coin.laps).toBeGreaterThan(15)
    expect(coin.topSpin).toBeGreaterThan(2)
  })
  it("lets heavier, larger coins outlast lighter ones", () => {
    const time = (id: string) => {
      const coin = launchCoin(coins.find((c) => c.id === id)!, tangential)
      while (coin.phase !== "falling") stepCoin(coin, 1 / 480)
      return coin.age
    }
    expect(time("2")).toBeGreaterThan(time("5p"))
  })
  it("tips over and slides straight in when dropped too slowly", () => {
    const coin = launchCoin(penny, { ...tangential, speed: 4 })
    expect(coin.phase).toBe("sliding")
    run(coin)
    expect(coin.laps).toBeLessThan(0.5)
  })
  it("loses laps when aimed towards the hole", () => {
    const flat = predictPath(launchCoin(penny, tangential))
    const steep = predictPath(launchCoin(penny, { ...tangential, aim: 50 }))
    expect(steep.laps).toBeLessThan(flat.laps)
  })
  it("stays upright at the speed the slope alone can hold", () => {
    const r = 20
    const coin = launchCoin(penny, tangential)
    coin.r = r
    coin.omega = Math.sqrt((981 * slope(r)) / r)
    expect(leanOf(coin)).toBeCloseTo(0, 5)
  })
})

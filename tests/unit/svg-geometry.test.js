import { describe, expect, it } from "vitest";
import { boxArea, createBoxIndex, unionBoxes } from "../../src/viewer/svg-geometry.js";

const box = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 });

describe("box helpers", () => {
  it("unions boxes and measures area", () => {
    const union = unionBoxes([box(0, 0, 10, 10), box(5, 5, 30, 20), undefined]);
    expect(union).toMatchObject({ left: 0, top: 0, right: 30, bottom: 20, width: 30, height: 20 });
    expect(boxArea(union)).toBe(600);
    expect(unionBoxes([])).toBeUndefined();
  });
});

describe("box index", () => {
  const index = createBoxIndex([
    { key: "big", box: box(0, 0, 400, 400) },
    { key: "small", box: box(100, 100, 150, 150) },
    { key: "far", box: box(1000, 20, 1100, 60) },
  ], 100);

  it("locates the smallest containing box", () => {
    expect(index.locate({ x: 120, y: 120 })?.key).toBe("small");
    expect(index.locate({ x: 300, y: 300 })?.key).toBe("big");
    expect(index.locate({ x: 152, y: 120 }, 4)?.key).toBe("small");
    expect(index.locate({ x: 900, y: 40 })).toBeUndefined();
  });

  it("finds the nearest box within reach", () => {
    expect(index.nearest({ x: 990, y: 40 }, 20)?.key).toBe("far");
    expect(index.nearest({ x: 900, y: 40 }, 20)).toBeUndefined();
  });

  it("measures only horizontal distance in column mode", () => {
    expect(index.nearest({ x: 1050, y: 900 }, 30, "column")?.key).toBe("far");
    expect(index.nearest({ x: 1050, y: 900 }, 30)).toBeUndefined();
  });
});

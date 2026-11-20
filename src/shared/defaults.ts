import type { StudioDocument } from "./document";
export function createDocument(): StudioDocument {
  return {
    asset: null,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    settings: {
      columns: 100,
      charset: "standard",
      custom: " .:-=+*#%@",
      contrast: 1,
      gamma: 1,
      invert: false,
      color: true,
      background: "#101216",
      indexed: true,
      maxColors: 16,
      strategy: "salient",
    },
    locks: [],
    grid: null,
    revision: 0,
  };
}

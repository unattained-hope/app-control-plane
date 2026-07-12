import sharp from "sharp";

/** Stored badge AVIFs target this size for fast storefront/gallery loads. */
export const BADGE_GRAPHIC_TARGET_MAX_BYTES = 20 * 1024;

/** Longest edge for stored badge graphics (gallery thumbs are ~72px tall). */
export const BADGE_GRAPHIC_MAX_DIMENSION = 256;

const AVIF_EFFORT = 4;
const DIMENSION_STEPS = [256, 224, 192, 160] as const;
const QUALITY_STEPS = [58, 50, 42, 35, 28] as const;

function readRgb(rgba: Buffer, offset: number): [number, number, number] {
  return [rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!];
}

function colorDistance(
  r: number,
  g: number,
  b: number,
  cr: number,
  cg: number,
  cb: number,
): number {
  return Math.abs(r - cr) + Math.abs(g - cg) + Math.abs(b - cb);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Dense samples from all four edges (corners + along each side). */
function sampleEdgeColors(
  rgba: Buffer,
  width: number,
  height: number,
): Array<[number, number, number]> {
  const colors: Array<[number, number, number]> = [];
  const stepX = Math.max(1, Math.floor(width / 40));
  const stepY = Math.max(1, Math.floor(height / 40));

  for (let x = 0; x < width; x += stepX) {
    colors.push(readRgb(rgba, x * 4));
    colors.push(readRgb(rgba, ((height - 1) * width + x) * 4));
  }
  for (let y = 0; y < height; y += stepY) {
    colors.push(readRgb(rgba, (y * width) * 4));
    colors.push(readRgb(rgba, (y * width + width - 1) * 4));
  }

  return colors;
}

function medianEdgeColor(colors: Array<[number, number, number]>): [number, number, number] {
  return [
    median(colors.map((c) => c[0])),
    median(colors.map((c) => c[1])),
    median(colors.map((c) => c[2])),
  ];
}

function isNeutralBackgroundPixel(
  r: number,
  g: number,
  b: number,
  refs: Array<[number, number, number]>,
  tolerance: number,
): boolean {
  if (refs.some(([cr, cg, cb]) => colorDistance(r, g, b, cr, cg, cb) <= tolerance)) {
    return true;
  }

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  const avg = (r + g + b) / 3;

  // White / off-white / JPEG halo around AI-generated badges on light backdrops.
  if (avg > 225 && spread < 50) return true;
  // Black / near-black studio backdrops.
  if (avg < 36 && spread < 40) return true;
  // Light gray checkerboard sheets.
  if (spread < 24 && avg > 165 && avg < 245) return true;

  return false;
}

/**
 * Flood-fill neutral backgrounds from image edges. Tolerance is tuned per upload
 * so JPEG compression and painted fuzzy borders still detach from the artwork.
 */
function floodFillBackground(
  rgba: Buffer,
  width: number,
  height: number,
  refs: Array<[number, number, number]>,
  tolerance: number,
): void {
  const visited = new Uint8Array(width * height);
  const queue: Array<[number, number]> = [];

  const enqueue = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    queue.push([x, y]);
  };

  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (queue.length > 0) {
    const item = queue.pop();
    if (!item) break;
    const [x, y] = item;
    const idx = y * width + x;
    if (visited[idx]) continue;

    const [r, g, b] = readRgb(rgba, idx * 4);
    if (!isNeutralBackgroundPixel(r, g, b, refs, tolerance)) continue;

    visited[idx] = 1;
    rgba[idx * 4 + 3] = 0;

    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }
}

/** Remove light neutral halos that touch transparency (painted / JPEG fringe). */
function removeFringeHalos(rgba: Buffer, width: number, height: number, passes = 3): void {
  const isFringe = (r: number, g: number, b: number): boolean => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const spread = max - min;
    const avg = (r + g + b) / 3;
    return avg > 215 && spread < 55;
  };

  const hasTransparentNeighbor = (x: number, y: number): boolean => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
      if (rgba[(ny * width + nx) * 4 + 3]! < 128) return true;
    }
    return false;
  };

  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3]! < 128) continue;
        const r = rgba[i]!;
        const g = rgba[i + 1]!;
        const b = rgba[i + 2]!;
        if (isFringe(r, g, b) && hasTransparentNeighbor(x, y)) {
          rgba[i + 3] = 0;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

function edgeTransparentRatio(rgba: Buffer, width: number, height: number): number {
  let transparent = 0;
  let total = 0;

  const check = (x: number, y: number) => {
    const alpha = rgba[(y * width + x) * 4 + 3]!;
    total++;
    if (alpha < 128) transparent++;
  };

  for (let x = 0; x < width; x++) {
    check(x, 0);
    check(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    check(0, y);
    check(width - 1, y);
  }

  return total === 0 ? 0 : transparent / total;
}

function opaqueRatio(rgba: Buffer, width: number, height: number): number {
  let opaque = 0;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    if (rgba[i * 4 + 3]! >= 128) opaque++;
  }
  return opaque / total;
}

function scoreBackgroundRemoval(rgba: Buffer, width: number, height: number): number {
  const edge = edgeTransparentRatio(rgba, width, height);
  const opaque = opaqueRatio(rgba, width, height);
  if (opaque < 0.04) return -1;
  if (opaque > 0.97) return edge * 0.25;
  return edge;
}

function removeSolidBackground(rgba: Buffer, width: number, height: number): void {
  const edgeColors = sampleEdgeColors(rgba, width, height);
  const refs = [medianEdgeColor(edgeColors), ...edgeColors.slice(0, 4)];

  let best = Buffer.from(rgba);
  let bestScore = -1;

  for (const tolerance of [48, 72, 96]) {
    const trial = Buffer.from(rgba);
    floodFillBackground(trial, width, height, refs, tolerance);
    removeFringeHalos(trial, width, height);
    const score = scoreBackgroundRemoval(trial, width, height);
    if (score > bestScore) {
      bestScore = score;
      best = trial;
    }
  }

  rgba.set(best);
}

async function encodeBadgeGraphicAvif(
  rgba: Buffer,
  width: number,
  height: number,
  maxBytes: number,
): Promise<Buffer> {
  let best: Buffer | null = null;

  for (const maxDimension of DIMENSION_STEPS) {
    const longEdge = Math.max(width, height);
    let pipeline = sharp(rgba, { raw: { width, height, channels: 4 } });
    if (longEdge > maxDimension) {
      pipeline = pipeline.resize({
        width: width >= height ? maxDimension : undefined,
        height: height > width ? maxDimension : undefined,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    for (const quality of QUALITY_STEPS) {
      const avif = await pipeline
        .clone()
        .avif({ quality, effort: AVIF_EFFORT, chromaSubsampling: "4:2:0" })
        .toBuffer();
      if (avif.byteLength <= maxBytes) return avif;
      if (!best || avif.byteLength < best.byteLength) best = avif;
    }
  }

  if (best && best.byteLength <= maxBytes) return best;
  throw new Error(
    `Could not compress badge image below ${maxBytes} bytes (best effort: ${best?.byteLength ?? 0} bytes)`,
  );
}

/**
 * Normalizes a badge graphic upload: smart background removal, trim, resize,
 * and AVIF encode for efficient gallery delivery.
 */
export async function processBadgeGraphicUpload(
  data: Uint8Array,
  options: { maxDimension?: number; maxBytes?: number } = {},
): Promise<{ data: Buffer; mimeType: "image/avif" }> {
  const maxBytes = options.maxBytes ?? BADGE_GRAPHIC_TARGET_MAX_BYTES;

  const { data: raw, info } = await sharp(Buffer.from(data))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = Buffer.from(raw);
  let { width, height } = info;

  if (edgeTransparentRatio(rgba, width, height) < 0.35) {
    removeSolidBackground(rgba, width, height);
  }

  const trimmed = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .trim({ threshold: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const avif = await encodeBadgeGraphicAvif(
    Buffer.from(trimmed.data),
    trimmed.info.width,
    trimmed.info.height,
    maxBytes,
  );
  return { data: avif, mimeType: "image/avif" };
}

/**
 * Server-side ECharts → SVG (Apache ECharts SSR), persisted under repo-root charts-public/.
 * @see https://apache.github.io/echarts-handbook/en/how-to/cross-platform/server/
 */
// MUST import before `sharp` — sets FONTCONFIG_FILE so libvips finds bundled TTFs.
import "./fontconfig-init.js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
// echarts uses `export =` (CommonJS); Node ESR loads SSR build this way per handbook examples.
const echarts = require("echarts") as typeof import("echarts");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Repo root …/charts-public (works from dist/services/*.js). */
export const CHARTS_PUBLIC_DIR = path.resolve(__dirname, "../../charts-public");

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

function getPublicBaseUrl(): string {
  const explicit = process.env.CHARTS_PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  // Railway injects RAILWAY_PUBLIC_DOMAIN as hostname only (e.g. "voitech.up.railway.app").
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) {
    const host = railway.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `https://${host}`;
  }
  const port = process.env.PORT ?? process.env.API_PORT ?? "3000";
  return `http://localhost:${port}`;
}

export type ChartOutputFormat = "svg" | "png";

export interface RenderChartParams {
  option: Record<string, unknown>;
  width?: number;
  height?: number;
  /** Optional basename (no path); extension matches format. Safe chars only. */
  filenameBase?: string;
  /** File format on disk and in the returned URL. Default png. */
  format?: ChartOutputFormat;
}

export interface SavedChartResult {
  filename: string;
  filePath: string;
  url: string;
}

/**
 * Font stack used inside SSR SVG. Matches the bundled TTFs under `fonts/`
 * (see `fontconfig-init.ts`). DejaVu Sans covers Latin, Cyrillic, Greek, Vietnamese, math.
 *
 * IMPORTANT: no inner quotes. ECharts writes this verbatim into
 *   `font-family="…"` attributes, so any `"` inside would break XML parsing
 *   ("attributes construct error"). CSS allows unquoted multi-word family names
 *   (see https://drafts.csswg.org/css-fonts/#family-name-value).
 */
const DEFAULT_FONT_FAMILY = "DejaVu Sans, sans-serif";

export function renderEChartOptionToSvg(
  option: Record<string, unknown>,
  width: number,
  height: number
): string {
  const chart = echarts.init(null, null, {
    renderer: "svg",
    ssr: true,
    width,
    height,
  });
  try {
    const userTextStyle =
      (option as { textStyle?: Record<string, unknown> }).textStyle ?? {};
    chart.setOption({
      animation: false,
      ...option,
      // Merge so caller-provided textStyle wins, but we always supply a fontFamily default.
      textStyle: {
        fontFamily: DEFAULT_FONT_FAMILY,
        ...userTextStyle,
      },
    });
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

function makeFilename(base: string | undefined, ext: "svg" | "png"): string {
  const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  if (base && SAFE_NAME.test(base)) {
    return `${base.replace(/\.(svg|png)$/i, "")}-${suffix}`;
  }
  return `chart-${suffix}`;
}

async function svgToPng(svg: string, width: number, height: number): Promise<Buffer> {
  return sharp(Buffer.from(svg, "utf8"), { density: 144 })
    .resize(width, height)
    .png()
    .toBuffer();
}

/**
 * Renders ECharts (SSR SVG), optionally rasterizes to PNG, writes under charts-public/, returns a public URL.
 */
export async function renderAndSaveChart(params: RenderChartParams): Promise<SavedChartResult> {
  const width = params.width ?? 800;
  const height = params.height ?? 500;
  const format = params.format ?? "png";
  if (width < 16 || width > 4000 || height < 16 || height > 4000) {
    throw new Error("width and height must be between 16 and 4000");
  }

  const svg = renderEChartOptionToSvg(params.option, width, height);
  await mkdir(CHARTS_PUBLIC_DIR, { recursive: true });

  const filename = makeFilename(params.filenameBase, format === "png" ? "png" : "svg");
  const filePath = path.join(CHARTS_PUBLIC_DIR, filename);

  if (format === "png") {
    const png = await svgToPng(svg, width, height);
    await writeFile(filePath, png);
  } else {
    await writeFile(filePath, svg, "utf8");
  }

  const url = `${getPublicBaseUrl()}/charts-public/${encodeURIComponent(filename)}`;
  return { filename, filePath, url };
}

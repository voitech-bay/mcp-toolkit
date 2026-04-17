/**
 * Register bundled TTF fonts with fontconfig at process startup.
 *
 * `sharp` rasterizes ECharts SVG via libvips+librsvg, which calls fontconfig
 * to resolve every `<text font-family="…">` element. If the host has no fonts
 * (or no fontconfig config), glyphs render as tofu rectangles.
 *
 * We write a throwaway fonts.conf to a tmp dir that points fontconfig at the
 * repo's `fonts/` directory. Works on Windows, Alpine, Debian, macOS, Railway.
 *
 * IMPORTANT: must be imported BEFORE `sharp` so that FONTCONFIG_FILE is set
 * before libvips does its first init. `charts-public.ts` imports this first.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo-root `fonts/` (resolves both from src/ and dist/).
const FONTS_DIR = path.resolve(__dirname, "../../fonts");

const workDir = path.join(tmpdir(), "mcp-toolkit-fontconfig");
const cacheDir = path.join(workDir, "cache");
mkdirSync(cacheDir, { recursive: true });

/** fontconfig XML wants forward slashes even on Windows. */
const fc = (p: string) => p.replace(/\\/g, "/");

const FONTS_CONF = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${fc(FONTS_DIR)}</dir>
  <cachedir>${fc(cacheDir)}</cachedir>

  <!-- Route generic CSS families to the single shipped font so every
       ECharts default (sans-serif/serif/monospace) resolves to DejaVu Sans. -->
  <alias binding="same">
    <family>sans-serif</family>
    <prefer><family>DejaVu Sans</family></prefer>
  </alias>
  <alias binding="same">
    <family>serif</family>
    <prefer><family>DejaVu Sans</family></prefer>
  </alias>
  <alias binding="same">
    <family>monospace</family>
    <prefer><family>DejaVu Sans</family></prefer>
  </alias>
</fontconfig>
`;

const confPath = path.join(workDir, "fonts.conf");
writeFileSync(confPath, FONTS_CONF, "utf8");

process.env.FONTCONFIG_FILE = confPath;
process.env.FONTCONFIG_PATH = workDir;

export const FONTCONFIG_CONF_PATH = confPath;
export const BUNDLED_FONTS_DIR = FONTS_DIR;

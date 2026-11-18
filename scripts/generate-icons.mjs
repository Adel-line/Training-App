// Renders public/icons/*.png from an inline SVG using the installed Chromium.
// Usage: npm run icons
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BG = "#0b0d10";
const ACCENT = "#5eead4";
// Simple mark: rising line over a baseline. `pad` shrinks it for maskable icons.
const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(256 256) scale(${pad}) translate(-256 -256)" fill="none" stroke="${ACCENT}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="96,352 192,240 272,296 416,144"/>
    <line x1="96" y1="416" x2="416" y2="416"/>
  </g>
</svg>`;

const targets = [
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-maskable-512.png", 512, 0.7],
  ["apple-touch-icon.png", 180, 0.85],
];

mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
for (const [name, size, pad] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg(size, pad)}</body>`);
  writeFileSync(`public/icons/${name}`, await page.screenshot({ type: "png" }));
  await page.close();
}
await browser.close();
console.log("icons written");

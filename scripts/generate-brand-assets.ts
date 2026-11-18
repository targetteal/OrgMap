/** Rebuild platform icons from the approved R2 vector masters; no network or fonts required. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const publicRoot = new URL("../web/public/", import.meta.url);
const brand = new URL("brand/", publicRoot);
const teal = "#105D63";
const load = (name: string) => readFile(new URL(name, brand), "utf8");
const save = (name: string, data: string | Uint8Array, root = brand) =>
  writeFile(new URL(name, root), data);
const paths = (svg: string) => svg.match(/<path\b[^>]*\/>/g)?.join("") ?? "";
const wrap = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
const normal = paths(await load("orgmap-symbol-white.svg"));
const small = paths(await load("orgmap-symbol-small-white.svg"));
if (!normal || !small) throw Error("Missing vector masters");
await save(
  "orgmap-symbol-small-black.svg",
  (await load("orgmap-symbol-small.svg")).replaceAll(teal, "#000000"),
);

function icon(symbol: string, maskable = false) {
  return wrap(
    512,
    512,
    `<rect width="512" height="512"${maskable ? "" : ' rx="112"'} fill="${teal}"/><g transform="translate(${maskable ? "76 68" : "51 43"}) scale(${(maskable ? 360 : 410) / 580})">${symbol}</g>`,
  );
}
const app = icon(normal),
  maskable = icon(normal, true),
  microApp = icon(small);
await save("orgmap-icon.svg", app);
await save("orgmap-icon-maskable.svg", maskable);
await save("orgmap-icon-small.svg", microApp);
for (const size of [192, 512]) {
  await sharp(Buffer.from(app))
    .resize(size)
    .png()
    .toFile(fileURLToPath(new URL(`orgmap-icon-${size}.png`, brand)));
}
await sharp(Buffer.from(maskable))
  .png()
  .toFile(fileURLToPath(new URL("orgmap-icon-maskable-512.png", brand)));
// Apple supplies its own corner mask. Use an opaque, full-bleed background.
await sharp(Buffer.from(icon(normal).replace(' rx="112"', "")))
  .resize(180)
  .png()
  .toFile(fileURLToPath(new URL("apple-touch-icon.png", publicRoot)));
const favicon = wrap(
  580,
  580,
  `<style>path{fill:${teal}}@media(prefers-color-scheme:dark){path{fill:#fff}}</style>${small}`,
);
await save("favicon.svg", favicon, publicRoot);
const entries = await Promise.all(
  [16, 32, 48].map(async (size) => ({
    size,
    data: await sharp(Buffer.from(size <= 32 ? microApp : app))
      .resize(size)
      .png()
      .toBuffer(),
  })),
);
const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
for (const [index, entry] of entries.entries()) {
  const at = 6 + index * 16;
  header[at] = header[at + 1] = entry.size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(entry.data.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += entry.data.length;
}
await save(
  "favicon.ico",
  Buffer.concat([header, ...entries.map((entry) => entry.data)]),
  publicRoot,
);

const logo = await load("orgmap-logo-white.svg");
const viewBox = logo.match(/viewBox="([^"]+)"/)?.[1];
if (!viewBox) throw Error("Missing logo viewBox");
const [, , width, height] = viewBox.split(" ").map(Number);
const displayWidth = 900,
  displayHeight = (displayWidth * height) / width;
// Preserve the master's nested transforms and inherited fills, including the scaled symbol.
const logoBody = logo.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const social = wrap(
  1200,
  630,
  `<rect width="1200" height="630" fill="${teal}"/><svg x="150" y="${(630 - displayHeight) / 2}" width="900" height="${displayHeight}" viewBox="${viewBox}">${logoBody}</svg>`,
);
await sharp(Buffer.from(social))
  .png()
  .toFile(fileURLToPath(new URL("orgmap-social.png", brand)));
await save(
  "site.webmanifest",
  JSON.stringify(
    {
      id: "/",
      name: "OrgMap",
      short_name: "OrgMap",
      lang: "pt-BR",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: teal,
      background_color: "#F3F8F8",
      icons: [
        {
          src: "/brand/orgmap-icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/brand/orgmap-icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/brand/orgmap-icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    null,
    2,
  ) + "\n",
  publicRoot,
);
console.log(
  "OrgMap R2: favicon, Apple touch, application icons, manifest and social image generated.",
);

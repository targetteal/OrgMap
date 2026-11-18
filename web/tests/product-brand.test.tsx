import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const publicRoot = new URL("public/", root);

test("browser metadata references shipped images with the declared dimensions", async () => {
  const html = new JSDOM(await readFile(new URL("index.html", root), "utf8"));
  try {
    const document = html.window.document;
    const urls = [
      ...Array.from(
        document.querySelectorAll(
          'link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]',
        ),
        (node) => node.getAttribute("href")!,
      ),
      document
        .querySelector('meta[property="og:image"]')!
        .getAttribute("content")!,
      document
        .querySelector('meta[name="twitter:image"]')!
        .getAttribute("content")!,
    ];
    for (const url of urls) {
      assert.match(
        url,
        /^\/(?:brand\/|favicon\.|apple-touch-icon\.|site\.webmanifest)/,
      );
      await access(new URL(url.slice(1), publicRoot));
    }
    const manifest = JSON.parse(
      await readFile(new URL("site.webmanifest", publicRoot), "utf8"),
    );
    assert.equal(manifest.name, "OrgMap");
    for (const icon of manifest.icons) {
      const image = await sharp(
        await readFile(new URL(icon.src.slice(1), publicRoot)),
      ).metadata();
      assert.equal(`${image.width}x${image.height}`, icon.sizes);
      assert.equal(image.format, "png");
    }
    const social = await sharp(
      await readFile(new URL("brand/orgmap-social.png", publicRoot)),
    ).metadata();
    assert.equal(
      social.width,
      Number(
        document
          .querySelector('meta[property="og:image:width"]')!
          .getAttribute("content"),
      ),
    );
    assert.equal(
      social.height,
      Number(
        document
          .querySelector('meta[property="og:image:height"]')!
          .getAttribute("content"),
      ),
    );
    assert.equal(
      (
        await sharp(
          await readFile(new URL("apple-touch-icon.png", publicRoot)),
        ).metadata()
      ).width,
      180,
    );
    const ico = await readFile(new URL("favicon.ico", publicRoot));
    assert.equal(ico.readUInt16LE(2), 1);
    const sizes = Array.from(
      { length: ico.readUInt16LE(4) },
      (_, i) => ico[6 + 16 * i],
    );
    assert.deepEqual(sizes, [16, 32, 48]);
  } finally {
    html.window.close();
  }
});

test("maskable artwork stays inside the safe circle and has an opaque full-bleed background", async () => {
  const { data, info } = await sharp(
    await readFile(new URL("brand/orgmap-icon-maskable-512.png", publicRoot)),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let artwork = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const at = (y * info.width + x) * 4;
      assert.equal(data[at + 3], 255);
      if (data[at] > 235 && data[at + 1] > 235 && data[at + 2] > 235) {
        artwork++;
        assert.ok(
          Math.hypot(x + 0.5 - 256, y + 0.5 - 256) <= 512 * 0.4,
          `Artwork outside maskable safe area: ${x},${y}`,
        );
      }
    }
  assert.ok(artwork > 10000, "The icon must contain the actual white mark");
});

test("platform identity has one accessible name and its signature and small symbols resolve locally", async () => {
  const vite = await createServer({
    root: root.pathname,
    configFile: false,
    logLevel: "error",
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    appType: "custom",
  });
  try {
    const { OrgMapBrand } = await vite.ssrLoadModule("/src/OrgMapBrand.tsx");
    for (const tone of ["color", "white", "black"])
      for (const variant of ["signature", "symbol"]) {
        const dom = new JSDOM(
          renderToStaticMarkup(<OrgMapBrand tone={tone} variant={variant} />),
        );
        try {
          assert.equal(
            dom.window.document.querySelectorAll(
              '[role="img"][aria-label="OrgMap"]',
            ).length,
            1,
          );
          for (const img of dom.window.document.querySelectorAll("img")) {
            assert.equal(img.alt, "");
            const svg = await readFile(
              new URL(img.getAttribute("src")!.slice(1), publicRoot),
              "utf8",
            );
            assert.doesNotMatch(
              svg,
              /<(?:text|image|script)\b/,
              "Brand assets must be self-contained vectors, independent of font loading",
            );
          }
        } finally {
          dom.window.close();
        }
      }
  } finally {
    await vite.close();
  }
});

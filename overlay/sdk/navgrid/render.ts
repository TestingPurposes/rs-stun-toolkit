// Renders a planned route onto the real world map.
//
//   bun sdk/navgrid/render.ts <srcX> <srcZ> <destX> <destZ> [out.html]
//
// Rasterizes the same worldmap.jag data the /mapview canvas uses (same floorcol
// palette), then draws the navgrid route over it next to the shortest-path route
// so you can see what the road preference and clearance penalty actually bought.
import { deflateSync } from 'zlib';
import { planRoute, init, type Route } from './index.js';

// ---- worldmap decode (colours this time, not just surface classes)

function genHash(name: string): number {
    let hash = 0;
    for (const ch of name.toUpperCase()) hash = (hash * 61 + ch.charCodeAt(0) - 32) | 0;
    return hash;
}

class Reader {
    pos = 0;
    constructor(readonly d: Uint8Array) {}
    g1(): number { return this.d[this.pos++]!; }
    g2(): number { return (this.g1() << 8) | this.g1(); }
    g3(): number { return (this.g1() << 16) | (this.g1() << 8) | this.g1(); }
    g4(): number { return ((this.g1() << 24) | (this.g1() << 16) | (this.g1() << 8) | this.g1()) >>> 0; }
    g4s(): number { return (this.g1() << 24) | (this.g1() << 16) | (this.g1() << 8) | this.g1(); }
    get available(): number { return this.d.length - this.pos; }
}

const BZip2 = (await import('../../server/engine/src/io/BZip2.js')).default;

function openJag(raw: Uint8Array): Map<number, Uint8Array> {
    const head = new Reader(raw);
    const u = head.g3(), p = head.g3();
    const whole = u !== p;
    const body = whole ? BZip2.decompress(raw.subarray(6), u, true) : raw;
    const src = new Reader(body);
    if (!whole) src.pos = 6;
    const count = src.g2();
    const out = new Map<number, Uint8Array>();
    let pos = src.pos + count * 10;
    for (let i = 0; i < count; i++) {
        const h = src.g4s(), us = src.g3(), ps = src.g3();
        const slice = body.subarray(pos, pos + ps);
        out.set(h, whole ? slice : BZip2.decompress(slice, us, true));
        pos += ps;
    }
    return out;
}

const jagBytes = new Uint8Array(
    await (await fetch('https://rs-sdk-demo.fly.dev/worldmap.jag')).arrayBuffer()
);
const jag = openJag(jagBytes);

const floorcol = new Reader(jag.get(genHash('floorcol.dat'))!);
const nCols = floorcol.g2();
const under1: number[] = [0];
const over2: number[] = [0];
for (let i = 0; i < nCols; i++) {
    under1[i + 1] = floorcol.g4();
    over2[i + 1] = floorcol.g4();
}

function realMz(m: number) {
    if (m >= 144) return { mz: m - 82, overworld: false };
    if (m >= 70 && m <= 76) return { mz: m + 10, overworld: false };
    return { mz: m, overworld: true };
}

const colour = new Map<number, number>(); // packed x,z -> rgb
const packXZ = (x: number, z: number) => x * 100000 + z;

const un = new Reader(jag.get(genHash('underlay.dat'))!);
while (un.available > 0) {
    const mx = un.g1();
    const { mz, overworld } = realMz(un.g1());
    for (let x = 0; x < 64; x++) {
        for (let z = 63; z >= 0; z--) {
            const id = un.g1();
            if (!overworld || id === 0) continue;
            colour.set(packXZ(mx * 64 + x, mz * 64 + z), under1[id] ?? 0);
        }
    }
}
const ov = new Reader(jag.get(genHash('overlay.dat'))!);
while (ov.available > 0) {
    const mx = ov.g1();
    const { mz, overworld } = realMz(ov.g1());
    for (let x = 0; x < 64; x++) {
        for (let z = 63; z >= 0; z--) {
            const id = ov.g1();
            if (id === 0) continue;
            ov.g1();
            if (!overworld) continue;
            colour.set(packXZ(mx * 64 + x, mz * 64 + z), over2[id] ?? 0);
        }
    }
}

// ---- minimal PNG encoder (no image deps in this repo)

function crc32(buf: Uint8Array): number {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i]!;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

function encodePng(w: number, h: number, rgb: Uint8Array): Uint8Array {
    const raw = new Uint8Array(h * (w * 3 + 1));
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0; // filter: none
        raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
    }
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w);
    dv.setUint32(4, h);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 2;   // colour type: truecolour
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const png = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { png.set(p, o); o += p.length; }
    return png;
}

// ---- render

const [sxA, szA, dxA, dzA, outArg] = process.argv.slice(2);
const srcX = +(sxA ?? 3222), srcZ = +(szA ?? 3218);
const destX = +(dxA ?? 2655), destZ = +(dzA ?? 3283);
const outPath = outArg ?? 'route.html';

init();
const shortest = planRoute(srcX, srcZ, destX, destZ, { roadPreference: 0, clearanceWeight: 0, doorCost: 0 });
const navgrid = planRoute(srcX, srcZ, destX, destZ);
if (!navgrid) throw new Error('navgrid found no route');

const all = [...(shortest?.waypoints ?? []), ...navgrid.waypoints];
const PAD = 24;
const minX = Math.min(...all.map(w => w.x)) - PAD;
const maxX = Math.max(...all.map(w => w.x)) + PAD;
const minZ = Math.min(...all.map(w => w.z)) - PAD;
const maxZ = Math.max(...all.map(w => w.z)) + PAD;

const SCALE = 2; // pixels per tile
const tw = maxX - minX + 1, th = maxZ - minZ + 1;
const W = tw * SCALE, H = th * SCALE;
const rgb = new Uint8Array(W * H * 3);

// Base map. z grows north, images grow down, so flip vertically.
for (let tz = 0; tz < th; tz++) {
    for (let tx = 0; tx < tw; tx++) {
        const c = colour.get(packXZ(minX + tx, maxZ - tz)) ?? 0x000000;
        for (let py = 0; py < SCALE; py++) {
            for (let px = 0; px < SCALE; px++) {
                const i = (((tz * SCALE + py) * W) + (tx * SCALE + px)) * 3;
                rgb[i] = (c >> 16) & 0xff;
                rgb[i + 1] = (c >> 8) & 0xff;
                rgb[i + 2] = c & 0xff;
            }
        }
    }
}

function stroke(route: Route, r: number, g: number, b: number, thick = 1) {
    for (const w of route.waypoints) {
        const tx = w.x - minX, tz = maxZ - w.z;
        for (let py = -thick; py < SCALE + thick; py++) {
            for (let px = -thick; px < SCALE + thick; px++) {
                const X = tx * SCALE + px, Y = tz * SCALE + py;
                if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
                const i = (Y * W + X) * 3;
                rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
            }
        }
    }
}

function marker(x: number, z: number, r: number, g: number, b: number, size = 4) {
    const tx = x - minX, tz = maxZ - z;
    for (let py = -size; py <= size; py++) {
        for (let px = -size; px <= size; px++) {
            const X = tx * SCALE + px, Y = tz * SCALE + py;
            if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            const i = (Y * W + X) * 3;
            rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
        }
    }
}

if (shortest) stroke(shortest, 0xff, 0x3b, 0x30);  // red   - shortest path
stroke(navgrid, 0x2e, 0xd5, 0x73);                 // green - navgrid
for (const d of navgrid.doors) marker(d.x, d.z, 0xff, 0xd7, 0x00, 3);
marker(srcX, srcZ, 0x00, 0xbf, 0xff, 5);
marker(destX, destZ, 0xff, 0x00, 0xff, 5);

const png = encodePng(W, H, rgb);
const b64 = Buffer.from(png).toString('base64');

const delta = (a: number, b: number, unit = '') => {
    const d = b - a;
    if (d === 0) return '<span class="d flat">same</span>';
    const better = unit === '%' ? d > 0 : d < 0;
    const sign = d > 0 ? '+' : '';
    return `<span class="d ${better ? 'good' : 'bad'}">${sign}${d}${unit}</span>`;
};

const cmp = shortest && navgrid
    ? `<tr>
         <th scope="row">on road</th>
         <td>${shortest.onRoadPct.toFixed(0)}%</td>
         <td class="hi">${navgrid.onRoadPct.toFixed(0)}%</td>
         <td>${delta(Math.round(shortest.onRoadPct), Math.round(navgrid.onRoadPct), '%')}</td>
       </tr>
       <tr>
         <th scope="row">longest off-road run</th>
         <td>${shortest.longestOffRoad}</td>
         <td class="hi">${navgrid.longestOffRoad}</td>
         <td>${delta(shortest.longestOffRoad, navgrid.longestOffRoad)}</td>
       </tr>
       <tr>
         <th scope="row">length (tiles)</th>
         <td>${shortest.tiles}</td>
         <td class="hi">${navgrid.tiles}</td>
         <td><span class="d flat">${navgrid.tiles - shortest.tiles > 0 ? '+' : ''}${navgrid.tiles - shortest.tiles}</span></td>
       </tr>
       <tr>
         <th scope="row">doors crossed</th>
         <td>${shortest.doors.length}</td>
         <td class="hi">${navgrid.doors.length}</td>
         <td>${delta(shortest.doors.length, navgrid.doors.length)}</td>
       </tr>`
    : '';

await Bun.write(outPath, `<title>Route ${srcX},${srcZ} &rarr; ${destX},${destZ}</title>
<style>
  /* Neutrals carry a green-brown bias, taken from the map's own terrain palette,
     so the chrome sits with the raster instead of fighting it. */
  :root {
    color-scheme: light dark;
    --bg:      #f2f1ea;
    --panel:   #fbfaf6;
    --ink:     #23261f;
    --muted:   #6a6f60;
    --line:    #d7d5c7;
    --shortest:#c0392b;
    --navgrid: #1f8a4c;
    --door:    #b58a00;
    --good:    #1f8a4c;
    --bad:     #c0392b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:      #14160f;
      --panel:   #1c1f17;
      --ink:     #e8e7dc;
      --muted:   #9aa08c;
      --line:    #333729;
      --shortest:#ff6b5e;
      --navgrid: #4ade80;
      --door:    #ffd34d;
      --good:    #4ade80;
      --bad:     #ff6b5e;
    }
  }
  :root[data-theme="dark"] {
    --bg:#14160f; --panel:#1c1f17; --ink:#e8e7dc; --muted:#9aa08c; --line:#333729;
    --shortest:#ff6b5e; --navgrid:#4ade80; --door:#ffd34d; --good:#4ade80; --bad:#ff6b5e;
  }
  :root[data-theme="light"] {
    --bg:#f2f1ea; --panel:#fbfaf6; --ink:#23261f; --muted:#6a6f60; --line:#d7d5c7;
    --shortest:#c0392b; --navgrid:#1f8a4c; --door:#b58a00; --good:#1f8a4c; --bad:#c0392b;
  }

  body {
    margin: 0; padding: 32px 24px 64px;
    background: var(--bg); color: var(--ink);
    font: 15px/1.55 ui-sans-serif, system-ui, sans-serif;
  }
  main { max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }

  .eyebrow {
    font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
  }
  h1 {
    margin: 0; font-size: 1.4rem; text-wrap: balance;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }
  .sub { margin: 0; color: var(--muted); max-width: 65ch; }

  .key { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    display: flex; align-items: center; gap: 7px;
    padding: 5px 11px; border: 1px solid var(--line); border-radius: 999px;
    background: var(--panel); font-size: 13px;
  }
  .sw { width: 11px; height: 11px; border-radius: 50%; flex: none; }

  .map {
    overflow-x: auto; background: var(--panel);
    border: 1px solid var(--line); border-radius: 10px; padding: 10px;
  }
  .map img { display: block; image-rendering: pixelated; max-width: 100%; height: auto; }

  table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
  caption { text-align: left; color: var(--muted); padding-bottom: 8px; font-size: 13px; }
  th, td { text-align: right; padding: 8px 20px 8px 0; border-bottom: 1px solid var(--line); }
  thead th, tbody th { text-align: left; }
  thead th { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  td.hi { font-weight: 650; color: var(--navgrid); }
  .d { font-size: 13px; font-weight: 600; }
  .d.good { color: var(--good); }
  .d.bad  { color: var(--bad); }
  .d.flat { color: var(--muted); font-weight: 500; }
</style>
<main>
  <header>
    <p class="eyebrow">navgrid route preview</p>
    <h1>(${srcX}, ${srcZ}) &rarr; (${destX}, ${destZ})</h1>
  </header>
  <p class="sub">Rasterized from <code>worldmap.jag</code> &mdash; the same tile data the <code>/mapview</code> canvas draws. Red is the shortest path the bots walk today; green is the navgrid route, which prefers real roads and keeps its distance from walls.</p>

  <div class="key">
    <span class="chip"><i class="sw" style="background:var(--shortest)"></i>shortest path (today)</span>
    <span class="chip"><i class="sw" style="background:var(--navgrid)"></i>navgrid (roads + clearance)</span>
    <span class="chip"><i class="sw" style="background:var(--door)"></i>door</span>
    <span class="chip"><i class="sw" style="background:#00bfff"></i>start</span>
    <span class="chip"><i class="sw" style="background:#ff00ff"></i>goal</span>
  </div>

  <div class="map"><img src="data:image/png;base64,${b64}" width="${W}" height="${H}" alt="World map with both routes drawn"></div>

  <table>
    <caption>Higher road usage and shorter off-road runs mean fewer chances to drift into a wall pocket.</caption>
    <thead>
      <tr><th scope="col">metric</th><th scope="col">shortest</th><th scope="col">navgrid</th><th scope="col">change</th></tr>
    </thead>
    <tbody>${cmp}</tbody>
  </table>
</main>`);

console.log(`wrote ${outPath}  (${W}x${H}px, ${(png.length / 1024).toFixed(0)} KB)`);
console.log(`shortest: ${shortest?.tiles} tiles, ${shortest?.onRoadPct.toFixed(0)}% road`);
console.log(`navgrid : ${navgrid.tiles} tiles, ${navgrid.onRoadPct.toFixed(0)}% road`);

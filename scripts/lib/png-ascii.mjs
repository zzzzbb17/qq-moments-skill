import { inflateSync } from 'node:zlib';

function readChunks(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const chunks = [];
  let p = 8;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    chunks.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function unfilter(raw, height, stride, bpp) {
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const row = y * stride;
    const prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[p++];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      let v;
      if (f === 0) v = cur;
      else if (f === 1) v = cur + a;
      else if (f === 2) v = cur + b;
      else if (f === 3) v = cur + ((a + b) >> 1);
      else {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[row + x] = v & 0xff;
    }
  }
  return out;
}

function decode(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (ihdr[12] !== 0) throw new Error('interlaced PNG not supported');
  const plteChunk = chunks.find((c) => c.type === 'PLTE');
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = inflateSync(idat);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bits = channels * bitDepth;
  const bpp = Math.max(1, bits >> 3);
  const stride = Math.ceil((width * bits) / 8);
  return { width, height, bitDepth, colorType, stride, plte: plteChunk ? plteChunk.data : null, data: unfilter(raw, height, stride, bpp) };
}

function isDark(img, x, y) {
  const { bitDepth, colorType, stride, data, plte } = img;
  if (colorType === 0) {
    if (bitDepth === 1) return ((data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1) === 0;
    if (bitDepth === 8) return data[y * stride + x] < 128;
    if (bitDepth === 16) return data.readUInt16BE(y * stride + x * 2) < 32768;
  } else if (colorType === 3) {
    const idx = bitDepth === 1 ? (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 : data[y * stride + x];
    return plte[idx * 3] + plte[idx * 3 + 1] + plte[idx * 3 + 2] < 384;
  } else if (colorType === 2 || colorType === 6) {
    const ch = colorType === 2 ? 3 : 4;
    const o = y * stride + x * ch;
    return data[o] + data[o + 1] + data[o + 2] < 384;
  } else if (colorType === 4) {
    return data[y * stride + x] < 128;
  }
  return false;
}

export function pngToAscii(buf) {
  const img = decode(buf);
  const { width, height } = img;
  let xmin = width, xmax = -1, ymin = height, ymax = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isDark(img, x, y)) {
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
      }
    }
  }
  if (xmax < 0) throw new Error('empty image');
  let ppm = width;
  for (let y = 0; y < height; y++) {
    let prev = isDark(img, 0, y), run = 1;
    for (let x = 1; x < width; x++) {
      const d = isDark(img, x, y);
      if (d === prev) run++;
      else {
        if (run < ppm) ppm = run;
        run = 1;
        prev = d;
      }
    }
  }
  const mods = Math.round((xmax - xmin + 1) / ppm);
  const at = (c, r) => isDark(img, xmin + Math.round(c * ppm + ppm / 2), ymin + Math.round(r * ppm + ppm / 2));
  const lines = [' '.repeat(mods + 2)];
  for (let r = 0; r < mods; r += 2) {
    let s = ' ';
    for (let c = 0; c < mods; c++) {
      const top = at(c, r);
      const bot = r + 1 < mods ? at(c, r + 1) : false;
      s += top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
    }
    lines.push(s);
  }
  lines.push(' '.repeat(mods + 2));
  return lines.join('\n');
}

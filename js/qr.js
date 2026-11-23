// 100% Offline QR-Code SVG Encoder (ISO/IEC 18004 Byte Mode, Error Correction L, Versions 1-20)
// + Optional Web Crypto AES-GCM PIN encryption for Pixel 9a <-> Win 11 device pairing (#8)

// ---------- Minimal Standards-Compliant QR Matrix Encoder (EC Level L) ----------

const EXP_TBL = new Uint8Array(512);
const LOG_TBL = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TBL[i] = x;
    EXP_TBL[i + 255] = x;
    LOG_TBL[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP_TBL[LOG_TBL[a] + LOG_TBL[b]];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP_TBL[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const res = new Uint8Array(ecCount);
  for (const b of data) {
    const factor = b ^ res[0];
    for (let i = 0; i < ecCount - 1; i++) res[i] = res[i + 1];
    res[ecCount - 1] = 0;
    for (let i = 0; i < ecCount; i++) {
      res[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return res;
}

// Version table (EC Level L): [totalCodewords, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data, alignCenters]
const QR_VER_L = [
  null,
  [26, 7, 1, 19, 0, 0, []],
  [44, 10, 1, 34, 0, 0, [6, 18]],
  [70, 15, 1, 55, 0, 0, [6, 22]],
  [100, 20, 1, 80, 0, 0, [6, 26]],
  [134, 26, 1, 108, 0, 0, [6, 30]],
  [172, 18, 2, 68, 0, 0, [6, 34]],
  [196, 20, 2, 78, 0, 0, [6, 22, 38]],
  [242, 24, 2, 97, 0, 0, [6, 24, 42]],
  [292, 30, 2, 116, 0, 0, [6, 26, 46]],
  [346, 18, 2, 68, 2, 69, [6, 28, 50]],
  [404, 20, 4, 81, 0, 0, [6, 30, 54]],
  [466, 24, 2, 92, 2, 93, [6, 32, 58]],
  [532, 26, 4, 107, 0, 0, [6, 34, 62]],
  [581, 30, 3, 115, 1, 116, [6, 26, 46, 66]],
  [655, 22, 5, 87, 1, 88, [6, 26, 48, 70]],
  [733, 24, 5, 98, 1, 99, [6, 26, 50, 74]],
  [815, 28, 1, 107, 5, 108, [6, 30, 54, 78]],
  [901, 30, 5, 120, 1, 121, [6, 30, 56, 82]],
  [991, 28, 3, 113, 4, 114, [6, 30, 58, 86]],
  [1085, 28, 3, 107, 5, 108, [6, 34, 62, 90]]
];

function formatBits(mask) {
  // EC level L = 01 (binary) -> 5-bit data = (0b01 << 3) | mask
  let data = (1 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

export function generateQrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  let ver = 0;
  for (let v = 1; v < QR_VER_L.length; v++) {
    const [, , g1b, g1d, g2b, g2d] = QR_VER_L[v];
    const dataCapBytes = g1b * g1d + g2b * g2d;
    const countBits = v <= 9 ? 8 : 16;
    const neededBits = 4 + countBits + bytes.length * 8;
    if (neededBits <= dataCapBytes * 8) { ver = v; break; }
  }
  if (!ver) throw new Error('Text zu lang für QR-Code.');

  const [, ecPerBlock, g1b, g1d, g2b, g2d, aligns] = QR_VER_L[ver];
  const dataCapBytes = g1b * g1d + g2b * g2d;

  // Pack bitstream
  const bits = [];
  const pushBits = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);
  const remBits = dataCapBytes * 8 - bits.length;
  for (let i = 0; i < Math.min(4, remBits); i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataCw.push(b);
  }
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (dataCw.length < dataCapBytes) dataCw.push(padBytes[pi++ & 1]);

  // Split into blocks & compute Reed-Solomon EC
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1b; i++) {
    const d = dataCw.slice(offset, offset + g1d);
    blocks.push({ d, ec: rsEncode(d, ecPerBlock) });
    offset += g1d;
  }
  for (let i = 0; i < g2b; i++) {
    const d = dataCw.slice(offset, offset + g2d);
    blocks.push({ d, ec: rsEncode(d, ecPerBlock) });
    offset += g2d;
  }

  // Interleave
  const finalCw = [];
  const maxD = Math.max(g1d, g2d);
  for (let i = 0; i < maxD; i++) {
    for (const bl of blocks) if (i < bl.d.length) finalCw.push(bl.d[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const bl of blocks) finalCw.push(bl.ec[i]);
  }

  const size = ver * 4 + 17;
  const mat = Array.from({ length: size }, () => new Int8Array(size)); // 0=white, 1=black
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunc = (r, c, v) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      mat[r][c] = v ? 1 : 0;
      isFunc[r][c] = 1;
    }
  };

  // Finder patterns + separators
  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        setFunc(r0 + dr, c0 + dc, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  for (let i = 0; i < aligns.length; i++) {
    for (let j = 0; j < aligns.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === aligns.length - 1) || (i === aligns.length - 1 && j === 0)) continue;
      const cr = aligns[i], cc = aligns[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunc(cr + dr, cc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Reserve format areas + dark module
  for (let i = 0; i <= 8; i++) {
    setFunc(8, i, 0);
    setFunc(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) setFunc(8, size - 1 - i, 0);
  for (let i = 0; i < 7; i++) setFunc(size - 1 - i, 8, 0);
  setFunc(size - 8, 8, 1);

  // Version info (v >= 7)
  if (ver >= 7) {
    const vb = versionBits(ver);
    for (let i = 0; i < 18; i++) {
      const bit = (vb >>> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  // Place data bits (zigzag upward/downward)
  let bitIdx = 0;
  const totalBits = finalCw.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((size - 1 - right) >> 1) % 2 === 0;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (isFunc[r][c]) continue;
        const bit = bitIdx < totalBits ? (finalCw[bitIdx >> 3] >>> (7 - (bitIdx & 7))) & 1 : 0;
        mat[r][c] = bit;
        bitIdx++;
      }
    }
  }

  // Apply mask 0: (r + c) % 2 === 0 (clean & universally readable)
  const mask = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunc[r][c] && ((r + c) % 2 === 0)) mat[r][c] ^= 1;
    }
  }

  // Write format info
  const fb = formatBits(mask);
  const f1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  for (let i = 0; i < 15; i++) {
    const b = (fb >>> (14 - i)) & 1;
    mat[f1[i][0]][f1[i][1]] = b;
    if (i < 8) mat[size - 1 - i][8] = b;
    else mat[8][size - 15 + i] = b;
  }

  return mat;
}

export function renderQrSvg(text, px = 220) {
  const mat = generateQrMatrix(text);
  const n = mat.length;
  const q = 3; // quiet zone
  const total = n + q * 2;
  let paths = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mat[r][c]) paths += `M${c + q},${r + q}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}" style="background:#ffffff;border-radius:10px;display:block;"><path d="${paths}" fill="#000000"/></svg>`;
}

// ---------- Pairing Payload Encryption (Optional PIN via Web Crypto AES-GCM) ----------

function toB64Url(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str) {
  const norm = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(pin, salt) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 60000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encodePairingCode(payloadObj, pin = '') {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const cleanPin = (pin || '').trim();
  if (!cleanPin) {
    return `P0.${toB64Url(jsonBytes)}`;
  }
  const salt = crypto.getRandomValues(new Uint8Array(12));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(cleanPin, salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, jsonBytes));
  return `P1.${toB64Url(salt)}.${toB64Url(iv)}.${toB64Url(cipher)}`;
}

export function isPinProtectedPairingCode(code) {
  return String(code || '').trim().startsWith('P1.');
}

export async function decodePairingCode(code, pin = '') {
  const clean = String(code || '').trim();
  if (clean.startsWith('P0.')) {
    const bytes = fromB64Url(clean.slice(3));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  if (clean.startsWith('P1.')) {
    const parts = clean.split('.');
    if (parts.length !== 4) throw new Error('Ungültiger Kopplungs-Code.');
    const salt = fromB64Url(parts[1]);
    const iv = fromB64Url(parts[2]);
    const cipher = fromB64Url(parts[3]);
    const key = await deriveKey((pin || '').trim(), salt);
    try {
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new Error('Falsche PIN oder beschädigter Code.');
    }
  }
  throw new Error('Unbekanntes Kopplungs-Format.');
}

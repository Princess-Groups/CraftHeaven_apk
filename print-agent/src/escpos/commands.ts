/**
 * ESC/POS Command Builder
 * Generates raw ESC/POS commands for thermal receipt printers
 */

// ESC/POS Commands
export const ESC = 0x1b;
export const GS = 0x1d;
export const FS = 0x1c;
export const DLE = 0x10;
export const EOT = 0x04;
export const ENQ = 0x05;

// Helper to create command arrays
export function cmd(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

export function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// Initialize printer
export function init(): Uint8Array {
  return cmd(ESC, 0x40); // ESC @
}

// Text formatting
export function setAlign(align: "left" | "center" | "right"): Uint8Array {
  const map = { left: 0, center: 1, right: 2 };
  return cmd(ESC, 0x61, map[align]);
}

export function setFontSize(width: number, height: number): Uint8Array {
  // width: 0=normal, 1=2x; height: 0=normal, 1=2x
  const n = (width ? 0x10 : 0) | (height ? 0x20 : 0) | 0x00;
  return cmd(GS, 0x21, n);
}

export function setBold(enabled: boolean): Uint8Array {
  return cmd(ESC, 0x45, enabled ? 1 : 0);
}

export function setUnderline(enabled: boolean): Uint8Array {
  return cmd(ESC, 0x2d, enabled ? 1 : 0);
}

export function setInvert(enabled: boolean): Uint8Array {
  return cmd(GS, 0x42, enabled ? 1 : 0);
}

// Text encoding
export function setCodePage(codePage: number): Uint8Array {
  return cmd(ESC, 0x74, codePage);
}

// Line feed
export function feedLines(lines: number): Uint8Array {
  return cmd(ESC, 0x64, lines);
}

export function feedAndCut(): Uint8Array {
  return concat(
    feedLines(3),
    cmd(GS, 0x56, 0x41, 0x00) // GS V A 0 - full cut
  );
}

export function partialCut(): Uint8Array {
  return concat(
    feedLines(3),
    cmd(GS, 0x56, 0x41, 0x01) // GS V A 1 - partial cut
  );
}

// Cash drawer
export function kickDrawer(pin: 2 | 5 = 2): Uint8Array {
  // ESC p m t1 t2
  // m=0 (drawer 1), m=1 (drawer 2)
  // t1, t2 = on/off time (1-8, in 2ms units)
  return cmd(ESC, 0x70, pin === 2 ? 0 : 1, 2, 2);
}

// Barcode (CODE128)
export function printBarcode(data: string, options: {
  width?: number;    // 2-6, default 3
  height?: number;   // 1-255, default 162
  hriPosition?: number; // 0=none, 1=above, 2=below, 3=both, default 2
  hriFont?: number;  // 0=font A, 1=font B, default 0
} = {}): Uint8Array {
  const { width = 3, height = 162, hriPosition = 2, hriFont = 0 } = options;
  const bytes = new TextEncoder().encode(data);

  return concat(
    cmd(GS, 0x77, width),        // GS w - set width
    cmd(GS, 0x68, height),       // GS h - set height
    cmd(GS, 0x48, hriPosition),  // GS H - HRI position
    cmd(GS, 0x66, hriFont),      // GS f - HRI font
    cmd(GS, 0x6b, 0x49, bytes.length, ...bytes) // GS k - CODE128
  );
}

// QR Code
export function printQRCode(data: string, options: {
  model?: 1 | 2;     // QR model
  size?: number;     // 1-16, default 3
  errorLevel?: "L" | "M" | "Q" | "H"; // default M
} = {}): Uint8Array {
  const { model = 2, size = 3, errorLevel = "M" } = options;
  const errorMap = { L: 0x30, M: 0x31, Q: 0x32, H: 0x33 };
  const bytes = new TextEncoder().encode(data);

  return concat(
    cmd(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, model, 0x00), // Select model
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, errorMap[errorLevel]), // Set error correction
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x44, size), // Set size
    cmd(GS, 0x28, 0x6b, bytes.length + 3, 0x00, 0x31, 0x50, 0x30, ...bytes), // Store data
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30)  // Print
  );
}

// Image printing (raster)
export function printImage(imageData: Uint8Array, width: number, height: number): Uint8Array {
  // GS v 0 - print raster bit image
  // width in bytes (8 dots per byte)
  const widthBytes = Math.ceil(width / 8);
  const header = cmd(GS, 0x76, 0x30, 0x00, widthBytes & 0xFF, (widthBytes >> 8) & 0xFF, height & 0xFF, (height >> 8) & 0xFF);
  return concat(header, imageData);
}

// Paper sensor status
export function getPaperStatus(): Uint8Array {
  return cmd(ESC, 0x76); // ESC v - not widely supported
}

// Real-time status request
export function realTimeStatus(): Uint8Array {
  return cmd(DLE, 0x04, 0x01); // DLE EOT 1 - printer status
}

// Print and return to standard mode (for page mode)
export function printAndReturn(): Uint8Array {
  return cmd(ESC, 0x0c); // FF
}

// Page mode commands
export function enterPageMode(): Uint8Array {
  return cmd(ESC, 0x4c); // ESC L
}

export function exitPageMode(): Uint8Array {
  return cmd(ESC, 0x53); // ESC S
}

// Set print area in page mode
export function setPrintArea(x: number, y: number, width: number, height: number): Uint8Array {
  return cmd(ESC, 0x57, x & 0xFF, (x >> 8) & 0xFF, y & 0xFF, (y >> 8) & 0xFF, width & 0xFF, (width >> 8) & 0xFF, height & 0xFF, (height >> 8) & 0xFF);
}

// Print text helper
export function text(content: string, options: {
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: "normal" | "double" | "double-width" | "double-height";
  underline?: boolean;
} = {}): Uint8Array {
  const { align = "left", bold = false, size = "normal", underline = false } = options;

  const cmds: Uint8Array[] = [];

  if (align !== "left") cmds.push(setAlign(align));
  if (bold) cmds.push(setBold(true));
  if (underline) cmds.push(setUnderline(true));

  switch (size) {
    case "double":
      cmds.push(setFontSize(1, 1));
      break;
    case "double-width":
      cmds.push(setFontSize(1, 0));
      break;
    case "double-height":
      cmds.push(setFontSize(0, 1));
      break;
  }

  cmds.push(cmd(...new TextEncoder().encode(content + "\n")));

  // Reset formatting
  if (underline) cmds.push(setUnderline(false));
  if (bold) cmds.push(setBold(false));
  if (size !== "normal") cmds.push(setFontSize(0, 0));
  if (align !== "left") cmds.push(setAlign("left"));

  return concat(...cmds);
}

// Draw line
export function drawLine(char: string = "-", width: number = 42): Uint8Array {
  return text(char.repeat(width), { align: "center" });
}
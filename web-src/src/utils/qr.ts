import qrcode from '../lib/qrcode.js';

/** Draws `text` as a QR code onto `canvas` (fixed 4px modules, 4-module quiet zone). */
export function renderQrCanvas(canvas: HTMLCanvasElement | null, text: string): void {
  if (!canvas) return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const moduleCount = qr.getModuleCount();
    const cellSize = 4;
    const margin = 4;
    const size = moduleCount * cellSize + margin * 2;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(margin + c * cellSize, margin + r * cellSize, cellSize, cellSize);
        }
      }
    }
  } catch (e) {
    console.warn('QR render failed:', e);
  }
}

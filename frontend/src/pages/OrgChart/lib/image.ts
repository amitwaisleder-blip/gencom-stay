// Resize an uploaded image to a JPEG data URL that fits in localStorage.
// Browsers store strings as UTF-16, so a 5MB quota gives ~2.5MB usable;
// we cap photos at ~600px on the long edge and ~85% JPEG quality, which
// lands around 100-200KB per photo for typical hotel exteriors.

const MAX_EDGE = 600;
const QUALITY = 0.85;

export async function fileToResizedDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = scaleDown(img.naturalWidth, img.naturalHeight, MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unsupported");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image."));
    img.src = url;
  });
}

function scaleDown(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w >= h ? max / w : max / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

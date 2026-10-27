// Achica una foto en el navegador antes de subirla (JPEG, lado mayor 2048 px).
// WhatsApp acepta fotos de hasta 5 MB y solo JPG o PNG.

const STEPS = [
  { maxSide: 2048, quality: 0.85 },
  { maxSide: 1600, quality: 0.75 },
  { maxSide: 1280, quality: 0.7 },
];

async function encode(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Fondo blanco: JPEG no tiene transparencia (los PNG quedarían en negro).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

/** Devuelve la foto en JPEG por debajo de `maxBytes`, o null si no se pudo. */
export async function compressImage(file: Blob, maxBytes: number): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    for (const step of STEPS) {
      const blob = await encode(bitmap, step.maxSide, step.quality);
      if (blob && blob.size <= maxBytes) return blob;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/** "foto.png" → "foto.jpg". */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "foto";
  return `${base}.jpg`;
}

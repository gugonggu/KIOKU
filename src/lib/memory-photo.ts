import sharp from "sharp";

export const maxMemoryUpload = 3800000;
export const maxMemoryPhotoBytes = 524288;

const accepted = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

export async function sanitizeMemoryPhoto(file: File) {
  if (!Object.hasOwn(accepted, file.type) || !file.size || file.size > maxMemoryUpload) throw new Error("Invalid photo");
  const image = sharp(Buffer.from(await file.arrayBuffer()), { failOn: "warning", limitInputPixels: 40000000 });
  const metadata = await image.metadata();
  if (metadata.format !== accepted[file.type as keyof typeof accepted] || (metadata.pages ?? 1) > 1) throw new Error("Invalid photo format");
  const oriented = image.autoOrient().flatten({ background: "#fbf8f1" });
  for (const edge of [1440, 1080, 800]) {
    const { data, info } = await oriented.clone()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (data.byteLength <= maxMemoryPhotoBytes) return { bytes: data, width: info.width, height: info.height };
  }
  throw new Error("Photo is too large after processing");
}

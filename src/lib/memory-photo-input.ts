export const maxMemoryUpload = 3_800_000;
export const memoryPhotoFormats = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

export function selectedMemoryPhotos(form: FormData): File[] {
  return [...form.getAll("photo"), ...form.getAll("camera")]
    .filter((file): file is File => file instanceof File && file.size > 0);
}

export function memoryPhotoInputError(files: File[], maxSize = maxMemoryUpload): string {
  if (files.length !== 1) return "사진 선택이나 카메라 중 한 곳에서 사진을 한 장 지정해 주세요.";
  const [file] = files;
  if (!Object.hasOwn(memoryPhotoFormats, file.type)) {
    if (/^image\/hei[cf](?:-sequence)?$/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
      return "HEIC·HEIF 사진은 JPEG로 내보낸 뒤 첨부해 주세요.";
    }
    return "JPEG, PNG 또는 WebP 사진을 선택해 주세요.";
  }
  if (file.size > maxSize) return "사진 크기를 3.8MB 이하로 줄인 뒤 다시 첨부해 주세요.";
  return "";
}

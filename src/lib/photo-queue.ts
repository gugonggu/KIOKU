export type PhotoProgress = { id: string; status: "queued" | "uploading" | "saved" | "failed"; error?: string };

export function photoFingerprint(file: Pick<File, "name" | "size" | "type" | "lastModified">) {
  // Mobile file pickers can assign a new lastModified value on every selection.
  return JSON.stringify([file.name, file.size, file.type]);
}

export async function uploadPhotoQueue<T extends PhotoProgress>(
  rows: readonly T[], upload: (row: T) => Promise<string>, update: (row: PhotoProgress) => void,
) {
  for (const row of rows) {
    if (row.status !== "queued" && row.status !== "failed") continue;
    update({ id: row.id, status: "uploading", error: "" });
    let error: string;
    try { error = await upload(row); } catch { error = "연결을 확인한 뒤 이 사진을 다시 시도해 주세요."; }
    update({ id: row.id, status: error ? "failed" : "saved", error });
  }
}

"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { maxMemoryUpload, memoryPhotoInputError } from "@/lib/memory-photo-input";
import { photoFingerprint, uploadPhotoQueue, type PhotoProgress } from "@/lib/photo-queue";
import { shrinkPhoto } from "./memory-form";

type QueuedPhoto = PhotoProgress & { file?: File; title: string; preview: string; fingerprint: string };
const labels = { queued: "대기", uploading: "전송 중", saved: "저장 완료", failed: "실패" };

async function thumbnail(file: File) {
  const bitmap = await createImageBitmap(file, { resizeWidth: 240 });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .7));
    return blob ? URL.createObjectURL(blob) : "";
  } finally { bitmap.close(); }
}

export function PhotoQueueForm({ action, remaining, children }: {
  action: (id: string, form: FormData) => Promise<string>; remaining: number; children: ReactNode;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<QueuedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const urls = useRef(new Set<string>());
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
  const saved = rows.filter(row => row.status === "saved").length;
  function update(change: PhotoProgress) {
    setRows(previous => previous.map(row => row.id === change.id ? { ...row, ...change,
      ...(change.status === "saved" && { file: undefined }) } : row));
  }
  async function run(selected: QueuedPhoto[]) {
    if (lock.current || !formRef.current?.reportValidity()) return;
    lock.current = true; setBusy(true); setMessage("");
    const common = new FormData(formRef.current);
    try {
      await uploadPhotoQueue(selected, async row => {
        if (!row.file) return "사진을 다시 선택해 주세요.";
        const form = new FormData();
        for (const [key, value] of common) form.append(key, value);
        form.set("title", row.title.trim() || "여행 사진");
        const file = row.file.size > maxMemoryUpload ? await shrinkPhoto(row.file).catch(() => null) : row.file;
        if (!file) return "사진 크기를 3.8MB 이하로 줄인 뒤 다시 첨부해 주세요.";
        form.set("photo", file);
        return action(row.id, form);
      }, update);
      router.refresh();
    } finally { lock.current = false; setBusy(false); }
  }
  async function select(files: File[]) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    const selected = [...rows];
    const errors: string[] = [];
    try {
      for (const file of files) {
        if (selected.some(row => row.fingerprint === photoFingerprint(file))) continue;
        if (selected.filter(row => row.status !== "saved").length >= remaining) {
          errors.push("여행의 남은 사진 한도를 초과했어요."); break;
        }
        const error = memoryPhotoInputError([file], 16_000_000);
        if (error) { errors.push(error); continue; }
        const preview = await thumbnail(file).catch(() => "");
        if (preview) urls.current.add(preview);
        selected.push({ id: crypto.randomUUID(), status: "queued", file, preview,
          title: file.name.replace(/\.[^.]+$/, "").slice(0, 100), fingerprint: photoFingerprint(file) });
      }
      setRows(selected); setMessage([...new Set(errors)].join(" "));
    } finally { lock.current = false; setBusy(false); }
  }
  return <form ref={formRef} className="suite-form" onSubmit={event => { event.preventDefault(); void run(rows); }}>
    <fieldset disabled={busy} className="plan-fields">
      <label>사진 파일<input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event => {
        void select(Array.from(event.target.files ?? [])); event.target.value = "";
      }} /></label>
      <label>카메라로 촬영<input type="file" accept="image/jpeg" capture="environment" onChange={event => {
        void select(Array.from(event.target.files ?? [])); event.target.value = "";
      }} /></label>
      <p className="plan-meta">여러 장을 선택하고 사진별 제목을 수정할 수 있어요. 큰 사진은 한 장씩 줄이며 위치 등 메타데이터는 저장 전에 제거해요. HEIC·HEIF는 JPEG로 내보내 주세요.</p>
      <p className="plan-meta">추가 가능 {Math.max(0, remaining - rows.filter(row => row.status !== "saved").length)}장 · 계정 전체 한도는 저장할 때 확인해요.</p>
      {children}
      <ul className="photo-queue" aria-label="선택한 사진">
        {rows.map((row, index) => <li key={row.id}>
          {row.preview && <Image src={row.preview} alt="선택한 사진 미리보기" unoptimized width={240} height={160} className="memory-image memory-preview" />}
          <label>사진 제목 {index + 1}<input maxLength={100} value={row.title} disabled={row.status === "saved"}
            onChange={event => setRows(previous => previous.map(item => item.id === row.id ? { ...item, title: event.target.value } : item))} /></label>
          <p>{labels[row.status]}</p>
          {row.error && <p role="alert">{row.error}</p>}
          {row.status !== "saved" && <button type="button" className="quiet-link" onClick={() => {
            if (row.preview) { URL.revokeObjectURL(row.preview); urls.current.delete(row.preview); }
            setRows(previous => previous.filter(item => item.id !== row.id));
          }}>사진 {index + 1} 제거</button>}
          {row.status === "failed" && <button type="button" className="quiet-link" onClick={() => void run([row])}>사진 {index + 1} 재시도</button>}
        </li>)}
      </ul>
      <button className="primary-button" type="submit" disabled={!rows.some(row => row.status === "queued" || row.status === "failed")}>사진 저장</button>
    </fieldset>
    <progress aria-label="전체 업로드 진행률" value={rows.filter(row => row.status === "saved" || row.status === "failed").length} max={Math.max(1, rows.length)} />
    <p role="status">{busy ? "사진 처리 중 · " : ""}{saved}/{rows.length}장 저장 · 실패 {rows.filter(row => row.status === "failed").length}장</p>
    {message && <p role="alert">{message}</p>}
  </form>;
}

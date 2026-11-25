"use client";

import Image from "next/image";
import { startTransition, useActionState, useEffect, useState, type ReactNode } from "react";
import { maxMemoryUpload, memoryPhotoInputError, selectedMemoryPhotos } from "@/lib/memory-photo-input";

const localPhotoLimit = 16_000_000;

async function shrinkPhoto(file: File) {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .83));
    return jpeg?.size && jpeg.size < maxMemoryUpload ? new File([jpeg], "photo.jpg", { type: "image/jpeg" }) : null;
  } finally {
    image.close();
  }
}

export function MemoryForm({ action, label, children, confirm, photoUpload }: {
  action: (state: string, form: FormData) => Promise<string>;
  label: string; children?: ReactNode; confirm?: string; photoUpload?: boolean;
}) {
  const [message, submit, pending] = useActionState(action, "");
  const [inputError, setInputError] = useState("");
  const [preview, setPreview] = useState("");
  const [processing, setProcessing] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const alert = inputError || message;
  return <form className={children ? "suite-form" : "memory-command"} action={submit} onChange={(event) => {
    if (!photoUpload || !(event.target instanceof HTMLInputElement) || event.target.type !== "file") return;
    const form = event.currentTarget;
    const other = form.elements.namedItem(event.target.name === "photo" ? "camera" : "photo");
    if (other instanceof HTMLInputElement && event.target.files?.length) other.value = "";
    const files = selectedMemoryPhotos(new FormData(form));
    const error = files.length ? memoryPhotoInputError(files, localPhotoLimit) : "";
    setInputError(error);
    setPreview(!error && files.length ? URL.createObjectURL(files[0]) : "");
  }} onSubmit={async (event) => {
    if (confirm && !window.confirm(confirm)) event.preventDefault();
    if (!photoUpload) return;
    const form = new FormData(event.currentTarget);
    const files = selectedMemoryPhotos(form);
    const error = memoryPhotoInputError(files, localPhotoLimit);
    setInputError(error);
    if (error) {
      event.preventDefault();
      return;
    }
    const [file] = files;
    if (file.size <= maxMemoryUpload) return;
    event.preventDefault();
    if (processing || pending) return;
    setProcessing(true);
    try {
      const reduced = await shrinkPhoto(file).catch(() => null);
      if (!reduced) {
        setInputError(memoryPhotoInputError(files));
        return;
      }
      form.set("photo", reduced);
      form.delete("camera");
      startTransition(() => submit(form));
    } finally {
      setProcessing(false);
    }
  }}>
    {children}
    {preview && <Image className="memory-image memory-preview" src={preview} unoptimized alt="선택한 사진 미리보기" width={240} height={160} />}
    <button className={children ? "primary-button" : "quiet-link"} disabled={processing || pending} type="submit">
      {processing ? "사진을 줄이는 중…" : pending ? "처리 중…" : label}
    </button>
    {alert && <p className="notice notice-error" role="alert">{alert}</p>}
  </form>;
}

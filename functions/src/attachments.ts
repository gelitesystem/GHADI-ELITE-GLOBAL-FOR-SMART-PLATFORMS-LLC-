import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore, storage } from "./firebase";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 12;
const blockedExtensions = /\.(exe|dll|bat|cmd|com|scr|msi|sh|ps1)$/i;

function safeName(input: string) {
  const normalized = input.normalize("NFKC").replace(/[^\p{L}\p{N}\-_. ]/gu, "_").trim().slice(0, 160);
  return normalized || "attachment";
}

function kindFor(mime: string, name: string) {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("zip") || /\.(zip|tar|gz|7z)$/i.test(name)) return "archive";
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("javascript")) return "text";
  return "document";
}

export async function storeAttachment(buffer: Buffer, nameHeader: string, mimeHeader: string) {
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error("attachment_size_not_allowed");
  const name = safeName(nameHeader || "attachment");
  const mimeType = (mimeHeader || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (blockedExtensions.test(name)) throw new Error("attachment_type_not_allowed");
  const bucket = storage.bucket();
  if (!bucket.name) throw new Error("storage_bucket_not_configured");
  const id = `att_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const storagePath = `ghadi/attachments/${id}/${name}`;
  const file = bucket.file(storagePath);
  await file.save(buffer, { resumable: false, metadata: { contentType: mimeType, metadata: { ghadiAttachmentId: id } } });
  const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });
  const record = { id, name, size: buffer.length, mimeType, kind: kindFor(mimeType, name), storagePath, url, uploadStatus: "stored", uploadedAt: new Date().toISOString() };
  await firestore.collection("ghadiAttachments").doc(id).set({ ...record, createdAt: FieldValue.serverTimestamp() });
  return record;
}

export async function getAttachment(id: string) {
  const snapshot = await firestore.collection("ghadiAttachments").doc(id).get();
  return snapshot.exists ? snapshot.data() : null;
}

export { MAX_ATTACHMENTS };

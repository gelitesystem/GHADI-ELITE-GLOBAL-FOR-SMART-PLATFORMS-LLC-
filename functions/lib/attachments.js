"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ATTACHMENTS = void 0;
exports.storeAttachment = storeAttachment;
exports.getAttachment = getAttachment;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const firebase_1 = require("./firebase");
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 12;
exports.MAX_ATTACHMENTS = MAX_ATTACHMENTS;
const blockedExtensions = /\.(exe|dll|bat|cmd|com|scr|msi|sh|ps1)$/i;
function safeName(input) {
    const normalized = input.normalize("NFKC").replace(/[^\p{L}\p{N}\-_. ]/gu, "_").trim().slice(0, 160);
    return normalized || "attachment";
}
function kindFor(mime, name) {
    if (mime === "application/pdf")
        return "pdf";
    if (mime.startsWith("image/"))
        return "image";
    if (mime.startsWith("video/"))
        return "video";
    if (mime.startsWith("audio/"))
        return "audio";
    if (mime.includes("zip") || /\.(zip|tar|gz|7z)$/i.test(name))
        return "archive";
    if (mime.startsWith("text/") || mime.includes("json") || mime.includes("javascript"))
        return "text";
    return "document";
}
async function storeAttachment(buffer, nameHeader, mimeHeader) {
    if (!buffer.length || buffer.length > MAX_BYTES)
        throw new Error("attachment_size_not_allowed");
    const name = safeName(nameHeader || "attachment");
    const mimeType = (mimeHeader || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (blockedExtensions.test(name))
        throw new Error("attachment_type_not_allowed");
    const bucket = firebase_1.storage.bucket();
    if (!bucket.name)
        throw new Error("storage_bucket_not_configured");
    const id = `att_${(0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 14)}`;
    const storagePath = `ghadi/attachments/${id}/${name}`;
    const file = bucket.file(storagePath);
    await file.save(buffer, { resumable: false, metadata: { contentType: mimeType, metadata: { ghadiAttachmentId: id } } });
    const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });
    const record = { id, name, size: buffer.length, mimeType, kind: kindFor(mimeType, name), storagePath, url, uploadStatus: "stored", uploadedAt: new Date().toISOString() };
    await firebase_1.firestore.collection("ghadiAttachments").doc(id).set({ ...record, createdAt: firestore_1.FieldValue.serverTimestamp() });
    return record;
}
async function getAttachment(id) {
    const snapshot = await firebase_1.firestore.collection("ghadiAttachments").doc(id).get();
    return snapshot.exists ? snapshot.data() : null;
}
//# sourceMappingURL=attachments.js.map
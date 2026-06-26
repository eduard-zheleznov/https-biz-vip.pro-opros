import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { nanoid } from "nanoid";

import { env } from "@/lib/env";

type UploadPurpose = "survey-media" | "response-attachment" | "voice-answer";

const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const responseAttachmentMimeTypes = new Set([
  ...imageMimeTypes,
  "application/pdf",
  "application/octet-stream",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/json",
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/webm",
  "audio/mp3",
  "audio/mpga",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/wave",
  "audio/x-m4a",
  "audio/x-wav",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const voiceMimeTypes = new Set([
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/webm",
  "audio/mp3",
  "audio/mpga",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/wave",
  "audio/x-m4a",
  "audio/x-wav",
  "application/octet-stream",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const imageUploadLimitBytes = 8 * 1024 * 1024;
const responseUploadLimitBytes = 25 * 1024 * 1024;

function uploadRoot() {
  return path.resolve(process.cwd(), env.UPLOAD_DIR);
}

export async function ensureUploadDir() {
  await mkdir(uploadRoot(), { recursive: true });
}

function allowedMimeTypesForPurpose(purpose: UploadPurpose) {
  if (purpose === "voice-answer") {
    return voiceMimeTypes;
  }

  if (purpose === "response-attachment") {
    return responseAttachmentMimeTypes;
  }

  return imageMimeTypes;
}

function uploadLimitForPurpose(purpose: UploadPurpose) {
  return purpose === "survey-media" ? imageUploadLimitBytes : responseUploadLimitBytes;
}

function normalizeMimeType(mimeType: string) {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

function extensionForMimeType(mimeType: string) {
  const byMime: Record<string, string> = {
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "audio/m4a": ".m4a",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp3": ".mp3",
    "audio/mpga": ".mp3",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-m4a": ".m4a",
    "audio/x-wav": ".wav",
    "application/octet-stream": ".bin",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/json": ".json",
  };

  return byMime[mimeType] ?? ".bin";
}

function mimeTypeForExtension(filename: string, purpose: UploadPurpose) {
  const byExtension: Record<string, string> = {
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".m4a": "audio/m4a",
    ".mp3": "audio/mpeg",
    ".mpga": "audio/mpga",
    ".mp4": purpose === "voice-answer" ? "audio/mp4" : "video/mp4",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".wav": "audio/wav",
    ".wave": "audio/wav",
    ".webm": "audio/webm",
    ".mov": "video/quicktime",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
  };

  return byExtension[path.extname(filename).toLowerCase()] ?? "";
}

export async function saveUploadedFile(
  file: File,
  surveyId: string,
  options?: { purpose?: UploadPurpose },
) {
  const purpose = options?.purpose ?? "survey-media";
  const allowedMimeTypes = allowedMimeTypesForPurpose(purpose);
  const maxUploadBytes = uploadLimitForPurpose(purpose);
  const normalizedMimeType = normalizeMimeType(file.type) || mimeTypeForExtension(file.name, purpose);

  if (!allowedMimeTypes.has(normalizedMimeType)) {
    throw new Error(
      purpose === "survey-media"
        ? "Разрешены только изображения JPEG, PNG, WEBP и GIF."
        : "Тип файла не поддерживается. Загрузите документ, изображение, аудио или видео в распространённом формате.",
    );
  }

  if (file.size > maxUploadBytes) {
    throw new Error(`Файл превышает ограничение ${Math.round(maxUploadBytes / 1024 / 1024)} МБ.`);
  }

  await ensureUploadDir();
  const extension = path.extname(file.name) || extensionForMimeType(normalizedMimeType);
  const filename = `${surveyId}-${nanoid(12)}${extension}`;
  const storagePath = path.join(uploadRoot(), filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(storagePath, buffer);

  return {
    filename,
    storagePath,
    originalName: file.name,
    mimeType: normalizedMimeType || file.type,
    byteSize: file.size,
  };
}

export async function readStoredFile(storagePath: string) {
  return readFile(storagePath);
}

export async function deleteStoredFile(storagePath: string) {
  try {
    await unlink(storagePath);
  } catch {
    // Ignore missing file paths during cleanup.
  }
}

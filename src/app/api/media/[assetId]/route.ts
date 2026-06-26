import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/storage";

function encodeHeaderFilename(filename: string) {
  const normalized = filename.trim() || "file";
  const asciiCandidate = normalized
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[\\"]/g, "")
    .replace(/[^\w .-]+/g, "_")
    .trim()
    .slice(0, 120);
  const extension = asciiCandidate.match(/\.[A-Za-z0-9]{1,12}$/)?.[0] ?? "";
  const fallback = asciiCandidate && !asciiCandidate.startsWith(".") ? asciiCandidate : `file${extension}`;
  const encoded = encodeURIComponent(normalized).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_request: Request, context: RouteContext<"/api/media/[assetId]">) {
  const { assetId } = await context.params;

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
  });

  if (!asset) {
    return new NextResponse("Not found", { status: 404 });
  }

  let file: Buffer;

  try {
    file = await readStoredFile(asset.storagePath);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Disposition": encodeHeaderFilename(asset.originalName),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

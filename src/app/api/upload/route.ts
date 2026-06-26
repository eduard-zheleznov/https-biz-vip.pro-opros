import { NextResponse } from "next/server";

import { hasSurveyAbility } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withBasePath } from "@/lib/base-path";
import { getCurrentUser } from "@/lib/data";
import { saveUploadedFile } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const surveyId = String(formData.get("surveyId") ?? "");
    const file = formData.get("file");

    if (!surveyId || !(file instanceof File)) {
      return NextResponse.json({ error: "surveyId and file are required" }, { status: 400 });
    }

    const survey = await prisma.survey.findUnique({
      where: { id: surveyId },
      include: {
        permissions: {
          where: { userId: user.id },
        },
      },
    });

    if (!survey) {
      return NextResponse.json({ error: "Survey not found" }, { status: 404 });
    }

    const permission = survey.permissions[0] ?? null;
    if (!hasSurveyAbility(user, permission, survey.ownerId, "edit")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const saved = await saveUploadedFile(file, surveyId);
    const asset = await prisma.mediaAsset.create({
      data: {
        surveyId,
        originalName: saved.originalName,
        filename: saved.filename,
        mimeType: saved.mimeType,
        byteSize: saved.byteSize,
        storagePath: saved.storagePath,
      },
    });

    return NextResponse.json({
      assetId: asset.id,
      url: withBasePath(`/api/media/${asset.id}`),
      filename: asset.filename,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 },
    );
  }
}

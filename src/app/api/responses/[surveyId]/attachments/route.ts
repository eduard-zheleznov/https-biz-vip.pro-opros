import { NextResponse } from "next/server";

import { saveResponseAttachment } from "@/lib/data";

export async function POST(request: Request, context: RouteContext<"/api/responses/[surveyId]/attachments">) {
  try {
    const { surveyId } = await context.params;
    const formData = await request.formData();
    const blockId = String(formData.get("blockId") ?? "");
    const kindValue = String(formData.get("kind") ?? "file");
    const file = formData.get("file");
    const kind = kindValue === "voice" ? "voice" : "file";
    const attachToResult = String(formData.get("attachToResult") ?? "true") !== "false";

    if (!blockId || !(file instanceof File)) {
      return NextResponse.json({ error: "blockId and file are required" }, { status: 400 });
    }

    const attachment = await saveResponseAttachment(surveyId, blockId, file, kind, {
      attachToResult,
    });

    return NextResponse.json({ attachment });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить файл." },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";

import { getCurrentUser, saveSurveyDraft } from "@/lib/data";

export async function POST(request: Request, context: RouteContext<"/api/surveys/[surveyId]/save">) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { surveyId } = await context.params;
    const payload = (await request.json()) as {
      schema: unknown;
      changeSummary?: string;
      folderId?: string | null;
    };

    const version = await saveSurveyDraft(surveyId, user.id, {
      schema: payload.schema as never,
      changeSummary: payload.changeSummary,
      folderId: payload.folderId,
    });

    return NextResponse.json({
      ok: true,
      versionNumber: version.versionNumber,
      savedAt: version.createdAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save survey" },
      { status: 400 },
    );
  }
}

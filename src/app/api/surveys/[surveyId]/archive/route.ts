import { NextResponse } from "next/server";

import { archiveSurvey, getCurrentUser } from "@/lib/data";

export async function POST(_request: Request, context: RouteContext<"/api/surveys/[surveyId]/archive">) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { surveyId } = await context.params;
    await archiveSurvey(surveyId, user.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to archive survey" },
      { status: 400 },
    );
  }
}

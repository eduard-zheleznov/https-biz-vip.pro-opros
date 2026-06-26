import { NextResponse } from "next/server";

import { getCurrentUser, restoreSurvey } from "@/lib/data";

export async function POST(_request: Request, context: RouteContext<"/api/surveys/[surveyId]/restore">) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { surveyId } = await context.params;
    await restoreSurvey(surveyId, user.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to restore survey" },
      { status: 400 },
    );
  }
}

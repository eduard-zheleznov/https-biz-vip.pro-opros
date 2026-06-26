import { NextResponse } from "next/server";

import { getCurrentUser, publishSurvey } from "@/lib/data";

export async function POST(_request: Request, context: RouteContext<"/api/surveys/[surveyId]/publish">) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { surveyId } = await context.params;
    await publishSurvey(surveyId, user.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to publish survey" },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";

import { getCurrentUser, updateSurveyPublicSlug } from "@/lib/data";

export async function POST(request: Request, context: RouteContext<"/api/surveys/[surveyId]/public-slug">) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { surveyId } = await context.params;
    const payload = (await request.json()) as {
      publicSlug?: unknown;
    };

    const survey = await updateSurveyPublicSlug(surveyId, user.id, String(payload.publicSlug ?? ""));

    return NextResponse.json({
      ok: true,
      publicSlug: survey.publicSlug,
      savedAt: survey.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update public link" },
      { status: 400 },
    );
  }
}

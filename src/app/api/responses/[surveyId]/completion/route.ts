import { NextResponse } from "next/server";

import { getPublicResponseCompletionState } from "@/lib/data";

export async function GET(_request: Request, context: RouteContext<"/api/responses/[surveyId]/completion">) {
  try {
    const { surveyId } = await context.params;
    const state = await getPublicResponseCompletionState(surveyId);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load completion state" },
      { status: 400 },
    );
  }
}

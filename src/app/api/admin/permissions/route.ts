import { NextResponse } from "next/server";

import { getCurrentUser, updateSurveyPermission } from "@/lib/data";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await request.json()) as {
      userId: string;
      surveyId: string;
      canView: boolean;
      canCreate?: boolean;
      canEdit: boolean;
      canDelete: boolean;
      canResults: boolean;
    };

    await updateSurveyPermission(user.id, {
      ...payload,
      canCreate: payload.canCreate ?? false,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update permissions" },
      { status: 400 },
    );
  }
}

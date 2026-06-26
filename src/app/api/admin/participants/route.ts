import { NextResponse } from "next/server";

import { createParticipant, deleteParticipant, getCurrentUser } from "@/lib/data";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await request.json()) as { email: string };
    const result = await createParticipant(payload.email, user.id);
    return NextResponse.json({
      ok: true,
      inviteUrl: result.inviteUrl,
      memberId: result.member.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create participant" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await request.json()) as { userId: string };
    await deleteParticipant(user.id, payload.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete participant" },
      { status: 400 },
    );
  }
}

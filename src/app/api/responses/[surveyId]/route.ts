import { NextResponse } from "next/server";

import {
  completeResponseSession,
  initResponseSession,
  recordResponseAnswer,
  resetInProgressResponseSession,
  ResponseTimerExpiredError,
  startResponseTimer,
} from "@/lib/data";

export async function GET(request: Request, context: RouteContext<"/api/responses/[surveyId]">) {
  try {
    const { surveyId } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    const restart = searchParams.get("restart") === "1";
    const retakeToken = searchParams.get("retake");
    const session = await initResponseSession(surveyId, { restart, retakeToken });
    const answers =
      "answers" in session && Array.isArray(session.answers)
        ? session.answers
        : [];

    return NextResponse.json({
      id: session.id,
      respondentKey: session.respondentKey,
      status: session.status,
      startedAt: session.startedAt,
      timerStartedAt: session.timerStartedAt,
      timerDeadlineAt: session.timerDeadlineAt,
      secondsLeft: session.secondsLeft,
      lastBlockId: session.lastBlockId,
      answers: answers.map((answer) => ({
        blockId: answer.blockId,
        rawValue: answer.rawValue,
        value: answer.value,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to initialise response" },
      { status: 400 },
    );
  }
}

export async function POST(request: Request, context: RouteContext<"/api/responses/[surveyId]">) {
  try {
    const { surveyId } = await context.params;
    const payload = (await request.json()) as
      | { action: "answer"; blockId: string; value: unknown; allowPartial?: boolean }
      | { action: "startTimer"; nextBlockId: string | null }
      | { action: "complete"; status: "COMPLETED" | "PARTIAL" | "TIMED_OUT" }
      | { action: "reset" };

    if (payload.action === "answer") {
      const answer = await recordResponseAnswer(surveyId, payload.blockId, payload.value, {
        allowPartial: payload.allowPartial,
      });
      return NextResponse.json({ ok: true, answer });
    }

    if (payload.action === "startTimer") {
      const timer = await startResponseTimer(surveyId, payload.nextBlockId);
      return NextResponse.json({ ok: true, ...timer });
    }

    if (payload.action === "reset") {
      await resetInProgressResponseSession(surveyId);
      return NextResponse.json({ ok: true });
    }

    const session = await completeResponseSession(surveyId, payload.status);
    return NextResponse.json({ ok: true, session });
  } catch (error) {
    if (error instanceof ResponseTimerExpiredError) {
      return NextResponse.json(
        {
          error: error.message,
          status: "TIMED_OUT",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit response" },
      { status: 400 },
    );
  }
}

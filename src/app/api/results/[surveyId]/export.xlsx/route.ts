import { NextResponse } from "next/server";

import { buildResultsWorkbook } from "@/lib/export";
import { getCurrentUser, listSurveyResults } from "@/lib/data";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, context: RouteContext<"/api/results/[surveyId]/export.xlsx">) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { surveyId } = await context.params;
  const { searchParams } = new URL(request.url);
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
  });

  if (!survey) {
    return new NextResponse("Survey not found", { status: 404 });
  }

  const responses = await listSurveyResults(surveyId, user.id, {
    status: (searchParams.get("status") as "ALL") || "ALL",
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
    sort: (searchParams.get("sort") as never) || "newest",
    search: searchParams.get("search"),
  });

  const workbook = await buildResultsWorkbook(survey.title, responses);

  return new NextResponse(workbook, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(
        `${slugifyFilename(survey.title)}.xlsx`,
      )}"`,
    },
  });
}

function slugifyFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/(^-|-$)/g, "");
}

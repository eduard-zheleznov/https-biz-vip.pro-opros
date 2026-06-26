import ExcelJS from "exceljs";

import { buildAnswerRows } from "@/lib/results";
import { formatResponseStatus } from "@/lib/utils";

type ExportResponse = {
  id: string;
  status: string;
  totalScore: number;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  answers: {
    blockId: string;
    blockType: string;
    prompt: string;
    value: unknown;
    score: number;
  }[];
};

export async function buildResultsWorkbook(surveyTitle: string, responses: ExportResponse[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Survey Builder";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Результаты");
  const dynamicColumns = Array.from(
    new Set(
      responses.flatMap((response) =>
        buildAnswerRows(
          response.answers.map((answer) => ({
            ...answer,
            blockType: answer.blockType as never,
          })),
        ).map((answer) => answer.prompt),
      ),
    ),
  );

  worksheet.columns = [
    { header: "ID", key: "id", width: 28 },
    { header: "Статус", key: "status", width: 16 },
    { header: "Баллы", key: "totalScore", width: 12 },
    { header: "Начало", key: "startedAt", width: 24 },
    { header: "Завершение", key: "completedAt", width: 24 },
    ...dynamicColumns.map((column) => ({
      header: column,
      key: column,
      width: 28,
    })),
  ];

  for (const response of responses) {
    const row: Record<string, string | number> = {
      id: response.id,
      status: formatResponseStatus(response.status),
      totalScore: response.totalScore,
      startedAt: new Date(response.startedAt).toISOString(),
      completedAt: response.completedAt ? new Date(response.completedAt).toISOString() : "",
    };

    for (const answer of buildAnswerRows(response.answers as never)) {
      row[answer.prompt] = answer.value;
    }

    worksheet.addRow(row);
  }

  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

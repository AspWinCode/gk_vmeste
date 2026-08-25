import fs from "fs";
import path from "path";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { env } from "../lib/env";

export interface DailyReportInput {
  kpis: { label: string; value: string }[];
  signals: { title: string; text: string; label: string }[];
  projects: { name: string; note: string; status: string }[];
  tasks: { title: string; due: string }[];
}

function cell(text: string, header = false) {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: header })] })] });
}

// Отчёт руководителя — генерируется по кнопке "Сформировать отчёт" на рабочем столе,
// из уже посчитанных на клиенте данных (те же сигналы/проекты/поручения, что видны на экране).
export async function buildDailyReportDocx(input: DailyReportInput): Promise<string> {
  const today = new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Сводка руководителя", heading: HeadingLevel.TITLE }),
          new Paragraph({ text: today, heading: HeadingLevel.HEADING_3 }),

          new Paragraph({ text: "Ключевые показатели", heading: HeadingLevel.HEADING_2 }),
          new Table({
            rows: input.kpis.map(
              (k) => new TableRow({ children: [cell(k.label), cell(k.value, true)] })
            ),
          }),

          new Paragraph({ text: "Критические сигналы", heading: HeadingLevel.HEADING_2 }),
          ...(input.signals.length
            ? input.signals.map((s) => new Paragraph({ text: `• [${s.label}] ${s.title} — ${s.text}` }))
            : [new Paragraph({ text: "Критических сигналов нет." })]),

          new Paragraph({ text: "Проекты под контролем", heading: HeadingLevel.HEADING_2 }),
          new Table({
            rows: [
              new TableRow({ children: [cell("Проект", true), cell("Статус", true), cell("Комментарий", true)] }),
              ...input.projects.map(
                (p) => new TableRow({ children: [cell(p.name), cell(p.status), cell(p.note)] })
              ),
            ],
          }),

          new Paragraph({ text: "Поручения дня", heading: HeadingLevel.HEADING_2 }),
          ...(input.tasks.length
            ? input.tasks.map((t) => new Paragraph({ text: `• ${t.title} — срок: ${t.due}` }))
            : [new Paragraph({ text: "Открытых поручений нет." })]),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const dir = path.resolve(env.uploadDir, "reports");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `daily-report-${Date.now()}.docx`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

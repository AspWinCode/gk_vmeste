import fs from "fs";
import path from "path";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { env } from "../lib/env";

export interface ProtocolInput {
  jobId: string;
  meetingType: string | null;
  summary: string;
  keyPoints: string[];
  tasks: { title: string; owner: string | null; dueDate: string | null }[];
  transcriptExcerpt: string;
}

function cell(text: string, header = false) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: header })] })],
  });
}

// Формирует протокол встречи в .docx — то, что транскрибатор рассылает участникам по email.
export async function buildProtocolDocx(input: ProtocolInput): Promise<string> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Протокол встречи", heading: HeadingLevel.TITLE }),
          new Paragraph({ text: input.meetingType ?? "Встреча", heading: HeadingLevel.HEADING_3 }),

          new Paragraph({ text: "Краткое содержание", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: input.summary }),

          new Paragraph({ text: "Ключевые тезисы", heading: HeadingLevel.HEADING_2 }),
          ...input.keyPoints.map((p) => new Paragraph({ text: `• ${p}` })),

          new Paragraph({ text: "Поручения", heading: HeadingLevel.HEADING_2 }),
          new Table({
            rows: [
              new TableRow({
                children: [cell("Поручение", true), cell("Ответственный", true), cell("Срок", true)],
              }),
              ...input.tasks.map(
                (t) =>
                  new TableRow({
                    children: [cell(t.title), cell(t.owner ?? "—"), cell(t.dueDate ?? "—")],
                  })
              ),
            ],
          }),

          new Paragraph({ text: "Фрагмент расшифровки", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: input.transcriptExcerpt }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const dir = path.resolve(env.uploadDir, "protocols");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `protocol-${input.jobId}.docx`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

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
  // Заполнено только для "встречных" типов — см. isMeetingType в services/claude.ts.
  participants?: string[];
  subject?: string | null;
  discussionPoints?: string[];
  decisions?: string[];
  plans?: string[];
}

function cell(text: string, header = false) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: header })] })],
  });
}

// Формирует протокол встречи в .docx — то, что транскрибатор рассылает участникам по email.
// Для диктовки (participants/decisions/... пустые) секции шаблона встречи просто не выводятся —
// нет смысла показывать пустые "Участники"/"Решения" в протоколе монолога.
export async function buildProtocolDocx(input: ProtocolInput): Promise<string> {
  const isMeeting = Boolean(
    (input.participants && input.participants.length > 0) ||
      input.subject ||
      (input.discussionPoints && input.discussionPoints.length > 0) ||
      (input.decisions && input.decisions.length > 0) ||
      (input.plans && input.plans.length > 0)
  );

  const meetingSections = isMeeting
    ? [
        new Paragraph({ text: "Предмет обсуждения", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: input.subject || "—" }),

        new Paragraph({ text: "Участники", heading: HeadingLevel.HEADING_2 }),
        ...((input.participants && input.participants.length > 0
          ? input.participants.map((p) => new Paragraph({ text: `• ${p}` }))
          : [new Paragraph({ text: "Не определены." })])),

        new Paragraph({ text: "Что обсуждали", heading: HeadingLevel.HEADING_2 }),
        ...((input.discussionPoints && input.discussionPoints.length > 0
          ? input.discussionPoints.map((p) => new Paragraph({ text: `• ${p}` }))
          : [new Paragraph({ text: "—" })])),

        new Paragraph({ text: "Что решили", heading: HeadingLevel.HEADING_2 }),
        ...((input.decisions && input.decisions.length > 0
          ? input.decisions.map((p) => new Paragraph({ text: `• ${p}` }))
          : [new Paragraph({ text: "—" })])),

        new Paragraph({ text: "Планы", heading: HeadingLevel.HEADING_2 }),
        ...((input.plans && input.plans.length > 0
          ? input.plans.map((p) => new Paragraph({ text: `• ${p}` }))
          : [new Paragraph({ text: "—" })])),
      ]
    : [];

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: isMeeting ? "Протокол встречи" : "Саммари записи", heading: HeadingLevel.TITLE }),
          new Paragraph({ text: input.meetingType ?? "Встреча", heading: HeadingLevel.HEADING_3 }),

          new Paragraph({ text: "Краткое содержание", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: input.summary }),

          ...meetingSections,

          new Paragraph({ text: "Ключевые тезисы", heading: HeadingLevel.HEADING_2 }),
          ...(input.keyPoints.length > 0
            ? input.keyPoints.map((p) => new Paragraph({ text: `• ${p}` }))
            : [new Paragraph({ text: "—" })]),

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

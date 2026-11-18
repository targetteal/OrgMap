import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fail, Failure } from "../../src/core.js";
import type {
  RichInline,
  RichNode,
  RichParagraph,
  RichMark,
} from "../../../packages/content/index.js";
import type {
  ReportRenderDocument,
  ReportPdfRenderer,
} from "../meetings/export-contract.js";
import {
  validateReportDocument,
  REPORT_EXPORT_BUDGETS,
} from "./report-package.js";
const require = createRequire(import.meta.url);
const VERSION = "orgmap-pdfkit-v1";
type LocalFont = {
  alias: string;
  data: Buffer;
  face: { hasGlyphForCodePoint(code: number): boolean };
};
/** Loaded once by the server factory. Fonts and code are local; no URL or markup renderer exists. */
export async function createLocalReportPdfRenderer(): Promise<ReportPdfRenderer> {
  let PDFDocument: any, fontkit: any;
  try {
    const pdfkit = require("pdfkit");
    PDFDocument = pdfkit.PDFDocument ?? pdfkit;
    fontkit = require("fontkit");
  } catch {
    return fail(503, "FORMAT_CONFIGURATION_REQUIRED");
  }
  if (typeof PDFDocument !== "function" || typeof fontkit.create !== "function")
    fail(503, "FORMAT_CONFIGURATION_REQUIRED");
  let fonts: LocalFont[];
  try {
    const manifest = JSON.parse(
      await readFile(new URL("./fonts/manifest.json", import.meta.url), "utf8"),
    );
    fonts = [];
    for (const [alias, file] of [
      ["regular", "NotoSansCJKjp-Regular.otf"],
      ["bold", "NotoSansCJKjp-Bold.otf"],
      ["emoji", "NotoEmoji-Regular.ttf"],
    ]) {
      const data = await readFile(new URL("./fonts/" + file, import.meta.url));
      if (
        data.length > 20 * 1024 * 1024 ||
        manifest.files.find((f: any) => f.file === file)?.sha256 !==
          createHash("sha256").update(data).digest("hex")
      )
        throw Error("Font integrity");
      fonts.push({ alias, data, face: fontkit.create(data) });
    }
  } catch {
    return fail(503, "REPORT_FONT_CONFIGURATION_REQUIRED");
  }
  const fontFor = (text: string, bold = false) => {
    const preferred = fonts[bold ? 1 : 0];
    if (
      [...text].every(
        (c) =>
          /\s/u.test(c) ||
          preferred.face.hasGlyphForCodePoint(c.codePointAt(0)!),
      )
    )
      return preferred;
    if (
      [...text].every(
        (c) =>
          /\s/u.test(c) ||
          fonts[2].face.hasGlyphForCodePoint(c.codePointAt(0)!),
      )
    )
      return fonts[2];
    return fail(422, "UNSUPPORTED_REPORT_GLYPH");
  };
  const segments = (text: string, bold = false) => {
    const result: { text: string; alias: string }[] = [];
    for (const { segment } of new Intl.Segmenter("und", {
      granularity: "grapheme",
    }).segment(text)) {
      const alias = fontFor(segment, bold).alias,
        last = result.at(-1);
      if (segment === "\n" || segment === "\r\n") {
        result.push({ text: "\n", alias });
        continue;
      }
      if (last?.alias === alias && last.text !== "\n") last.text += segment;
      else result.push({ text: segment, alias });
    }
    return result;
  };
  return {
    async render(value: ReportRenderDocument) {
      const document = validateReportDocument(value);
      // Preflight every emitted text before opening a PDF stream; unsupported text never becomes tofu.
      const textValues = [
        document.title,
        document.circle.label,
        document.coverage,
        ...document.sections.map((s) => s.heading),
        ...document.roster.map((r) => r.label),
        ...document.agenda.map((a) => a.title),
        ...document.actions.map((a) => a.title),
      ];
      const visit = (nodes: readonly RichNode[]) => {
        for (const node of nodes) {
          if (node.type === "paragraph") {
            for (const inline of node.content ?? [])
              if (inline.type === "text")
                segments(
                  inline.text,
                  inline.marks?.some((m) => m.type === "bold"),
                );
          } else {
            for (const item of node.content) visit(item.content);
          }
        }
      };
      textValues.forEach((text) => segments(text));
      document.sections.forEach((s) => visit(s.body.doc.content));
      return new Promise<{
        bytes: Uint8Array;
        pages: number;
        rendererVersion: string;
      }>((resolve, reject) => {
        const doc = new PDFDocument({
          size: "A4",
          margins: { top: 48, left: 48, right: 48, bottom: 48 },
          bufferPages: true,
          font: null,
          info: {
            Title: document.title,
            Author: "OrgMap",
            Subject: document.state + " | " + document.coverage,
            CreationDate: new Date(document.capturedAt),
            ModDate: new Date(document.capturedAt),
          },
        });
        const chunks: Buffer[] = [];
        let total = 0,
          pages = 1,
          failed = false;
        const abort = (error: unknown) => {
          if (failed) return;
          failed = true;
          doc.destroy();
          reject(error);
        };
        doc.on("error", abort);
        doc.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > REPORT_EXPORT_BUDGETS.maxArtifactBytes) {
            abort(new Failure(413, "EXPORT_TOO_LARGE"));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        doc.on("end", () => {
          if (!failed)
            resolve({
              bytes: Buffer.concat(chunks),
              pages,
              rendererVersion: VERSION,
            });
        });
        doc.on("pageAdded", () => {
          pages++;
          if (pages > REPORT_EXPORT_BUDGETS.maxPagesPerPdf)
            throw new Failure(413, "REPORT_PAGE_LIMIT");
        });
        try {
          for (const font of fonts) doc.registerFont(font.alias, font.data);
          const left = 48,
            right = () => doc.page.width - 48,
            width = () => right() - left;
          const ensure = (height: number) => {
            if (height > doc.page.height - 96) fail(413, "REPORT_ROW_TOO_TALL");
            if (doc.y + height > doc.page.height - 48) doc.addPage();
          };
          const renderRuns = (
            runs: { text: string; marks?: RichMark[] }[],
            x: number,
            y: number,
            w: number,
            size = 10,
          ) => {
            const parts = runs.flatMap((run) =>
              segments(
                run.text,
                run.marks?.some((m) => m.type === "bold"),
              ).map((p) => ({ ...p, marks: run.marks ?? [] })),
            );
            if (!parts.length) {
              doc.y = y + size * 1.5;
              return;
            }
            doc.x = x;
            doc.y = y;
            parts.forEach((part, i) => {
              if (part.text === "\n") {
                if (
                  i === 0 ||
                  parts[i - 1].text === "\n" ||
                  i === parts.length - 1
                )
                  doc.y += size * 1.5;
                doc.x = x;
                ensure(size * 1.5);
                return;
              }

              const link = part.marks.find(
                (m): m is Extract<RichMark, { type: "link" }> =>
                  m.type === "link",
              );
              doc
                .font(part.alias)
                .fontSize(size)
                .fillColor(link ? "#164b78" : "#222222")
                .text(part.text, {
                  width: w,
                  lineGap: 3,
                  continued: i < parts.length - 1 && parts[i + 1].text !== "\n",
                  underline: part.marks.some((m) => m.type === "underline"),
                  strike: part.marks.some((m) => m.type === "strike"),
                  oblique: part.marks.some((m) => m.type === "italic")
                    ? 12
                    : false,
                  link: link?.attrs.href ?? null,
                });
            });
          };
          const paragraph = (
            node: RichParagraph,
            level = 0,
            marker?: string,
          ) => {
            ensure(24);
            let x = left + level * 18;
            const y = doc.y;
            if (marker) {
              doc.font("regular").fontSize(10);
              const markerWidth = doc.widthOfString(marker) + 8;
              doc.fillColor("#222222").text(marker, x, y, { lineBreak: false });
              x += markerWidth;
            }
            renderRuns(
              (node.content ?? []).map((inline: RichInline) =>
                inline.type === "hardBreak"
                  ? { text: "\n" }
                  : inline.type === "roleMention"
                    ? {text: "@" + inline.attrs.label}
                    : { text: inline.text, marks: inline.marks },
              ),
              x,
              y,
              right() - x,
            );
            doc.x = left;
            doc.moveDown(0.25);
          };
          const blocks = (nodes: readonly RichNode[], level = 0) => {
            for (const node of nodes) {
              if (node.type === "paragraph") paragraph(node, level);
              else
                node.content.forEach((item, index) => {
                  const marker =
                    node.type === "bulletList"
                      ? "•"
                      : String((node.attrs?.start ?? 1) + index) + ".";
                  item.content.forEach((child, i) => {
                    if (child.type === "paragraph")
                      paragraph(child, level, i === 0 ? marker : undefined);
                    else blocks([child], level + 1);
                  });
                });
            }
          };
          const text = (value: string, size = 10, bold = false) => {
            ensure(size * 2);
            renderRuns(
              [{ text: value, marks: bold ? [{ type: "bold" }] : [] }],
              left,
              doc.y,
              width(),
              size,
            );
            doc.x = left;
            doc.moveDown(0.4);
          };
          const heading = (value: string) => {
            ensure(64);
            doc.moveDown(0.7);
            text(value, 13, true);
          };
          const table = (
            caption: string,
            headers: string[],
            values: string[][],
            ratios: number[],
          ) => {
            const widths = ratios.map((r) => width() * r),
              padding = 5;
            const measure = (cells: string[], header = false) => {
              doc.font(header ? "bold" : "regular").fontSize(9);
              return Math.max(
                24,
                ...cells.map(
                  (cell, i) =>
                    doc.heightOfString(cell, {
                      width: widths[i] - padding * 2,
                      lineGap: 3,
                    }) +
                    padding * 2 +
                    6,
                ),
              );
            };
            const headerHeight = measure(headers, true);
            ensure(
              headerHeight + (values.length ? measure(values[0]) : 0) + 48,
            );
            heading(caption);
            const row = (cells: string[], header = false): void => {
              const height = measure(cells, header);
              if (!header && height > doc.page.height - 96 - headerHeight)
                fail(413, "REPORT_ROW_TOO_TALL");
              if (!header && doc.y + height > doc.page.height - 48) {
                doc.addPage();
                row(headers, true);
              }
              ensure(height);
              const startY = doc.y;
              let x = left;
              cells.forEach((cell, i) => {
                if (header)
                  doc.rect(x, startY, widths[i], height).fill("#efefef");
                doc
                  .rect(x, startY, widths[i], height)
                  .lineWidth(0.4)
                  .strokeColor("#c8c8c8")
                  .stroke();
                renderRuns(
                  [{ text: cell, marks: header ? [{ type: "bold" }] : [] }],
                  x + padding,
                  startY + padding,
                  widths[i] - padding * 2,
                  9,
                );
                x += widths[i];
              });
              doc.x = left;
              doc.y = startY + height;
            };
            row(headers, true);
            values.forEach((cells) => row(cells));
            doc.moveDown(0.5);
          };
          text(document.title, 21, true);
          text(
            document.state === "DRAFT"
              ? "DRAFT / RASCUNHO"
              : "PUBLISHED / PUBLICADA",
            11,
            true,
          );
          text(document.circle.label, 12);
          text("Meeting: " + document.ref.meetingId);
          text("Report: " + document.ref.reportId);
          text(
            `Source version: ${document.ref.reportVersion ?? "-"} | Published: ${document.ref.publishedVersion ?? "-"} | Epoch: ${document.ref.epoch}`,
          );
          text("Notes sequence: " + JSON.stringify(document.ref.notesSeq));
          text(
            `Planned: ${document.meeting.plannedStart} | Timezone: ${document.meeting.timezone}`,
          );
          text(
            `Actual: ${document.meeting.actualStart ?? "-"} / ${document.meeting.actualEnd ?? "-"}`,
          );
          text("Captured: " + document.capturedAt);
          text("Coverage: " + document.coverage);
          for (const section of document.sections) {
            heading(section.heading);
            blocks(section.body.doc.content);
          }
          if (document.roster.length) {
            table(
              "Participantes",
              ["Nome", "Presença", "Participação"],
              document.roster.map((r) => [
                r.label,
                r.attendance,
                r.participationRole,
              ]),
              [0.5, 0.25, 0.25],
            );
          }
          const names = new Map(
            document.roster.map((r) => [r.memberId, r.label]),
          );
          if (document.agenda.length) {
            table(
              "Pauta",
              ["Item", "Apresentador", "Estado / minutos"],
              document.agenda.map((a) => [
                a.title,
                names.get(a.presenterId) ?? a.presenterId,
                a.status +
                  " / " +
                  (a.durationMinutes ?? "-") +
                  (a.skipped ? " / SKIPPED" : ""),
              ]),
              [0.5, 0.25, 0.25],
            );
          }
          if (document.actions.length) {
            table(
              "Ações",
              ["Ação", "Responsável", "Estado"],
              document.actions.map((a) => [
                a.title,
                names.get(a.assigneeId) ?? a.assigneeId,
                a.state,
              ]),
              [0.5, 0.3, 0.2],
            );
          }
          const range = doc.bufferedPageRange();
          pages = range.count;
          for (
            let page = range.start;
            page < range.start + range.count;
            page++
          ) {
            doc.switchToPage(page);
            const bottom = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;
            doc
              .font("regular")
              .fontSize(8)
              .fillColor("#555555")
              .text(
                `${page + 1} / ${range.count} | ${VERSION}`,
                left,
                doc.page.height - 30,
                { width: width(), lineBreak: false },
              );
            doc.page.margins.bottom = bottom;
          }
          doc.end();
        } catch (error) {
          abort(error);
        }
      });
    },
  };
}

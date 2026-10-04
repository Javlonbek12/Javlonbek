import { getUserFromRequest } from "@/modules/core/auth/request-user";

const TYPES = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  png: "image/png",
} as const;

export type ExportFormat = keyof typeof TYPES;

export function exportFormat(value: string | null): ExportFormat | null {
  return value && value in TYPES ? (value as ExportFormat) : null;
}

export function fileResponse(body: Buffer, format: ExportFormat, fileName: string) {
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${fileName}.${format}`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function requireRequestUser(request: Request) {
  return getUserFromRequest(request);
}

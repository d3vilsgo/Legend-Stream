export type XtreamCatalogErrorCode =
  | "INVALID_RESPONSE"
  | "UNSUPPORTED_RESPONSE"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "UNREACHABLE"
  | "HTTP_ERROR";

export class XtreamCatalogError extends Error {
  readonly code: XtreamCatalogErrorCode;
  readonly status?: number;

  constructor(code: XtreamCatalogErrorCode, message: string, status?: number) {
    super(message);
    this.name = "XtreamCatalogError";
    this.code = code;
    this.status = status;
  }
}

export function isXtreamCatalogFallbackError(error: unknown) {
  return (
    error instanceof XtreamCatalogError &&
    (error.code === "INVALID_RESPONSE" ||
      error.code === "UNSUPPORTED_RESPONSE" ||
      error.code === "NOT_FOUND")
  );
}

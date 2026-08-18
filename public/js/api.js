export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message || code || "请求失败");
    this.name = "ApiError";
    this.status = status;
    this.code = code || "REQUEST_FAILED";
    this.details = details;
  }
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  let body = options.body;
  if (body !== undefined && typeof body !== "string") {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
    body,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error, payload?.message || "请求失败", payload?.details);
  }
  return payload;
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, { method: "POST", body });

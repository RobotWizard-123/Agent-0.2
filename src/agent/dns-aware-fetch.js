import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { resolve4 } from "node:dns/promises";

function normalizedHeaders(headers) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return { ...(headers ?? {}) };
}

async function connectionAddress(hostname, resolve4Impl) {
  if (isIP(hostname)) return { kind: "ip", value: hostname };
  try {
    const addresses = await resolve4Impl(hostname);
    if (addresses.length > 0) return { kind: "ip", value: addresses[0] };
  } catch {
    // DNS 解析失败：回退到让操作系统/原生请求处理，不抛出错误。
  }
  return { kind: "hostname", value: hostname, fallback: true };
}

export function createDnsAwareFetch({
  resolve4Impl = resolve4,
  httpRequestImpl = httpRequest,
  httpsRequestImpl = httpsRequest,
  maxResponseBytes = 2_000_000,
} = {}) {
  return async function dnsAwareFetch(input, opts = {}) {
    const target = new URL(input);
    if (!["http:", "https:"].includes(target.protocol)) {
      throw Object.assign(new Error(`Unsupported Agent protocol: ${target.protocol}`), {
        code: "AGENT_PROTOCOL_UNSUPPORTED",
      });
    }
    const secure = target.protocol === "https:";
    const address = await connectionAddress(target.hostname, resolve4Impl);
    const headers = {
      ...normalizedHeaders(opts.headers),
      host: target.host,
    };
    const resolvedHostname = address.value;
    const requestImpl = secure ? httpsRequestImpl : httpRequestImpl;

    try {
      return await new Promise((resolve, reject) => {
        const req = requestImpl({
          protocol: target.protocol,
          hostname: resolvedHostname,
          port: target.port || undefined,
          path: `${target.pathname}${target.search}`,
          method: opts.method ?? "GET",
          headers,
          signal: opts.signal,
          ...(secure ? {
            servername: target.hostname,
            rejectUnauthorized: true,
          } : {}),
        }, (response) => {
          const chunks = [];
          let bytes = 0;
          response.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > maxResponseBytes) {
              req.destroy(Object.assign(new Error("Agent response is too large"), {
                code: "AGENT_RESPONSE_TOO_LARGE",
              }));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            const bodyBytes = Buffer.concat(chunks);
            resolve(new Response(bodyBytes.length ? bodyBytes : null, {
              status: response.statusCode ?? 500,
              headers: response.headers,
            }));
          });
        });
        req.on("error", reject);
        if (opts.body !== undefined && opts.body !== null) req.write(opts.body);
        req.end();
      });
    } catch (err) {
      // 自定义请求失败（DNS 解析失败回退、证书 SNI、代理环境等）时，回退到使用原生 fetch。
      try {
        return await fetch(input, { ...opts, headers });
      } catch {
        throw err;
      }
    }
  };
}

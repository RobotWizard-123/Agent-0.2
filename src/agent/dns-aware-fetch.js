import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { resolve4 } from "node:dns/promises";

function normalizedHeaders(headers) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return { ...(headers ?? {}) };
}

async function connectionAddress(hostname, resolve4Impl) {
  if (isIP(hostname)) return hostname;
  const addresses = await resolve4Impl(hostname);
  if (!addresses.length) {
    throw Object.assign(new Error(`No IPv4 address found for ${hostname}`), {
      code: "ENOTFOUND",
    });
  }
  return addresses[0];
}

export function createDnsAwareFetch({
  resolve4Impl = resolve4,
  httpRequestImpl = httpRequest,
  httpsRequestImpl = httpsRequest,
  maxResponseBytes = 2_000_000,
} = {}) {
  return async function dnsAwareFetch(input, options = {}) {
    const target = new URL(input);
    if (!["http:", "https:"].includes(target.protocol)) {
      throw Object.assign(new Error(`Unsupported Agent protocol: ${target.protocol}`), {
        code: "AGENT_PROTOCOL_UNSUPPORTED",
      });
    }
    const secure = target.protocol === "https:";
    const address = await connectionAddress(target.hostname, resolve4Impl);
    const requestImpl = secure ? httpsRequestImpl : httpRequestImpl;
    const headers = {
      ...normalizedHeaders(options.headers),
      host: target.host,
    };

    return new Promise((resolve, reject) => {
      const request = requestImpl({
        protocol: target.protocol,
        hostname: address,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: options.method ?? "GET",
        headers,
        signal: options.signal,
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
            request.destroy(Object.assign(new Error("Agent response is too large"), {
              code: "AGENT_RESPONSE_TOO_LARGE",
            }));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve(new Response(body.length ? body : null, {
            status: response.statusCode ?? 500,
            headers: response.headers,
          }));
        });
      });
      request.on("error", reject);
      if (options.body !== undefined && options.body !== null) request.write(options.body);
      request.end();
    });
  };
}

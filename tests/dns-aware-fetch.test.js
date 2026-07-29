import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createDnsAwareFetch } from "../src/agent/dns-aware-fetch.js";

function fakeRequest(responseBody, capture) {
  return (options, callback) => {
    capture.options = options;
    const request = new EventEmitter();
    request.write = (body) => { capture.body = body; };
    request.destroy = (error) => request.emit("error", error);
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = { "content-type": "application/json" };
      callback(response);
      response.emit("data", Buffer.from(responseBody));
      response.emit("end");
    });
    return request;
  };
}

test("DNS-aware HTTPS transport connects by resolved IP while preserving SNI and Host", async () => {
  const capture = {};
  const fetchImpl = createDnsAwareFetch({
    resolve4Impl: async (hostname) => {
      assert.equal(hostname, "gateway.example");
      return ["10.20.30.40"];
    },
    httpsRequestImpl: fakeRequest('{"ok":true}', capture),
  });

  const response = await fetchImpl("https://gateway.example:4000/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer local" },
    body: '{"model":"demo"}',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(capture.options.hostname, "10.20.30.40");
  assert.equal(capture.options.servername, "gateway.example");
  assert.equal(capture.options.headers.host, "gateway.example:4000");
  assert.equal(capture.options.path, "/v1/chat/completions");
  assert.equal(capture.options.rejectUnauthorized, true);
});

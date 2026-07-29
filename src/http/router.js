export function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

export function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(Object.assign(new Error("Request body is too large"), { code: "REQUEST_TOO_LARGE" }));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request body is not valid JSON"), { code: "INVALID_JSON" }));
      }
    });
    request.on("error", reject);
  });
}

function matchPath(pattern, pathname) {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].startsWith(":")) {
      params[expected[index].slice(1)] = decodeURIComponent(actual[index]);
    } else if (expected[index] !== actual[index]) {
      return null;
    }
  }
  return params;
}

export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      routes.push({ method, pattern, handler });
    },
    async dispatch(request, response, context) {
      const url = new URL(request.url, "http://localhost");
      for (const route of routes) {
        if (request.method !== route.method) continue;
        const params = matchPath(route.pattern, url.pathname);
        if (!params) continue;
        const result = await route.handler({ request, response, params, url, context, readJsonBody });
        if (result !== undefined && !response.writableEnded) {
          const envelope = Number.isInteger(result?.status) && Object.hasOwn(result, "body");
          sendJson(response, envelope ? result.status : 200, envelope ? result.body : result, envelope ? result.headers : undefined);
        }
        return true;
      }
      return false;
    },
  };
}

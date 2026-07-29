import test from "node:test";
import assert from "node:assert/strict";
import { withV02Server } from "./helpers.js";

test("live and ready health checks keep degraded optional services visible", async () => {
  await withV02Server(async ({ request }) => {
    const live = await request("/health/live");
    const ready = await request("/health/ready");

    assert.equal(live.response.status, 200);
    assert.deepEqual(live.body, { status: "live", application_version: "0.2.0" });
    assert.equal(ready.response.status, 200);
    assert.equal(ready.body.status, "ready");
    assert.equal(ready.body.core.repository, "ready");
    assert.equal(ready.body.dependencies.model, "unconfigured");
    assert.equal(ready.body.dependencies.collector, "not_connected");
  });
});

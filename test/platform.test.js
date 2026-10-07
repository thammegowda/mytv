import test from "node:test";
import assert from "node:assert/strict";

import { createPlatform } from "../src/platform.js";

test("normalizes Samsung hardware Back key", () => {
  const platform = createPlatform({});

  assert.equal(
    platform.resolveRemoteKey({ keyCode: 10009, key: "Unidentified" }),
    "Back",
  );
  assert.equal(
    platform.resolveRemoteKey({ keyCode: 27, key: "Escape" }),
    "Escape",
  );
});

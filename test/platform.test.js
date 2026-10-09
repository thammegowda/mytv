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

test("registers channel and playback remote keys", async () => {
  let registeredKeys;
  const environment = {
    tizen: {
      application: {},
      tvinputdevice: {
        registerKeyBatch(keys, onSuccess) {
          registeredKeys = keys;
          onSuccess();
        },
        getKey(name) {
          return {
            ChannelDown: { code: 428 },
            ChannelUp: { code: 427 },
            MediaPlayPause: { code: 10252 },
          }[name];
        },
      },
    },
  };
  const platform = createPlatform(environment);

  await platform.registerRemoteKeys();

  assert.deepEqual(registeredKeys, [
    "ChannelDown",
    "ChannelUp",
    "MediaPlayPause",
  ]);
  assert.equal(
    platform.resolveRemoteKey({ keyCode: 427, key: "Unidentified" }),
    "ChannelUp",
  );
});

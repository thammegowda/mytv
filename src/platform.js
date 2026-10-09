const REMOTE_KEYS = [
  "ChannelDown",
  "ChannelUp",
  "MediaPlayPause",
];

export function createPlatform(environment = globalThis) {
  const tizenApi = environment.tizen;
  const samsungApi = environment.webapis;
  const isTizen = Boolean(tizenApi?.application);
  const isSamsungTv = Boolean(samsungApi?.appcommon);
  const remoteKeyCodes = new Map();

  return {
    isTizen,
    isSamsungTv,

    async registerRemoteKeys() {
      const inputDevice = tizenApi?.tvinputdevice;
      if (!inputDevice) {
        return { supported: false, keyCodes: remoteKeyCodes };
      }

      await new Promise((resolve, reject) => {
        if (typeof inputDevice.registerKeyBatch === "function") {
          inputDevice.registerKeyBatch(
            REMOTE_KEYS,
            resolve,
            (error) =>
              reject(
                new Error(
                  `Remote key registration failed: ${error?.message ?? error}`,
                ),
              ),
          );
          return;
        }

        try {
          for (const key of REMOTE_KEYS) {
            inputDevice.registerKey(key);
          }
          resolve();
        } catch (error) {
          reject(new Error(`Remote key registration failed: ${error.message}`));
        }
      });

      for (const key of REMOTE_KEYS) {
        const keyInfo = inputDevice.getKey(key);
        if (keyInfo?.code) {
          remoteKeyCodes.set(keyInfo.code, key);
        }
      }

      return { supported: true, keyCodes: remoteKeyCodes };
    },

    resolveRemoteKey(event) {
      if (event.keyCode === 10009) {
        return "Back";
      }
      return remoteKeyCodes.get(event.keyCode) ?? event.key;
    },

    setScreenSaver(enabled) {
      const appCommon = samsungApi?.appcommon;
      if (!appCommon) {
        return Promise.resolve({ supported: false });
      }

      const state = enabled
        ? appCommon.AppCommonScreenSaverState.SCREEN_SAVER_ON
        : appCommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF;

      return new Promise((resolve, reject) => {
        try {
          appCommon.setScreenSaver(
            state,
            () => resolve({ supported: true }),
            (error) =>
              reject(
                new Error(
                  `Screen saver update failed: ${error?.message ?? error}`,
                ),
              ),
          );
        } catch (error) {
          reject(new Error(`Screen saver update failed: ${error.message}`));
        }
      });
    },

    getMemorySnapshot() {
      const systemInfo = tizenApi?.systeminfo;
      if (!systemInfo) {
        return null;
      }

      return {
        totalBytes: systemInfo.getTotalMemory(),
        availableBytes: systemInfo.getAvailableMemory(),
      };
    },

    exit() {
      if (isTizen) {
        tizenApi.application.getCurrentApplication().exit();
        return true;
      }

      return false;
    },
  };
}

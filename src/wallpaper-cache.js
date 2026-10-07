const DATABASE_NAME = "open-gallery";
const DATABASE_VERSION = 1;
const STORE_NAME = "bing-wallpapers";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(new Error(`Wallpaper cache request failed: ${request.error}`));
    };
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => {
      reject(
        new Error(`Wallpaper cache transaction failed: ${transaction.error}`),
      );
    };
    transaction.onabort = () => {
      reject(
        new Error(`Wallpaper cache transaction aborted: ${transaction.error}`),
      );
    };
  });
}

export class IndexedDbWallpaperCache {
  constructor({
    indexedDb = globalThis.indexedDB,
    urlApi = globalThis.URL,
  } = {}) {
    this.indexedDb = indexedDb;
    this.urlApi = urlApi;
    this.databasePromise = null;
    this.objectUrls = new Set();
  }

  get supported() {
    return Boolean(this.indexedDb);
  }

  async list() {
    if (!this.supported) {
      return [];
    }

    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const records = await requestResult(
      transaction.objectStore(STORE_NAME).getAll(),
    );

    return records
      .sort((left, right) =>
        String(right.wallpaper.startDate).localeCompare(
          String(left.wallpaper.startDate),
        ),
      )
      .map((record) => ({
        ...record.wallpaper,
        src: this.createObjectUrl(record.blob),
        cached: true,
      }));
  }

  async put(wallpaper, blob) {
    if (!this.supported) {
      return;
    }

    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).put({
      id: wallpaper.id,
      wallpaper: {
        ...wallpaper,
        src: wallpaper.networkUrl,
        cached: false,
      },
      blob,
      cachedAt: Date.now(),
    });
    await done;
  }

  async prune(allowedIds) {
    if (!this.supported) {
      return;
    }

    const database = await this.#open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionComplete(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const keys = await requestResult(store.getAllKeys());

    for (const key of keys) {
      if (!allowedIds.has(key)) {
        store.delete(key);
      }
    }

    await done;
  }

  createObjectUrl(blob) {
    if (!this.urlApi?.createObjectURL) {
      return null;
    }

    const objectUrl = this.urlApi.createObjectURL(blob);
    this.objectUrls.add(objectUrl);
    return objectUrl;
  }

  dispose() {
    if (!this.urlApi?.revokeObjectURL) {
      return;
    }

    for (const objectUrl of this.objectUrls) {
      this.urlApi.revokeObjectURL(objectUrl);
    }
    this.objectUrls.clear();
  }

  #open() {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          reject(new Error(`Unable to open wallpaper cache: ${request.error}`));
        };
        request.onblocked = () => {
          reject(new Error("Wallpaper cache upgrade is blocked"));
        };
      });
    }

    return this.databasePromise;
  }
}


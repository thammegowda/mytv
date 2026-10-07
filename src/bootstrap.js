async function loadSamsungProductApi() {
  if (!globalThis.tizen || globalThis.webapis) {
    return;
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "$WEBAPIS/webapis/webapis.js";
    script.onload = resolve;
    script.onerror = () => {
      reject(new Error("Samsung Product API failed to load"));
    };
    document.head.append(script);
  });
}

try {
  await loadSamsungProductApi();
} catch (error) {
  console.error(error);
}

await import("./app.js");

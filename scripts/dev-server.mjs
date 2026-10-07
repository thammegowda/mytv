import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";

const root = resolve(import.meta.dirname, "..");
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jsonl", "application/x-ndjson; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function serveBingMetadata(requestUrl, response) {
  const market = requestUrl.searchParams.get("mkt") ?? "en-US";
  const index = requestUrl.searchParams.get("idx") ?? "0";
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(market)) {
    send(response, 400, "Invalid Bing market");
    return;
  }
  if (!["0", "7"].includes(index)) {
    send(response, 400, "Invalid Bing archive index");
    return;
  }

  const endpoint = new URL(
    "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8",
  );
  endpoint.searchParams.set("mkt", market);
  endpoint.searchParams.set("idx", index);
  const bingResponse = await fetch(endpoint, {
    headers: { Accept: "application/json" },
  });
  if (!bingResponse.ok) {
    send(response, 502, `Bing returned HTTP ${bingResponse.status}`);
    return;
  }

  send(
    response,
    200,
    await bingResponse.text(),
    "application/json; charset=utf-8",
  );
}

async function serveStatic(requestUrl, response) {
  const pathname =
    requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = resolve(root, `.${decodeURIComponent(pathname)}`);

  if (!filePath.startsWith(`${root}${sep}`)) {
    send(response, 403, "Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    send(
      response,
      200,
      body,
      types.get(extname(filePath)) ?? "application/octet-stream",
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      send(response, 404, "Not found");
      return;
    }
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (requestUrl.pathname === "/api/bing") {
      await serveBingMetadata(requestUrl, response);
    } else {
      await serveStatic(requestUrl, response);
    }
  } catch (error) {
    console.error(error);
    send(response, 500, "Internal server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`MyTV Art development server: http://127.0.0.1:${port}`);
});

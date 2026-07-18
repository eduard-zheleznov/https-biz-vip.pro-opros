#!/usr/bin/env node

import http from "node:http";

const host = process.env.OPENROUTER_RELAY_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.OPENROUTER_RELAY_PORT || "18081", 10);
const targetOrigin = "https://openrouter.ai";

function copyRequestHeaders(requestHeaders) {
  const headers = new Headers();
  const skippedHeaders = new Set(["host", "connection", "content-length", "accept-encoding"]);

  for (const [name, value] of Object.entries(requestHeaders)) {
    if (!value || skippedHeaders.has(name.toLowerCase())) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else {
      headers.set(name, value);
    }
  }

  return headers;
}

function copyResponseHeaders(response) {
  const headers = {};
  const skippedHeaders = new Set(["content-encoding", "transfer-encoding", "connection"]);

  response.headers.forEach((value, name) => {
    if (!skippedHeaders.has(name.toLowerCase())) {
      headers[name] = value;
    }
  });

  return headers;
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);

    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (!url.pathname.startsWith("/api/v1/")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unsupported relay path." }));
      return;
    }

    const body = await readRequestBody(request);
    const upstreamResponse = await fetch(`${targetOrigin}${url.pathname}${url.search}`, {
      method: request.method,
      headers: copyRequestHeaders(request.headers),
      body: body.length ? body : undefined,
      redirect: "manual",
    });
    const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());

    response.writeHead(upstreamResponse.status, copyResponseHeaders(upstreamResponse));
    response.end(responseBody);
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: "OpenRouter relay failed.",
        message: error instanceof Error ? error.message : "Unknown relay error.",
      }),
    );
  }
});

server.listen(port, host, () => {
  console.log(`OpenRouter relay listening on http://${host}:${port}`);
});

// npm start and Playwright run the standalone build locally. Next.js leaves static
// assets outside that directory, so copy them before starting; Docker does this at build time.
import { cp } from "node:fs/promises";

await cp(
  new URL("../.next/static/", import.meta.url),
  new URL("../.next/standalone/.next/static/", import.meta.url),
  { recursive: true },
);
process.env.HOSTNAME = process.env.HOSTNAME ?? "0.0.0.0";
await import("../.next/standalone/server.js");

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { startingTeams } from "./fixtures.mjs";
import { sampleExport } from "./instance-lifecycle.mjs";

const port = Number(process.env.PORT ?? 4173);
const assets = new Map([
  ["/mockup.css", ["mockup.css", "text/css; charset=utf-8"]],
  ["/mockup.mjs", ["mockup.mjs", "text/javascript; charset=utf-8"]],
  ["/fixtures.mjs", ["fixtures.mjs", "text/javascript; charset=utf-8"]],
  ["/activity-feed.mjs", ["activity-feed.mjs", "text/javascript; charset=utf-8"]],
  ["/notifications.mjs", ["notifications.mjs", "text/javascript; charset=utf-8"]],
  ["/app-status.mjs", ["app-status.mjs", "text/javascript; charset=utf-8"]],
  ["/team-activity.mjs", ["team-activity.mjs", "text/javascript; charset=utf-8"]],
  ["/team-management.mjs", ["team-management.mjs", "text/javascript; charset=utf-8"]],
  ["/template-catalog.mjs", ["template-catalog.mjs", "text/javascript; charset=utf-8"]],
  ["/template-publishing.mjs", ["template-publishing.mjs", "text/javascript; charset=utf-8"]],
  ["/environment-management.mjs", ["environment-management.mjs", "text/javascript; charset=utf-8"]],
  ["/instance-lifecycle.mjs", ["instance-lifecycle.mjs", "text/javascript; charset=utf-8"]],
  ["/instance-setup.mjs", ["instance-setup.mjs", "text/javascript; charset=utf-8"]],
  ["/installation-setup.mjs", ["installation-setup.mjs", "text/javascript; charset=utf-8"]],
]);
const page = ["index.html", "text/html; charset=utf-8"];
const routes = /^\/(?:sign-in|sign-up|forgot-password|reset-password|verify-email|callback|templates(?:\/[a-z0-9-]+)?|status\/[a-z0-9-]+\/[a-z0-9-]+|dashboard(?:\/[^.?#]*)?)?\/?$/;

createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const exportRoute = path.match(/^\/dashboard\/teams\/([a-z0-9-]+)\/instances\/([a-z0-9-]+)\/lifecycle\/sample-export\.md$/);
  if (exportRoute) {
    const team = startingTeams.find(item => item.slug === exportRoute[1]);
    const instance = team?.instances.find(item => item.slug === exportRoute[2]);
    if (!instance || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(instance ? 405 : 404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${team.slug}-${instance.slug}-sample-export.md"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : sampleExport(team, instance));
    return;
  }
  const asset = assets.get(path) ?? (routes.test(path) ? page : undefined);
  if (!["GET", "HEAD"].includes(request.method) || !asset) {
    response.writeHead(asset ? 405 : 404).end();
    return;
  }

  const [name, contentType] = asset;
  const content = await readFile(new URL(name, import.meta.url));
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; connect-src 'none'; form-action 'self'",
  });
  response.end(request.method === "HEAD" ? undefined : content);
}).listen(port, "127.0.0.1", () => {
  console.log(`Platfolio mockup at http://localhost:${port}`);
});

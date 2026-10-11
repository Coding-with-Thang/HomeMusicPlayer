import path from "node:path";

import { createBootstrapCode } from "./auth.js";
import { getDataDirectory, loadConfig, saveConfig } from "./config.js";
import { buildServers } from "./server.js";

const config = await loadConfig();
const bootstrapCode = config.adminPassword ? undefined : createBootstrapCode();
const { admin, api, index, rescanRoots, watcher } = buildServers(config, saveConfig, {
  bootstrapCode,
  indexStoragePath: path.join(getDataDirectory(), "library-index.json"),
  watchLibrary: true,
});

await index.load();
await rescanRoots();
await Promise.all([
  admin.listen({ host: "127.0.0.1", port: config.adminPort }),
  api.listen({ host: "127.0.0.1", port: config.apiPort }),
]);

console.log(`HomeAudioPlayer setup: http://127.0.0.1:${config.adminPort}`);
console.log(`Tailscale API target: http://127.0.0.1:${config.apiPort}`);
if (bootstrapCode) {
  console.log(`First-run admin setup code: ${bootstrapCode}`);
}

const shutdown = async () => {
  await Promise.all([admin.close(), api.close(), watcher?.close()]);
  await index.flush();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { createBootstrapCode } from "./auth.js";
import { loadConfig, saveConfig } from "./config.js";
import { buildServers } from "./server.js";

const config = await loadConfig();
const bootstrapCode = config.adminPassword ? undefined : createBootstrapCode();
const { admin, api, index } = buildServers(config, saveConfig, { bootstrapCode });

await index.scan(config.libraryRoots);
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
  await Promise.all([admin.close(), api.close()]);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

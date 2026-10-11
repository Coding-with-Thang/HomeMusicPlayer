import { watch, type FSWatcher } from "chokidar";

import { isSupportedAudioPath, type MusicLibraryIndex } from "./library.js";

const BATCH_DELAY_MS = 1500;

type WatcherLogger = {
  info: (details: object, message: string) => void;
  warn: (details: object, message: string) => void;
};

export class LibraryWatcher {
  private watcher: FSWatcher | null = null;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly index: MusicLibraryIndex,
    private readonly log: WatcherLogger,
  ) {}

  async start(roots: string[]) {
    await this.close();
    if (roots.length === 0) return;

    const watcher = watch(roots, {
      atomic: true,
      awaitWriteFinish: { pollInterval: 200, stabilityThreshold: 2000 },
      ignoreInitial: true,
      ignored: (filePath, stats) => Boolean(stats?.isFile() && !isSupportedAudioPath(filePath)),
      persistent: true,
    });
    watcher
      .on("add", (filePath) => this.queue(filePath))
      .on("change", (filePath) => this.queue(filePath))
      .on("unlink", (filePath) => this.queue(filePath))
      .on("addDir", (directory) => this.queue(directory))
      .on("unlinkDir", (directory) => this.queue(directory))
      .on("error", (error) => this.log.warn({ error }, "library watcher error"));
    this.watcher = watcher;
    this.log.info({ rootCount: roots.length }, "library watcher started");
  }

  async close() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    const watcher = this.watcher;
    this.watcher = null;
    await watcher?.close();
  }

  private queue(changedPath: string) {
    this.pending.add(changedPath);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const paths = [...this.pending];
      this.pending.clear();
      const before = this.index.revision;
      void this.index
        .reindexPaths(paths)
        .then(() => {
          if (this.index.revision !== before) {
            this.log.info(
              { pathCount: paths.length, revision: this.index.revision },
              "library updated from disk changes",
            );
          }
        })
        .catch((error: unknown) => this.log.warn({ error }, "library reindex failed"));
    }, BATCH_DELAY_MS);
  }
}

import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MusicLibraryIndex } from "../src/library.js";
import { LibraryWatcher } from "../src/watcher.js";

const silentLog = { info: () => undefined, warn: () => undefined };

async function createLibrary() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "home-audio-index-")));
  const root = path.join(directory, "music");
  await mkdir(root);
  return { directory, root };
}

test("index tracks revisions and serves incremental changes", async () => {
  const { directory, root } = await createLibrary();
  try {
    await writeFile(path.join(root, "one.mp3"), Buffer.from("one"));
    await writeFile(path.join(root, "two.mp3"), Buffer.from("two"));
    const index = new MusicLibraryIndex("server");
    await index.scan([root]);
    const baseline = index.revision;
    assert.equal(index.count, 2);

    const unchanged = index.changesSince(baseline, index.epoch, 100);
    assert.equal(unchanged.resetRequired, false);
    assert.deepEqual(unchanged.upserts, []);
    assert.deepEqual(unchanged.deletes, []);

    await index.scan([root]);
    assert.equal(index.revision, baseline, "an unchanged rescan must not bump the revision");

    await writeFile(path.join(root, "three.mp3"), Buffer.from("three"));
    await rm(path.join(root, "one.mp3"));
    await index.reindexPaths([path.join(root, "three.mp3"), path.join(root, "one.mp3")]);
    const delta = index.changesSince(baseline, index.epoch, 100);
    assert.deepEqual(delta.upserts.map((track) => track.name), ["three"]);
    assert.equal(delta.deletes.length, 1);
    assert.equal(delta.revision, index.revision);

    const paged = index.changesSince(baseline, index.epoch, 1);
    assert.equal(paged.nextSince, baseline + 1);
    assert.equal(index.changesSince(baseline, "other-epoch", 100).resetRequired, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persisted index survives restarts without a new epoch", async () => {
  const { directory, root } = await createLibrary();
  const storagePath = path.join(directory, "library-index.json");
  try {
    await writeFile(path.join(root, "one.mp3"), Buffer.from("one"));
    const first = new MusicLibraryIndex("server", storagePath);
    await first.scan([root]);
    await first.flush();

    const second = new MusicLibraryIndex("server", storagePath);
    assert.equal(await second.load(), true);
    assert.equal(second.epoch, first.epoch);
    assert.equal(second.revision, first.revision);
    await second.scan([root]);
    assert.equal(second.revision, first.revision);

    const otherServer = new MusicLibraryIndex("other", storagePath);
    assert.equal(await otherServer.load(), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("watcher picks up files added on disk", async () => {
  const { directory, root } = await createLibrary();
  const index = new MusicLibraryIndex("server");
  const watcher = new LibraryWatcher(index, silentLog);
  try {
    await index.scan([root]);
    await watcher.start([root]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await writeFile(path.join(root, "added.mp3"), Buffer.from("added"));

    const deadline = Date.now() + 15_000;
    while (index.count === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(index.count, 1);
  } finally {
    await watcher.close();
    await rm(directory, { recursive: true, force: true });
  }
});

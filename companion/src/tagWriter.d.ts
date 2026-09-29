export type TagsToWrite = {
  album?: string;
  artist?: string;
  genre?: string;
  title?: string;
  track?: number;
  year?: number;
};

export type ReadTagsResult = {
  album: string;
  artist: string;
  genre: string;
  title: string;
  track: number;
  year: number;
};

export function readTags(input: {
  data: Uint8Array;
  filename: string;
}): Promise<ReadTagsResult>;

export function writeTags(
  input: { data: Uint8Array; filename: string },
  tags: TagsToWrite,
): Promise<Uint8Array | null>;

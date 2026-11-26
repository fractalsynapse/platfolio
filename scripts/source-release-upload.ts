import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export async function withReleaseSource<T>(sources: Readonly<Record<string, string>>, work: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'platfolio-source-build-'));
  try {
    for (const [path, content] of Object.entries(sources)) {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

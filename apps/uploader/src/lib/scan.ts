export type CardFile = { path: string; file: File };

const isPhoto = (name: string) => /\.jpe?g$/i.test(name);

export function scanFileList(list: ArrayLike<File>): CardFile[] {
  const out: CardFile[] = [];
  for (const file of Array.from(list)) {
    if (isPhoto(file.name)) out.push({ path: file.webkitRelativePath || file.name, file });
  }
  return out;
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntry[] = [];
    const pump = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(out);
        out.push(...batch);
        pump();
      }, reject);
    pump();
  });
}

async function walk(entry: FileSystemEntry, out: CardFile[]): Promise<void> {
  if (entry.isFile) {
    if (!isPhoto(entry.name)) return;
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ path: entry.fullPath.replace(/^\//, ''), file });
  } else if (entry.isDirectory) {
    for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) await walk(child, out);
  }
}

export async function scanDrop(items: DataTransferItemList): Promise<CardFile[]> {
  const roots = Array.from(items, (item) => item.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  const out: CardFile[] = [];
  for (const root of roots) await walk(root, out);
  return out;
}

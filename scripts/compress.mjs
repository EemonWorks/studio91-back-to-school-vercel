import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

let originalBytes = 0;
let compressedBytes = 0;
let files = 0;

async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await compress(path);
    } else if (/\.(html|js|css|svg|json)$/.test(entry.name)) {
      const original = await readFile(path);
      const compressed = gzipSync(original, { level: 9 });
      if (compressed.length >= original.length) continue;
      await writeFile(`${path}.gz`, compressed);
      originalBytes += original.length;
      compressedBytes += compressed.length;
      files++;
    }
  }
}

await compress(fileURLToPath(new URL('../dist', import.meta.url)));
console.log(`Precompressed ${files} assets: ${originalBytes.toLocaleString()} -> ${compressedBytes.toLocaleString()} bytes.`);

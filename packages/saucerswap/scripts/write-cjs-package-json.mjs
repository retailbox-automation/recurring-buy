// Marks dist/cjs as CommonJS regardless of the package root's "type": "module",
// so Node's loader treats tsc's CommonJS output there correctly. Node resolves
// module format from the nearest package.json, and this one is nearer.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../dist/cjs/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "package.json", JSON.stringify({ type: "commonjs" }, null, 2) + "\n");

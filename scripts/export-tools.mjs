import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/travel/tools.ts"],
  outfile: "dist/tools.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { SPECIALIST_TOOLS, CARD_TOOLS, LOCAL_TOOLS } =
  await import("../dist/tools.mjs");
await mkdir("agents/functions", { recursive: true });
for (const tool of [...SPECIALIST_TOOLS, ...CARD_TOOLS, ...LOCAL_TOOLS])
  await writeFile(
    `agents/functions/${tool.name}.json`,
    JSON.stringify(tool, null, 2) + "\n",
  );
await writeFile(
  "agents/main-tools.json",
  JSON.stringify(
    [...SPECIALIST_TOOLS, ...CARD_TOOLS, ...LOCAL_TOOLS],
    null,
    2,
  ) + "\n",
);
console.log(
  "Exported 7 specialist, 5 card, and 2 local-storage function definitions.",
);

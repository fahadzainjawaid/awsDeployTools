import { build } from "esbuild";
import { promises as fs } from "fs";
import path from "path";


const cliFolder = "./cli";
const distFolder = "./dist";


async function getEntryPoints() {
  const files = await fs.readdir(cliFolder);
  return files
    .filter(file => file.endsWith(".mjs"))
    .map(file => ({
      input: `${cliFolder}/${file}`,
      output: `${distFolder}/${path.basename(file, ".mjs")}.cjs`
    }));
}


const entryPoints = await getEntryPoints();

async function buildAndAddShebang(entry) {
  await build({
    entryPoints: [entry.input],
    bundle: true,
    platform: "node",
    outfile: entry.output,
    format: "cjs",
    target: ["node14"],
    external: [
      "commander", 
      '@aws-sdk/client-secret-manager',
      '@aws-sdk/nested-clients',
      "@aws-sdk/submodules/sts/auth/httpAuthSchemeProvider",
      "@aws-sdk/submodules/sts/endpoint/EndpointParameters",
      "@aws-sdk/submodules/sts/runtimeConfig",
      "@aws-sdk/submodules/sts/runtimeExtensions"
    ],
  });

  // Add shebang line to the output file
  const shebang = "#!/usr/bin/env node\n";
  const content = await fs.readFile(entry.output, "utf8");
  await fs.writeFile(entry.output, shebang + content);
}

await Promise.all(entryPoints.map(buildAndAddShebang));
console.log("Build complete.");

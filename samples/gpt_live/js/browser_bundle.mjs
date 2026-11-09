// Bundles the page's modules and the Projects SDK into one browser script with esbuild, using the
// SDK package's browser build. The page uses only the SDK's Live client. The package's entry point
// also re-exports AIProjectClient, which imports the OpenAI SDK for its Responses helpers; esbuild
// would keep that package because it does not declare itself free of side effects. Declaring it so
// lets esbuild drop the unused OpenAI code: the page never loads or calls the OpenAI SDK.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("./public/app.js", import.meta.url));
const UNUSED_PACKAGES = /^openai(\/.*)?$/;

let bundle;

/** Builds public/app.js once per process and resolves with the JavaScript text. */
export function browserBundle() {
  bundle ??= build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "unused-openai",
        setup(builder) {
          builder.onResolve({ filter: UNUSED_PACKAGES }, async ({ path, kind, importer, resolveDir, pluginData }) => {
            if (pluginData === "resolving") return undefined;
            const resolved = await builder.resolve(path, { kind, importer, resolveDir, pluginData: "resolving" });
            return { ...resolved, sideEffects: false };
          });
        },
      },
    ],
  }).then((result) => result.outputFiles[0].text);
  return bundle;
}

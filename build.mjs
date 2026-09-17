import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: "dist/main.js",
  sourcemap: true,
  legalComments: "none"
});

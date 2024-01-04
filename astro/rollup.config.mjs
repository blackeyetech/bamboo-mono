import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";

import { createRequire } from "node:module";

// Consts here
// Load the package.json so we can get the current version of the shell
const require = createRequire(import.meta.url);
const pkg = require("./package.json");

// We need to know if we are building for prod or dev
const NODE_ENV =
  process.env.NODE_ENV === undefined ? "development" : process.env.NODE_ENV;

// Setup the plugins here
let plugins = [
  replace({
    preventAssignment: true,
    values: { BS_VERSION: pkg.version },
  }),
  commonjs(),
  resolve({ preferBuiltins: true }),
  json(),
];

// Check if this is a prod build
if (NODE_ENV !== "development") {
  // Add terser for prod builds
  plugins.push(terser());
}

export default [
  {
    // This is to rollup the shell lib
    input: "dist/main.js",
    output: {
      file: "dist/astro.mjs",
      format: "es",
      sourcemap: true,
    },
    external: ["@bs-core/shell", "astro/app"],
    plugins,
  },
  {
    // This is to rollup the .d.ts files
    input: "dist/types/main.d.ts",
    output: {
      file: "dist/astro.d.ts",
      format: "es",
    },
    external: [],
    plugins: [dts()],
  },
];

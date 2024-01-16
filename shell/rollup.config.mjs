import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import dts from "rollup-plugin-dts";
import sourcemaps from "rollup-plugin-sourcemaps";
import terser from "@rollup/plugin-terser";

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
  sourcemaps(),
];

export default [
  {
    // This is to rollup the shell lib
    input: "out/main.js",
    output: {
      file: "dist/shell.mjs",
      format: "es",
      sourcemap: true,
    },
    plugins: NODE_ENV === "development" ? plugins : [...plugins, terser()],
  },
  {
    // This is to rollup the .d.ts files
    input: "out/types/main.d.ts",
    output: {
      file: "dist/shell.d.ts",
      format: "es",
    },
    external: ["node:http", "node:net"], // This is because we use the http/net types
    plugins: [dts()],
  },
];

import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import dts from "rollup-plugin-dts";

// Load the package.json so we can get the current version of the shell
import pkg from "./package.json" with { type: "json" };
const { version } = pkg;

// We need to know if we are building for prod or dev
const NODE_ENV =
  process.env.NODE_ENV === undefined ? "development" : process.env.NODE_ENV;

// Setup the plugins here
let plugins = [
  replace({
    preventAssignment: true,
    values: { BS_VERSION: version },
  }),
  commonjs(),
  resolve({ preferBuiltins: true }),
  json(),
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
    plugins,
  },
  {
    // This is to rollup the .d.ts files
    input: "out/types/main.d.ts",
    output: {
      file: "dist/shell.d.ts",
      format: "es",
    },
    external: ["node:http", "node:stream", "node:crypto", "crypto"], // This is because we use the http/net/stream/crypto types
    plugins: [dts()],
  },
];

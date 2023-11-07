// imports here
import type { AstroAdapter, AstroIntegration, SSRManifest } from "astro";
import { App } from "astro/app";

import { bs, ServerRequest, ServerResponse } from "@bs-core/shell";

// Misc consts here
const ADAPTER_NAME = "@bs-core/astro";

// Module properties here
let _app: App;

// types here
export type InitFunc = {
  staticFilesPath: string;
  render: (req: ServerRequest, res: ServerResponse, match: boolean) => boolean;
};

export type Options = {
  initFunc: InitFunc;
};

// Private functions here
function getAdapter(args: Options): AstroAdapter {
  return {
    name: ADAPTER_NAME,
    serverEntrypoint: "@bs-core/astro/astro.mjs",
    // previewEntrypoint: '@bs-core/astro/main.mjs',
    args,
    exports: [],
    supportedAstroFeatures: {
      hybridOutput: "stable",
      staticOutput: "stable",
      serverOutput: "stable",
      assets: {
        supportKind: "stable",
        isSharpCompatible: false,
        isSquooshCompatible: false,
      },
    },
  };
}

// Exported functions here

// The default function will be called by Astro when the adapter is created
export default (args: Options): AstroIntegration => {
  return {
    name: ADAPTER_NAME,
    hooks: {
      "astro:config:done": ({ setAdapter, config }) => {
        setAdapter(getAdapter(args));
      },
      "astro:build:done": async (options: { dir: URL }) => {
        // This is the directory for the static HTML
        console.log(options.dir.pathname);
      },
    },
  };
};

// We need a createExports() exported or Astro will complain
// NOTE: We dont require any exports
export const createExports = (): Record<string, any> => {
  return {};
};

// This is the function that will be called when the bundled script is run
export const start = (manifest: SSRManifest, args: Options) => {
  _app = new App(manifest);

  // args.initFunc(manifest.base);

  // manifest.
};

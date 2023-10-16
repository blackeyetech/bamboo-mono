// imports here
import type { AstroAdapter, AstroIntegration, SSRManifest } from "astro";
import { App } from "astro/app";

import { bs } from "@bs-core/shell";

// Misc consts here
const ADAPTER_NAME = "@bs-core/astro";

// types here
type Options = {};

// private methods here
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

// exported functions
export default (args: Options = {}): AstroIntegration => {
  return {
    name: ADAPTER_NAME,
    hooks: {
      "astro:config:done": ({ setAdapter, config }) => {
        setAdapter(getAdapter(args));

        bs.debug("Astro config: %j", config);
      },
    },
  };
};

// We need a createExports() exported or Astro will complain
export function createExports() {}

// This is the function that will be called when the bundle script is run
export const start = (manifest: SSRManifest) => {
  let app = new App(manifest);

  console.log(app);
};

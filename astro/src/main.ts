// imports here
import type { AstroAdapter, AstroIntegration, SSRManifest } from "astro";
import { App } from "astro/app";

import { bs, HttpConfig } from "@bs-core/shell";

// Misc consts here
const ADAPTER_NAME = "@bs-core/astro";

// Module properties here
let _app: App;

// types here
export type Options = {
  staticFilesPath?: string;
  extraContentTypes?: Record<string, string>;

  keepAliveTimeout?: number;
  // NOTE: There is a potential race condition and the recommended
  // solution is to make the header timeouts greater then the keep alive
  // timeout. See - https://github.com/nodejs/node/issues/27363
  headerTimeout?: number;

  defaultRouterBasePath?: string;

  healthcheckPath?: string;
  healthcheckGoodRes?: number;
  healthcheckBadRes?: number;

  enableHttps?: boolean;
  // httpsKeyFile?: string;
  // httpsCertFile?: string;
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

// The default function is called when the bundle script is being built
export default (args: Options): AstroIntegration => {
  return {
    name: ADAPTER_NAME,
    hooks: {
      "astro:config:done": ({ setAdapter }) => {
        setAdapter(getAdapter(args));
      },
      "astro:build:done": async (options) => {
        // We could update the bundle file here
        // This is the directory for the static HTML
        options.logger.info(options.dir.pathname);
      },
    },
  };
};

// We need a createExports() exported or Astro will complain
// NOTE: We dont require any exports!
export const createExports = (): Record<string, any> => {
  return {};
};

// This is the function that will be called when the bundled script is run
export const start = async (
  manifest: SSRManifest,
  options: Options,
): Promise<void> => {
  bs.startupMsg("Adapter options: (%j)", options);

  _app = new App(manifest);

  let opts: HttpConfig = {
    keepAliveTimeout: options.keepAliveTimeout,
    headerTimeout: options.headerTimeout,
    defaultRouterBasePath: options.defaultRouterBasePath,
    healthcheckPath: options.healthcheckPath,
    healthcheckGoodRes: options.healthcheckGoodRes,
    healthcheckBadRes: options.healthcheckBadRes,
    enableHttps: options.enableHttps,
  };

  if (options.enableHttps) {
    opts.httpsCertFile = bs.getConfigStr("HTTP_CERT_FILE");
    opts.httpsKeyFile = bs.getConfigStr("HTTP_KEY_FILE");
  }

  if (options.staticFilesPath !== undefined) {
    opts.staticFileServer = {
      path: options.staticFilesPath,
      extraContentTypes: options.extraContentTypes,
    };
  }

  let networkIf = bs.getConfigStr("HTTP_HOST", "lo");
  let networkPort = bs.getConfigNum("HTTP_PORT", 8080);

  bs.startupMsg("HttpServer config (%j)", opts);
  // Do not start the HttpServer until we are finished setting everything up
  let httpServer = await bs.addHttpServer(
    networkIf,
    networkPort,
    opts,
    false,
    "Astro",
  );

  httpServer.ssrRouter;
  _app.getAdapterLogger;

  // Start the http server now!
  await httpServer.start();

  bs.startupMsg("We are ready so party on!!");
};

// imports here
import {
  bs,
  HttpConfig,
  ServerRequest,
  ServerResponse,
  RouterMatchFunc,
} from "@bs-core/shell";

import type { AstroIntegration, SSRManifest } from "astro";
import { App } from "astro/app";

// Misc consts here
const ADAPTER_NAME = "@bs-core/astro";

const HTTP_CERT_FILE = "HTTP_CERT_FILE";
const HTTP_KEY_FILE = "HTTP_KEY_FILE";
const HTTP_ENABLE_HTTPS = "HTTP_ENABLE_HTTPS";
const HTTP_IF = "HTTP_IF";
const HTTP_PORT = "HTTP_PORT";

// Module properties here

/** The Astro App instance. */
let _app: App;

// Types here
export type Options = {
  setupEntryPoint?: string;

  staticFilesPath?: string;
  extraContentTypes?: Record<string, string>;
  immutableRegex?: RegExp;

  keepAliveTimeout?: number;
  // NOTE: There is a potential race condition and the recommended
  // solution is to make the header timeouts greater then the keep alive
  // timeout. See - https://github.com/nodejs/node/issues/27363
  headerTimeout?: number;

  defaultRouterBasePath?: string;

  healthcheckPath?: string;
  healthcheckGoodRes?: number;
  healthcheckBadRes?: number;
};

export class WebRequest extends Request {
  public req: ServerRequest;
  public res: ServerResponse;

  constructor(req: ServerRequest, res: ServerResponse) {
    // NOTE: WE don't care about headers since they are already on req and res
    super(req.urlObj, { method: req.method });

    this.req = req;
    this.res = res;
  }
}

// Private functions here
function matcher(_: string): RouterMatchFunc {
  return (url: URL) => {
    let routeData = _app.match(new Request(url));

    if (routeData === undefined) {
      return false;
    }

    // For now we will ignore the params because they are available
    // in the Astro Request object
    // NOTE: We need to return routeData so it can be use with _app.render()
    return {
      params: {},
      matchedInfo: routeData,
    };
  };
}

async function ssrEndpoint(
  req: ServerRequest,
  res: ServerResponse,
): Promise<void> {
  // Create a WebRequest object to pass to the render
  let webReq = new WebRequest(req, res);

  // Now render the page
  let webRes = await _app.render(webReq, { routeData: req.matchedInfo });

  // This is the easiest way to get the Response body
  res.body = await webRes.text();

  // Check if Astro set any headers that we shold pass on
  for (let header of webRes.headers.entries()) {
    res.setHeader(header[0], header[1]);
  }
}

// Exported functions here

// The default function is called when the bundle script is being built
export default (args: Options): AstroIntegration => {
  return {
    name: ADAPTER_NAME,
    hooks: {
      "astro:config:done": ({ setAdapter }) => {
        setAdapter({
          name: ADAPTER_NAME,
          serverEntrypoint: "@bs-core/astro",
          // previewEntrypoint: '@bs-core/astro',
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
        });
      },
      "astro:build:done": async () => {
        // We could update the bundle file here if needed
      },
    },
  };
};

// We need a createExports() exported or Astro will complain
export const createExports = (): Record<string, any> => {
  return {};
};

// This function that will be called when the bundled script is run
export const start = async (
  manifest: SSRManifest,
  options: Options,
): Promise<void> => {
  // Create the app first before doing anything else
  _app = new App(manifest);

  // Setup the config for the HTTP server
  let httpConfig: HttpConfig = {
    keepAliveTimeout: options.keepAliveTimeout,
    headerTimeout: options.headerTimeout,
    defaultRouterBasePath: options.defaultRouterBasePath,
    healthcheckPath: options.healthcheckPath,
    healthcheckGoodRes: options.healthcheckGoodRes,
    healthcheckBadRes: options.healthcheckBadRes,
  };

  if (options.staticFilesPath !== undefined) {
    httpConfig.staticFileServer = {
      path: options.staticFilesPath,
    };

    if (options.extraContentTypes !== undefined) {
      httpConfig.staticFileServer.extraContentTypes = options.extraContentTypes;
    }

    if (options.immutableRegex !== undefined) {
      httpConfig.staticFileServer.immutableRegex = options.immutableRegex;
    }
  }

  let enableHttps = bs.getConfigBool(HTTP_ENABLE_HTTPS, false);

  if (enableHttps) {
    httpConfig.enableHttps = true;
    httpConfig.httpsCertFile = bs.getConfigStr(HTTP_CERT_FILE);
    httpConfig.httpsKeyFile = bs.getConfigStr(HTTP_KEY_FILE);
  }

  let networkIf = bs.getConfigStr(HTTP_IF, "lo");
  let networkPort = bs.getConfigNum(HTTP_PORT, 8080);

  // Create the HTTP server
  // NOTE: Don't start it until we are finished setting everything up
  let httpServer = await bs.addHttpServer(
    networkIf,
    networkPort,
    httpConfig,
    false,
  );

  // Call setupEntryPoint here in case you want to setup any default
  // middleware for the SSR endpoint
  if (options.setupEntryPoint !== undefined) {
    // NOTE: We expect an exported function named "setup"
    let { setup } = await import(options.setupEntryPoint);
    await setup();
  }

  // Add the main SSR route - NOTE: the path is not important
  httpServer.ssrRouter.get("/", ssrEndpoint, {
    generateMatcher: matcher,
    etag: true,
  });

  // Start the http server now!
  await httpServer.start();

  bs.startupMsg("Astro adapter is primed - party on!!");
};

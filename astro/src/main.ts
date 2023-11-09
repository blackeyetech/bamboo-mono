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

// Module properties here
let _app: App;

// Types here
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
};

// Private functions here
function makeWebRequestHeaders(req: ServerRequest): Headers {
  // Copy all the headers for the new Request
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else {
      headers.append(name, value);
    }
  }

  return headers;
}

function matcher(_: string): RouterMatchFunc {
  return (path: string) => {
    let request = new Request(path);
    let routeData = _app.match(request);

    if (routeData === undefined) {
      return false;
    }

    return {
      params: {},
      matchedInfo: routeData,
    };
  };
}

async function ssrEndpoint(
  req: ServerRequest,
  _: ServerResponse,
): Promise<void> {
  let webReq = new Request(req.urlObj.href, {
    method: req.method,
    headers: makeWebRequestHeaders(req),
  });

  console.log(webReq);
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
      "astro:build:done": async (options) => {
        // We could update the bundle file here
        // This is the directory for the static HTML
        options.logger.info(options.dir.pathname);
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
  let opts: HttpConfig = { ...options };

  if (options.staticFilesPath !== undefined) {
    opts.staticFileServer = {
      path: options.staticFilesPath,
    };

    if (options.extraContentTypes !== undefined) {
      opts.staticFileServer.extraContentTypes = options.extraContentTypes;
    }
  }

  if (options.enableHttps) {
    opts.httpsCertFile = bs.getConfigStr("HTTP_CERT_FILE");
    opts.httpsKeyFile = bs.getConfigStr("HTTP_KEY_FILE");
  }

  let networkIf = bs.getConfigStr("HTTP_HOST", "lo");
  let networkPort = bs.getConfigNum("HTTP_PORT", 8080);

  // Create the Http server
  // NOTE: Don't start it until we are finished setting everything up
  let httpServer = await bs.addHttpServer(
    networkIf,
    networkPort,
    opts,
    false,
    "astro",
  );

  // Create the app before setting up the SSR endpoint
  _app = new App(manifest);

  httpServer.ssrRouter.get("/", ssrEndpoint, { generateMatcher: matcher });

  // Start the http server now!
  await httpServer.start();

  bs.startupMsg("We are ready now, so party on dude!!");
};

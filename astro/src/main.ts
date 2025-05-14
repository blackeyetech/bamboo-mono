// imports here
import {
  bs,
  Router,
  HttpConfig,
  ServerRequest,
  ServerResponse,
  RouterMatchFunc,
} from "@bs-core/shell";

import type { AstroIntegration, SSRManifest } from "astro";

import { App } from "astro/app";
import { pathToFileURL } from "url";

import { performance } from "node:perf_hooks";
import type { ReadableStream } from "node:stream/web";
import * as streams from "node:stream/promises";

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
  immutableRegexSrc?: string[];
  securityHeaders?: { name: string; value: string }[];

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
    // Get the headers so we can pass them on
    const headers = new Headers();

    for (const [name, value] of Object.entries(req.headers)) {
      // Skip headers with no values
      if (value === undefined) {
        continue;
      }

      // Value can be an array so we need to handle that
      if (Array.isArray(value)) {
        // Append each value as the header name
        for (const item of value) {
          headers.append(name, item);
        }
      } else {
        headers.append(name, value);
      }
    }

    // Now call the super constructor to create the Request
    super(req.urlObj, { method: req.method, body: req.body, headers });

    // Make sure to tack on the nodeJs req/res
    this.req = req;
    this.res = res;
  }
}

// Private functions here
function matcher(_: string): RouterMatchFunc {
  return (url: URL) => {
    const routeData = _app.match(new Request(url));

    if (routeData === undefined) {
      return false;
    }

    // For now we will ignore the params because they are available
    // in the Web Request object
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
  // Measure the time it took to render the page so capture when we started
  const startedAt = performance.now();

  // Create a webRequest object to pass to the render
  const webReq = new WebRequest(req, res);

  // Now render the page
  const webRes = await _app.render(webReq, {
    routeData: req.matchedInfo,
  });

  // Now figure out how long it took to render and store it in the metrics
  const ssrLatency = Math.round(performance.now() - startedAt);
  res.addServerTimingMetric("ssr", ssrLatency);

  // The default status code is always 200. If webRes.status is NOT 200
  // then it was set by the user so we need to use that status code
  if (webRes.status !== 200) {
    res.statusCode = webRes.status;
  }

  // Check if the user set any headers on webRes
  const SET_COOKIE = "set-cookie";

  for (let [name, value] of webRes.headers.entries()) {
    // Dont bother setting set-cookie headers, we will do that later
    if (name === SET_COOKIE) {
      continue;
    }

    res.setHeader(name, value);
  }

  // Check if there were any set-cookie headers and if so set them as an array
  const cookies = webRes.headers.getSetCookie();
  if (cookies.length > 0) {
    res.setHeader(SET_COOKIE, cookies);
  }

  // This is our last chance to set headers so set the server timings header
  res.setServerTimingHeader();

  // Now check if there is a body in the webRes
  if (webRes.body !== null) {
    // NOTE1: pipeline will close the res when it is finished
    // NOTE2: You need to cast as ReadableStream<Uint8Array> or TS will complain
    await streams
      .pipeline(webRes.body as ReadableStream<Uint8Array>, res)
      .catch((e) => {
        // We can't do anything else here because either:
        // - the stream is closed which means we can't send back an error
        // - we have an internal error, but we have already started streaming
        //   so we can't do anything
        bs.warn("ssrEndpoint had this error during rendering: (%s)", e);
      });
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
      extraContentTypes: options.extraContentTypes,
      immutableRegExp: options.immutableRegexSrc,
      securityHeaders: options.securityHeaders,
    };
  }

  const enableHttps = bs.getConfigBool(HTTP_ENABLE_HTTPS, false);

  if (enableHttps) {
    httpConfig.enableHttps = true;
    httpConfig.httpsCertFile = bs.getConfigStr(HTTP_CERT_FILE);
    httpConfig.httpsKeyFile = bs.getConfigStr(HTTP_KEY_FILE);
  }

  const networkIf = bs.getConfigStr(HTTP_IF, "127.0.0.1");
  const networkPort = bs.getConfigNum(HTTP_PORT, 8080);

  // Create the HTTP server
  const httpServer = await bs.addHttpServer(
    networkIf,
    networkPort,
    httpConfig,
    false, // NOTE: Don't start until we are finished setting everything up
  );

  // Call setupEntryPoint here in case you want to setup any default
  // middleware for the SSR endpoint
  if (options.setupEntryPoint !== undefined) {
    // NOTE: We expect an exported function named "setup"
    const { setup } = await import(pathToFileURL(options.setupEntryPoint).href);
    await setup();
  }

  // Add the main SSR route - NOTE: the path is not important since the
  // matcher will decide if there is a matching page
  httpServer.ssrRouter.all("/", ssrEndpoint, {
    generateMatcher: matcher,
    etag: true,
    middlewareList: [Router.setLatencyMetricName("astro")],
  });

  // Start the http server now!
  await httpServer.start();

  bs.startupMsg("Astro adapter is primed - party on dudes!!");
};

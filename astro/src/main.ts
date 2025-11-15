// imports here
import {
  bs,
  enhanceIncomingMessage,
  enhanceServerResponse,
  RouterMatchFunc,
  WebRequest,
  HttpConfig,
} from "@bs-core/shell";

import type { AstroIntegration, SSRManifest } from "astro";
import { App } from "astro/app";

import { pathToFileURL } from "url";

// Misc consts here
const ADAPTER_NAME = "@bs-core/astro";
const ADAPTER_LATENCY_NAME = "astro";

// Type here
export type AdapterConfig = {
  setupEntryPoint?: string;
  httpConfig: HttpConfig;
};

// Module properties here
let _app: App;

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

async function render(webReq: WebRequest): Promise<Response> {
  return await _app.render(webReq, {
    routeData: webReq.req.matchedInfo,
  });
}

// Exported functions here

// The default function is called when the bundle script is being built
export default (config: AdapterConfig): AstroIntegration => {
  return {
    name: ADAPTER_NAME,
    hooks: {
      "astro:config:done": ({ setAdapter }) => {
        setAdapter({
          name: ADAPTER_NAME,
          serverEntrypoint: "@bs-core/astro",
          // previewEntrypoint: '@bs-core/astro',
          args: config,
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

      "astro:server:setup": async ({ server }) => {
        // This is called when running the app in "dev" mode
        // Set the adapter name to use in the latency measurements
        config.httpConfig.ssrServer = {
          adapterName: ADAPTER_LATENCY_NAME,
        };

        // We need the req handler from the HttpServer so lets create one
        // even though we will not actually use it directly
        const httpServer = await bs.addHttpServer(
          config.httpConfig,
          false, // NOTE: Don't start the server
        );

        // Call setupEntryPoint in case they want to setup add API endpoints
        if (config.setupEntryPoint !== undefined) {
          // NOTE: We expect an exported function named "setup"
          const { setup } = await import(
            pathToFileURL(config.setupEntryPoint).href
          );
          await setup();
        }

        bs.startupMsg("HTTP server has been created");

        // Add the req handler to the dev server middleware
        server.middlewares.use(async (req, res, next) => {
          // Enhance req/res so that the endpoint code with work correctly
          let enhancedReq = enhanceIncomingMessage(req);
          let enhancedRes = enhanceServerResponse(res);

          // We only want the reeq handler to handle API reqs
          enhancedReq.checkSsrRoutes = false;
          enhancedReq.checkStaticFiles = false;

          // Make sure we do not generate a 404 if the route is not found
          enhancedReq.handle404 = false;

          // Call our req handler
          await httpServer.reqHandler(enhancedReq, enhancedRes);

          // If the req was handled by the req handler then we are done
          if (enhancedReq.handled) {
            return;
          }

          // If we are here the req was not handled, so call next
          next();
        });
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
  config: AdapterConfig,
): Promise<void> => {
  // Create the app first before doing anything else
  _app = new App(manifest);

  config.httpConfig.ssrServer = {
    ...config.httpConfig.ssrServer,
    adapterName: ADAPTER_LATENCY_NAME,
    render,
    matcher,
  };

  // We need the req handler from the HttpServer so lets create one
  // even though we will not actually use it directly
  const httpServer = await bs.addHttpServer(
    config.httpConfig,
    false, // NOTE: Don't start the server
  );

  // Call setupEntryPoint here in case you want to setup any default
  // middleware for the SSR endpoint or add API endpoints
  if (config.setupEntryPoint !== undefined) {
    // NOTE: We expect an exported function named "setup"
    const { setup } = await import(pathToFileURL(config.setupEntryPoint).href);
    await setup();
  }

  // Start the http server now!
  await httpServer.start();

  bs.startupMsg("Astro adapter is primed - party on dudes!!");
};

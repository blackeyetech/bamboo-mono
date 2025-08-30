// imports here
import {
  bs,
  enhanceIncomingMessage,
  enhanceServerResponse,
  HttpConfig,
  RouterMatchFunc,
  WebRequest,
} from "@bs-core/shell";

import type { Adapter, Builder, Server, SSRManifest } from "@sveltejs/kit";
import type { ViteDevServer, Plugin } from "vite";

import { rollup } from "rollup";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

import { writeFileSync } from "node:fs";
import * as http from "node:http";
import { pathToFileURL } from "url";

// import { WebRequest } from "@bs-core/shell";
export { bs, Router } from "@bs-core/shell";

// Misc constants here
const ADAPTER_NAME = "@bs-core/svelte-kit";
const ADAPTER_LATENCY_NAME = "svelte-kit";

const DIST_DIR = "dist";

const CONFIG = `./${DIST_DIR}/config.js`;
const MANIFEST = `./${DIST_DIR}/server/manifest.js`;
const SERVER = `./${DIST_DIR}/server/index.js`;
const CLIENT_DIR = `./${DIST_DIR}/client`;
const SETUP = `./${DIST_DIR}/backend/setup.js`;

// Global vars here
let kitServer: Server;
let ssrManifest: SSRManifest;

// Private functions here
function matcher(_: string): RouterMatchFunc {
  return (url: URL) => {
    for (const route of ssrManifest._.routes) {
      if (
        route.pattern.test(url.pathname) ||
        url.pathname.endsWith("__data.json") // This is a svelete-kit file in memory
      ) {
        return {
          params: {},
          matchedInfo: null,
        };
      }
    }

    return false;
  };
}

async function render(webReq: WebRequest): Promise<Response> {
  return await kitServer.respond(webReq, {
    getClientAddress: () => "",
  });
}

export const setup = async (): Promise<void> => {
  const { manifest } = await import(pathToFileURL(MANIFEST).href);
  const { httpConfig } = await import(pathToFileURL(CONFIG).href);
  const serverIndex = await import(pathToFileURL(SERVER).href);
  const { setup } = await import(pathToFileURL(SETUP).href);

  ssrManifest = manifest;
  kitServer = new serverIndex.Server(manifest);

  await kitServer.init({
    env: {},
  });
  const config: HttpConfig = httpConfig;

  config.ssrServer = {
    adapterName: ADAPTER_LATENCY_NAME,
    render,
    matcher,
  };

  config.staticFileServer = {
    path: CLIENT_DIR,
    stripHtmlExt: true,
    ...config.staticFileServer,
  };
  const httpServer = await bs.addHttpServer(
    httpConfig,
    false, // NOTE: Don't start the server
  );

  bs.startupMsg("HTTP server has been created");

  bs.startupMsg("Setting up backend ...");
  await setup();

  // Start the http server now!
  await httpServer.start();
};

// Default function here
export default function (config: HttpConfig) {
  const adapter: Adapter = {
    name: ADAPTER_NAME,

    async adapt(builder: Builder) {
      // Get the location for a temp dir to safely store the build files in
      const out = builder.getBuildDirectory("adapter-bs-core");
      // Recreate a new temp dir
      // NOTE: DO NOT clear the dist dir. That will have been done in the
      // build and backend code shoould be in there now
      builder.rimraf(out);
      builder.mkdirp(out);

      // Write the static assets
      builder.writeClient(`${DIST_DIR}/client${builder.config.kit.paths.base}`);

      // Write the pre-rendered pages
      // NOTE: Write to the same directoty as the static assets since they are
      // both referenced relavtive to the base URL
      builder.writePrerendered(
        `${DIST_DIR}/client${builder.config.kit.paths.base}`,
      );

      // Write the SSR output
      builder.writeServer(out);

      // Write the manifest file for svelte
      writeFileSync(
        `${out}/manifest.js`,
        [
          `export const manifest = ${builder.generateManifest({ relativePath: "./" })};`,
          `export const prerendered = new Set(${JSON.stringify(builder.prerendered.paths)});`,
          `export const base = ${JSON.stringify(builder.config.kit.paths.base)};`,
        ].join("\n\n"),
      );

      writeFileSync(
        CONFIG,
        `export const httpConfig = ${JSON.stringify(config)}`,
      );

      // we bundle the Vite output so that deployments only need
      // their production dependencies. Anything in devDependencies
      // will get included in the bundled code
      // const pkg = JSON.parse(readFileSync("package.json", "utf8"));
      const bundle = await rollup({
        input: {
          index: `${out}/index.js`, // This is our svelte app rendering code
          manifest: `${out}/manifest.js`, // This is the manifest file we create above
        },
        external: [
          // // dependencies could have deep exports, so we need a regex
          // ...Object.keys(pkg.dependencies || {}).map(
          //   (d) => new RegExp(`^${d}(\\/.*)?$`),
          // ),
        ],
        plugins: [
          commonjs({ strictRequires: true }),
          resolve({
            preferBuiltins: true,
            // exportConditions: ["node"],
          }),
          json(),
        ],
      });

      await bundle.write({
        dir: `${DIST_DIR}/server`,
        format: "es",
        sourcemap: true,
        chunkFileNames: "chunks/[name]-[hash].js",
      });
    },
  };

  return adapter;
}

export const viteDevPlugin = (httpConfig: HttpConfig = {}): Plugin => {
  return {
    name: "bs-vite-dev-plugin",
    configureServer: async (server: ViteDevServer) => {
      // This is called when running the app in "dev" mode

      // We need the req handler from the HttpServer so lets create one
      // even though we will not actually use it directly
      const httpServer = await bs.addHttpServer(
        httpConfig,
        false, // NOTE: Don't start the server
      );

      // Call setupEntryPoint in case they want to setup add API endpoints
      // NOTE: We expect an exported function named "setup"
      const { setup } = await import(pathToFileURL(SETUP).href);
      bs.startupMsg("Setting up backend ...");
      await setup();

      bs.startupMsg("HTTP server has been created");

      // Add the req handler to the dev server middleware
      server.middlewares.use(
        async (
          req: http.IncomingMessage,
          res: http.ServerResponse,
          next: () => void,
        ) => {
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
        },
      );
    },
  };
};

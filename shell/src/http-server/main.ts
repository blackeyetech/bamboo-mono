// imports here
import { Logger } from "../logger.js";

import {
  enhanceIncomingMessage,
  enhanceServerResponse,
  ServerRequest,
  ServerResponse,
} from "./req-res.js";
import { Middleware } from "./middleware.js";
import {
  StaticFileServer,
  StaticFileServerConfig,
} from "./static-file-server.js";
import {
  Router,
  EndpointOptions,
  EndpointCallback,
  Method,
  Route,
  RouterConfig,
  RouterMatchFunc,
  SsrRenderFunc,
} from "./router.js";

export {
  EndpointOptions,
  EndpointCallback,
  Router,
  RouterConfig,
  RouterMatch,
  RouterMatchFunc,
  SsrRenderFunc,
} from "./router.js";

import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as fs from "node:fs";
import * as net from "node:net";

// Types here
export type HealthcheckCallback = () => Promise<boolean>;

export class HttpConfigError {
  constructor(public message: string) {}
}

export type HttpConfig = {
  networkInterface?: string;
  networkPort?: number;

  // NOTE: The default node keep alive is 5 secs. This needs to be set
  // higher then any load balancers in front of this App
  keepAliveTimeout?: number;
  // NOTE: There is a potential race condition and the recommended
  // solution is to make the header timeouts greater then the keep alive
  // timeout. See - https://github.com/nodejs/node/issues/27363
  headerTimeout?: number;

  basePath?: string;

  defaultRouterBasePath?: string;
  healthcheckPath?: string;

  enableHttps?: boolean;
  httpsKeyFile?: string;
  httpsCertFile?: string;

  staticFileServer?: StaticFileServerConfig;

  ssrServer?: {
    adapterName: string;
    matcher?: (url: string) => RouterMatchFunc;
    render?: SsrRenderFunc;
  };
};

// HttpServer class here
export class HttpServer {
  private _logger: Logger;
  private _socketMap: Map<number, net.Socket>;
  private _socketId: number;

  private _networkInterface: string | null;
  private _networkPort: number | null;
  private _networkIp: string | null;
  private _listeningOn: string;

  private _name: string;

  private _healthcheckCallbacks: HealthcheckCallback[];

  private _httpKeepAliveTimeout: number;
  private _httpHeaderTimeout: number;

  private _basePath: string;

  private _healthCheckPath: string;
  private _healthCheckGoodResCode: number;
  private _healthCheckBadResCode: number;

  private _enableHttps: boolean;
  private _keyFile?: string;
  private _certFile?: string;

  private _apiRouterList: Router[];
  private _defaultApiRouter: Router;
  private _ssrRouter: Router | null;
  private _staticFileServer?: StaticFileServer;

  private _server?: http.Server;

  constructor(config: HttpConfig) {
    this._networkInterface = config.networkInterface ?? null;
    this._networkPort = config.networkPort ?? null;

    if (this._networkInterface === null || this._networkPort === null) {
      this._name = "not-listening";
    } else {
      this._name = `${config.networkInterface}-${config.networkPort}`;
    }
    this._logger = new Logger(`HttpServer-${this._name}`);

    this._httpKeepAliveTimeout = config.keepAliveTimeout ?? 65000;
    this._httpHeaderTimeout = config.headerTimeout ?? 66000;

    this._basePath = config.basePath ?? "";

    this._healthCheckPath = config.healthcheckPath ?? "/healthcheck";
    this._healthCheckGoodResCode = 200;
    this._healthCheckBadResCode = 503;

    this._enableHttps = config.enableHttps ?? false;

    this._socketMap = new Map();
    this._socketId = 0;

    this._networkIp = null;
    this._listeningOn = "";

    this._healthcheckCallbacks = [];

    this._apiRouterList = [];

    // Create the default router AFTER you initialise the _routerList
    this._defaultApiRouter = this.addRouter(
      config.defaultRouterBasePath ?? "/api",
    );

    // Now we need to add the endpoint for healthchecks
    this._defaultApiRouter.get(
      this._healthCheckPath,
      async (req, res) => this.healthcheckCallback(req, res),
      { useDefaultMiddlewares: false },
    );

    if (this._enableHttps) {
      this._keyFile = config.httpsKeyFile;
      this._certFile = config.httpsCertFile;
    }

    // Check if we are going to add a SSR endpoint
    if (
      config.ssrServer?.render === undefined ||
      config.ssrServer?.matcher === undefined
    ) {
      // We are not enabling SSR so mark the router as not existing
      this._ssrRouter = null;
      this._logger.startupMsg("SSR router NOT created");
    } else {
      // Make sure to NOT add the SSR Router to the
      // _apiRouterList since it doesnt have a fixed base path
      this._ssrRouter = new Router("/");

      const ssrEndpoint = this._ssrRouter.getSsrEndpoint(
        config.ssrServer.render,
      );

      // Add the main SSR route - NOTE: the path is not important since the
      // matcher will decide if there is a matching page
      this._ssrRouter.all("/", ssrEndpoint, {
        generateMatcher: config.ssrServer.matcher,
        etag: true,
        middlewareList: [
          Router.setLatencyMetricName(config.ssrServer.adapterName),
        ],
      });

      this._logger.startupMsg("SSR router created");
    }

    if (config.staticFileServer !== undefined) {
      this._staticFileServer = new StaticFileServer(
        `HttpServer-${this._name}/StaticFile`,
        config.staticFileServer,
      );
    }
  }

  // Getter and setter methods here
  get networkIp(): string | null {
    return this._networkIp;
  }

  get networkPort(): number | null {
    return this._networkPort;
  }

  get httpsEnabled(): boolean {
    return this._enableHttps;
  }

  get name(): string {
    return this._name;
  }

  get basePath(): string {
    return this._basePath;
  }

  get server(): http.Server | null {
    return this._server === undefined ? null : this._server;
  }

  get ssrRouter(): Router | null {
    return this._ssrRouter;
  }

  get reqHandler(): (req: ServerRequest, res: ServerResponse) => Promise<void> {
    return this.handleReq;
  }

  set healthCheckGoodResCode(code: number) {
    this._healthCheckGoodResCode = code;
  }

  set healthCheckBadResCode(code: number) {
    this._healthCheckBadResCode = code;
  }

  // Private methods here
  private findInterfaceIp(networkInterface: string): string | null {
    const ipv4Regex =
      /^(25[0-5]|2[0-4][0-9]|[0-1]?[0-9]{1,2})(\.(25[0-5]|2[0-4][0-9]|[0-1]?[0-9]{1,2})){3}$/;

    if (ipv4Regex.test(networkInterface)) {
      this._logger.startupMsg(`Using provided IP (${networkInterface})`);
      return networkInterface;
    }

    this._logger.startupMsg(`Finding IP for interface (${networkInterface})`);

    let ifaces = os.networkInterfaces();
    this._logger.startupMsg("Interfaces on host: %j", ifaces);

    if (ifaces[networkInterface] === undefined) {
      return null;
    }

    let ip = "";

    // Search for the first I/F with a family of type IPv4
    let found = ifaces[networkInterface]?.find((i) => i.family === "IPv4");
    if (found !== undefined) {
      ip = found.address;
      this._logger.startupMsg(
        `Found IP (${ip}) for interface ${networkInterface}`,
      );
    }

    if (ip.length === 0) {
      return null;
    }

    return ip;
  }

  private async startListening(server: http.Server): Promise<void> {
    // Make sure we have an interface and port before we start doing anything
    if (this._networkIp === null || this._networkPort === null) {
      this._logger.startupMsg("Not listening ...");
      return;
    }

    // Start listening
    server.listen(this._networkPort, this._networkIp);

    // Since this is an async event we need to wait for the "listening" event
    // to fire, so lets wrap this in a Promise and resolve the promise when
    // it happens
    return new Promise((resolve, _) => {
      server.on("listening", () => {
        this._logger.startupMsg(
          `Now listening on (${this._listeningOn}). HTTP manager started!`,
        );

        resolve();
      });

      // We also want to track all of the sockets that are opened
      server.on("connection", (socket: net.Socket) => {
        // We need a local copy of the socket ID for this closure to work
        let socketId = this._socketId++;
        this._socketMap.set(socketId, socket);

        this._logger.trace(
          "'connection' for socketId (%d) on remote connection (%s/%s)",
          socketId,
          socket.remoteAddress,
          socket.remotePort,
        );

        // Check when the socket closes
        socket.on("close", () => {
          // First check if the socket has not been closed during a stop()
          if (this._socketMap.has(socketId)) {
            this._socketMap.delete(socketId);

            this._logger.trace(
              "'close' for socketId (%d) on remote connection (%s/%s)",
              socketId,
              socket.remoteAddress,
              socket.remotePort,
            );
          }
        });
      });
    });
  }

  private async handleReq(
    req: ServerRequest,
    res: ServerResponse,
  ): Promise<void> {
    // Make sure the URL is valid before we go any further
    if (!req.validUrl) {
      const message = "Invalid URL";

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(message));
      res.statusCode = 400;
      res.write(message);
      res.end();
      return;
    }

    this._logger.trace(
      "Received (%s) req for (%s)",
      req.method,
      req.urlObj.pathname,
    );

    // Check if we should test for API route matches
    if (req.checkApiRoutes) {
      // Look for a router with a basePath that matches the start of the req path
      // NOTE: Make sure to delimit the pathname in case it is a match for
      // the root of the basepath
      let router = this._apiRouterList.find((el) =>
        el.inPath(`${req.urlObj.pathname}/`),
      );

      // Check if router exists
      if (router !== undefined) {
        // Try and handle the request
        await router.handleReq(req, res);
        if (req.handled) {
          return;
        }
      }
    }

    // Check if we should test for SSR routes matches
    if (req.checkSsrRoutes && this._ssrRouter !== null) {
      await this._ssrRouter.handleReq(req, res);
      if (req.handled) {
        return;
      }
    }

    // Check if we should test for static files matches AND if we are serving
    // static files
    if (req.checkStaticFiles && this._staticFileServer !== undefined) {
      await this._staticFileServer.handleReq(req, res);
      if (req.handled) {
        return;
      }
    }

    // If we are here then we dont know this URL at all so check if we should
    // return a 404
    if (req.handle404) {
      req.handled = true;

      const message = "Route not found";

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(message));
      res.write(message);
      res.end();
    }

    return;
  }

  private async healthcheckCallback(
    _1: ServerRequest,
    res: ServerResponse,
  ): Promise<void> {
    let healthy = true;

    for (let cb of this._healthcheckCallbacks) {
      healthy = await cb();

      if (!healthy) {
        break;
      }
    }

    if (healthy) {
      res.statusCode = this._healthCheckGoodResCode;
      res.body = "Healthy";
    } else {
      res.statusCode = this._healthCheckBadResCode;
      res.body = "Not Healthy";
    }
  }

  // Public methods here
  async start(): Promise<void> {
    // Make sure we have an interface and port before we start doing anything
    if (this._networkInterface === null || this._networkPort === null) {
      this._logger.startupMsg("Not initialising HTTP server ...");
      return;
    }

    this._logger.startupMsg("Initialising HTTP server ...");

    let ip = this.findInterfaceIp(this._networkInterface);

    if (ip === null) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    this._networkIp = ip;

    this._logger.startupMsg(
      `Will listen on interface ${this._networkInterface} (IP: ${this._networkIp})`,
    );

    // Create either a HTTP or HTTPS server
    if (this._enableHttps) {
      this._listeningOn = `https://${this._networkInterface}:${this._networkPort}`;

      if (this._keyFile === undefined) {
        throw new HttpConfigError("HTTPS is enabled but no key file provided!");
      }
      if (this._certFile === undefined) {
        throw new HttpConfigError(
          "HTTPS is enabled but no cert file provided!",
        );
      }

      this._logger.startupMsg(`Attempting to listen on (${this._listeningOn})`);

      const options: https.ServerOptions = {
        key: fs.readFileSync(this._keyFile),
        cert: fs.readFileSync(this._certFile),
      };

      this._server = https.createServer(options, (origReq, origRes) => {
        const req = enhanceIncomingMessage(origReq);
        const res = enhanceServerResponse(origRes);

        this.handleReq(req, res);
      });
    } else {
      this._listeningOn = `http://${this._networkInterface}:${this._networkPort}`;

      this._logger.startupMsg(`Attempting to listen on (${this._listeningOn})`);

      const options: https.ServerOptions = {};
      this._server = http.createServer(options, (origReq, origRes) => {
        const req = enhanceIncomingMessage(origReq);
        const res = enhanceServerResponse(origRes);

        this.handleReq(req, res);
      });
    }

    this._server.keepAliveTimeout = this._httpKeepAliveTimeout;
    this._server.headersTimeout = this._httpHeaderTimeout;

    await this.startListening(this._server);
  }

  async stop(): Promise<void> {
    this._logger.shutdownMsg("Closing all connections now ...");

    // Close all the remote connections
    this._socketMap.forEach((socket: net.Socket, key: number) => {
      socket.destroy();
      this._logger.trace(
        "Destroying socketId (%d) for remote connection (%s/%s)",
        key,
        socket.remoteAddress,
        socket.remotePort,
      );
    });

    // Just in case someone calls stop() a 2nd time
    this._socketMap.clear();

    if (this._server !== undefined) {
      this._logger.shutdownMsg("Closing HTTP manager port now ...");
      this._server.close();
      this._logger.shutdownMsg("Port closed");

      // Just in case someone calls stop() a 2nd time
      this._server = undefined;
    }

    return;
  }

  addHealthcheck(callback: HealthcheckCallback): void {
    this._healthcheckCallbacks.push(callback);
  }

  addRouter(basePath: string, routerConfig: RouterConfig = {}): Router {
    // Prepend the Http Server basePath and make sure the basePath
    // is properly terminated
    basePath = `${this._basePath}${basePath}`.replace(/\/*$/, "/");

    // Check to make sure this basePath does not overlap with another router's
    // basePath
    let found = this._apiRouterList.find((el) => {
      return el.inPath(basePath) || el.basePath.startsWith(basePath);
    });

    // If there is an overlap with an existing router then "stop the press"!
    if (found !== undefined) {
      throw new Error(`${basePath} clashes with basePath of ${found.basePath}`);
    }

    // If we are here then all is good so create the new router
    let router = new Router(basePath, routerConfig);
    this._apiRouterList.push(router);

    this._logger.startupMsg("(%s) router created", basePath.replace(/\/$/, ""));

    return router;
  }

  router(basePath?: string): Router | undefined {
    // If no basePath has been defined then return the default router
    if (basePath === undefined) {
      return this._defaultApiRouter;
    }

    // Prepend the Http Server basePath and make sure the basePath
    // is properly terminated
    const basePathSanitised = `${this._basePath}${basePath}`.replace(
      /\/*$/,
      "/",
    );

    return this._apiRouterList.find((el) => el.basePath === basePathSanitised);
  }

  // Methods for the default router here
  use(middleware: Middleware): Router {
    return this._defaultApiRouter.use(middleware);
  }

  del(
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ): Router {
    return this._defaultApiRouter.del(path, callback, options);
  }

  get(
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ): Router {
    return this._defaultApiRouter.get(path, callback, options);
  }

  patch(
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ): Router {
    return this._defaultApiRouter.patch(path, callback, options);
  }

  post(
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ): Router {
    return this._defaultApiRouter.post(path, callback, options);
  }

  put(
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ): Router {
    return this._defaultApiRouter.put(path, callback, options);
  }

  endpoint(
    method: Method,
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ): Router {
    return this._defaultApiRouter.endpoint(method, path, callback, options);
  }

  route(path: string): Route {
    return this._defaultApiRouter.route(path);
  }
}

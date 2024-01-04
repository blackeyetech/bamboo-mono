// imports here
import { logger } from "../logger.js";

import { ServerRequest, ServerResponse } from "./req-res.js";
import {
  Middleware,
  ExpressMiddleware,
  CorsOptions,
  CsrfChecksOptions,
  SecurityHeadersOptions,
  bodyMiddleware,
  jsonMiddleware,
  corsMiddleware,
  expressWrapper,
  csrfChecksMiddleware,
  securityHeadersMiddleware,
} from "./middleware.js";
import * as staticFiles from "./static-files.js";
import {
  Router,
  EndpointOptions,
  EndpointCallback,
  Method,
  Route,
  RouterConfig,
} from "./router.js";

export {
  EndpointOptions,
  EndpointCallback,
  Router,
  RouterConfig,
  RouterMatch,
  RouterMatchFunc,
} from "./router.js";

import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

// Types here
export type HealthcheckCallback = () => Promise<boolean>;

export class HttpConfigError {
  constructor(public message: string) {}
}

export type HttpConfig = {
  // NOTE: The default node keep alive is 5 secs. This needs to be set
  // higher then any load balancers in front of this App
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
  httpsKeyFile?: string;
  httpsCertFile?: string;

  staticFileServer?: {
    path: string;
    extraContentTypes?: Record<string, string>;
  };
};

// HttpServer class here
export class HttpServer {
  private _socketMap: Map<number, net.Socket>;
  private _socketId: number;

  private _networkInterface: string;
  private _networkPort: number;
  private _networkIp: string;
  private _baseUrl: string;

  private _name: string;
  private _loggerTag: string;

  private _healthcheckCallbacks: HealthcheckCallback[];

  private _httpKeepAliveTimeout: number;
  private _httpHeaderTimeout: number;

  private _healthCheckPath: string;
  private _healthCheckGoodResCode: number;
  private _healthCheckBadResCode: number;

  private _enableHttps: boolean;
  private _keyFile?: string;
  private _certFile?: string;

  private _apiRouterList: Router[];
  private _defaultApiRouter: Router;
  private _ssrRouter: Router;
  private _staticFileServer?: staticFiles.StaticFileServer;

  private _server?: http.Server;

  constructor(
    name: string,
    networkInterface: string,
    networkPort: number,
    config: HttpConfig = {},
  ) {
    this._httpKeepAliveTimeout = config.keepAliveTimeout ?? 65000;
    this._httpHeaderTimeout = config.headerTimeout ?? 66000;

    this._healthCheckPath = config.healthcheckPath ?? "/healthcheck";
    this._healthCheckGoodResCode = config.healthcheckGoodRes ?? 200;
    this._healthCheckBadResCode = config.healthcheckBadRes ?? 503;

    this._enableHttps = config.enableHttps ?? false;

    this._socketMap = new Map();
    this._socketId = 0;

    this._networkIp = "";
    this._baseUrl = "";

    this._name = name;
    this._loggerTag = `HttpServer-${name}-${networkInterface}-${networkPort}`;

    this._networkInterface = networkInterface;
    this._networkPort = networkPort;

    this._healthcheckCallbacks = [];

    this._apiRouterList = [];

    // Create the default router AFTER you initialise the _routerList
    this._defaultApiRouter = this.addRouter(
      config.defaultRouterBasePath ?? "/api",
    );

    if (this._enableHttps) {
      this._keyFile = config.httpsKeyFile;
      this._certFile = config.httpsCertFile;
    }

    // Make sure the SSR Router DOES NOT use the not found handler - we need it
    // to pass control to the static file server and do not add it to the
    // _apiRouterList since it doesnt have a fixed base path
    this._ssrRouter = new Router("/", { useNotFoundHandler: false });
    logger.startupMsg(this._loggerTag, "SSR router created");

    if (config.staticFileServer !== undefined) {
      this._staticFileServer = new staticFiles.StaticFileServer({
        filePath: config.staticFileServer.path,
        loggerTag: `${this._loggerTag}/StaticFile`,
        extraContentTypes: config.staticFileServer.extraContentTypes,
      });
    }
  }

  // Getter methods here
  get networkIp(): string {
    return this._networkIp;
  }

  get networkPort(): number {
    return this._networkPort;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get httpsEnabled(): boolean {
    return this._enableHttps;
  }

  get name(): string {
    return this._name;
  }

  get ssrRouter(): Router {
    return this._ssrRouter;
  }

  // Private methods here
  private findInterfaceIp(networkInterface: string): string | null {
    logger.startupMsg(
      this._loggerTag,
      `Finding IP for interface (${networkInterface})`,
    );

    let ifaces = os.networkInterfaces();
    logger.startupMsg(this._loggerTag, "Interfaces on host: %j", ifaces);

    if (ifaces[networkInterface] === undefined) {
      return null;
    }

    let ip = "";

    // Search for the first I/F with a family of type IPv4
    let found = ifaces[networkInterface]?.find((i) => i.family === "IPv4");
    if (found !== undefined) {
      ip = found.address;
      logger.startupMsg(
        this._loggerTag,
        `Found IP (${ip}) for interface ${networkInterface}`,
      );
    }

    if (ip.length === 0) {
      return null;
    }

    return ip;
  }

  private async startListening(server: http.Server): Promise<void> {
    // Start listening
    server.listen(this._networkPort, this._networkIp);

    // Since this is an async event we need to wait for the "listening" event
    // to fire, so lets wrap this in a Promise and resolve the promise when
    // it happens
    return new Promise((resolve, _) => {
      server.on("listening", () => {
        logger.startupMsg(
          this._loggerTag,
          `Now listening on (${this._baseUrl}). HTTP manager started!`,
        );

        resolve();
      });

      // We also want to track all of the sockets that are opened
      server.on("connection", (socket: net.Socket) => {
        // We need a local copy of the socket ID for this closure to work
        let socketId = this._socketId++;
        this._socketMap.set(socketId, socket);

        logger.trace(
          this._loggerTag,
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

            logger.trace(
              this._loggerTag,
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
    // We have to do this hear for now since the url will not be set until
    // after this object it created

    // To avoid attempted path traversals resolve the path with "/" as the base
    // This will sort out ".."s, "."s and "//"s and ensure you can not end up
    // wit a path like "../secret-dir/secrets.txt"
    let url = path.resolve("/", req.url as string);
    let protocol = this._enableHttps ? "https" : "http";
    req.urlObj = new URL(url, `${protocol}://${req.headers.host}`);

    logger.trace(
      this._loggerTag,
      "Received (%s) req for (%s)",
      req.method,
      url,
    );

    // Look for a router with a basePath that matches the start of the req path
    let pathname = req.urlObj.pathname;
    let router = this._apiRouterList.find((el) => el.inPath(pathname));

    // Try and handle the request (if router exists)
    if ((await router?.handleReq(req, res)) === true) {
      return;
    }

    // If we're here this wasn't an API req so check if it was SSR req
    if (await this._ssrRouter.handleReq(req, res)) {
      return;
    }

    // If we're here this wasn't a SSR req so check if we're serving
    // static files
    if (this._staticFileServer !== undefined) {
      await this._staticFileServer.handleReq(req, res);
      return;
    }

    // If we are here then we dont know this URL so return a 404
    res.statusCode = 404;
    res.write("Not found");
    res.end();
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
    logger.startupMsg(this._loggerTag, "Initialising HTTP manager ...");

    let ip = this.findInterfaceIp(this._networkInterface);

    if (ip === null) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    this._networkIp = ip;

    logger.startupMsg(
      this._loggerTag,
      `Will listen on interface ${this._networkInterface} (IP: ${this._networkIp})`,
    );

    // Create either a HTTP or HTTPS server
    if (this._enableHttps) {
      this._baseUrl = `https://${this._networkIp}:${this._networkPort}`;

      if (this._keyFile === undefined) {
        throw new HttpConfigError("HTTPS is enabled but no key file provided!");
      }
      if (this._certFile === undefined) {
        throw new HttpConfigError(
          "HTTPS is enabled but no cert file provided!",
        );
      }

      logger.startupMsg(
        this._loggerTag,
        `Attempting to listen on (${this._baseUrl})`,
      );

      const options: https.ServerOptions = {
        IncomingMessage: ServerRequest,
        ServerResponse: <any>ServerResponse, // Something wrong with typedefs
        key: fs.readFileSync(this._keyFile),
        cert: fs.readFileSync(this._certFile),
      };

      this._server = https.createServer(options, (req, res) => {
        this.handleReq(req as ServerRequest, res as ServerResponse);
      });
    } else {
      this._baseUrl = `http://${this._networkIp}:${this._networkPort}`;

      logger.startupMsg(
        this._loggerTag,
        `Attempting to listen on (${this._baseUrl})`,
      );

      const options: https.ServerOptions = {
        IncomingMessage: ServerRequest,
        ServerResponse: <any>ServerResponse, // Something wrong with typedefs
      };
      this._server = http.createServer(options, (req, res) => {
        this.handleReq(req as ServerRequest, res as ServerResponse);
      });
    }

    this._server.keepAliveTimeout = this._httpKeepAliveTimeout;
    this._server.headersTimeout = this._httpHeaderTimeout;

    await this.startListening(this._server);

    // Now we need to add the endpoint for healthchecks
    this._defaultApiRouter.get(
      this._healthCheckPath,
      async (req, res) => this.healthcheckCallback(req, res),
      { useDefaultMiddlewares: false },
    );
  }

  async stop(): Promise<void> {
    logger.shutdownMsg(this._loggerTag, "Closing all connections now ...");

    // Close all the remote connections
    this._socketMap.forEach((socket: net.Socket, key: number) => {
      socket.destroy();
      logger.trace(
        this._loggerTag,
        "Destroying socketId (%d) for remote connection (%s/%s)",
        key,
        socket.remoteAddress,
        socket.remotePort,
      );
    });

    // Just in case someone calls stop() a 2nd time
    this._socketMap.clear();

    if (this._server !== undefined) {
      logger.shutdownMsg(this._loggerTag, "Closing HTTP manager port now ...");
      this._server.close();
      logger.shutdownMsg(this._loggerTag, "Port closed");

      // Just in case someone calls stop() a 2nd time
      this._server = undefined;
    }

    return;
  }

  addHealthcheck(callback: HealthcheckCallback): void {
    this._healthcheckCallbacks.push(callback);
  }

  addRouter(basePath: string, routerConfig: RouterConfig = {}): Router {
    // Make sure the basePath is properly terminated
    basePath = basePath.replace(/\/*$/, "/");

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

    logger.startupMsg(
      this._loggerTag,
      "(%s) router created",
      basePath.replace(/\/$/, ""),
    );

    return router;
  }

  getRouter(basePath: string): Router | undefined {
    // Make sure to remove any trailing slashes and then delimit properly
    basePath = basePath.replace(/\/*$/, "/");

    return this._apiRouterList.find((el) => el.basePath === basePath);
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
    return this._defaultApiRouter.endpoint("DELETE", path, callback, options);
  }

  get(
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ): Router {
    return this._defaultApiRouter.endpoint("GET", path, callback, options);
  }

  patch(
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ): Router {
    return this._defaultApiRouter.endpoint("PATCH", path, callback, options);
  }

  post(
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ): Router {
    return this._defaultApiRouter.endpoint("POST", path, callback, options);
  }

  put(
    path: string,
    callback: EndpointCallback,
    options: EndpointOptions = {},
  ): Router {
    return this._defaultApiRouter.endpoint("PUT", path, callback, options);
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

  // Middleware methods here
  static body(options: { maxBodySize?: number } = {}): Middleware {
    // Rem we have to call bodyMiddleware since it returns the middleware
    return bodyMiddleware(options);
  }

  static json(): Middleware {
    return jsonMiddleware;
  }

  static cors(options: CorsOptions = {}): Middleware {
    return corsMiddleware(options);
  }

  static csrf(middleware: CsrfChecksOptions = {}): Middleware {
    return csrfChecksMiddleware(middleware);
  }

  static secHeaders(middleware: SecurityHeadersOptions): Middleware {
    return securityHeadersMiddleware(middleware);
  }

  static expressWrapper(middleware: ExpressMiddleware): Middleware {
    return expressWrapper(middleware);
  }
}

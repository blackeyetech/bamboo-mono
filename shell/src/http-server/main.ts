// imports here
import { Logger } from "../logger.js";

import { ServerRequest, ServerResponse } from "./req-res.js";
import { Middleware } from "./middleware.js";
import { StaticFileServer } from "./static-file-server.js";
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

  startInMaintenanceMode?: boolean;
  maintenanceRoute?: string;

  staticFileServer?: {
    path: string;
    extraContentTypes?: Record<string, string>;
    immutableRegExp?: RegExp | string | RegExp[] | string[];
    securityHeaders?: { name: string; value: string }[];
  };
};

// HttpServer class here
export class HttpServer {
  private _logger: Logger;
  private _socketMap: Map<number, net.Socket>;
  private _socketId: number;

  private _networkInterface: string;
  private _networkPort: number;
  private _networkIp: string;
  private _baseUrl: string;

  private _name: string;

  private _healthcheckCallbacks: HealthcheckCallback[];

  private _httpKeepAliveTimeout: number;
  private _httpHeaderTimeout: number;

  private _healthCheckPath: string;
  private _healthCheckGoodResCode: number;
  private _healthCheckBadResCode: number;

  private _enableHttps: boolean;
  private _keyFile?: string;
  private _certFile?: string;

  private _maintenanceModeOn: boolean;
  private _maintenanceRoute?: string;

  private _apiRouterList: Router[];
  private _defaultApiRouter: Router;
  private _ssrRouter: Router;
  private _staticFileServer?: StaticFileServer;

  private _server?: http.Server;

  constructor(
    networkInterface: string,
    networkPort: number,
    config: HttpConfig = {},
  ) {
    this._name = `${networkInterface}-${networkPort}`;
    this._logger = new Logger(`HttpServer-${this._name}`);

    this._httpKeepAliveTimeout = config.keepAliveTimeout ?? 65000;
    this._httpHeaderTimeout = config.headerTimeout ?? 66000;

    this._healthCheckPath = config.healthcheckPath ?? "/healthcheck";
    this._healthCheckGoodResCode = config.healthcheckGoodRes ?? 200;
    this._healthCheckBadResCode = config.healthcheckBadRes ?? 503;

    this._enableHttps = config.enableHttps ?? false;

    this._maintenanceRoute = config.maintenanceRoute;
    this._maintenanceModeOn = config.startInMaintenanceMode ?? false;

    this._logger.startupMsg(
      "Maintenance mode is set to (%j)",
      this._maintenanceModeOn,
    );

    this._socketMap = new Map();
    this._socketId = 0;

    this._networkIp = "";
    this._baseUrl = "";

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
    this._logger.startupMsg("SSR router created");

    if (config.staticFileServer !== undefined) {
      this._staticFileServer = new StaticFileServer({
        loggerName: `HttpServer-${this._name}/StaticFile`,
        filePath: config.staticFileServer.path,
        extraContentTypes: config.staticFileServer.extraContentTypes,
        immutableRegExp: config.staticFileServer.immutableRegExp,
        securityHeaders: config.staticFileServer.securityHeaders,
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

  // Setter methods here
  set maintenanceModeOn(on: boolean) {
    this._maintenanceModeOn = on;

    this._logger.info("Maintenance mode set to (%j)", this._maintenanceModeOn);
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
    // Start listening
    server.listen(this._networkPort, this._networkIp);

    // Since this is an async event we need to wait for the "listening" event
    // to fire, so lets wrap this in a Promise and resolve the promise when
    // it happens
    return new Promise((resolve, _) => {
      server.on("listening", () => {
        this._logger.startupMsg(
          `Now listening on (${this._baseUrl}). HTTP manager started!`,
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
    // Check if we are in maintenance mode
    if (this._maintenanceModeOn && this._maintenanceRoute !== undefined) {
      this._logger.trace(
        "Maintenance mode on. Redirecting (%s) to (%s)",
        req.url,
        this._maintenanceRoute,
      );

      // This isn't very sexy and seems a little heavy handed but works a treat
      // we just point the req to the maintenance route and pray the user set
      // it up!
      req.method = "GET";
      req.url = this._maintenanceRoute;
    }

    // We have to do this here because the url will not be set until
    // after this object it created: See req-res.ts
    let protocol = this._enableHttps ? "https" : "http";
    req.urlObj = new URL(
      req.url as string,
      `${protocol}://${req.headers.host}`,
    );

    this._logger.trace(
      "Received (%s) req for (%s)",
      req.method,
      req.urlObj.pathname,
    );

    // Look for a router with a basePath that matches the start of the req path
    // NOTE: Make sure to delimit the pathname in case it is a match for
    // the root of the basepath
    let router = this._apiRouterList.find((el) =>
      el.inPath(`${req.urlObj.pathname}/`),
    );

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
    this._logger.startupMsg("Initialising HTTP manager ...");

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
      this._baseUrl = `https://${this._networkIp}:${this._networkPort}`;

      if (this._keyFile === undefined) {
        throw new HttpConfigError("HTTPS is enabled but no key file provided!");
      }
      if (this._certFile === undefined) {
        throw new HttpConfigError(
          "HTTPS is enabled but no cert file provided!",
        );
      }

      this._logger.startupMsg(`Attempting to listen on (${this._baseUrl})`);

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

      this._logger.startupMsg(`Attempting to listen on (${this._baseUrl})`);

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

    this._logger.startupMsg("(%s) router created", basePath.replace(/\/$/, ""));

    return router;
  }

  router(basePath?: string): Router | undefined {
    if (basePath === undefined) {
      return this._defaultApiRouter;
    }

    // Make sure to remove any trailing slashes and then delimit properly
    let basePathSanitised = basePath.replace(/\/*$/, "/");

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

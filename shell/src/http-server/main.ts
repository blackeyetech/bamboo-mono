// imports here
import { SseServer, SseServerOptions } from "./sse-server.js";
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
  setServerTimingHeader,
  securityHeadersMiddleware,
} from "./middleware.js";
import * as staticFiles from "./static-files.js";
import * as logger from "../logger.js";
import * as PathToRegEx from "path-to-regexp";

import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as fs from "node:fs";
import * as net from "node:net";
import * as crypto from "node:crypto";
import * as path from "node:path";

// Types here
export type HealthcheckCallback = () => Promise<boolean>;

export type EndpointOptions = {
  defaultMiddlewares?: boolean;
  middlewareList?: Middleware[];
  sseServerOptions?: SseServerOptions;
  etag?: boolean;
};

export type EndpointCallback = (
  req: ServerRequest,
  res: ServerResponse,
) => Promise<void> | void;

export class HttpConfigError {
  message: string;

  constructor(message: string) {
    this.message = message;
  }
}

export class HttpError {
  status: number;
  message: string;

  constructor(status: number, message: string) {
    this.status = status;
    this.message = message;
  }
}

export type HttpConfig = {
  loggerTag?: string;

  // NOTE: The default node keep alive is 5 secs. This needs to be set
  // higher then any load balancers in front of this App
  keepAliveTimeout?: number;
  // NOTE: There is a potential race condition and the recommended
  // solution is to make the header timeouts greater then the keep alive
  // timeout. See - https://github.com/nodejs/node/issues/27363
  headerTimeout?: number;

  healthcheckPath?: string;
  healthcheckGoodRes?: number;
  healthcheckBadRes?: number;

  enableHttps?: boolean;
  httpsKeyFile?: string;
  httpsCertFile?: string;

  ssrHandler?: (req: ServerRequest, res: ServerResponse) => Promise<void>;
  staticFileServer?: {
    path: string;
    extraContentTypes?: Record<string, string>;
  };
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
type MethodListElement = {
  matchFunc: PathToRegEx.MatchFunction<object>;
  callback: EndpointCallback;

  middlewareList: Middleware[];
  sseServerOptions?: SseServerOptions;
  etag: boolean;
};

// HttpServer class here
export class HttpServer {
  private _socketMap: Map<number, net.Socket>;
  private _socketId: number;

  private _networkInterface: string;
  private _networkPort: number;
  private _networkIp: string;
  private _baseUrl: string;

  private _log: logger.LoggerInstance;

  private _healthcheckCallbacks: HealthcheckCallback[];
  private _methodListMap: Record<Method, MethodListElement[]>;

  private _httpKeepAliveTimeout: number;
  private _httpHeaderTimeout: number;

  private _healthCheckPath: string;
  private _healthCheckGoodResCode: number;
  private _healthCheckBadResCode: number;

  private _enableHttps: boolean;
  private _keyFile?: string;
  private _certFile?: string;

  private _ssrHandler?: (
    req: ServerRequest,
    res: ServerResponse,
    next: () => void,
  ) => Promise<void>;
  private _staticFileServer?: staticFiles.StaticFileServer;

  private _defaultMiddlewareList: Middleware[];

  private _server?: http.Server;

  constructor(
    networkInterface: string,
    networkPort: number,
    bsLogger: logger.AbstractLogger,
    httpConfig: HttpConfig = {},
  ) {
    let config = {
      loggerTag: `HttpServer-${networkInterface}-${networkPort}`,

      keepAliveTimeout: 65000,
      headerTimeout: 66000,

      healthcheckPath: "/api/healthcheck",
      healthcheckGoodRes: 200,
      healthcheckBadRes: 503,

      enableHttps: false,

      ...httpConfig,
    };

    this._socketMap = new Map();
    this._socketId = 0;

    this._networkIp = "";
    this._baseUrl = "";

    this._log = new logger.LoggerInstance(bsLogger, config.loggerTag);

    this._networkInterface = networkInterface;
    this._networkPort = networkPort;

    this._healthcheckCallbacks = [];
    this._methodListMap = {
      GET: [],
      DELETE: [],
      PATCH: [],
      POST: [],
      PUT: [],
      OPTIONS: [],
    };

    this._httpKeepAliveTimeout = config.keepAliveTimeout;
    this._httpHeaderTimeout = config.headerTimeout;

    this._healthCheckPath = config.healthcheckPath;
    this._healthCheckGoodResCode = config.healthcheckGoodRes;
    this._healthCheckBadResCode = config.healthcheckBadRes;

    this._enableHttps = config.enableHttps;

    if (this._enableHttps) {
      this._keyFile = config.httpsKeyFile;
      this._certFile = config.httpsCertFile;
    }

    this._ssrHandler = config.ssrHandler;

    this._defaultMiddlewareList = [];

    if (config.staticFileServer !== undefined) {
      this._staticFileServer = new staticFiles.StaticFileServer({
        filePath: config.staticFileServer.path,
        logger: bsLogger,
        loggerTag: `${config.loggerTag}/StaticFile`,
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

  // Private methods here
  private findInterfaceIp(networkInterface: string): string | null {
    this._log.startupMsg(`Finding IP for interface (${networkInterface})`);

    let ifaces = os.networkInterfaces();
    this._log.startupMsg("Interfaces on host: %j", ifaces);

    if (ifaces[networkInterface] === undefined) {
      return null;
    }

    let ip = "";

    // Search for the first I/F with a family of type IPv4
    let found = ifaces[networkInterface]?.find((i) => i.family === "IPv4");
    if (found !== undefined) {
      ip = found.address;
      this._log.startupMsg(
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
        this._log.startupMsg(
          `Now listening on (${this._baseUrl}). HTTP manager started!`,
        );

        resolve();
      });

      // We also want to track all of the sockets that are opened
      server.on("connection", (socket: net.Socket) => {
        // We need a local copy of the socket ID for this closure to work
        let socketId = this._socketId++;
        this._socketMap.set(socketId, socket);

        this._log.trace(
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

            this._log.trace(
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

  private async handleHttpReq(
    req: ServerRequest,
    res: ServerResponse,
    https: boolean,
  ): Promise<void> {
    // We have to do this hear for now since the url will not be set until
    // after this object it created

    // To avoid attempted path traversals resolve the path with "/" as the base
    // This will sort out ".."s, "."s and "//"s and ensure you can not end up
    // wit a path like "../secret-dir/secrets.txt"
    let url = path.resolve("/", req.url as string);
    let protocol = https ? "https" : "http";
    req.urlObj = new URL(url, `${protocol}://${req.headers.host}`);

    this._log.trace("Received (%s) req for (%s)", req.method, url);

    if (await this.handleApiReq(req, res)) {
      return;
    }

    // This wasn't an API call so check if we are doing SSR
    if (this._ssrHandler !== undefined) {
      // This is a flag to check if the URL path matches an SSR path
      let wasHandled = true;

      await this._ssrHandler(req, res, () => {
        // If this is called then the URL path doesn't match an SSR path
        wasHandled = false;
      });

      // Only return IF the URL was handled
      if (wasHandled) {
        return;
      }
    }

    // If we're here then check if we are serving static files
    if (this._staticFileServer !== undefined) {
      await this._staticFileServer.handleReq(req, res);
      return;
    }

    // If we are here then we dont know this URL so return a 404
    res.statusCode = 404;
    res.end();
  }

  private findEndpoint(req: ServerRequest): MethodListElement | null {
    let method = <Method>req.method;

    // Check for a CORS Preflight request - yes there is middleware for this
    // but this has to be checked here because we will not have a registered
    // endpoint under OPTIONS
    if (
      req.method === "OPTIONS" &&
      req.headers["access-control-request-method"] !== undefined
    ) {
      // Get the method this preflight request is checking for and use that
      // to see there is an endpoint registered for it
      method = <Method>req.headers["access-control-request-method"];
    }

    // First, make sure we have a list for the req method
    let list = this._methodListMap[method];
    if (list === undefined) {
      return null;
    }

    let matchedEl: MethodListElement | null = null;

    // Next see if we have a registered callback for the HTTP req path
    for (let el of list) {
      let result = el.matchFunc(req.urlObj.pathname);

      // If result is false that means we found nothing
      if (result === false) {
        continue;
      }

      // If we are here we found the callback
      matchedEl = el;
      // Don't forget to set the url parameters
      req.params = result.params;
      // Stop looking
      break;
    }

    return matchedEl;
  }

  private async handleApiReq(
    req: ServerRequest,
    res: ServerResponse,
  ): Promise<boolean> {
    // See if this request matches a registered endpoint
    let matchedEl = this.findEndpoint(req);
    if (matchedEl === null) {
      // Couldn't find a match so flag that the req has not been handled
      return false;
    }

    await this.callMiddleware(
      req,
      res,
      matchedEl,
      matchedEl.middlewareList,
    ).catch((e) => {
      let message: string;

      // If it is a HttpError assume the error message has already been logged
      if (e instanceof HttpError) {
        res.statusCode = e.status;
        message = e.message;
      } else {
        // We don't know what this is so log it and make sure to return a 500
        this._log.error(
          "Unknown error happened while handling URL (%s) - (%s)",
          req.urlObj.pathname,
          e,
        );

        res.statusCode = 500;
        message = "Unknown error happened";
      }

      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("content-length", Buffer.byteLength(message));
      res.write(message);
      res.end();
    });

    // Check if res.write() has NOT been called yet
    if (!res.headersSent) {
      // Check if the callback wants us to add the body, headers etc
      this.addResponse(req, res, matchedEl.etag);
    }

    // Check if the res.end() has NOT been called yet
    if (!res.writableEnded) {
      // End the response now
      res.end();
    }

    // Flag this req has been handled
    return true;
  }

  private async callMiddleware(
    req: ServerRequest,
    res: ServerResponse,
    el: MethodListElement,
    middlewareStack: Middleware[],
  ): Promise<void> {
    // Check if there handlers still be be called on the stack
    if (middlewareStack.length) {
      // Call the top handler and pass the rest of the handlers after it
      await middlewareStack[0](req, res, async () => {
        await this.callMiddleware(req, res, el, middlewareStack.slice(1));
      });
    } else {
      // No more handlers but make sure is NOT an unhandled preflight check.
      // If it is then we DO NOT want to call the endpoint handler
      if (req.method !== "OPTIONS") {
        await this.callEndpoint(req, res, el);
      }
    }
  }

  private async callEndpoint(
    req: ServerRequest,
    res: ServerResponse,
    el: MethodListElement,
  ): Promise<void> {
    // Check if this should be a server sent event endpoint
    if (el.sseServerOptions !== undefined) {
      req.sseServer = new SseServer(req, res, el.sseServerOptions);
    }

    // The callback can be async or not so check for it
    if (el.callback.constructor.name === "AsyncFunction") {
      // This is async so use await
      await el.callback(req, res);
    } else {
      // This is a synchronous call
      el.callback(req, res);
    }
  }

  private addResponse(req: ServerRequest, res: ServerResponse, etag: boolean) {
    let body: string | Buffer | null = null;

    // Check if a json or a body response has been passed back
    if (res.json !== undefined) {
      res.setHeader("content-type", "application/json; charset=utf-8");
      body = JSON.stringify(res.json);
    } else if (res.body !== undefined) {
      // Check if the content-type has not been set
      if (!res.hasHeader("content-type")) {
        // It hasn't so set it to the default type
        res.setHeader("content-type", "text/plain; charset=utf-8");
      }
      body = res.body;
    }

    // Check if the user didnt pass any data to send back (body is null)
    if (body === null) {
      // This means there will be an empty body so check if the StatusCode has
      // been change from the default 200 - if it has leave it alone beacuse
      // the user must have set it
      if (res.statusCode === 200) {
        // Otherwise set the status code to indicate an empty body
        res.statusCode = 204;
      }

      // Don't forget to set the server-timing header before we leave
      setServerTimingHeader(res, req.receiveTime);
      // Nothing else to do so get out of here
      return;
    }

    // Check if the user wants an etag added to the response
    if (etag) {
      let etag = crypto.createHash("sha1").update(body).digest("hex");

      // All headers need to be set, except content-length, for a 304
      res.setHeader("cache-control", "no-cache");
      res.setHeader("etag", etag);

      // Check if any cache validators exist on the request
      if (req.headers["if-none-match"] === etag) {
        // Don't forget to set the server-timing header after we do everything else
        setServerTimingHeader(res, req.receiveTime);

        res.statusCode = 304;
        res.end();
        return;
      }
    }

    // Only set the length when we don't do a 304
    res.setHeader("content-length", Buffer.byteLength(body));

    // Don't forget to set the server-timing header after we do everything else
    setServerTimingHeader(res, req.receiveTime);

    res.write(body);
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
    this._log.startupMsg("Initialising HTTP manager ...");

    let ip = this.findInterfaceIp(this._networkInterface);

    if (ip === null) {
      throw new Error(
        `${this._networkInterface} is not an interface on this server`,
      );
    }

    this._networkIp = ip;

    this._log.startupMsg(
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

      this._log.startupMsg(`Attempting to listen on (${this._baseUrl})`);

      const options: https.ServerOptions = {
        IncomingMessage: ServerRequest,
        ServerResponse: <any>ServerResponse, // Something wrong with typedefs
        key: fs.readFileSync(this._keyFile),
        cert: fs.readFileSync(this._certFile),
      };

      this._server = https.createServer(options, (req, res) => {
        this.handleHttpReq(req as ServerRequest, res as ServerResponse, true);
      });
    } else {
      this._baseUrl = `http://${this._networkIp}:${this._networkPort}`;

      this._log.startupMsg(`Attempting to listen on (${this._baseUrl})`);

      const options: https.ServerOptions = {
        IncomingMessage: ServerRequest,
        ServerResponse: <any>ServerResponse, // Something wrong with typedefs
      };
      this._server = http.createServer(options, (req, res) => {
        this.handleHttpReq(req as ServerRequest, res as ServerResponse, false);
      });
    }

    this._server.keepAliveTimeout = this._httpKeepAliveTimeout;
    this._server.headersTimeout = this._httpHeaderTimeout;

    await this.startListening(this._server);

    // Now we need to add the endpoint for healthchecks
    this.endpoint(
      "GET",
      this._healthCheckPath,
      (req, res) => this.healthcheckCallback(req, res),
      { defaultMiddlewares: false },
    );
  }

  async stop(): Promise<void> {
    this._log.shutdownMsg("Closing all connections now ...");

    // Close all the remote connections
    this._socketMap.forEach((socket: net.Socket, key: number) => {
      socket.destroy();
      this._log.trace(
        "Destroying socketId (%d) for remote connection (%s/%s)",
        key,
        socket.remoteAddress,
        socket.remotePort,
      );
    });

    // Just in case someone calls stop() a 2nd time
    this._socketMap.clear();

    if (this._server !== undefined) {
      this._log.shutdownMsg("Closing HTTP manager port now ...");
      this._server.close();
      this._log.shutdownMsg("Port closed");

      // Just in case someone calls stop() a 2nd time
      this._server = undefined;
    }

    return;
  }

  addHealthcheck(callback: HealthcheckCallback) {
    this._healthcheckCallbacks.push(callback);
  }

  use(middleware: Middleware) {
    this._defaultMiddlewareList.push(middleware);
  }

  del(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ) {
    this.endpoint("DELETE", path, callback, endpointOptions);
  }

  get(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ) {
    this.endpoint("GET", path, callback, endpointOptions);
  }

  patch(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ) {
    this.endpoint("PATCH", path, callback, endpointOptions);
  }

  post(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ) {
    this.endpoint("POST", path, callback, endpointOptions);
  }

  put(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ) {
    this.endpoint("PUT", path, callback, endpointOptions);
  }

  endpoint(
    method: Method,
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ) {
    let options = { defaultMiddlewares: true, etag: true, ...endpointOptions };

    // Then create the matching function
    let matchFunc = PathToRegEx.match(path, {
      decode: decodeURIComponent,
      strict: true,
    });

    // Make sure we have the middlewares requested
    let middlewareList: Middleware[] = [];

    // Check if the user wants the default middlewares
    if (options.defaultMiddlewares) {
      // ... stick the default middlewares in first
      middlewareList = [...this._defaultMiddlewareList];
    }

    if (options.middlewareList !== undefined) {
      middlewareList = [...middlewareList, ...options.middlewareList];
    }

    // Finally add it to the list of callbacks
    this._methodListMap[method].push({
      matchFunc,
      callback,
      middlewareList,
      sseServerOptions: options.sseServerOptions,
      etag: options.etag,
    });

    this._log.info(
      "Added %s endpoint for path (%s)",
      method.toUpperCase(),
      path,
    );
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

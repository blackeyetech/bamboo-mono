// imports here
import { Logger } from "../logger.js";

import { SseServer, SseServerOptions } from "./sse-server.js";
import {
  ServerRequest,
  ServerResponse,
  HttpError,
  HttpRedirect,
} from "./req-res.js";
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
  getSecurityHeaders,
  securityHeadersMiddleware,
  dontCompressResponse,
} from "./middleware.js";
import * as PathToRegEx from "path-to-regexp";

import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import * as streams from "node:stream/promises";
import { PassThrough } from "node:stream";

// Types here
export type HealthcheckCallback = () => Promise<boolean>;

export type RouterMatch = {
  params: Record<string, string>;

  matchedInfo: any;
};

export type RouterMatchFunc = (url: URL) => RouterMatch | false;

export type EndpointOptions = {
  generateMatcher?: (path: string) => RouterMatchFunc;
  useDefaultMiddlewares?: boolean;
  middlewareList?: Middleware[];
  sseServerOptions?: SseServerOptions;
  etag?: boolean;
};

export type EndpointCallback = (
  req: ServerRequest,
  res: ServerResponse,
) => Promise<void> | void;

export type Method =
  | "ALL"
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export type Route = {
  get: (callback: EndpointCallback, endpointOptions?: EndpointOptions) => Route;
  patch: (
    callback: EndpointCallback,
    endpointOptions?: EndpointOptions,
  ) => Route;
  post: (
    callback: EndpointCallback,
    endpointOptions?: EndpointOptions,
  ) => Route;
  put: (callback: EndpointCallback, endpointOptions?: EndpointOptions) => Route;
  del: (callback: EndpointCallback, endpointOptions?: EndpointOptions) => Route;
  all: (callback: EndpointCallback, endpointOptions?: EndpointOptions) => Route;
};

export type RouterNotFoundHandler = (
  req: ServerRequest,
  res: ServerResponse,
) => Promise<void>;

export type RouterConfig = {
  useNotFoundHandler?: boolean;
  notFoundHandler?: RouterNotFoundHandler;

  minCompressionSize?: number;
};

type MethodListElement = {
  match: RouterMatchFunc;
  callback: EndpointCallback;

  middlewareList: Middleware[];
  sseServerOptions?: SseServerOptions;
  etag: boolean;
};

// Misc here
const defaultNotFoundHandler: RouterNotFoundHandler = async (
  _: ServerRequest,
  res: ServerResponse,
) => {
  res.statusCode = 404;
  res.write("API route not found");
  res.end();
};

// Router class here
export class Router {
  private _basePathDelimited: string;
  private _basePath: string;
  private _useNotFoundHandler: boolean;
  private _notFoundHandler: RouterNotFoundHandler;
  private _minCompressionSize: number;

  private _logger: Logger;
  private _methodListMap: Record<Method, MethodListElement[]>;
  private _defaultMiddlewareList: Middleware[];

  constructor(basePath: string, config: RouterConfig = {}) {
    // Make sure to properly delimit the basePath
    this._basePathDelimited = basePath.replace(/\/*$/, "/");
    // Make sure to strip off the trailing slashes
    this._basePath = basePath.replace(/\/*$/, "");

    this._useNotFoundHandler = config.useNotFoundHandler ?? true;
    this._notFoundHandler = config.notFoundHandler ?? defaultNotFoundHandler;
    this._minCompressionSize = config.minCompressionSize ?? 1024;

    this._logger = new Logger(`Router (${this._basePath})`);

    // Initialise the method list manually
    this._methodListMap = {
      ALL: [],
      GET: [],
      DELETE: [],
      PATCH: [],
      POST: [],
      PUT: [],
      OPTIONS: [],
      HEAD: [],
    };

    this._defaultMiddlewareList = [];
  }

  // Getter methods here
  get basePath(): string {
    return this._basePathDelimited;
  }

  // Private methods here
  private searchMethodElements(
    req: ServerRequest,
    list: MethodListElement[],
  ): MethodListElement | null {
    let matchedEl: MethodListElement | null = null;

    // Next see if we have a registered callback for the HTTP req path
    for (let el of list) {
      let routerMatch = el.match(req.urlObj);

      // If result is false that means we found nothing
      if (routerMatch === false) {
        continue;
      }

      // If we are here we found the callback
      matchedEl = el;

      // Don't forget to set the matchedInfo and params properties
      req.matchedInfo = routerMatch.matchedInfo;
      req.params = routerMatch.params;

      // Stop looking
      break;
    }

    return matchedEl;
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

    // If the method is HEAD then check the GET method map
    if (req.method === "HEAD") {
      method = "GET";
    }

    // Make sure we don't have some odd method we never heard about
    let list = this._methodListMap[method];
    if (list === undefined) {
      return null;
    }

    // First search for the routes in the req method list
    let matchedEl = this.searchMethodElements(req, list);

    if (matchedEl === null) {
      // If we are here that means we did not find a callback for the req path
      // and we should check for a fallback callback
      matchedEl = this.searchMethodElements(req, this._methodListMap["ALL"]);
    }

    return matchedEl;
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

  private async addResponse(
    req: ServerRequest,
    res: ServerResponse,
    etag: boolean,
  ): Promise<void> {
    let body: string | Buffer | null = null;

    // Check if a json or a body response has been passed back
    if (res.json !== undefined) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      body = JSON.stringify(res.json);
    } else if (res.body !== undefined) {
      // Check if the content-type has not been set
      if (!res.hasHeader("Content-Type")) {
        // It hasn't so set it to the default type
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
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
      res.setServerTimingHeader();

      // Nothing else to do including calculating and etag so get out of here
      return;
    }

    // We need to ensure body is a string or a Buffer or we will have problems
    if (Buffer.isBuffer(body) === false && typeof body !== "string") {
      this._logger.error(
        "(%s) response body for (%s) is not of type string or Buffer",
        req.method,
        req.urlObj.pathname,
      );

      res.statusCode = 500;
      res.end();
      return;
    }

    // Check if the user wants an etag added to the response
    if (etag) {
      let etag = crypto.createHash("sha1").update(body).digest("hex");

      // All headers need to be set, except content-length, for a 304
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Etag", etag);

      // Check if any cache validators exist on the request
      if (req.headers["if-none-match"] === etag) {
        // Don't forget to set the server-timing header after we do everything else
        res.setServerTimingHeader();

        res.statusCode = 304;
        res.end();
        return;
      }
    }

    // Check out if the req will accept a gzip res AND the body is large enough
    // AND compression is not turned off for this request
    let gzipIt = false;

    if (
      req.headers["accept-encoding"]?.includes("gzip") === true &&
      Buffer.byteLength(body) >= this._minCompressionSize &&
      req.dontCompressResponse === false
    ) {
      // It does ...
      gzipIt = true;

      // Dont set the content-length. Use transfer-encoding instead
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Content-Encoding", "gzip");
    } else {
      // It does not ...

      // Only set the length when we don't do a 304
      res.setHeader("Content-Length", Buffer.byteLength(body));
    }

    // Don't forget to set the server-timing header after we do everything else
    res.setServerTimingHeader();

    // Check if this was a HEAD method - if so we don't want to write the body
    if (req.method !== "HEAD") {
      if (gzipIt) {
        const passThrough = new PassThrough();
        passThrough.end(body);
        // NOTE1: pipeline will close the res when it is finished
        await streams
          .pipeline(passThrough, zlib.createGzip(), res)
          .catch((e) => {
            this._logger.error(
              "addResponse had this error during streaming: (%s)",
              e,
            );
            throw new HttpError(500, "Internal Server Error");
          });
      } else {
        res.write(body);
      }
    }

    res.end();
  }

  // Public methods here
  inPath(pathname: string): boolean {
    // Make sure to use the delimited base path to ensure a correct match
    return pathname.startsWith(this._basePathDelimited);
  }

  async handleReq(req: ServerRequest, res: ServerResponse): Promise<boolean> {
    // See if this request matches a registered endpoint
    let matchedEl = this.findEndpoint(req);
    if (matchedEl === null) {
      // Check if we should use the supplied Not Found handler or not
      if (this._useNotFoundHandler) {
        await this._notFoundHandler(req, res);
        return true;
      }

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

      // If a redirect call res.redirect() and get out of the error handler
      if (e instanceof HttpRedirect) {
        res.redirect(e.location, e.statusCode, e.message);
        return;
      }

      // If it is a HttpError assume the error message has already been logged
      if (e instanceof HttpError) {
        res.statusCode = e.status;
        message = e.message;
      } else {
        // We don't know what this is so log it and make sure to return a 500
        this._logger.error(
          "Unknown error happened while handling URL (%s) - (%s)",
          req.urlObj.pathname,
          e,
        );

        res.statusCode = 500;
        message = "Unknown error happened";
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(message));
      res.write(message);
      res.end();
    });

    // If there is an SSE server dont call addResponse or res.end()
    if (req.sseServer !== undefined) {
      return true;
    }

    // Check if res.write() has NOT been called yet
    if (!res.headersSent) {
      // Check if the callback wants us to add the body, headers etc
      await this.addResponse(req, res, matchedEl.etag);
    }

    // Check if the res.end() has NOT been called yet
    if (!res.writableEnded) {
      // End the response now
      res.end();
    }

    // Flag this req has been handled
    return true;
  }

  pathToRegexMatch(path: string): RouterMatchFunc {
    // Then create the matching function
    let match = PathToRegEx.match(path, {
      decode: decodeURIComponent,
      strict: true,
    });

    return (url: URL): RouterMatch | false => {
      let result = match(url.pathname);

      if (result === false) {
        return false;
      }

      return {
        params: result.params as Record<string, string>,
        matchedInfo: result,
      };
    };
  }

  use(middleware: Middleware): Router {
    this._defaultMiddlewareList.push(middleware);

    return this;
  }

  endpoint(
    method: Method,
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ): Router {
    let options = {
      useDefaultMiddlewares: true,
      etag: false,
      generateMatcher: this.pathToRegexMatch,

      ...endpointOptions,
    };

    // Make sure we have the middlewares requested
    let middlewareList: Middleware[] = [];

    // Check if the user wants the default middlewares
    if (options.useDefaultMiddlewares) {
      // ... stick the default middlewares in first
      // NOTE: Any middleware added to the defaults after this endpoint is
      // added will not be used by this endpoint
      middlewareList = [...this._defaultMiddlewareList];
    }

    if (options.middlewareList !== undefined) {
      middlewareList = [...middlewareList, ...options.middlewareList];
    }

    // GEt the full path - check if the path already includes the basePath
    let fullPath = this.inPath(path) ? path : `${this._basePath}${path}`;

    // Finally add it to the list of callbacks
    this._methodListMap[method].push({
      match: options.generateMatcher(fullPath),
      callback,
      middlewareList,
      sseServerOptions: options.sseServerOptions,
      etag: options.etag,
    });

    this._logger.startupMsg(
      "Added %s endpoint for path (%s)",
      method.toUpperCase(),
      fullPath,
    );

    return this;
  }

  // endpoint helper methods here
  del(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ): Router {
    this.endpoint("DELETE", path, callback, endpointOptions);
    return this;
  }

  get(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ): Router {
    this.endpoint("GET", path, callback, endpointOptions);
    return this;
  }

  patch(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ): Router {
    this.endpoint("PATCH", path, callback, endpointOptions);
    return this;
  }

  post(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ): Router {
    this.endpoint("POST", path, callback, endpointOptions);
    return this;
  }

  put(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ): Router {
    this.endpoint("PUT", path, callback, endpointOptions);
    return this;
  }

  all(
    path: string,
    callback: EndpointCallback,
    endpointOptions: EndpointOptions = {},
  ): Router {
    this.endpoint("ALL", path, callback, endpointOptions);
    return this;
  }

  route(path: string): Route {
    let server = this;

    return {
      get(
        callback: EndpointCallback,
        endpointOptions: EndpointOptions = {},
      ): Route {
        server.endpoint("GET", path, callback, endpointOptions);
        return server.route(path);
      },

      patch(
        callback: EndpointCallback,
        endpointOptions: EndpointOptions = {},
      ): Route {
        server.endpoint("PATCH", path, callback, endpointOptions);
        return server.route(path);
      },

      post(
        callback: EndpointCallback,
        endpointOptions: EndpointOptions = {},
      ): Route {
        server.endpoint("POST", path, callback, endpointOptions);
        return server.route(path);
      },

      put(
        callback: EndpointCallback,
        endpointOptions: EndpointOptions = {},
      ): Route {
        server.endpoint("PUT", path, callback, endpointOptions);
        return server.route(path);
      },

      del(
        callback: EndpointCallback,
        endpointOptions: EndpointOptions = {},
      ): Route {
        server.endpoint("DELETE", path, callback, endpointOptions);
        return server.route(path);
      },

      all(
        callback: EndpointCallback,
        endpointOptions: EndpointOptions = {},
      ): Route {
        server.endpoint("ALL", path, callback, endpointOptions);
        return server.route(path);
      },
    };
  }

  // Middleware methods here
  static body(options: { maxBodySize?: number } = {}): Middleware {
    // Rem we have to call bodyMiddleware since it returns the middleware
    return bodyMiddleware(options);
  }

  static json(): Middleware {
    return jsonMiddleware();
  }

  static cors(options: CorsOptions = {}): Middleware {
    return corsMiddleware(options);
  }

  static csrf(options: CsrfChecksOptions = {}): Middleware {
    return csrfChecksMiddleware(options);
  }

  static getSecHeaders(
    options: SecurityHeadersOptions,
  ): { name: string; value: string }[] {
    return getSecurityHeaders(options);
  }

  static secHeaders(options: SecurityHeadersOptions): Middleware {
    return securityHeadersMiddleware(options);
  }

  static expressWrapper(options: ExpressMiddleware): Middleware {
    return expressWrapper(options);
  }

  static dontCompressResponse(): Middleware {
    return dontCompressResponse();
  }
}

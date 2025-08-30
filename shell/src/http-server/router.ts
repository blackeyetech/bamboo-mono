// imports here
import { Logger } from "../logger.js";

import { SseServer, SseServerOptions } from "./sse-server.js";
import {
  ServerRequest,
  ServerResponse,
  HttpError,
  HttpRedirect,
  WebRequest,
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
  setLatencyMetricName,
} from "./middleware.js";

import { contentTypes } from "./content-types.js";

import * as PathToRegEx from "path-to-regexp";

import * as path from "node:path";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import * as stream from "node:stream";
import * as streams from "node:stream/promises";

// Types here
export type HealthcheckCallback = () => Promise<boolean>;

export type RouterMatch = {
  params: Record<string, string>;

  matchedInfo: any;
};

export type RouterMatchFunc = (url: URL) => RouterMatch | false;
export type SsrRenderFunc = (webReq: WebRequest) => Promise<Response>;

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

export type RouterConfig = {
  minCompressionSize?: number;
  defaultCharSet?: string;
};

type MethodListElement = {
  match: RouterMatchFunc;
  callback: EndpointCallback;

  middlewareList: Middleware[];
  sseServerOptions?: SseServerOptions;
  etag: boolean;
};

// Router class here
export class Router {
  private _basePathDelimited: string;
  private _basePath: string;
  private _minCompressionSize: number;
  private _defaultCharSet: string;

  private _logger: Logger;
  private _methodListMap: Record<Method, MethodListElement[]>;
  private _defaultMiddlewareList: Middleware[];

  constructor(basePath: string, config: RouterConfig = {}) {
    // Make sure to properly delimit the basePath
    this._basePathDelimited = basePath.replace(/\/*$/, "/");
    // Make sure to strip off the trailing slashes
    this._basePath = basePath.replace(/\/*$/, "");

    this._minCompressionSize = config.minCompressionSize ?? 1024;
    this._defaultCharSet = config.defaultCharSet ?? "charset=utf-8";

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

  private hasNoBody(res: ServerResponse): boolean {
    // Check if the json prop has been set
    // NOTE: If the user sets the json AND body prop the json prop will be used
    if (res.json !== undefined) {
      // Convert the json to a string and assign it as the body
      res.body = JSON.stringify(res.json);
      // Set correct content-type for a json payload
      res.setHeader("Content-Type", "application/json; charset=utf-8");

      return false;
    }

    // Check if the body has NOT been set
    if (res.body === undefined) {
      // There is no body which means we should set the statusCode to 204.
      // However, the user may have set it and if they have then leave it alone
      // We can tell if the user has NOT changed it because the statusCode will
      // be the default value 200
      if (res.statusCode === 200) {
        // Statuscode has not been changed so set it to the correct value of 204
        res.statusCode = 204;
      } else {
        // Explcitily set the content-length to be 0, because there is no body
        res.setHeader("Content-Length", 0);
      }

      // Don't forget to set the server-timing header
      res.setServerTimingHeader();

      return true;
    }

    // We know there is a body so make sure the body is a string or a Buffer
    if (Buffer.isBuffer(res.body) || typeof res.body === "string") {
      // Check if the content-type has NOT been set
      if (!res.hasHeader("Content-Type")) {
        // It hasnt so set the default type
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
      }

      return false;
    }

    // If we are here the body has been set but it is not valid
    this._logger.error(
      "(%s) response body for (%s) is not of type string or Buffer",
      res.enhancedReq.method,
      res.enhancedReq.urlObj.pathname,
    );

    res.statusCode = 500;
    return true;
  }

  private bodyNotModified(res: ServerResponse): boolean {
    // If we are here the body exists, so to keep the compiler happy do this
    const body = res.body as string | Buffer<ArrayBufferLike>;

    // Calcuate the etag
    const etag = crypto.createHash("sha1").update(body).digest("hex");

    // Do not set content-length header for a 304
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Etag", etag);

    // Check for cache validators on the request and see if the etag changed
    if (res.enhancedReq.headers["if-none-match"] === etag) {
      // Don't forget to set the server-timing header
      res.setServerTimingHeader();

      res.statusCode = 304;
      return true;
    }

    // If we are here the body was modified
    return false;
  }

  private lookupType(file: string): string {
    // Look up the file extension to get content type - drop the leading '.'
    const ext = path.extname(file).slice(1);
    const type = contentTypes[ext];

    if (type !== undefined) {
      return `${type}; ${this._defaultCharSet}`;
    }

    // This is the default content type
    return `text/plain; ${this._defaultCharSet}`;
  }

  private async streamRes(res: ServerResponse): Promise<void> {
    const streamRes = res.streamRes as {
      body: stream.Readable;
      fileName?: string;
    };

    // Check if this is a file
    if (streamRes.fileName !== undefined) {
      // Set headers that will allow the fiel to be downloaded by the browser
      res.setHeader("Content-Type", this.lookupType(streamRes.fileName));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${streamRes.fileName}"`,
      );
    }

    // Do not worry about the content-length, always use chunked encoding
    res.setHeader("Transfer-Encoding", "chunked");

    // Check if the req will accept a gzip res AND
    // compression is turned on for this request
    if (
      res.enhancedReq.headers["accept-encoding"]?.includes("gzip") === true &&
      res.enhancedReq.compressResponse
    ) {
      // Set the correct headers for a gzipped body
      res.setHeader("Content-Encoding", "gzip");

      // Only send the body if this is NOT a HEAD request
      if (res.enhancedReq.method !== "HEAD") {
        await pipeline(streamRes.body, zlib.createGzip(), res).catch((e) => {
          this._logger.error("Error during streaming: (%s)", e);
        });
      }
    } else {
      // Only send the body if this is NOT a HEAD request
      if (res.enhancedReq.method !== "HEAD") {
        await pipeline(streamRes.body, res).catch((e) => {
          this._logger.error("Error during streaming: (%s)", e);
        });
      }
    }
  }

  private async addResponseBody(
    req: ServerRequest,
    res: ServerResponse,
    etag: boolean,
  ): Promise<void> {
    // Check if the response should be streamed
    if (res.streamRes !== undefined) {
      await this.streamRes(res);
      return;
    }

    // Check if there is no body to send
    if (this.hasNoBody(res)) {
      // There is no body so no more to do here
      return;
    }

    // If we are here the body exists, so to keep the compiler happy do this
    const body = res.body as string | Buffer<ArrayBufferLike>;

    // Check if we are using etags res AND if the body has NOT changed
    if (etag && this.bodyNotModified(res)) {
      // Body is the same so no more to do here
      return;
    }

    // Don't forget to set the server-timing header
    res.setServerTimingHeader();

    // Check if the req will accept a gzip res AND
    // the body is large enough AND
    // compression is turned on for this request
    if (
      req.headers["accept-encoding"]?.includes("gzip") === true &&
      Buffer.byteLength(body) >= this._minCompressionSize &&
      req.compressResponse
    ) {
      // Set the correct headers for a gzipped body
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Content-Encoding", "gzip");

      // Only send the body if this is NOT a HEAD request
      if (req.method !== "HEAD") {
        const passThrough = new stream.PassThrough();
        passThrough.end(body);

        // NOTE1: pipeline will close the res when it is finished
        await pipeline(passThrough, zlib.createGzip(), res).catch((e) => {
          // We can't do anything else here because either:
          // - the stream is closed which means we can't send back an error
          // - we have an internal error, but we have already started streaming
          //   so we can't do anything
          this._logger.error(
            "addResponse had this error during streaming: (%s)",
            e,
          );
        });
      }
    } else {
      // Set the corect content-length
      res.setHeader("Content-Length", Buffer.byteLength(body));

      // Only send the body if this is NOT a HEAD request
      if (req.method !== "HEAD") {
        res.write(body);
      }
    }
  }

  // Public methods here
  inPath(pathname: string): boolean {
    // Make sure to use the delimited base path to ensure a correct match
    return pathname.startsWith(this._basePathDelimited);
  }

  async handleReq(req: ServerRequest, res: ServerResponse): Promise<void> {
    // See if this request matches a registered endpoint
    let matchedEl = this.findEndpoint(req);
    if (matchedEl === null) {
      // Couldn't find a match so return with the req not been handled
      return;
    }

    // We found it so mark this as handled before we do anything else
    req.handled = true;

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

      // Check if res.write() has NOT been called yet
      if (!res.headersSent) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Length", Buffer.byteLength(message));
        res.write(message);
      }

      // Check if the res.end() has NOT been called yet
      if (!res.writableEnded) {
        // End the response now
        res.end();
      }
    });

    // If this is an SSE server dont call addResponse or res.end()
    if (req.sseServer !== undefined) {
      return;
    }

    // Check if res.write() has NOT been called yet
    if (!res.headersSent) {
      // Check if there is a body to add
      await this.addResponseBody(req, res, matchedEl.etag);
    }

    // Check if the res.end() has NOT been called yet
    if (!res.writableEnded) {
      // End the response now
      res.end();
    }
  }

  static pathToRegexMatcher(path: string): RouterMatchFunc {
    // Create the matching function
    let match = PathToRegEx.match(path, {
      decode: decodeURIComponent,
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

  static matchAllMatcher(_: string): RouterMatchFunc {
    // This will match everything
    return (url: URL): RouterMatch => {
      return {
        matchedInfo: url.pathname,
        params: {}, // We dont know that the params are so just ignore them
      };
    };
  }

  use(middleware: Middleware): Router {
    this._defaultMiddlewareList.push(middleware);

    return this;
  }

  getSsrEndpoint(render: SsrRenderFunc): EndpointCallback {
    return async (req: ServerRequest, res: ServerResponse): Promise<void> => {
      // Measure the time it took to render the page so capture when we started
      const startedAt = performance.now();

      // Create a webRequest object to pass to the render
      const webReq = new WebRequest(req, res);

      // Now render the page
      const webRes = await render(webReq);

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
            this._logger.warn(
              "ssrEndpoint had this error during rendering: (%s)",
              e,
            );
          });
      }
    };
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
      generateMatcher: Router.pathToRegexMatcher,

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

  static setLatencyMetricName(name: string): Middleware {
    return setLatencyMetricName(name);
  }
}

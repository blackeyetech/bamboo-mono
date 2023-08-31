// imports here
import { SseServer } from "./sse-server.js";

import * as http from "node:http";

// Types here
export interface ServerResponse extends http.ServerResponse {
  json?: object | [] | string | number | boolean;
  body?: string | Buffer;
  serverTimingsMetrics: { name: string; duration: number }[];
}

export interface ServerRequest extends http.IncomingMessage {
  urlObject: URL;
  params: Record<string, any>;
  middlewareProps: Record<string, any>;

  receiveTime: number;

  sseServer?: SseServer;
  json?: any;
  body?: Buffer;
}

export type Middleware = (
  req: ServerRequest,
  res: ServerResponse,
  next: () => Promise<void>,
) => Promise<void>;

export type ExpressMiddleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (e?: any) => void,
) => void;

export type CorsOptions = {
  originsAllowed?: "*" | string[];
  headersAllowed?: "*" | string[];
  headersExposed?: string[];
  methodsAllowed?: string[];
  credentialsAllowed?: boolean;
  maxAge?: number;
};

// Utility functions here

export const setServerTimingHeader = (
  res: ServerResponse,
  receiveTime: number,
) => {
  // Set the total latency first
  let lat = Math.round((performance.now() - receiveTime) * 1000) / 1000;
  let timing = `latency;dur=${lat}`;

  // Then add each additional metric added to the res
  for (let metric of res.serverTimingsMetrics) {
    timing += `, ${metric.name};dur=${metric.duration}`;
  }

  res.setHeader("server-timing", timing);
};

// Middleware functions here
export const jsonMiddleware = async (
  req: ServerRequest,
  res: ServerResponse,
  next: () => Promise<void>,
): Promise<void> => {
  // Before we do anything make sure there is a body!
  let body: Buffer | undefined;

  if (Buffer.isBuffer(req.body)) {
    body = req.body;
  }

  if (body === undefined || body.length === 0) {
    // No body to parse so call next middleware and then return
    await next();
    return;
  }

  let jsonBody: any;
  let parseOk = true;
  let errMessage = "";

  // Now check the content-type header to find out what sort of data we have
  const contentTypeHeader = req.headers["content-type"];

  if (contentTypeHeader !== undefined) {
    let contentType = contentTypeHeader.split(";")[0];

    switch (contentType) {
      case "application/json":
        try {
          jsonBody = JSON.parse(body.toString());
        } catch (_) {
          // Set the error message you want to return
          errMessage = "Can not parse JSON body!";

          parseOk = false;
        }
        break;
      case "application/x-www-form-urlencoded":
        let qry = new URLSearchParams(body.toString());
        jsonBody = {};

        for (let [key, value] of qry.entries()) {
          jsonBody[key] = value;
        }
        break;
      default:
        break;
    }
  }

  // If the parsing failed then return an error
  if (!parseOk) {
    res.statusCode = 400;
    res.write(errMessage);
    res.end();

    return;
  }

  req.json = jsonBody;
  await next();
};

export const bodyMiddleware = (
  options: { maxBodySize?: number } = {},
): Middleware => {
  // Because we need to pass in options we will return the middleware,
  // i.e. you need to call this function
  let opts = {
    maxBodySize: 1024 * 1024,
    ...options,
  };

  return (
    // NOTE: No async here please since this is returning a Promise
    req: ServerRequest,
    res: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    // We need to wait until res "end" event occurs and then call next()
    // The best way is to use a Promise
    return new Promise((resolve, reject) => {
      // Store each data "chunk" we receive this array
      let chunks: Buffer[] = [];
      let bodySize = 0;

      // This event fires when there is a chunk of the body received
      req.on("data", (chunk: Buffer) => {
        bodySize += chunk.byteLength;

        if (bodySize >= opts.maxBodySize) {
          // The body is too big so flag to user and remvoe all of the listeners
          res.statusCode = 400;
          res.write(`Body length greater than ${opts.maxBodySize} bytes`);
          res.end();

          // May be overkill but do it anyway
          req.removeAllListeners("data");
          req.removeAllListeners("end");
        } else {
          chunks.push(chunk);
        }
      });

      // This event fires when we have received all of the body
      req.on("end", async () => {
        // Set the body in the req for the callback
        req.body = Buffer.concat(chunks);

        // Now we can wait for the rest of the middleware to run
        await next().catch((e) => {
          // Pass the error back up
          reject(e);
        });

        // This will allow the middleware stack to finish unwinding
        resolve();
      });
    });
  };
};

export const corsMiddleware = (options: CorsOptions = {}): Middleware => {
  // Because we need to pass in options we will return the middleware,
  // i.e. you need to call this function
  let opts: CorsOptions = {
    // Defaults first
    originsAllowed: "*",
    headersAllowed: "*",
    headersExposed: [],
    methodsAllowed: ["GET", "PUT", "POST", "DELETE", "PATCH"],
    credentialsAllowed: false,
    maxAge: 86400,

    ...options,
  };

  return async (
    req: ServerRequest,
    res: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    let origin = req.headers["origin"];

    // Check if this is a CORS preflight request
    if (req.method === "OPTIONS") {
      // The origin MUST be available or this is not valid
      if (origin === undefined) {
        res.statusCode = 400;
        res.end();
        return;
      }

      // Access-Control-Allow-Origin
      if (
        opts.originsAllowed === "*" ||
        opts.originsAllowed?.includes(origin)
      ) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }

      // Access-Control-Allow-Headers
      let reqHeaders = req.headers["access-control-request-headers"];

      if (reqHeaders !== undefined) {
        // If we allow any header then return the headers sent by client
        if (opts.headersAllowed === "*") {
          res.setHeader("Access-Control-Allow-Headers", reqHeaders);
        } else if (opts.headersAllowed !== undefined) {
          res.setHeader(
            "Access-Control-Allow-Headers",
            opts.headersAllowed.join(","),
          );
        }
      }

      // Access-Control-Expose-Headers
      if (opts.headersExposed !== undefined && opts.headersExposed.length) {
        res.setHeader(
          "Access-Control-Expose-Headers",
          opts.headersExposed.join(","),
        );
      }

      // Access-Control-Allow-Methods
      if (opts.methodsAllowed !== undefined) {
        res.setHeader(
          "Access-Control-Allow-Methods",
          opts.methodsAllowed.join(","),
        );
      }

      // Access-Control-Max-Age
      if (opts.maxAge !== undefined) {
        res.setHeader("Access-Control-Max-Age", opts.maxAge);
      }

      // Access-Control-Allow-Credentials
      if (opts.credentialsAllowed) {
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }

      // Finish up here and do not continue down the middleware stack
      res.statusCode = 204;
      res.end();

      return;
    }

    // If we are here this was not a preflight request
    // The origin needs to be available or we can't set the CORS headers
    if (origin !== undefined) {
      if (opts.credentialsAllowed === true) {
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }

      if (
        opts.originsAllowed === "*" ||
        opts.originsAllowed?.includes(origin)
      ) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
    }

    // If we are here we do want to continue down the middleware stack
    await next();
  };
};

export const expressWrapper = (middleware: ExpressMiddleware): Middleware => {
  // Because we need to pass in the express middleware we will return the
  // middleware, i.e. you need to call this function s
  return async (
    req: ServerRequest,
    res: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    middleware(req, res, (e?: unknown) => {
      if (e !== undefined) {
        throw e;
      }
    });

    await next();
  };
};

// Imports here
import { HttpError, ServerRequest, ServerResponse } from "./req-res.js";

import * as http from "node:http";

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

export type CsrfChecksOptions = {
  checkType?: "custom-req-header" | "naive-double-submit-cookie";
  header?: string;
  cookie?: string;
};

export type SecurityHeadersOptions = {
  headers: { name: string; value: string }[];
};

// Middleware functions here
export const jsonMiddleware = async (
  req: ServerRequest,
  _: ServerResponse,
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
    throw new HttpError(400, errMessage);
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

  return async (
    // NOTE: No async here please since this is returning a Promise
    req: ServerRequest,
    _: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    // Cehck if body has already been set
    if (req.body !== undefined) {
      // If so just continue down the middleware stack
      await next();
      return;
    }

    // Store each data "chunk" we receive this array
    let chunks: Buffer[] = [];
    let bodySize = 0;

    // Iterate of the req's AsyncIterator
    for await (let chunk of req) {
      bodySize += chunk.byteLength;

      // Check if the body is larger then the user is allowing
      if (bodySize >= opts.maxBodySize) {
        let msg = `Body length greater than ${opts.maxBodySize} bytes`;
        throw new HttpError(400, msg);
      }

      chunks.push(chunk);
    }

    req.body = Buffer.concat(chunks);
    await next();
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
        throw new HttpError(400);
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
  // middleware, i.e. you need to call this function
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

export const csrfChecksMiddleware = (
  options: CsrfChecksOptions = {},
): Middleware => {
  let opts = {
    checkType: "custom-req-header",
    header: "x-csrf-header",

    ...options,
  };

  // Need to make sure the header we check for is always lower case
  opts.header = opts.header.toLowerCase();

  // If this is "naive-double-submit-cookie" check the cookie is supplied
  if (opts.checkType === "naive-double-submit-cookie") {
    if (opts.cookie === undefined) {
      throw new Error(
        "Must set cookie to use the 'naive-double-submit-cookie' csrf check",
      );
    }
  }

  // Because we need to pass in the options we will return the
  // middleware, i.e. you need to call this function
  return async (
    req: ServerRequest,
    res: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    let failed = false;

    if (opts.checkType === "custom-req-header") {
      // The custom-req-header check just ensures that the specified
      // header exists - the value is not important
      if (req.headers[opts.header] === undefined) {
        failed = true;
      }
    } else {
      // The naive-double-submit-cookie check ensures the value of the
      // specified cookie matches the value of the specified header
      let value = req.getCookie(opts.cookie as string);
      if (req.headers[opts.header] !== value) {
        failed = true;
      }
    }

    // If the CSRF check failed then DO NOT continue down the stack
    if (failed) {
      res.statusCode = 401;
      res.write("The request failed the CSRF check");
      return;
    }

    await next();
  };
};

export const securityHeadersMiddleware = (
  options: SecurityHeadersOptions,
): Middleware => {
  // Because we need to pass in the options we will return the
  // middleware, i.e. you need to call this function
  return async (
    _: ServerRequest,
    res: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    let defaultHeaders: { name: string; value: string }[] = [
      { name: "X-Frame-Options", value: "SAMEORIGIN" },
      { name: "X-XSS-Protection", value: "0" },
      { name: "X-Content-Type-Options", value: "nosniff" },
      { name: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        name: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      { name: "X-DNS-Prefetch-Control", value: "off" },
      {
        name: "Content-Security-Policy",
        value:
          "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
      },
    ];

    // Set all of the user supplied headers first
    for (let header of options.headers) {
      res.setHeader(header.name, header.value);
    }

    // Now step through all of the defaul headers
    for (let header of defaultHeaders) {
      // Check if the user has already supplied the header (use lower case
      // to be safe)
      let found = options.headers.find(
        (el) => el.name.toLowerCase() === header.name.toLowerCase(),
      );

      if (found === undefined) {
        res.setHeader(header.name, header.value);
      }
    }

    await next();
  };
};

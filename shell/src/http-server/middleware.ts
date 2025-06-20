// Imports here
import { HttpError, ServerRequest, ServerResponse } from "./req-res.js";

import * as http from "node:http";
import * as crypto from "node:crypto";

export type Middleware = (
  req: ServerRequest,
  res: ServerResponse,
  next: () => Promise<void>,
) => Promise<void>;

export type BodyOptions = {
  maxBodySize?: number;
};

export type ExpressMiddleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (e?: any) => void,
) => void;

export type MiddlewareMethods = "GET" | "PUT" | "POST" | "DELETE" | "PATCH";

export type CorsOptions = {
  // Origins allowed
  originsAllowed?: "*" | string[];
  // Methods allowed
  methodsAllowed?: "*" | MiddlewareMethods[];
  // Headers allowed by the browser to be sent on the req
  headersAllowed?: "*" | string[];
  // Headers that the browser can expose on the res
  headersExposed?: "*" | string[];
  // Flag to indicate if you can send credential headers
  credentialsAllowed?: boolean;
  // Max age of the CORS preflight request in seconds
  maxAge?: number;
};

export type CsrfChecksOptions = {
  methods?: MiddlewareMethods[];
  checkType?:
    | "custom-req-header"
    | "naive-double-submit-cookie"
    | "signed-double-submit-cookie";
  header?: string;
  cookie?: string;
  secret?: string;
  hashAlgo?: string;
  signatureSeparator?: string;
};

export type SecurityHeadersOptions = {
  headers?: { name: string; value: string }[];
  useDefaultHeaders?: boolean;
};

// Middleware functions here
export const jsonMiddleware = (): Middleware => {
  return async (
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

    let parseOk = true;
    let errMessage = "";

    // Now check the content-type header to find out what sort of data we have
    const contentTypeHeader = req.headers["content-type"];

    if (contentTypeHeader !== undefined) {
      let contentType = contentTypeHeader.split(";")[0];

      switch (contentType) {
        case "application/json":
          try {
            req.json = JSON.parse(body.toString());
          } catch (_) {
            // Set the error message you want to return
            errMessage = "Can not parse JSON body!";

            parseOk = false;
          }
          break;
        case "application/x-www-form-urlencoded":
          let qry = new URLSearchParams(body.toString());
          let jsonBody: Record<string, any> = {};

          for (let [key, value] of qry.entries()) {
            jsonBody[key] = value;
          }

          req.json = jsonBody;
          break;
        default:
          break;
      }
    }

    // If the parsing failed then return an error
    if (!parseOk) {
      throw new HttpError(400, errMessage);
    }

    await next();
  };
};

export const bodyMiddleware = (options: BodyOptions = {}): Middleware => {
  let opts: Required<BodyOptions> = {
    maxBodySize: options.maxBodySize ?? 1024 * 1024,
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
  let opts: Required<CorsOptions> = {
    originsAllowed: options.originsAllowed ?? "*",
    methodsAllowed: options.methodsAllowed ?? [],
    headersAllowed: options.headersAllowed ?? [],
    headersExposed: options.headersExposed ?? [],

    credentialsAllowed: options.credentialsAllowed ?? false,
    maxAge: options.maxAge ?? 60 * 60, // 1 hour
  };

  // NOTE: If credentialsAllowed is enabled then other headers cant be a "*"
  if (opts.credentialsAllowed) {
    if (opts.originsAllowed === "*") {
      throw new Error(
        "The originsAllowed MUST be specified when credentialsAllowed is true",
      );
    }
    if (opts.methodsAllowed === "*") {
      throw new Error(
        "The methodsAllowed MUST be specified when credentialsAllowed is true",
      );
    }
    if (opts.headersAllowed === "*") {
      throw new Error(
        "The headersAllowed MUST be specified when credentialsAllowed is true",
      );
    }
    if (opts.headersExposed === "*") {
      throw new Error(
        "The headersExposed MUST be specified when credentialsAllowed is true",
      );
    }
  }

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
        throw new HttpError(400, "No origin header sent with the CORS request");
      }

      // Set Access-Control-Allow-Origin
      if (opts.originsAllowed === "*" || opts.originsAllowed.includes(origin)) {
        // Best to set this to the origin for this req and NOT allowed origins
        res.setHeader("Access-Control-Allow-Origin", origin);
      } else {
        throw new HttpError(400, `The origin ${origin} is not allowed`);
      }

      // Set Access-Control-Allow-Methods
      // We know this header exists otherwise we couldn't have gotten here
      let reqMethod = req.headers[
        "access-control-request-method"
      ] as MiddlewareMethods;

      if (opts.methodsAllowed === "*") {
        res.setHeader("Access-Control-Allow-Methods", "*");
      } else if (opts.methodsAllowed.length === 0) {
        // No methods being specified implies you should use the reqMethod
        res.setHeader("Access-Control-Allow-Methods", reqMethod);
      } else if (opts.methodsAllowed.includes(reqMethod)) {
        res.setHeader(
          "Access-Control-Allow-Methods",
          opts.methodsAllowed.join(","),
        );
      } else {
        throw new HttpError(
          400,
          `The access-control-request-method ${reqMethod} is not allowed`,
        );
      }

      // Set Access-Control-Allow-Headers
      if (req.headers["access-control-request-headers"] !== undefined) {
        if (opts.headersAllowed === "*") {
          res.setHeader("Access-Control-Allow-Headers", "*");
        } else if (opts.headersAllowed.length) {
          // Let the browser handle this one
          res.setHeader(
            "Access-Control-Allow-Headers",
            opts.headersAllowed.join(","),
          );
        }
      }

      // Set Access-Control-Expose-Headers
      if (opts.headersExposed === "*") {
        res.setHeader("Access-Control-Expose-Headers", "*");
      } else if (opts.headersExposed.length) {
        res.setHeader(
          "Access-Control-Expose-Headers",
          opts.headersExposed.join(","),
        );
      }

      // Access-Control-Max-Age
      res.setHeader("Access-Control-Max-Age", opts.maxAge);

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
    // The origin needs to be available or we shouldn't set the CORS headers
    if (origin !== undefined) {
      if (opts.credentialsAllowed) {
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }

      if (opts.originsAllowed === "*" || opts.originsAllowed.includes(origin)) {
        // Best to set this to the origin for this req and NOT allowed origins
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
    }

    // If we are here then continue down the middleware stack
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
  let opts: Required<CsrfChecksOptions> = {
    methods: options.methods ?? ["POST", "PUT", "PATCH", "DELETE"],
    checkType: options.checkType ?? "custom-req-header",
    header: options.header ?? "x-csrf-header",
    cookie: options.cookie ?? "x-csrf-cookie",
    secret: options.secret ?? "",
    hashAlgo: options.hashAlgo ?? "sha256",
    signatureSeparator: options.signatureSeparator ?? ".",
  };

  // Need to make sure the header we check for is always lower case
  opts.header = opts.header.toLowerCase();

  // If this is "naive-double-submit-cookie" check the cookie is supplied
  if (opts.checkType === "signed-double-submit-cookie") {
    if (opts.secret.length === 0) {
      throw new Error(
        "Must set secret to use the 'signed-double-submit-cookie' CSRF check middleware",
      );
    }
  }

  let custReqHeader = (req: ServerRequest) => {
    // The custom-req-header check just ensures that the specified
    // header exists - the value is not important
    if (req.headers[opts.header] === undefined) {
      return false;
    }

    return true;
  };

  let naiveDoubleSubmitCookie = (req: ServerRequest) => {
    // The naive-double-submit-cookie check ensures the value of the
    // specified cookie matches the value of the specified header
    let cookie = req.getCookie(opts.cookie as string);

    // Note if cookie doesn't exist value is null and if headers doesn't exist
    // it is undefined
    if (req.headers[opts.header] !== cookie) {
      return false;
    }

    return true;
  };

  let signedDoubleSubmitCookie = (req: ServerRequest) => {
    // The signed-double-submit-cookie check ensures the value of the
    // specified cookie matches the value of the specified header
    let cookie = req.getCookie(opts.cookie as string);

    // Note if cookie doesn't exist value is null and if headers doesn't exist
    // it is undefined
    if (req.headers[opts.header] !== cookie) {
      return false;
    }

    let [token, hash] = cookie.split(opts.signatureSeparator);

    if (
      hash !==
      crypto.createHmac(opts.hashAlgo, opts.secret).update(token).digest("hex")
    ) {
      return false;
    }

    return true;
  };

  // Because we need to pass in the options we will return the
  // middleware, i.e. you need to call this function
  return async (
    req: ServerRequest,
    res: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    // Make sure the method is one of the ones we want to check
    if (opts.methods.includes(req.method as MiddlewareMethods)) {
      let passed = false;

      if (opts.checkType === "custom-req-header") {
        passed = custReqHeader(req);
      } else if (opts.checkType === "naive-double-submit-cookie") {
        passed = naiveDoubleSubmitCookie(req);
      } else {
        passed = signedDoubleSubmitCookie(req);
      }

      // If the CSRF check failed then DO NOT continue down the stack
      if (passed === false) {
        res.statusCode = 401;
        res.write("The request failed the CSRF check");
        return;
      }
    }

    await next();
  };
};

export const getSecurityHeaders = (
  options: SecurityHeadersOptions = {},
): { name: string; value: string }[] => {
  let opts: Required<SecurityHeadersOptions> = {
    headers: options.headers ?? [],
    useDefaultHeaders: options.useDefaultHeaders ?? true,
  };

  // These are the default headers to use
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

  // These are the headers we will use
  let securityHeaders: { name: string; value: string }[] = [];

  // Set all of the user supplied headers first
  for (let header of opts.headers) {
    securityHeaders.push({ name: header.name, value: header.value });
  }

  // Check if we should use the default headers
  if (opts.useDefaultHeaders) {
    // Looks like it - so add the default headers
    for (let header of defaultHeaders) {
      // Check if the user has already supplied the header (use lower case
      // to be safe)
      let found = opts.headers.find(
        (el) => el.name.toLowerCase() === header.name.toLowerCase(),
      );

      if (found !== undefined) {
        continue;
      }

      securityHeaders.push({ name: header.name, value: header.value });
    }
  }

  return securityHeaders;
};

export const securityHeadersMiddleware = (
  options: SecurityHeadersOptions = {},
): Middleware => {
  // Get the security headers
  let securityHeaders = getSecurityHeaders(options);

  // Because we need to pass in the options we will return the
  // middleware, i.e. you need to call this function
  return async (
    _: ServerRequest,
    res: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    // Set all of the sec headers
    for (let header of securityHeaders) {
      res.setHeader(header.name, header.value);
    }

    await next();
  };
};

export const dontCompressResponse = (): Middleware => {
  return async (
    req: ServerRequest,
    _: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    // Flag the response should not be compressed
    req.compressResponse = false;

    await next();
  };
};

export const setLatencyMetricName = (name: string): Middleware => {
  return async (
    _: ServerRequest,
    res: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void> => {
    // Set the latency metric name
    res.latencyMetricName = name;

    await next();
  };
};

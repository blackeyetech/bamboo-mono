// imports here
import { SseServer } from "./sse-server.js";

import * as http from "node:http";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";

// Types here
export type Cookie = {
  name: string;
  value: string;
  maxAge?: number;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  domain?: string;
};

// Classes here
export class HttpError {
  constructor(
    public status: number,
    public message: string = "Achtung Baby!",
  ) {}
}

export type HttpRedirectStatusCode =
  | 301
  | 302
  | 303
  | 304
  | 305
  | 306
  | 307
  | 308;

export class HttpRedirect {
  constructor(
    public statusCode: HttpRedirectStatusCode = 302,
    public location: string,
    public message: string = "",
  ) {}
}

export type ServerTimingMetric = {
  name: string;
  duration?: number;
  description?: string;
};

// NOTE: ServerRequest needs to be a type. It was orignially a class and this
// worked great when it was passed to createServer(), but it will not work
// in other scenarios like Astro in dev mode where the vite dev server creates
// the requests
export type ServerRequest = http.IncomingMessage & {
  // New properties here
  validUrl: boolean;
  urlObj: URL;
  params: Record<string, any>;

  sseServer?: SseServer;
  json?: any;
  body?: Buffer;

  matchedInfo: any; // Is any because its use depends on the matcher

  handled: boolean;
  compressResponse: boolean;

  checkApiRoutes: boolean;
  checkSsrRoutes: boolean;
  checkStaticFiles: boolean;

  handle404: boolean;

  // New methods here
  getCookie(cookieName: string): string | null;

  setServerTimingHeader(value: string): void;
};

// This method enhances an existing IncomingMessage to be a ServerRequest
export const enhanceIncomingMessage = (
  req: http.IncomingMessage,
): ServerRequest => {
  // Treat req like a ServerRequest (which it is minus some props and methods)
  let enhancedReq = req as ServerRequest;

  // Now set all of the props that make it a ServerRequest
  // NOTE: I can not figure out a good way to tell if the req is HTTP or HTTPS
  // but I dont think it matters here unless someone needs the protocol prop
  enhancedReq.validUrl = URL.canParse(
    req.url as string,
    `https://${req.headers.host}`,
  );

  // If the URL is not valid then we should return now
  if (!enhancedReq.validUrl) {
    return enhancedReq;
  }

  // If we are here we know the URL is valid so it is safe to use it
  enhancedReq.urlObj = new URL(
    req.url as string,
    `https://${req.headers.host}`,
  );

  enhancedReq.params = {};
  enhancedReq.handled = false;

  // By default we will compress the response
  enhancedReq.compressResponse = true;

  // By default we shld check all the different types of routes
  enhancedReq.checkApiRoutes = true;
  enhancedReq.checkSsrRoutes = true;
  enhancedReq.checkStaticFiles = true;

  // By default the req handler is expected to handle the 404
  enhancedReq.handle404 = true;

  // Now set all of the public methods that make it a ServerRequest
  enhancedReq.getCookie = (cookieName: string): string | null => {
    // Get the cookie header and spilt it up by cookies -
    // NOTE: cookies are separated by semi colons
    let cookies = enhancedReq.headers.cookie?.split(";");

    if (cookies === undefined) {
      // Nothing to do so just return
      return null;
    }

    // Loop through the cookies
    for (let cookie of cookies) {
      // Split the cookie up into a key value pair
      // NOTE: key/value is separated by an equals sign and has leading spaces
      let [name, value] = cookie.trim().split("=");

      // Make sure it was a validly formatted cookie
      if (value === undefined) {
        // It is not a valid cookie so skip it
        continue;
      }

      // Check if we found the cookie
      if (name === cookieName) {
        // Return the cookie value
        return value;
      }
    }

    return null;
  };

  enhancedReq.setServerTimingHeader = (value: string): void => {
    enhancedReq.headers["Server-Timing"] = value;
  };

  return enhancedReq;
};

// NOTE: ServerResponse needs to be a type. It was orignially a class and this
// worked great when it was passed to createServer(), but it will not work
// in other scenarios like Astro in dev mode where the vite dev server creates
// the response
export type ServerResponse = http.ServerResponse & {
  // New properties here
  receiveTime: number;
  redirected: boolean;
  latencyMetricName: string;
  serverTimingsMetrics: (ServerTimingMetric | string)[];

  body?: string | Buffer;
  json?: object | [] | string | number | boolean;
  streamRes?: {
    body: Readable;
    fileName?: string;
  };

  enhancedReq: ServerRequest;

  // New methods here
  setCookies(cookies: Cookie[]): void;
  clearCookies(cookies: string[], domain?: string): void;
  setServerTimingHeader(): void;
  redirect(
    location: string,
    statusCode?: HttpRedirectStatusCode,
    message?: string,
  ): void;
  addServerTimingMetric(
    name: string,
    duration?: number,
    description?: string,
  ): void;
  addServerTimingHeader(header: string): void;
};

// This method enhances an existing ServerResponse to be a ServerResponse
export const enhanceServerResponse = (
  res: http.ServerResponse,
): ServerResponse => {
  // Treat res like a ServerResponse (which it is minus the props and methods)
  let enhancedRes = res as ServerResponse;

  // Now set all of the props that make it a ServerRequest
  // NOTE: enhancedRes will be created at the same time as ServerRequest
  enhancedRes.receiveTime = performance.now();
  enhancedRes.redirected = false;
  enhancedRes.latencyMetricName = "latency";
  enhancedRes.serverTimingsMetrics = [];

  enhancedRes.enhancedReq = enhancedRes.req as ServerRequest;

  // Now set all of the public methods that make it a ServerResponse
  enhancedRes.setCookies = (cookies: Cookie[]): void => {
    let setCookiesValue: string[] = [];

    // Check for exiting cookies and add them to the setCookiesValue array
    let existing = enhancedRes.getHeader("Set-Cookie");

    if (typeof existing === "string") {
      setCookiesValue.push(existing);
    } else if (Array.isArray(existing)) {
      setCookiesValue = existing;
    }

    // Loop through each cookie and build the cookie values
    for (let cookie of cookies) {
      // Set the cookie value first
      let value = `${cookie.name}=${cookie.value}`;

      // if there is a maxAge then set it - NOTE: put ";" first
      if (cookie.maxAge !== undefined) {
        value += `; Max-Age=${cookie.maxAge}`;
      }
      // If there is a path then set it or use default path of "/" - NOTE: put ";" first
      if (cookie.path !== undefined) {
        value += `; Path=${cookie.path}`;
      } else {
        value += `; Path=/`;
      }
      // If httpOnly is indicated then add it - NOTE: put ";" first
      if (cookie.httpOnly === true) {
        value += "; HttpOnly";
      }
      // If secure is indicated set then add it - NOTE: put ";" first
      if (cookie.secure === true) {
        value += "; Secure";
      }
      // If sameSite has been provided then add it - NOTE: put ";" first
      if (cookie.sameSite !== undefined) {
        value += `; SameSite=${cookie.sameSite}`;
      }

      // If domain has been provided then add it - NOTE: put ";" first
      if (cookie.domain !== undefined) {
        value += `; Domain=${cookie.domain}`;
      }

      // Save the cookie
      setCookiesValue.push(value);
    }

    // Finally set the cookie/s in the response header
    enhancedRes.setHeader("Set-Cookie", setCookiesValue);
  };

  enhancedRes.clearCookies = (cookies: string[], domain?: string): void => {
    let httpCookies: Cookie[] = [];

    for (let cookie of cookies) {
      // To clear a cookie - set value to empty string and max age to -1
      httpCookies.push({ name: cookie, value: "", maxAge: -1, domain });
    }

    enhancedRes.setCookies(httpCookies);
  };

  enhancedRes.setServerTimingHeader = () => {
    let serverTimingHeaders: string[] = [];

    // Check if the req has a Server-Timing header. This is not normal but I
    // want to something like a forwardAuth server to be able to add it's
    // metrics to the response header
    if (enhancedRes?.req?.headers["server-timing"] !== undefined) {
      const reqTimings = enhancedRes.req.headers["server-timing"];

      // Check if there are multiple headers
      if (Array.isArray(reqTimings)) {
        // If so then since this is the first just use it as the headers array
        serverTimingHeaders = reqTimings;
      } else {
        // If not then just add it to the array
        serverTimingHeaders.push(reqTimings);
      }
    }

    let serverTimingValue = "";

    // Add each additional metric added to the res next so they are in
    // the order they were added
    for (let metric of enhancedRes.serverTimingsMetrics) {
      // Check if we have a string or a metric object
      if (typeof metric === "string") {
        // The string version is already formatted so just add to the array
        serverTimingHeaders.push(metric);
        continue;
      }

      // If we are here then we have a metric object so add the name
      serverTimingValue += metric.name;

      // Check if there is an optional duration
      if (metric.duration !== undefined) {
        serverTimingValue += `;dur=${metric.duration}`;
      }
      // Check if there is an optional description
      if (metric.description !== undefined) {
        serverTimingValue += `;desc="${metric.description}"`;
      }

      serverTimingValue += ", ";
    }

    // Finally add the total latency for the endpoint to the array
    const latency = Math.round(performance.now() - enhancedRes.receiveTime);
    serverTimingValue += `${enhancedRes.latencyMetricName};dur=${latency}`;
    serverTimingHeaders.push(serverTimingValue);

    // Of course don't forget to set the header!!
    enhancedRes.setHeader("Server-Timing", serverTimingHeaders);
  };

  enhancedRes.redirect = (
    location: string,
    statusCode: HttpRedirectStatusCode = 302,
    message: string = "",
  ) => {
    enhancedRes.redirected = true;

    let htmlMessage =
      message.length > 0
        ? message
        : `Redirected to <a href="${location}">here</a>`;

    // Write a little something something for good measure
    enhancedRes.body = `
    <html>
      <body>
        <p>${htmlMessage}</p>
      </body>
    </html>`;

    enhancedRes.setHeader("Content-Type", "text/html; charset=utf-8");
    enhancedRes.setHeader("Location", location);

    enhancedRes.statusCode = statusCode;
  };

  enhancedRes.addServerTimingMetric = (
    name: string,
    duration?: number,
    description?: string,
  ) => {
    // This adds a metric to the Server-Timing header for this response
    enhancedRes.serverTimingsMetrics.push({ name, duration, description });
  };

  enhancedRes.addServerTimingHeader = (header: string) => {
    // This adds a complete Server-Timing header to this response
    enhancedRes.serverTimingsMetrics.push(header);
  };

  return enhancedRes;
};

export class WebRequest extends Request {
  public req: ServerRequest;
  public res: ServerResponse;

  constructor(req: ServerRequest, res: ServerResponse) {
    // Get the headers so we can pass them on
    const headers = new Headers();

    for (const [name, value] of Object.entries(req.headers)) {
      // Skip headers with no values
      if (value === undefined) {
        continue;
      }

      // Value can be an array so we need to handle that
      if (Array.isArray(value)) {
        // Append each value as the header name
        for (const item of value) {
          headers.append(name, item);
        }
      } else {
        headers.append(name, value);
      }
    }

    // Now call the super constructor to create the Request
    // NOTE: Request is a Web standard and doesnt use Buffers so convert req.body
    super(req.urlObj, {
      method: req.method,
      body: req.body !== undefined ? new Uint8Array(req.body) : undefined,
      headers,
    });

    // Make sure to tack on the nodeJs req/res
    this.req = req;
    this.res = res;
  }
}

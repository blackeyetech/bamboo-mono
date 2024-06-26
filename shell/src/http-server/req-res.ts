// imports here
import { SseServer } from "./sse-server.js";

import * as net from "node:net";
import * as http from "node:http";
import { performance } from "node:perf_hooks";

// Types here
export type Cookie = {
  name: string;
  value: string;
  maxAge?: number;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
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

export class ServerResponse extends http.ServerResponse {
  // Properties here
  private _receiveTime: number;
  private _redirected: boolean;

  public serverTimingsMetrics: { name: string; duration: number }[];

  public json?: object | [] | string | number | boolean;
  public body?: string | Buffer;

  public proxied: boolean;

  // constructor here
  constructor(req: http.IncomingMessage) {
    super(req);

    // NOTE: This will be created at the same time as ServerRequest
    this._receiveTime = performance.now();
    this._redirected = false;
    this.serverTimingsMetrics = [];
    this.proxied = false;
  }

  // Getter methods here
  get redirected(): boolean {
    return this._redirected;
  }

  // Public functions here
  redirect(
    location: string,
    statusCode: HttpRedirectStatusCode = 302,
    message: string = "",
  ) {
    this._redirected = true;

    let htmlMessage =
      message.length > 0
        ? message
        : `Redirected to <a href="${location}">here</a>`;

    // Write a little something something for good measure
    this.body = `
    <html>
      <body>
        <p>${htmlMessage}</p>
      </body>
    </html>`;

    this.setHeader("Content-Type", "text/html; charset=utf-8");
    this.setHeader("Location", location);

    this.statusCode = statusCode;
  }

  setCookies = (cookies: Cookie[]): void => {
    let setCookiesValue: string[] = [];

    // Check for exiting cookies and add them to the setCookiesValue array
    let existing = this.getHeader("Set-Cookie");

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

      // Save the cookie
      setCookiesValue.push(value);
    }

    // Finally set the cookie/s in the response header
    this.setHeader("Set-Cookie", setCookiesValue);
  };

  clearCookies = (cookies: string[]): void => {
    let httpCookies: Cookie[] = [];

    for (let cookie of cookies) {
      // To clear a cookie - set value to empty string and max age to -1
      httpCookies.push({ name: cookie, value: "", maxAge: -1 });
    }

    this.setCookies(httpCookies);
  };

  setServerTimingHeader = () => {
    // Set the total latency first
    let lat = Math.round((performance.now() - this._receiveTime) * 1000) / 1000;
    let timing = `latency;dur=${lat}`;

    // Then add each additional metric added to the res
    for (let metric of this.serverTimingsMetrics) {
      timing += `, ${metric.name};dur=${metric.duration}`;
    }

    this.setHeader("Server-Timing", timing);
  };
}

export class ServerRequest extends http.IncomingMessage {
  // Properties here
  public urlObj: URL;
  public params: Record<string, any>;
  public middlewareProps: Record<string, any>;

  public sseServer?: SseServer;
  public json?: any;
  public body?: Buffer;

  public matchedInfo: any;

  public dontCompressResponse: boolean;

  // Constructor here
  constructor(socket: net.Socket) {
    super(socket);

    // When this object is instantiated the body of the req has not yet been
    // received so the details, such as the URL, will not be known until later
    this.urlObj = new URL("http://localhost/");

    this.params = {};
    this.middlewareProps = {};
    this.dontCompressResponse = false;
  }

  getCookie = (cookieName: string): string | null => {
    // Get the cookie header and spilt it up by cookies -
    // NOTE: cookies are separated by semi colons
    let cookies = this.headers.cookie?.split(";");

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
}

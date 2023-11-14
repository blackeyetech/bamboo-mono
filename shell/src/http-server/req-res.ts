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

export class ServerResponse extends http.ServerResponse {
  // Properties here
  private _receiveTime: number;
  private _redirected: boolean;

  public serverTimingsMetrics: { name: string; duration: number }[];

  public json?: object | [] | string | number | boolean;
  public body?: string | Buffer;

  // constructor here
  constructor(req: http.IncomingMessage) {
    super(req);

    // NOTE: This will be created at the same time as ServerRequest
    this._receiveTime = performance.now();
    this._redirected = false;
    this.serverTimingsMetrics = [];
  }

  // Getter methods here
  get redirected(): boolean {
    return this._redirected;
  }

  // Public functions here
  redirect(
    req: ServerRequest,
    location: string,
    statusCode: 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308 = 301,
  ) {
    this._redirected = true;

    this.statusCode = statusCode;
    this.setHeader("Location", location);

    this.setServerTimingHeader();

    // Write a little something something for good measure
    let body = `<html><body><p>${req.urlObj.pathname} has been redirected to <a href="${location}">here</a></p></body></html>`;
    this.setHeader("Content-Type", "text/html; charset=utf-8");
    this.setHeader("Content-Length", Buffer.byteLength(body));
    this.write(body);

    this.end();
  }

  setCookies = (cookies: Cookie[]): void => {
    let setCookiesValue: string[] = [];

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

  // Constructor here
  constructor(socket: net.Socket) {
    super(socket);

    // Set this to the root as a default
    this.urlObj = new URL("http://localhost/");

    this.params = {};
    this.middlewareProps = {};
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
      let parts = cookie.trim().split("=");

      // Make sure it was a validly formatted cookie
      if (parts.length !== 2) {
        // It is not a valid cookie so skip it
        continue;
      }

      // Check if we found the cookie
      if (parts[0] === cookieName) {
        // Return the cookie value
        return parts[1];
      }
    }

    return null;
  };
}

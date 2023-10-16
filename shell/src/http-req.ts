// NOTE: To use this with endpoints using self signed certs add this env var
// NODE_TLS_REJECT_UNAUTHORIZED=0

// imports here
import { logger } from "./logger.js";

// Types here
export type ReqRes = {
  statusCode: number;
  headers: Headers;
  body: any;
  response?: Response;
};

export type ReqOptions = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  searchParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: object | [] | string;
  auth?: {
    username: string;
    password: string;
  };
  bearerToken?: string;
  timeout?: number;
  handleResponse?: boolean;

  // These are additional options for fetch
  keepalive?: boolean;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  mode?: RequestMode;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  signal?: AbortSignal;
};

// Error classes here
export class ReqAborted {
  constructor(
    public timedOut: boolean,
    public message: string,
  ) {}
}

export class ReqError {
  constructor(
    public status: number,
    public message: string,
  ) {}
}

// Misc consts here
const LOG_TAG = "request";

// Private methods here
async function callFetch(
  origin: string,
  path: string,
  options: ReqOptions,
  body?: string,
): Promise<Response> {
  // Build the url
  let url = `${origin}${path}`;
  // And add the query string if one has been provided
  if (options.searchParams !== undefined) {
    url += `?${new URLSearchParams(options.searchParams)}`;
  }

  let timeoutTimer: NodeJS.Timeout | undefined;

  // Create an AbortController if a timeout has been provided
  if (options.timeout) {
    const controller = new AbortController();

    // NOTE: this will overwrite a signal if one has been provided
    options.signal = controller.signal;

    timeoutTimer = setTimeout(() => {
      controller.abort();
    }, options.timeout * 1000);
  }

  let results = await fetch(url, {
    method: options.method,
    headers: options.headers,
    body,
    keepalive: options.keepalive,
    cache: options.cache,
    credentials: options.credentials,
    mode: options.mode,
    redirect: options.redirect,
    referrer: options.referrer,
    referrerPolicy: options.referrerPolicy,
    signal: options.signal,
  }).catch((e) => {
    // Check if the request was aborted
    if (e.name === "AbortError") {
      // If timeout was set then the req must have timed out
      if (options.timeout) {
        throw new ReqAborted(
          true,
          `Request timeout out after ${options.timeout} seconds`,
        );
      }

      throw new ReqAborted(false, "Request aborted");
    }

    // Need to check if we started a timeout
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
    }

    // We don't know what the error is so pass it back
    throw e;
  });

  // Need to check if we started a timeout
  if (timeoutTimer !== undefined) {
    clearTimeout(timeoutTimer);
  }

  if (!results.ok) {
    let message = await results.text();

    throw new ReqError(
      results.status,
      message.length === 0 ? results.statusText : message,
    );
  }

  return results;
}

async function handleResponseData(results: Response): Promise<object | string> {
  let resData: object | string;

  // Safest way to check for a body is the content-length header exists
  // and is not "0" (no need to convert to a number)
  let contentExists = false;
  if (
    results.headers.has("content-length") &&
    results.headers.get("content-length") !== "0"
  ) {
    contentExists = true;
  }

  // Only convert to json if there is content otherwise .json() will throw
  if (
    contentExists &&
    results.headers.get("content-type")?.startsWith("application/json") === true
  ) {
    resData = await results.json();
  } else {
    resData = await results.text();
    // If the string has length then let's check the content-type again for
    // json data - sometimes the server isn't setting the content-length ...
    if (
      resData.length &&
      results.headers.get("content-type")?.startsWith("application/json") ===
        true
    ) {
      resData = JSON.parse(resData);
    }
  }

  return resData;
}

// Public methods here
export let request = async (
  origin: string,
  path: string,
  reqOptions?: ReqOptions,
): Promise<ReqRes> => {
  logger.trace(LOG_TAG, "Request for origin (%s) path (%s)", origin, path);

  // Set the default values
  let options = {
    method: "GET",
    timeout: 0,
    keepalive: true,
    handleResponse: true,
    cache: <RequestCache>"no-store",
    mode: <RequestMode>"cors",
    credentials: <RequestCredentials>"include",
    redirect: <RequestRedirect>"follow",
    referrerPolicy: <ReferrerPolicy>"no-referrer",

    ...reqOptions,
  } as ReqOptions;

  // Make sure the headers is set to something for later
  if (options.headers === undefined) {
    options.headers = {};
  }

  // If a bearer token is provided then add a Bearer auth header
  if (options.bearerToken !== undefined) {
    options.headers.Authorization = `Bearer ${options.bearerToken}`;
  }

  // If the basic auth creds are provided add a Basic auth header
  if (options.auth !== undefined) {
    let token = Buffer.from(
      `${options.auth.username}:${options.auth.password}`,
    ).toString("base64");
    options.headers.Authorization = `Basic ${token}`;
  }

  let payloadBody: string | undefined;

  // Automatically stringify and set the header if this is a JSON payload
  // BUT dont do it for GETs and DELETE since they can have no body
  if (
    options.body !== undefined &&
    options.method !== "GET" &&
    options.method !== "DELETE"
  ) {
    // Rem an array is an object to!
    if (typeof options.body === "object") {
      // Add the content-type if it hasn't been provided
      if (options.headers?.["content-type"] === undefined) {
        options.headers["content-type"] = "application/json; charset=utf-8";
      }

      payloadBody = JSON.stringify(options.body);
    } else {
      payloadBody = options.body;
    }
  }

  // Call fetch
  let response = await callFetch(origin, path, options, payloadBody);

  // Build the response
  let res: ReqRes = {
    statusCode: response.status,
    headers: response.headers,
    body: undefined, // set to undefined for now
  };

  // Check if we should handle the response for the user
  if (options.handleResponse) {
    // Yes, so handle and set the body
    res.body = await handleResponseData(response);
  } else {
    // No, so set the response
    res.response = response;
  }

  return res;
};

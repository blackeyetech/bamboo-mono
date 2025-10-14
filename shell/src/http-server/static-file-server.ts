// imports here
import { Logger } from "../logger.js";
import { ServerRequest, ServerResponse } from "./req-res.js";
import { contentTypes } from "./content-types.js";
import { Router } from "./router.js";

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import * as stream from "node:stream";
import * as zlib from "node:zlib";

// Types here
type FileDetails = {
  contentType: string;
  size: number;
  lastModifiedNoMs: number;
  lastModifiedMs: number;
  lastModifiedUtcStr: string;
  eTag: string;
  fullPath: string;
  immutable: boolean;
  fileBuffer: Buffer;
  compressedBuffer: Buffer;
};

export type StaticFileServerConfig = {
  path: string;

  immutableRegExp?: string[];
  defaultDirFile?: string;

  defaultCharSet?: string;

  securityHeaders?: { name: string; value: string }[];

  stripHtmlExt?: boolean;
};

// StaticFileServer class here
export class StaticFileServer {
  private _logger: Logger;

  private _filePath: string;
  private _immutableRegExp: RegExp[];
  private _defaultDirFile: string;
  private _defaultCharSet: string;
  private _stripHtmlExt: boolean;

  private _staticFileMap: Map<string, FileDetails>;
  private _redirectUrlMap: Map<string, string>;

  private _securityHeaders: { name: string; value: string }[];

  constructor(loggerName: string, config: StaticFileServerConfig) {
    // Make sure there is no trailing slash at the end of the path
    this._logger = new Logger(loggerName);
    this._logger.startupMsg("Creating static file server ...");

    this._filePath = config.path.replace(/\/*$/, "");

    // Initialise the immutable regexs array
    this._immutableRegExp = [];

    // Check if user has provided an immutable config value
    if (config.immutableRegExp !== undefined) {
      for (const exp of config.immutableRegExp) {
        // This is an array so iterate through each element and add it to the list
        this._immutableRegExp.push(new RegExp(exp));
      }
    }

    this._defaultDirFile = config.defaultDirFile ?? "index.html";
    this._defaultCharSet = config.defaultCharSet ?? "charset=utf-8";
    this._stripHtmlExt = config.stripHtmlExt ?? false;

    this._staticFileMap = new Map();
    this._redirectUrlMap = new Map();

    // Get the standard sec headers and add the users specified headers as well
    this._securityHeaders = Router.getSecHeaders({
      headers: config.securityHeaders,
    });

    // Get all of the files at start up - but a constructor cant be async so
    // run getFilesRecursively() at the earliest possibile time
    setImmediate(async () => {
      await this.getFilesRecursively();
    });
  }

  // Private methods here
  private async getFilesRecursively(urlPath: string = "/"): Promise<void> {
    // Note: urlPath should always start and end in "/"
    const dir = `${this._filePath}${urlPath}`;
    let dirFiles: string[] = [];

    // Get a list of files in the dir and check for errors
    try {
      dirFiles = fs.readdirSync(dir);
    } catch (e) {
      this._logger.warn("No permissions to read from dir (%s)", dir);
    }

    // Iterate through each file and check if it is a dir or not
    for (const file of dirFiles) {
      const fullPath = `${dir}${file}`;
      const stats = fs.statSync(fullPath);
      const url = `${urlPath}${file}`;

      if (stats.isDirectory()) {
        // Get the files in this dir
        this.getFilesRecursively(`${url}/`);
      } else if (stats.isFile()) {
        // Add the file to the list
        await this.addFile(fullPath, url, stats);
      }
    }
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

  private async calculateEtag(
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<string | null> {
    // MD5 hash the file contents to calculate the etag
    const contents = stream.Readable.from(fileBuffer);
    const hash = crypto.createHash("sha1");

    // Flag to check if we successfully pipe the file to the hash
    let failed = false;

    await pipeline(contents, hash).catch((e) => {
      this._logger.trace(
        "Error attempting to create etag for file (%s) (%s): ",
        fileName,
        e,
      );

      failed = true;
    });

    if (failed) {
      return null;
    }

    return hash.digest("hex");
  }

  private async addFile(
    fullPath: string,
    urlPath: string,
    stats: fs.Stats,
  ): Promise<boolean> {
    // Use a flag to decide if we add the file to the file map or not
    let addFile = true;

    try {
      // Test if we can read the file
      fs.accessSync(fullPath, fs.constants.R_OK);
    } catch (e) {
      // There was an error which means we cant read the file so DO NOT add it
      addFile = false;
      this._logger.warn("No permissions to read file : (%s)", fullPath);
    }

    if (addFile === false) {
      // Can't add file so do nothing
      return false;
    }

    // Add the file and it's details to the map
    const modTimeMs = stats.mtime.getTime();
    // Get rid of the ms from the time because we lose it when we convert to a
    // UTC string which means we get a mismatch checking "If-Modified-Since"
    const modTimeNoMs = Math.trunc(modTimeMs / 1000) * 1000;

    const fileBuffer = fs.readFileSync(fullPath);

    const eTag = await this.calculateEtag(fileBuffer, fullPath);
    if (eTag === null) {
      // Couldn't calculate the etag so do nothing
      return false;
    }

    // Default immutable to false until we can prove it is
    let immutable = false;

    // Now check if the path matches one of the RegExps
    for (const regexp of this._immutableRegExp) {
      if (regexp.test(fullPath)) {
        immutable = true;
        break;
      }
    }

    const fileDetails: FileDetails = {
      contentType: this.lookupType(fullPath), // In case urlPath is a dir
      size: stats.size,
      lastModifiedNoMs: modTimeNoMs,
      lastModifiedMs: modTimeMs,
      lastModifiedUtcStr: new Date(modTimeNoMs).toUTCString(),
      eTag,
      fullPath,
      immutable,
      fileBuffer,
      compressedBuffer: zlib.gzipSync(fileBuffer),
    };

    this._staticFileMap.set(urlPath, fileDetails);

    this._logger.trace(
      "Added (%s) to file map. Details: contentType (%s), size (%s), lastModifiedMs(%s), eTag (%s), fullPath (%s), immutable (%j)",
      urlPath,
      fileDetails.contentType,
      fileDetails.size,
      fileDetails.lastModifiedMs,
      fileDetails.eTag,
      fileDetails.fullPath,
      fileDetails.immutable,
    );

    const HTML_EXT = ".html";

    // Check if we should strip .html from the file extension
    if (this._stripHtmlExt && path.extname(urlPath) === HTML_EXT) {
      // Add the file again but this time without the .html
      const strippedUrl = urlPath.slice(0, HTML_EXT.length * -1);
      this._logger.trace("Adding striped html file (%s)", strippedUrl);
      this._staticFileMap.set(strippedUrl, fileDetails);
    }

    // Check if this file is the default dir file
    if (path.basename(urlPath) === this._defaultDirFile) {
      const basePath = path.dirname(urlPath);
      // If we at the root we want / to return /index.html
      if (basePath === "/") {
        this._logger.trace("Adding canonical path (%s)", basePath);
        this._staticFileMap.set(basePath, fileDetails);
      } else {
        // We want a user to be able to request url like this:
        //   /about/index.html -> this returns the HTML file
        //   /about/ -> this returns the HTML file
        //   /about -> this redirects to /about/
        const canonicalPath = `${basePath}/`;

        this._logger.trace("Adding canonical path (%s)", canonicalPath);
        this._staticFileMap.set(canonicalPath, fileDetails);

        // Add a redirect for the basePath (/about -> /about/)
        this._logger.trace(
          "Adding redirect from (%s) to (%s)",
          basePath,
          canonicalPath,
        );
        this._redirectUrlMap.set(basePath, canonicalPath);
      }
    }

    return true;
  }

  // Public methods here
  async handleReq(req: ServerRequest, res: ServerResponse): Promise<void> {
    // We only handle GET and HEAD for static files
    if (req.method !== "GET" && req.method !== "HEAD") {
      // Go no further, return with the req not handled
      return;
    }

    this._logger.info("%s", req.urlObj.pathname);
    // Get the file details
    const details = this._staticFileMap.get(req.urlObj.pathname);
    if (details === undefined) {
      // See if there are any redirects in place for this URL
      const redirect = this._redirectUrlMap.get(req.urlObj.pathname);
      if (redirect !== undefined) {
        // Mark the req as being handled and redirect it
        req.handled = true;

        res.redirect(redirect);
        res.end();
        return;
      }

      // URL doesnt match nor has a redirect so return with req not handled
      return;
    }

    // Mark req as handled before we do anything else
    req.handled = true;

    const cacheControl = details.immutable
      ? "max-age=31536000, immutable"
      : "no-cache";

    // All headers need to be set, except content-length, for a 304
    res.setHeader("Cache-Control", cacheControl);
    res.setHeader("Etag", details.eTag);
    res.setHeader("Last-Modified", details.lastModifiedUtcStr);
    res.setHeader("Date", new Date().toUTCString());
    res.setHeader("Content-Type", details.contentType);

    // Set all of the sec headers
    for (const header of this._securityHeaders) {
      res.setHeader(header.name, header.value);
    }

    // Don't forget to set the server-timing header
    res.latencyMetricName = "sf-srv";
    res.setServerTimingHeader();

    // Check if any cache validators exist on the request - check etag first
    if (req.headers["if-none-match"] === details.eTag) {
      res.statusCode = 304;
      res.end();
      return;
    }

    if (req.headers["if-modified-since"] !== undefined) {
      const modifiedDate = new Date(req.headers["if-modified-since"]).getTime();

      // NOTE: Check the times are the same, if they are different, even if
      // details.lastModifiedNoMs is LESS than modifiedDate, it will still
      // because that implies there is a potential issue and it is best to
      // be safe
      if (modifiedDate === details.lastModifiedNoMs) {
        res.statusCode = 304;
        res.end();
        return;
      }
    }

    let fileRead: stream.Readable;

    // Check out if the req will accept a gzip res
    if (req.headers["accept-encoding"]?.includes("gzip") === true) {
      // It does ...
      fileRead = stream.Readable.from(details.compressedBuffer);

      // Dont set the content-length. Use transfer-encoding instead
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Content-Encoding", "gzip");
    } else {
      // It does not ...
      fileRead = stream.Readable.from(details.fileBuffer);

      // Only set the length when we don't do a 304
      res.setHeader("Content-Length", details.size);
    }

    // If it's a HEAD then do not set the body
    if (req.method === "HEAD") {
      res.end();
      return;
    }

    // NOTE: pipeline will close the res when it is finished
    await pipeline(fileRead, res).catch((e) => {
      // We can't do anything else here because either:
      // - the stream is closed which means we can't send back an error
      // - we have an internal error, but we have already started streaming
      //   so we can't do anything
      this._logger.trace("Error attempting to read (%s): (%s)", fileRead, e);
    });
  }
}

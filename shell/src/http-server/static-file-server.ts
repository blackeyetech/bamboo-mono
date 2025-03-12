// imports here
import { Logger } from "../logger.js";
import { ServerRequest, ServerResponse } from "./req-res.js";
import { contentTypes } from "./content-types.js";
import { Router } from "./router.js";

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as streams from "node:stream/promises";
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

export type StaticNotFoundHandler = (
  req: ServerRequest,
  res: ServerResponse,
) => Promise<void>;

export type StaticFileServerConfig = {
  loggerName: string;
  filePath: string;

  immutableRegExp?: RegExp | string | RegExp[] | string[];
  defaultDirFile?: string;
  notFoundHandler?: StaticNotFoundHandler;

  defaultCharSet?: string;
  extraContentTypes?: Record<string, string>;

  securityHeaders?: { name: string; value: string }[];
};

// Misc here
const defaultNotFoundHandler: StaticNotFoundHandler = async (
  _: ServerRequest,
  res: ServerResponse,
) => {
  res.statusCode = 404;
  res.write("File not found");
  res.end();
};
// StaticFileServer class here
export class StaticFileServer {
  private _logger: Logger;

  private _filePath: string;
  private _immutableRegExp: RegExp[];
  private _defaultDirFile: string;
  private _defaultCharSet: string;
  private _notFoundHandler: StaticNotFoundHandler;

  private _staticFileMap: Map<string, FileDetails>;
  private _contentTypes: Map<string, string>;

  private _securityHeaders: { name: string; value: string }[];

  constructor(config: StaticFileServerConfig) {
    // Make sure there is no trailing slash at the end of the path
    this._logger = new Logger(config.loggerName);
    this._logger.startupMsg("Creating static file server ...");

    this._filePath = config.filePath.replace(/\/*$/, "");

    // Initialise the immutable regexs array
    this._immutableRegExp = [];

    // Check if user has provided an immutable config value
    if (config.immutableRegExp !== undefined) {
      // Check if user has provided a regexp or string or array
      if (config.immutableRegExp instanceof RegExp) {
        this._immutableRegExp.push(config.immutableRegExp);
      } else if (typeof config.immutableRegExp === "string") {
        this._immutableRegExp.push(new RegExp(config.immutableRegExp));
      } else if (Array.isArray(config.immutableRegExp)) {
        for (const exp of config.immutableRegExp) {
          // This is an array so iterate through each element and add it to the list
          if (exp instanceof RegExp) {
            this._immutableRegExp.push(exp);
          } else if (typeof exp === "string") {
            this._immutableRegExp.push(new RegExp(exp));
          }
        }
      }
    }

    this._defaultDirFile = config.defaultDirFile ?? "index.html";
    this._defaultCharSet = config.defaultCharSet ?? "charset=utf-8";
    this._notFoundHandler = config.notFoundHandler ?? defaultNotFoundHandler;

    this._staticFileMap = new Map();
    this._contentTypes = new Map();

    // Get the standard sec headers and add the users specified headers as well
    this._securityHeaders = Router.getSecHeaders({
      headers: config.securityHeaders,
    });

    // Populate contentTypes using the predefined types
    for (const type in contentTypes) {
      this._contentTypes.set(type, contentTypes[type]);
    }

    // Then add any extra content types. NOTE: This allows you to overwrite
    // the predefined types
    if (config.extraContentTypes !== undefined) {
      for (const type in config.extraContentTypes) {
        this._contentTypes.set(type, config.extraContentTypes[type]);
      }
    }

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
        await this.addFile(fullPath, `${url}`, stats);
      }
    }
  }

  private lookupType(file: string): string {
    // Look up the file extension to get content type - drop the leading '.'
    const ext = path.extname(file).slice(1);
    const type = this._contentTypes.get(ext);

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

    await streams.pipeline(contents, hash).catch((e) => {
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
      if (regexp.test(fullPath) === true) {
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

    return true;
  }

  private async getFileDetails(file: string): Promise<FileDetails | undefined> {
    // Check for the details first. If it exists we want to use the stored full
    // path just in case file is s dir. It will save and extra stat!
    let details = this._staticFileMap.get(file);

    let fullPath =
      details?.fullPath ?? `${this._filePath}${file.replace(/\/*$/, "")}`;

    // If we can't stat the file (doesn't exist) then stat will throw
    let stats = await fsPromises.stat(fullPath).catch((e) => {
      this._logger.trace(
        "Received an error when trying to stat (%s): (%s)",
        fullPath,
        e,
      );
    });

    if (stats === undefined) {
      return undefined;
    }

    // Check if the file is a directory (should only happen the 1st time)
    if (stats.isDirectory()) {
      // This is a dir so set the file to be the default file for a dir
      fullPath += `/${this._defaultDirFile}`;

      // Get the stats again for the default file. If we can't stat the file
      // (doesn't exist) then stat will throw
      stats = await fsPromises.stat(fullPath).catch((e) => {
        this._logger.trace(
          "Received an error when trying to stat (%s): (%s)",
          fullPath,
          e,
        );
      });

      if (stats === undefined) {
        return undefined;
      }
    }

    // Check if the file wasn't in the file map or it was modified
    if (
      details === undefined ||
      details.lastModifiedMs !== stats.mtime.getTime() ||
      details.size !== stats.size
    ) {
      // Add the file to the file map and get the new details
      await this.addFile(fullPath, file, stats);
      details = this._staticFileMap.get(file);
    }

    return details;
  }

  // Public methods here
  async handleReq(req: ServerRequest, res: ServerResponse): Promise<void> {
    // We only handle GET and HEAD for static files. Return a not found
    if (req.method !== "GET" && req.method !== "HEAD") {
      this._notFoundHandler(req, res);
      return;
    }

    // Get the file details and if it doesn't exist return a not found
    const details = await this.getFileDetails(req.urlObj.pathname);
    if (details === undefined) {
      this._notFoundHandler(req, res);
      return;
    }

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
    await streams.pipeline(fileRead, res).catch((e) => {
      // We can't do anything else here because either:
      // - the stream is closed which means we can't send back an error
      // - we have an internal error, but we have already started streaming
      //   so we can't do anything
      this._logger.trace("Error attempting to read (%s): (%s)", fileRead, e);
    });
  }
}

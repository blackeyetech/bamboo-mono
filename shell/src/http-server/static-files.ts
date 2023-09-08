// imports here
import * as logger from "../logger.js";
import { setServerTimingHeader } from "./middleware.js";
import { ServerRequest, ServerResponse } from "./req-res.js";
import { contentTypes } from "./content-types.js";

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as http from "node:http";
import * as streams from "node:stream/promises";

// Types here
type FileDetails = {
  contentType: string;
  size: number;
  lastModifiedNoMs: number;
  lastModifiedMs: number;
  lastModifiedUtcStr: string;
  etag: string;
  fullPath: string;
};

export type NotFoundHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => Promise<void>;

export type StaticFileServerConfig = {
  filePath: string;
  logger: logger.AbstractLogger;
  loggerTag: string;
  defaultDirFile?: string;
  notFoundHandler?: NotFoundHandler;

  extraContentTypes?: Record<string, string>;
};

// StaticFileServer class here
export class StaticFileServer {
  private _filePath: string;
  private _log: logger.LoggerInstance;
  private _defaultDirFile: string;
  private _notFoundHandler: NotFoundHandler;

  private _staticFileMap: Map<string, FileDetails>;
  private _contentTypes: Map<string, string>;

  constructor(serverConfig: StaticFileServerConfig) {
    let config = {
      defaultDirFile: "index.html",
      notFoundHandler: async (
        _: http.IncomingMessage,
        res: http.ServerResponse,
      ) => {
        res.statusCode = 404;
        res.end();
      },

      ...serverConfig,
    };

    // Make sure there is no trailinog slash at the end of the path
    this._filePath = config.filePath.replace(/\/*$/, "");
    this._log = new logger.LoggerInstance(config.logger, config.loggerTag);
    this._defaultDirFile = config.defaultDirFile;
    this._notFoundHandler = config.notFoundHandler;

    this._staticFileMap = new Map();
    this._contentTypes = new Map();

    // Populate contentTypes using the predefined types
    for (let type in contentTypes) {
      this._contentTypes.set(type, contentTypes[type]);
    }

    // Then add any extra content types. NOTE: This allows you to overwrite
    // the predefined types
    if (config.extraContentTypes !== undefined) {
      for (let type in config.extraContentTypes) {
        this._contentTypes.set(type, config.extraContentTypes[type]);
      }
    }

    // Get all of the files at start up
    this.getFilesRecursively();
  }

  // Private methods here
  private getFilesRecursively(urlPath: string = "/"): void {
    // Note: urlPath should always start and end in "/"
    let dir = `${this._filePath}${urlPath}`;
    let dirFiles: string[] = [];

    // Get a list of files in the dir and check for errors
    try {
      dirFiles = fs.readdirSync(dir);
    } catch (e) {
      this._log.warn("No permissions to read from dir (%s)", dir);
    }

    // Iterate through each file and check if it is a dir or not
    for (let file of dirFiles) {
      let fullPath = `${dir}${file}`;
      let url = `${urlPath}${file}`;
      let stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        // Get the files in this dir
        this.getFilesRecursively(`${url}/`);
      } else if (stats.isFile()) {
        // Add the file to the list
        this.addFile(fullPath, `${url}`, stats);
      }
    }
  }

  private lookupType(file: string): string {
    // Look up the file extension to get content type - drop the leading '.'
    let ext = path.extname(file).slice(1);
    let type = this._contentTypes.get(ext);

    if (type !== undefined) {
      return type;
    }

    // This is the default content type
    return "text/plain";
  }

  private calculateEtag(file: string): string {
    // MD5 hash the file contents to calculate the etag
    let contents = fs.readFileSync(file, "utf-8");

    return crypto.createHash("sha1").update(contents).digest("hex");
  }

  private addFile(fullPath: string, urlPath: string, stats: fs.Stats): boolean {
    // Use a flag to decide if we add the file to the file map or not
    let addFile = true;

    try {
      // Test if we can read the file
      fs.accessSync(fullPath, fs.constants.R_OK);
    } catch (e) {
      // There was an error which means we cant read the file so DO NOT add it
      addFile = false;

      this._log.warn("No permissions to read file : (%s)", fullPath);
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

    let etag = this.calculateEtag(fullPath);

    const fileDetails: FileDetails = {
      contentType: this.lookupType(fullPath), // In case urlPath is a dir
      size: stats.size,
      lastModifiedNoMs: modTimeNoMs,
      lastModifiedMs: modTimeMs,
      lastModifiedUtcStr: new Date(modTimeNoMs).toUTCString(),
      etag,
      fullPath: fullPath,
    };

    this._staticFileMap.set(urlPath, fileDetails);

    this._log.trace(
      "Added (%s) to file map. Details (%j)",
      urlPath,
      fileDetails,
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
      this._log.trace(
        "Received an error when trying to stat (%s): (%s)",
        fullPath,
        e,
      );
    });

    if (stats === undefined) {
      return undefined;
    }

    // Check if the file is a directory (shoould only happen the 1st time)
    if (stats.isDirectory()) {
      // This is a dir so set the file to be the default file for a dir
      fullPath += `/${this._defaultDirFile}`;

      // Get the stats again for the default file. If we can't stat the file
      // (doesn't exist) then stat will throw
      stats = await fsPromises.stat(fullPath).catch((e) => {
        this._log.trace(
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
      this.addFile(fullPath, file, stats);
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
    let details = await this.getFileDetails(req.urlPath);
    if (details === undefined) {
      this._notFoundHandler(req, res);
      return;
    }

    // All headers need to be set, except content-length, for a 304
    res.setHeader("cache-control", "no-cache"); // max-age=31536000, immutable
    res.setHeader("etag", details.etag);
    res.setHeader("last-modified", details.lastModifiedUtcStr);
    res.setHeader("date", new Date().toUTCString());
    res.setHeader("content-type", details.contentType);

    // Don't forget to set the server-timing header
    setServerTimingHeader(res, req.receiveTime);

    // Check if any cache validators exist on the request - check etag first
    if (req.headers["if-none-match"] === details.etag) {
      res.statusCode = 304;
      res.end();
      return;
    } else if (req.headers["if-modified-since"] !== undefined) {
      // Check for last-modifed second. NOTE: The if-modified-since header will
      // have no ms in the time so compare with lastModifiedNoMs
      if (
        new Date(req.headers["if-modified-since"]).getTime() ===
        details.lastModifiedNoMs
      ) {
        res.statusCode = 304;
        res.end();
        return;
      }
    }

    // Only set the length when we don't do a 304
    res.setHeader("content-length", details.size);

    // If it's a HEAD then do not set the body
    if (req.method === "HEAD") {
      res.end();
      return;
    }

    let fileRead = fs.createReadStream(details.fullPath);
    await streams.pipeline(fileRead, res).catch((e) => {
      this._log.trace("Error attempting to read (%s): (%s)", fileRead, e);
    });
  }
}

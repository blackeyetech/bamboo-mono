// imports here
import { logger } from "../logger.js";
import { ServerRequest, ServerResponse } from "./req-res.js";
import { contentTypes } from "./content-types.js";

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
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
  req: ServerRequest,
  res: ServerResponse,
) => Promise<void>;

export type StaticFileServerConfig = {
  filePath: string;
  loggerTag: string;
  defaultDirFile?: string;
  notFoundHandler?: NotFoundHandler;

  defaultCharSet?: string;
  extraContentTypes?: Record<string, string>;
};

// StaticFileServer class here
export class StaticFileServer {
  private _filePath: string;
  private _loggerTag: string;
  private _defaultDirFile: string;
  private _defaultCharSet: string;
  private _notFoundHandler: NotFoundHandler;

  private _staticFileMap: Map<string, FileDetails>;
  private _contentTypes: Map<string, string>;

  constructor(serverConfig: StaticFileServerConfig) {
    let config = {
      defaultDirFile: "index.html",
      defaultCharSet: "charset=utf-8",
      notFoundHandler: async (_: ServerRequest, res: ServerResponse) => {
        res.statusCode = 404;
        res.write("File not found");
        res.end();
      },

      ...serverConfig,
    };

    // Make sure there is no trailing slash at the end of the path
    this._filePath = config.filePath.replace(/\/*$/, "");
    this._loggerTag = config.loggerTag;
    this._defaultDirFile = config.defaultDirFile;
    this._defaultCharSet = config.defaultCharSet;
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

    // Get all of the files at start up - but a constructor cant be async so
    // run getFilesRecursively()Nat the earliest possibile time
    setImmediate(async () => {
      await this.getFilesRecursively();
    });
  }

  // Private methods here
  private async getFilesRecursively(urlPath: string = "/"): Promise<void> {
    // Note: urlPath should always start and end in "/"
    let dir = `${this._filePath}${urlPath}`;
    let dirFiles: string[] = [];

    // Get a list of files in the dir and check for errors
    try {
      dirFiles = fs.readdirSync(dir);
    } catch (e) {
      logger.warn(this._loggerTag, "No permissions to read from dir (%s)", dir);
    }

    // Iterate through each file and check if it is a dir or not
    for (let file of dirFiles) {
      let fullPath = `${dir}${file}`;
      let stats = fs.statSync(fullPath);
      let url = `${urlPath}${file}`;

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
    let ext = path.extname(file).slice(1);
    let type = this._contentTypes.get(ext);

    if (type !== undefined) {
      return `${type}; ${this._defaultCharSet}`;
    }

    // This is the default content type
    return `text/plain; ${this._defaultCharSet}`;
  }

  private async calculateEtag(file: string): Promise<string | null> {
    // MD5 hash the file contents to calculate the etag
    let contents = fs.createReadStream(file);
    let hash = crypto.createHash("sha1");

    // Flag to check if we successfully pipe the file to the hash
    let failed = false;

    await streams.pipeline(contents, hash).catch((e) => {
      logger.trace(
        this._loggerTag,
        "Error attempting to create etag for file (%s) (%s): ",
        file,
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

      logger.warn(
        this._loggerTag,
        "No permissions to read file : (%s)",
        fullPath,
      );
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

    let etag = await this.calculateEtag(fullPath);
    if (etag === null) {
      // Couldn't calculate the etag so do nothing
      return false;
    }

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

    logger.trace(
      this._loggerTag,
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
      logger.trace(
        this._loggerTag,
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
        logger.trace(
          this._loggerTag,
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
    let details = await this.getFileDetails(req.urlObj.pathname);
    if (details === undefined) {
      this._notFoundHandler(req, res);
      return;
    }

    // All headers need to be set, except content-length, for a 304
    res.setHeader("Cache-Control", "no-cache"); // max-age=31536000, immutable
    res.setHeader("Etag", details.etag);
    res.setHeader("Last-Modified", details.lastModifiedUtcStr);
    res.setHeader("Date", new Date().toUTCString());
    res.setHeader("Content-Type", details.contentType);

    // Don't forget to set the server-timing header
    res.setServerTimingHeader();

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
    res.setHeader("Content-Length", details.size);

    // If it's a HEAD then do not set the body
    if (req.method === "HEAD") {
      res.end();
      return;
    }

    let fileRead = fs.createReadStream(details.fullPath);
    // NOTE: pipeline will close the res when it is finished
    await streams.pipeline(fileRead, res).catch((e) => {
      logger.trace(
        this._loggerTag,
        "Error attempting to read (%s): (%s)",
        fileRead,
        e,
      );
    });
  }
}

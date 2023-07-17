// imports here
import * as logger from "./logger.js";
import { LoggerConsole } from "./logger-console.js";
import * as configMan from "./config-man.js";
import * as httpReq from "./http-req.js";
import * as httpServer from "./http-server.js";

export { LogLevel } from "./logger.js";
export { ReqRes, ReqOptions, ReqAborted, ReqError } from "./http-req.js";
export { SseServerOptions, SseServer } from "./sse-server.js";
export {
  HttpServer,
  HttpConfig,
  HttpConfigError,
  ServerRequest,
  ServerResponse,
  CorsOptions,
  EndpointOptions,
  EndpointCallback,
  Middleware,
  HealthcheckCallback,
  HttpCookie,
  HttpError,
} from "./http-server.js";

import * as readline from "node:readline";

// Config consts here
const CFG_LOG_LEVEL = "LOG_LEVEL";
const CFG_LOG_TIMESTAMP = "LOG_TIMESTAMP";
const CFG_LOG_TIMESTAMP_LOCALE = "LOG_TIMESTAMP_LOCALE";
const CFG_LOG_TIMESTAMP_TZ = "LOG_TIMESTAMP_TZ";

// Misc consts here
const LOGGER_APP_NAME = "App";
const NODE_ENV =
  process.env.NODE_ENV === undefined ? "development" : process.env.NODE_ENV;

// NOTE: BS_VERSION is replaced with package.json#version by a
// rollup plugin at build time
const VERSION: string = "BS_VERSION";

// Private variables here
const _defaultFinallyHandler = async (): Promise<void> => {
  bs.shutdownMsg("Done!");
};

const _defaultStopHandler = async (): Promise<void> => {
  bs.shutdownMsg("Stopped!");
};

const _shutdownHandler = async (): Promise<void> => {
  await bs.exit(0);
};

const _exceptionHandler = async (e: Error) => {
  bs.error("Caught unhandled error - (%s)", e);
  await bs.exit(1);
};

let _httpServerList: httpServer.HttpServer[];
let _pluginList: { plugin: BSPlugin; stopHandler: () => Promise<void> }[];
let _pluginMap: Record<string, BSPlugin>;

let _stopHandler: () => Promise<void>;
let _finallyHandler: () => Promise<void>;

let _logger: logger.AbstractLogger;

// Types here
export type BSConfigOptions = {
  cmdLineFlag?: string;
  silent?: boolean;
  redact?: boolean;
};

export type BSQuestionOptions = {
  muteAnswer?: boolean;
  muteChar?: string;
};

// The shell object here
export const bs = Object.freeze({
  request: httpReq.request,

  // The init function - this does not need to be called by the user
  // this is here mainly to assit with testing. Should be called after
  // a soft exit
  init: (): void => {
    // Initialise the private variables
    _httpServerList = [];
    _pluginList = [];
    _pluginMap = {};
    _stopHandler = _defaultStopHandler;
    _finallyHandler = _defaultFinallyHandler;

    // Initialise and start the logger
    _logger = loggerInit();
    _logger.start();

    // Set the httpReq logger
    httpReq.setLogger(_logger);

    // Nopw spit out the versions
    bs.startupMsg(`Bamboo Shell version (${VERSION})`);
    bs.startupMsg(`NODE_ENV is (${NODE_ENV})`);

    // Now set up the event handler
    bs.startupMsg("Setting up shutdown event handlers ...");
    // Call exit() on a Ctrl-C
    process.on("SIGINT", _shutdownHandler);
    // Call exit() when the program is terminated
    process.on("SIGTERM", _shutdownHandler);
    // Call exit() during normal programming termination
    process.on("beforeExit", _shutdownHandler);
    // Catch and log any execptions and then call exit()
    process.on("uncaughtException", _exceptionHandler);

    // And it's party time!
    bs.startupMsg("Ready to Rock and Roll baby!");
  },

  // Config helper methods here
  getConfigStr: (
    config: string,
    defaultVal?: string,
    options?: BSConfigOptions,
  ): string => {
    // This either returns a string or it throws
    return <string>configMan.get({
      config,
      type: configMan.Types.String,
      logTag: LOGGER_APP_NAME,
      logger: _logger,
      defaultVal,
      ...options,
    });
  },

  getConfigBool: (
    config: string,
    defaultVal?: boolean,
    options?: BSConfigOptions,
  ): boolean => {
    // This either returns a bool or it throws
    return <boolean>configMan.get({
      config,
      type: configMan.Types.Boolean,
      logTag: LOGGER_APP_NAME,
      logger: _logger,
      defaultVal,
      ...options,
    });
  },

  getConfigNum: (
    config: string,
    defaultVal?: number,
    options?: BSConfigOptions,
  ): number => {
    // This either returns a number or it throws
    return <number>configMan.get({
      config,
      type: configMan.Types.Number,
      logTag: LOGGER_APP_NAME,
      logger: _logger,
      defaultVal,
      ...options,
    });
  },

  // Log helper methods here
  fatal: (...args: any): void => {
    _logger.fatal(LOGGER_APP_NAME, ...args);
  },

  error: (...args: any): void => {
    _logger.error(LOGGER_APP_NAME, ...args);
  },

  warn: (...args: any): void => {
    _logger.warn(LOGGER_APP_NAME, ...args);
  },

  info: (...args: any): void => {
    _logger.info(LOGGER_APP_NAME, ...args);
  },

  startupMsg: (...args: any): void => {
    _logger.startupMsg(LOGGER_APP_NAME, ...args);
  },

  shutdownMsg: (...args: any): void => {
    _logger.shutdownMsg(LOGGER_APP_NAME, ...args);
  },

  debug: (...args: any): void => {
    _logger.debug(LOGGER_APP_NAME, ...args);
  },

  trace: (...args: any): void => {
    _logger.trace(LOGGER_APP_NAME, ...args);
  },

  force: (...args: any): void => {
    _logger.force(LOGGER_APP_NAME, ...args);
  },

  logLevel: (level: logger.LogLevel) => {
    _logger.level = level;
  },

  // General functions here
  shellVersion: (): string => {
    return VERSION;
  },

  setFinallyHandler: (handler: () => Promise<void>) => {
    _finallyHandler = handler;
  },

  setStopHandler: (handler: () => Promise<void>) => {
    _stopHandler = handler;
  },

  setLogger(newLogger: logger.AbstractLogger): void {
    _logger = newLogger;
  },

  exit: async (code: number, hard: boolean = true): Promise<void> => {
    bs.shutdownMsg("Exiting ...");

    // Make sure we stop all of the HttpSevers - probably best to do it first
    for (let httpServer of _httpServerList) {
      await httpServer.stop();
    }

    // Clear the HttpServer list
    _httpServerList = [];

    // Stop the application second
    bs.shutdownMsg("Attempting to stop the application ...");
    await _stopHandler().catch((e) => {
      bs.error(e);
    });

    // Stop the extensions in the reverse order you started them
    for (let plugin of _pluginList.reverse()) {
      bs.shutdownMsg(`Attempting to stop plugin ${plugin.plugin.name} ...`);
      await plugin.stopHandler().catch((e) => {
        bs.error(e);
      });
    }

    // Clear the plugin list
    _pluginList = [];

    // If there was a finally handler provided then call it last
    if (_finallyHandler !== undefined) {
      bs.shutdownMsg("Calling the 'finally handler' ...");

      await _finallyHandler().catch((e) => {
        bs.error(e);
      });
    }

    // Remove the even handlers for catching exit events
    process.removeListener("SIGINT", _shutdownHandler);
    process.removeListener("SIGTERM", _shutdownHandler);
    process.removeListener("beforeExit", _shutdownHandler);
    process.removeListener("uncaughtException", _exceptionHandler);

    bs.shutdownMsg("So long and thanks for all the fish!");

    _logger.stop();

    // Check if the exit should also exit the process (a hard stop)
    if (hard) {
      process.exit(code);
    }
  },

  shutdownError: async (code: number = 1, testing: boolean = false) => {
    bs.error("Heuston, we have a problem. Shutting down now ...");

    if (testing) {
      // Do a soft stop so we don't force any testing code to exit
      await bs.exit(code, false);
      return;
    }

    await bs.exit(code);
  },

  // Utility functions here
  addHttpServer: (
    networkInterface: string,
    networkPort: number,
    httpConfig: httpServer.HttpConfig = {},
  ): httpServer.HttpServer => {
    let server = new httpServer.HttpServer(
      networkInterface,
      networkPort,
      _logger,
      httpConfig,
    );

    _httpServerList.push(server);

    return server;
  },

  getHttpServer: (serverNum: number): httpServer.HttpServer | undefined => {
    return _httpServerList.length ? _httpServerList[serverNum] : undefined;
  },

  getPlugin: (plugin: string): BSPlugin | undefined => {
    return _pluginMap[plugin];
  },

  sleep: async (durationInSeconds: number): Promise<void> => {
    // Convert duration to ms
    let ms = Math.round(durationInSeconds * 1000);

    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  },

  question: async (
    ask: string,
    questionOptions?: BSQuestionOptions,
  ): Promise<string> => {
    let input = process.stdin;
    let output = process.stdout;

    let options = {
      muteAnswer: false,
      muteChar: "*",

      ...questionOptions,
    };
    return new Promise((resolve) => {
      let rl = readline.createInterface({
        input,
        output,
      });

      if (options.muteAnswer) {
        input.on("keypress", () => {
          // get the number of characters entered so far:
          var len = rl.line.length;

          if (options.muteChar.length === 0) {
            // move cursor back one since we will always be at the start
            readline.moveCursor(output, -1, 0);
            // clear everything to the right of the cursor
            readline.clearLine(output, 1);
          } else {
            // move cursor back to the beginning of the input
            readline.moveCursor(output, -len, 0);
            // clear everything to the right of the cursor
            readline.clearLine(output, 1);

            // If there is a muteChar then replace the original input with it
            for (var i = 0; i < len; i++) {
              // In case the user passes a string just use the 1st char
              output.write(options.muteChar[0]);
            }
          }
        });
      }

      // Insert a space after the question for convience
      rl.question(`${ask} `, (answer) => {
        resolve(answer);
        rl.close();
      });
    });
  },
});

// Plugin code here
export class BSPlugin {
  // Properties here
  private _name: string;
  private _version: string;

  // Constructor here
  constructor(name: string, version: string) {
    this._name = name;
    this._version = version;

    this.startupMsg(`Adding plugin ${name}`);
    _pluginList.push({
      plugin: this,
      stopHandler: async () => {
        this.stop();
      },
    });
    _pluginMap[this._name] = this;

    this.startupMsg("Initialising ...");
  }

  // Protected methods (that can be overridden) here
  protected async stop(): Promise<void> {
    // This is a default stop method. Override it if you need to clean up
    this.shutdownMsg("Stopped!");
  }

  // Getters here
  get name(): string {
    return this._name;
  }

  get version(): string {
    return this._version;
  }

  // Private methods here

  // Static metods here
  static async question(
    ask: string,
    questionOptions?: BSQuestionOptions,
  ): Promise<string> {
    return bs.question(ask, questionOptions);
  }

  // Public methods here
  getConfigStr(
    config: string,
    defaultVal?: string,
    options?: BSConfigOptions,
  ): string {
    // This either returns a string or it throws
    return <string>configMan.get({
      config,
      type: configMan.Types.String,
      logTag: this._name,
      logger: _logger,
      defaultVal,
      ...options,
    });
  }

  getConfigBool(
    config: string,
    defaultVal?: boolean,
    options?: BSConfigOptions,
  ): boolean {
    // This either returns a bool or it throws
    return <boolean>configMan.get({
      config,
      type: configMan.Types.Boolean,
      logTag: this._name,
      logger: _logger,
      defaultVal,
      ...options,
    });
  }

  getConfigNum(
    config: string,
    defaultVal?: number,
    options?: BSConfigOptions,
  ): number {
    // This either returns a number or it throws
    return <number>configMan.get({
      config,
      type: configMan.Types.Number,
      logTag: this._name,
      logger: _logger,
      defaultVal,
      ...options,
    });
  }

  fatal(...args: any): void {
    _logger.fatal(this._name, ...args);
  }

  error(...args: any): void {
    _logger.error(this._name, ...args);
  }

  warn(...args: any): void {
    _logger.warn(this._name, ...args);
  }

  info(...args: any): void {
    _logger.info(this._name, ...args);
  }

  startupMsg(...args: any): void {
    _logger.startupMsg(this._name, ...args);
  }

  shutdownMsg(...args: any): void {
    _logger.shutdownMsg(this._name, ...args);
  }

  debug(...args: any): void {
    _logger.debug(this._name, ...args);
  }

  trace(...args: any): void {
    _logger.trace(this._name, ...args);
  }

  force(...args: any): void {
    _logger.force(this._name, ...args);
  }

  async request(
    origin: string,
    path: string,
    reqOptions?: httpReq.ReqOptions,
  ): Promise<httpReq.ReqRes> {
    return httpReq.request(origin, path, reqOptions);
  }
}

// Private functions here

// init function for logger
function loggerInit(): logger.AbstractLogger {
  let timestamp = <boolean>configMan.get({
    config: CFG_LOG_TIMESTAMP,
    type: configMan.Types.Boolean,
    logTag: "",
    defaultVal: false,
  });

  let timestampLocale = <string>configMan.get({
    config: CFG_LOG_TIMESTAMP_LOCALE,
    type: configMan.Types.String,
    logTag: "",
    defaultVal: "ISO",
  });

  let timestampTz = <string>configMan.get({
    config: CFG_LOG_TIMESTAMP_TZ,
    type: configMan.Types.String,
    logTag: "",
    defaultVal: "UTC",
  });

  let logLevel = <string>configMan.get({
    config: CFG_LOG_LEVEL,
    type: configMan.Types.String,
    logTag: "",
    defaultVal: "",
  });

  // LoggerConsole is the default logger
  return new LoggerConsole(timestamp, timestampLocale, timestampTz, logLevel);
}

// OK - lets light this candle!
bs.init();

// imports here
import { logger, LogLevel } from "./logger.js";
import { configMan } from "./config-man.js";
import * as httpReq from "./http-req.js";
import * as httpServer from "./http-server/main.js";
import { BSPlugin } from "./bs-plugin.js";

export { LogLevel } from "./logger.js";
export { ReqRes, ReqOptions, ReqAborted, ReqError } from "./http-req.js";
export { SseServerOptions, SseServer } from "./http-server/sse-server.js";
export {
  ServerRequest,
  ServerResponse,
  HttpError,
  Cookie,
} from "./http-server/req-res.js";
export {
  HttpServer,
  HttpConfig,
  HttpConfigError,
  EndpointOptions,
  EndpointCallback,
  HealthcheckCallback,
  Router,
  RouterMatch,
  RouterMatchFunc,
} from "./http-server/main.js";
export {
  Middleware,
  ExpressMiddleware,
  CorsOptions,
  CsrfChecksOptions,
} from "./http-server/middleware.js";
export { BSPlugin } from "./bs-plugin.js";

import * as readline from "node:readline";

// Misc consts here
const LOGGER_APP_NAME = "App";
const DEFAULT_HTTP_SERVER = "Main";

// NOTE: BS_VERSION is replaced with package.json#version by a
// rollup plugin at build time
const VERSION: string = "BS_VERSION";

// Private variables here
const _shutdownHandler = async (): Promise<void> => {
  await bs.exit(0);
};

const _exceptionHandler = async (e: Error) => {
  bs.error("Caught unhandled error - (%s)", e);
  await bs.exit(1);
};

let _finallyHandler = async (): Promise<void> => {
  bs.shutdownMsg("Done!");
};
let _stopHandler = async (): Promise<void> => {
  bs.shutdownMsg("Stopped!");
};
let _restartHandler = async (): Promise<void> => {
  bs.shutdownMsg("Restarted!");
};

let _httpServerMap: Map<string, httpServer.HttpServer>;
let _pluginMap: Map<string, BSPlugin>;
let _sharedStore: Map<string, any>;

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
  // request wrapper
  request: async (
    origin: string,
    path: string,
    reqOptions?: httpReq.ReqOptions,
  ): Promise<httpReq.ReqRes> => {
    return httpReq.request(origin, path, reqOptions);
  },

  // Config helper methods here
  getConfigStr: (
    config: string,
    defaultVal?: string,
    options?: BSConfigOptions,
  ): string => {
    // This either returns a string or it throws
    let value = <string>configMan.get({
      config,
      type: "String",
      defaultVal,
      ...options,
    });

    logConfigManMsgs();

    return value;
  },

  getConfigBool: (
    config: string,
    defaultVal?: boolean,
    options?: BSConfigOptions,
  ): boolean => {
    // This either returns a bool or it throws
    let value = <boolean>configMan.get({
      config,
      type: "Boolean",
      defaultVal,
      ...options,
    });

    logConfigManMsgs();

    return value;
  },

  getConfigNum: (
    config: string,
    defaultVal?: number,
    options?: BSConfigOptions,
  ): number => {
    // This either returns a number or it throws
    let value = <number>configMan.get({
      config,
      type: "Number",
      defaultVal,
      ...options,
    });

    logConfigManMsgs();

    return value;
  },

  // Log convience methods here
  fatal: (...args: any): void => {
    logger.fatal(LOGGER_APP_NAME, ...args);
  },

  error: (...args: any): void => {
    logger.error(LOGGER_APP_NAME, ...args);
  },

  warn: (...args: any): void => {
    logger.warn(LOGGER_APP_NAME, ...args);
  },

  info: (...args: any): void => {
    logger.info(LOGGER_APP_NAME, ...args);
  },

  startupMsg: (...args: any): void => {
    logger.startupMsg(LOGGER_APP_NAME, ...args);
  },

  shutdownMsg: (...args: any): void => {
    logger.shutdownMsg(LOGGER_APP_NAME, ...args);
  },

  debug: (...args: any): void => {
    logger.debug(LOGGER_APP_NAME, ...args);
  },

  trace: (...args: any): void => {
    logger.trace(LOGGER_APP_NAME, ...args);
  },

  force: (...args: any): void => {
    logger.force(LOGGER_APP_NAME, ...args);
  },

  setLogLevel: (level: LogLevel) => {
    logger.setLevel(level);
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

  setRestartHandler: (handler: () => Promise<void>) => {
    _restartHandler = handler;
  },

  exit: async (code: number, hard: boolean = true): Promise<void> => {
    bs.shutdownMsg("Exiting ...");

    // Clear the global and const stores
    _sharedStore.clear();

    // Make sure we stop all of the HttpSevers - probably best to do it first
    for (let httpServer of [..._httpServerMap.values()]) {
      await httpServer.stop();
    }

    // Clear the HttpServer list
    _httpServerMap.clear();

    // Stop the application second
    bs.shutdownMsg("Attempting to stop the application ...");
    await _stopHandler().catch((e) => {
      bs.error(e);
    });

    // Stop the plugins in the reverse order you started them
    for (let plugin of [..._pluginMap.values()].reverse()) {
      bs.shutdownMsg(`Attempting to stop plugin ${plugin.name} ...`);
      await plugin.stopHandler().catch((e) => {
        bs.error(e);
      });
    }

    // Clear the plugin list
    _pluginMap.clear();

    // If there was a finally handler provided then call it last
    if (_finallyHandler !== undefined) {
      bs.shutdownMsg("Calling the 'finally handler' ...");

      await _finallyHandler().catch((e) => {
        bs.error(e);
      });
    }

    // Remove the event handlers for catching exit events
    process.removeListener("SIGINT", _shutdownHandler);
    process.removeListener("SIGTERM", _shutdownHandler);
    process.removeListener("beforeExit", _shutdownHandler);
    process.removeListener("uncaughtException", _exceptionHandler);
    process.removeListener("SIGHUP", bs.restart);

    bs.shutdownMsg("So long and thanks for all the fish!");

    // Check if the exit should also exit the process (a hard stop)
    if (hard) {
      process.exit(code);
    }
  },

  restart: async () => {
    bs.info("Restarting now!");

    // Re-init the logger in case config values have changed
    logger.init();

    // Do a soft exit
    await bs.exit(0, false);
    // Then re-init this bad boy
    init();
    // Now call the users restart handler
    await _restartHandler();
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
  addHttpServer: async (
    networkInterface: string,
    networkPort: number,
    httpConfig: httpServer.HttpConfig = {},
    startServer: boolean = true,
    name: string = DEFAULT_HTTP_SERVER,
  ): Promise<httpServer.HttpServer> => {
    let server = new httpServer.HttpServer(
      name,
      networkInterface,
      networkPort,
      httpConfig,
    );

    // Automatically start the server if requested
    if (startServer) {
      await server.start();
    }

    _httpServerMap.set(name, server);

    return server;
  },

  httpServer: (name: string = DEFAULT_HTTP_SERVER): httpServer.HttpServer => {
    // Check if there are any servers first
    if (_httpServerMap.size === 0) {
      throw Error(`There are no http servers!!`);
    }

    let server = _httpServerMap.get(name);

    // Check if the requested server DOES NOT exist
    if (server === undefined) {
      throw Error(`There is no http servers with the name ${name}`);
    }

    return server;
  },

  addPlugin: (
    name: string,
    pluginClass: new (name: string, options?: any) => BSPlugin,
    config: any = {},
  ): BSPlugin => {
    // Make sure we don't have a duplicate name
    if (_pluginMap.has(name)) {
      throw Error(`There is already a plugin with the name ${name}`);
    }

    // Create the plugin
    let plugin = new pluginClass(name, config);

    // And then cache the plugin
    _pluginMap.set(name, plugin);

    return plugin;
  },

  plugin: (name: string): BSPlugin => {
    // Search for the plugin that has a matching name
    let plugin = _pluginMap.get(name);

    // Check if the plugin DOES NOT exist
    if (plugin === undefined) {
      throw Error(`There is no plugin with the name ${name}`);
    }

    return plugin;
  },

  save: (name: string, value: any): void => {
    _sharedStore.set(name, value);
  },

  retrieve: (name: string): any => {
    return _sharedStore.get(name);
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

// Private functions here
let logConfigManMsgs = (): void => {
  let messages = configMan.getMessages();
  for (let message of messages) {
    logger.startupMsg(LOGGER_APP_NAME, message[0]);
  }
  configMan.clearMessages();
};

function init(): void {
  // Initialise the private variables
  _httpServerMap = new Map();
  _pluginMap = new Map();
  _sharedStore = new Map();

  // Now spit out the versions
  bs.startupMsg(`Bamboo Shell version (${VERSION})`);
  bs.startupMsg(
    `NODE_ENV is (${
      process.env.NODE_ENV === undefined ? "development" : process.env.NODE_ENV
    })`,
  );

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
  // Call resatrt() on a HUP signal
  process.on("SIGHUP", bs.restart);

  // And it's party time!
  bs.startupMsg("Ready to Rock and Roll baby!");
}

// OK - lets light this candle!
init();

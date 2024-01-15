// imports here
import { Logger, LogLevel } from "./logger.js";
import { configMan, ConfigOptions } from "./config-man.js";
import * as httpReq from "./http-req.js";
import * as httpServer from "./http-server/main.js";
import { BSPlugin } from "./bs-plugin.js";

export { Logger, LogLevel } from "./logger.js";
export { ConfigOptions, ConfigError } from "./config-man.js";
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
  SecurityHeadersOptions,
} from "./http-server/middleware.js";
export { BSPlugin } from "./bs-plugin.js";

import * as readline from "node:readline";

// Misc consts here
const LOGGER_APP_NAME = "App";

// NOTE: BS_VERSION is replaced with package.json#version by a
// rollup plugin at build time
const VERSION: string = "BS_VERSION";

// Module private variables here
let _logger: Logger;
let _httpServerList: httpServer.HttpServer[];
let _pluginMap: Map<string, BSPlugin>;
let _sharedStore: Map<string, any>;

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

// Types here
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
  /**
   * Gets a string config value.
   *
   * @param config - The config key to get.
   * @param defaultVal - The default value if config not found.
   * @param options - Options for getting the config.
   * @returns The string config value.
   */
  getConfigStr: (
    config: string,
    defaultVal?: string,
    options?: ConfigOptions,
  ): string => {
    let value = configMan.getStr(config, defaultVal, options);

    logConfigManMsgs();

    return value;
  },

  /**
   * Gets a boolean config value.
   *
   * @param config - The config key to get.
   * @param defaultVal - The default value if config not found.
   * @param options - Options for getting the config.
   * @returns The boolean config value.
   */
  getConfigBool: (
    config: string,
    defaultVal?: boolean,
    options?: ConfigOptions,
  ): boolean => {
    let value = configMan.getBool(config, defaultVal, options);

    logConfigManMsgs();

    return value;
  },

  /**
   * Gets a number config value.
   *
   * @param config - The config key to get.
   * @param defaultVal - The default value if config not found.
   * @param options - Options for getting the config.
   * @returns The number config value.
   */
  getConfigNum: (
    config: string,
    defaultVal?: number,
    options?: ConfigOptions,
  ): number => {
    let value = <number>configMan.getNum(config, defaultVal, options);

    logConfigManMsgs();

    return value;
  },

  // Log convience methods here
  fatal: (...args: any): void => {
    _logger.fatal(...args);
  },

  error: (...args: any): void => {
    _logger.error(...args);
  },

  warn: (...args: any): void => {
    _logger.warn(...args);
  },

  info: (...args: any): void => {
    _logger.info(...args);
  },

  startupMsg: (...args: any): void => {
    _logger.startupMsg(...args);
  },

  shutdownMsg: (...args: any): void => {
    _logger.shutdownMsg(...args);
  },

  debug: (...args: any): void => {
    _logger.debug(...args);
  },

  trace: (...args: any): void => {
    _logger.trace(...args);
  },

  force: (...args: any): void => {
    _logger.force(...args);
  },

  setLogLevel: (level: LogLevel) => {
    _logger.setLevel(level);
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
    _logger = new Logger(LOGGER_APP_NAME);

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
  ): Promise<httpServer.HttpServer> => {
    let server = new httpServer.HttpServer(
      networkInterface,
      networkPort,
      httpConfig,
    );

    // Automatically start the server if requested
    if (startServer) {
      await server.start();
    }

    _httpServerList.push(server);

    return server;
  },

  httpServer: (index: number = 0): httpServer.HttpServer => {
    // Check if there are any http servers first
    if (_httpServerList.length === 0) {
      throw Error(`There are no http servers!!`);
    }

    // Check if the requested server DOES NOT exist
    if (index >= _httpServerList.length) {
      throw Error(`There is no http servers with the index ${index}`);
    }

    return _httpServerList[index];
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
    if (_sharedStore.has(name)) {
      throw Error(`There is already a value saved with the name ${name}`);
    }

    _sharedStore.set(name, value);
  },

  update: (name: string, value: any): void => {
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
    _logger.startupMsg(message[0]);
  }
  configMan.clearMessages();
};

function init(): void {
  // Initialise the private variables
  _logger = new Logger(LOGGER_APP_NAME);
  _httpServerList = [];
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

// imports here
import { configMan } from "./config-man.js";

import * as util from "node:util";

// Config consts here
const CFG_LOG_LEVEL = "LOG_LEVEL";
const CFG_LOG_TIMESTAMP = "LOG_TIMESTAMP";
const CFG_LOG_TIMESTAMP_LOCALE = "LOG_TIMESTAMP_LOCALE";
const CFG_LOG_TIMESTAMP_TZ = "LOG_TIMESTAMP_TZ";

// Enums here
export enum LogLevel {
  COMPLETE_SILENCE = 0, // Nothing - not even fatals
  QUIET = 100, // Log nothing except fatals, errors and warnings
  INFO = 200, // Log info messages
  START_UP = 250, // Log start up (and shutdown) as well as info messages
  DEBUG = 300, // Log debug messages
  TRACE = 400, // Log trace messages
}

// Private variables here
let _timestamp: boolean;
let _timestampLocale: string;
let _timestampTz: string;
let _logLevel: LogLevel;

// Private functions here
/**
 * Generates a timestamp string to prefix log messages.
 * Returns an empty string if timestamps are disabled. Otherwise returns
 * the formatted timestamp string.
 */
function timestamp(): string {
  // If we are not supposed to generate timestamps then return nothing
  if (!_timestamp) {
    return "";
  }

  let now = new Date();

  if (_timestampLocale === "ISO") {
    // Make sure to add a trailing space!
    return `${now.toISOString()} `;
  }

  // Make sure to add a trailing space!
  return `${now.toLocaleString(_timestampLocale, {
    timeZone: _timestampTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    fractionalSecondDigits: 3,
  })} `;
}

// Logger class here
export const logger = Object.freeze({
  init(): void {
    _timestamp = configMan.getBool(CFG_LOG_TIMESTAMP, false);
    _timestampLocale = configMan.getStr(CFG_LOG_TIMESTAMP_LOCALE, "ISO");
    _timestampTz = configMan.getStr(CFG_LOG_TIMESTAMP_TZ, "UTC");

    let level = configMan.getStr(CFG_LOG_LEVEL, "");

    switch (level.toUpperCase()) {
      case "": // This is in case it is not set
        _logLevel = LogLevel.INFO;
        break;
      case "SILENT":
        _logLevel = LogLevel.COMPLETE_SILENCE;
        break;
      case "QUIET":
        _logLevel = LogLevel.QUIET;
        break;
      case "INFO":
        _logLevel = LogLevel.INFO;
        break;
      case "STARTUP":
        _logLevel = LogLevel.START_UP;
        break;
      case "DEBUG":
        _logLevel = LogLevel.DEBUG;
        break;
      case "TRACE":
        _logLevel = LogLevel.TRACE;
        break;
      default:
        throw new Error(`${CFG_LOG_LEVEL} (${level}) is unknown.`);
    }

    // Now get the messages from the confgiMan for display
    let messages = configMan.getMessages();
    for (const message of messages) {
      logger.startupMsg("Logger", message[0]);
    }
    configMan.clearMessages();
  },

  fatal(tag: string, ...args: any): void {
    // fatals are always logged
    let msg = util.format(
      `${timestamp()}FATAL: ${tag}: ${args[0]}`,
      ...args.slice(1),
    );
    console.error(msg);
  },

  error(tag: string, ...args: any): void {
    // errors are always logged unless level = LOG_COMPLETE_SILENCE
    if (_logLevel > LogLevel.COMPLETE_SILENCE) {
      let msg = util.format(
        `${timestamp()}ERROR: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.error(msg);
    }
  },

  warn(tag: string, ...args: any): void {
    // warnings are always logged unless level = LOG_COMPLETE_SILENCE
    if (_logLevel > LogLevel.COMPLETE_SILENCE) {
      let msg = util.format(
        `${timestamp()}WARN: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.warn(msg);
    }
  },

  info(tag: string, ...args: any): void {
    if (_logLevel >= LogLevel.INFO) {
      let msg = util.format(
        `${timestamp()}INFO: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  },

  startupMsg(tag: string, ...args: any): void {
    if (_logLevel >= LogLevel.START_UP) {
      let msg = util.format(
        `${timestamp()}STARTUP: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  },

  shutdownMsg(tag: string, ...args: any): void {
    if (_logLevel >= LogLevel.START_UP) {
      let msg = util.format(
        `${timestamp()}SHUTDOWN: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  },

  debug(tag: string, ...args: any): void {
    if (_logLevel >= LogLevel.DEBUG) {
      let msg = util.format(
        `${timestamp()}DEBUG: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  },

  trace(tag: string, ...args: any): void {
    if (_logLevel >= LogLevel.TRACE) {
      let msg = util.format(
        `${timestamp()}TRACE: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  },

  force(tag: string, ...args: any): void {
    // forces are always logged even if level == LOG_COMPLETE_SILENCE
    let msg = util.format(
      `${timestamp()}FORCED: ${tag}: ${args[0]}`,
      ...args.slice(1),
    );
    console.error(msg);
  },

  setLevel(level: LogLevel) {
    _logLevel = level;
  },
});

// Time to setup this logger - init?!!
logger.init();

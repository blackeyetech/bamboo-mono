// imports here
import { configMan } from "./config-man.js";

import * as util from "node:util";

// Config consts here
const CFG_LOG_LEVEL = "LOG_LEVEL";
const CFG_LOG_TIMESTAMP = "LOG_TIMESTAMP";
const CFG_LOG_TIMESTAMP_LOCALE = "LOG_TIMESTAMP_LOCALE";
const CFG_LOG_TIMESTAMP_TZ = "LOG_TIMESTAMP_TZ";

// Types here
export enum LogLevel {
  COMPLETE_SILENCE = 0, // Nothing - not even fatals
  QUIET = 100, // Log nothing except fatals, errors and warnings
  INFO = 200, // Log info messages
  START_UP = 250, // Log start up (and shutdown) as well as info messages
  DEBUG = 300, // Log debug messages
  TRACE = 400, // Log trace messages
}

// Logger class here
export class Logger {
  // Private properties here
  private _name: string;

  private _timestamp: boolean;
  private _timestampLocale: string;
  private _timestampTz: string;
  private _logLevel: LogLevel;

  // Private methods here
  /**
   * Generates a timestamp string to prefix log messages.
   * Returns an empty string if timestamps are disabled. Otherwise returns
   * the formatted timestamp string.
   */
  private timestamp(): string {
    // If we are not supposed to generate timestamps then return nothing
    if (!this._timestamp) {
      return "";
    }

    let now = new Date();

    if (this._timestampLocale === "ISO") {
      // Make sure to add a trailing space!
      return `${now.toISOString()} `;
    }

    // Make sure to add a trailing space!
    return `${now.toLocaleString(this._timestampLocale, {
      timeZone: this._timestampTz,
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

  private convertLevel(level: string): LogLevel {
    let logLevel: LogLevel;

    switch (level.toUpperCase()) {
      case "": // This is in case it is not set
        logLevel = LogLevel.INFO;
        break;
      case "SILENT":
        logLevel = LogLevel.COMPLETE_SILENCE;
        break;
      case "QUIET":
        logLevel = LogLevel.QUIET;
        break;
      case "INFO":
        logLevel = LogLevel.INFO;
        break;
      case "STARTUP":
        logLevel = LogLevel.START_UP;
        break;
      case "DEBUG":
        logLevel = LogLevel.DEBUG;
        break;
      case "TRACE":
        logLevel = LogLevel.TRACE;
        break;
      default:
        throw new Error(`Log Level (${level}) is unknown.`);
    }

    return logLevel;
  }

  // constructor here
  constructor(name: string) {
    this._name = name;
    this._timestamp = configMan.getBool(CFG_LOG_TIMESTAMP, false);
    this._timestampLocale = configMan.getStr(CFG_LOG_TIMESTAMP_LOCALE, "ISO");
    this._timestampTz = configMan.getStr(CFG_LOG_TIMESTAMP_TZ, "UTC");

    this._logLevel = this.convertLevel(configMan.getStr(CFG_LOG_LEVEL, ""));

    // Now get the messages from the confgiMan for display
    let messages = configMan.getMessages();
    for (const message of messages) {
      this.startupMsg("Logger", message[0]);
    }

    configMan.clearMessages();
  }

  fatal(...args: any): void {
    // fatals are always logged
    let msg = util.format(
      `${this.timestamp()}FATAL: ${this._name}: ${args[0]}`,
      ...args.slice(1),
    );
    console.error(msg);
  }

  error(...args: any): void {
    // errors are always logged unless level = LOG_COMPLETE_SILENCE
    if (this._logLevel > LogLevel.COMPLETE_SILENCE) {
      let msg = util.format(
        `${this.timestamp()}ERROR: ${this._name}: ${args[0]}`,
        ...args.slice(1),
      );
      console.error(msg);
    }
  }

  warn(...args: any): void {
    // warnings are always logged unless level = LOG_COMPLETE_SILENCE
    if (this._logLevel > LogLevel.COMPLETE_SILENCE) {
      let msg = util.format(
        `${this.timestamp()}WARN: ${this._name}: ${args[0]}`,
        ...args.slice(1),
      );
      console.warn(msg);
    }
  }

  info(...args: any): void {
    if (this._logLevel >= LogLevel.INFO) {
      let msg = util.format(
        `${this.timestamp()}INFO: ${this._name}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  }

  startupMsg(...args: any): void {
    if (this._logLevel >= LogLevel.START_UP) {
      let msg = util.format(
        `${this.timestamp()}STARTUP: ${this._name}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  }

  shutdownMsg(...args: any): void {
    if (this._logLevel >= LogLevel.START_UP) {
      let msg = util.format(
        `${this.timestamp()}SHUTDOWN: ${this._name}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  }

  debug(...args: any): void {
    if (this._logLevel >= LogLevel.DEBUG) {
      let msg = util.format(
        `${this.timestamp()}DEBUG: ${this._name}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  }

  trace(...args: any): void {
    if (this._logLevel >= LogLevel.TRACE) {
      let msg = util.format(
        `${this.timestamp()}TRACE: ${this._name}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  }

  force(...args: any): void {
    // forces are always logged even if level == LOG_COMPLETE_SILENCE
    let msg = util.format(
      `${this.timestamp()}FORCED: ${this._name}: ${args[0]}`,
      ...args.slice(1),
    );
    console.error(msg);
  }

  setLevel(level: LogLevel) {
    this._logLevel = level;
  }
}

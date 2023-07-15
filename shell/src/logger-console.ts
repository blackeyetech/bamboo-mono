import { AbstractLogger, LogLevel } from "./logger.js";

import * as util from "node:util";

// LoggerConsole class here
export class LoggerConsole extends AbstractLogger {
  constructor(
    timestamp: boolean,
    timestampLocale: string,
    timestampTz: string,
    logLevel: string,
  ) {
    super(timestamp, timestampLocale, timestampTz, logLevel);
  }

  fatal(tag: string, ...args: any): void {
    // fatals are always logged
    let msg = util.format(
      `${this.timestamp()}FATAL: ${tag}: ${args[0]}`,
      ...args.slice(1),
    );
    console.error(msg);
  }

  error(tag: string, ...args: any): void {
    // errors are always logged unless level = LOG_COMPLETE_SILENCE
    if (this._level > LogLevel.COMPLETE_SILENCE) {
      let msg = util.format(
        `${this.timestamp()}ERROR: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.error(msg);
    }
  }

  warn(tag: string, ...args: any): void {
    // warnings are always logged unless level = LOG_COMPLETE_SILENCE
    if (this._level > LogLevel.COMPLETE_SILENCE) {
      let msg = util.format(
        `${this.timestamp()}WARN: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.warn(msg);
    }
  }

  info(tag: string, ...args: any): void {
    if (this._level >= LogLevel.INFO) {
      let msg = util.format(
        `${this.timestamp()}INFO: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  }

  startupMsg(tag: string, ...args: any): void {
    if (this._level >= LogLevel.START_UP) {
      let msg = util.format(
        `${this.timestamp()}STARTUP: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  }

  shutdownMsg(tag: string, ...args: any): void {
    if (this._level >= LogLevel.START_UP) {
      let msg = util.format(
        `${this.timestamp()}SHUTDOWN: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  }

  debug(tag: string, ...args: any): void {
    if (this._level >= LogLevel.DEBUG) {
      let msg = util.format(
        `${this.timestamp()}DEBUG: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  }

  trace(tag: string, ...args: any): void {
    if (this._level >= LogLevel.TRACE) {
      let msg = util.format(
        `${this.timestamp()}TRACE: ${tag}: ${args[0]}`,
        ...args.slice(1),
      );
      console.info(msg);
    }
  }

  force(tag: string, ...args: any): void {
    // forces are always logged even if level == LOG_COMPLETE_SILENCE
    let msg = util.format(
      `${this.timestamp()}FORCED: ${tag}: ${args[0]}`,
      ...args.slice(1),
    );
    console.error(msg);
  }
}

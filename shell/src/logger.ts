// Log levels
export enum LogLevel {
  COMPLETE_SILENCE = 0, // Nothing - not even fatals
  QUIET = 100, // Log nothing except fatals, errors and warnings
  INFO = 200, // Log info messages
  START_UP = 250, // Log start up (and shutdown) as well as info messages
  DEBUG = 300, // Log debug messages
  TRACE = 400, // Log trace messages
}

// Logger class here
export abstract class AbstractLogger {
  protected _timestamp: boolean;
  protected _timestampLocale: string;
  protected _timestampTz: string;
  protected _level: LogLevel;

  protected _started: boolean;

  constructor(
    timestamp: boolean,
    timestampLocale: string,
    timestampTz: string,
    logLevel: string,
  ) {
    this._started = false;

    this._timestamp = timestamp;
    this._timestampLocale = timestampLocale;
    this._timestampTz = timestampTz;

    switch (logLevel.toUpperCase()) {
      case "": // This is in case it is not set
        this._level = LogLevel.INFO;
        break;
      case "SILENT":
        this._level = LogLevel.COMPLETE_SILENCE;
        break;
      case "QUIET":
        this._level = LogLevel.QUIET;
        break;
      case "INFO":
        this._level = LogLevel.INFO;
        break;
      case "STARTUP":
        this._level = LogLevel.START_UP;
        break;
      case "DEBUG":
        this._level = LogLevel.DEBUG;
        break;
      case "TRACE":
        this._level = LogLevel.TRACE;
        break;
      default:
        this._level = LogLevel.INFO;
        this.warn(
          `LogLevel ${logLevel} is unknown. Setting level to ${
            LogLevel[this._level]
          }.`,
        );
        break;
    }
  }

  start(): void {
    // Override if you need to set something up before logging starts, e.g. open a file

    // Make sure you set started if you override this method
    this._started = true;
  }

  stop(): void {
    // Overide if you need to tidy up before exiting, e.g. close a file

    // Make sure you unset started if you override this method
    this._started = false;
  }

  abstract fatal(tag: string, ...args: any): void;
  abstract error(tag: string, ...args: any): void;
  abstract warn(tag: string, ...args: any): void;
  abstract startupMsg(tag: string, ...args: any): void;
  abstract shutdownMsg(tag: string, ...args: any): void;
  abstract info(tag: string, ...args: any): void;
  abstract debug(tag: string, ...args: any): void;
  abstract trace(tag: string, ...args: any): void;
  abstract force(tag: string, ...args: any): void;

  set level(level: LogLevel) {
    this._level = level;
  }

  set logTimestamps(log: boolean) {
    this._timestamp = log;
  }

  set logTimestampLocale(locale: string) {
    this._timestampLocale = locale;
  }

  set logTimestampTz(tz: string) {
    this._timestampTz = tz;
  }

  get started(): boolean {
    return this._started;
  }

  protected timestamp(): string {
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
}

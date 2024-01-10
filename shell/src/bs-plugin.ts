// imports here
import { Logger } from "./logger.js";

// BSPlugin class here
export class BSPlugin {
  private _name: string;
  private _version: string;
  private _logger: Logger;

  // Constructor here
  constructor(name: string, version: string) {
    this._name = name;
    this._version = version;
    this._logger = new Logger(this._name);

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

  get stopHandler(): () => Promise<void> {
    return this.stop;
  }

  // Protected methods here

  // Log convinence methods
  protected fatal(...args: any): void {
    this._logger.fatal(...args);
  }

  protected error(...args: any): void {
    this._logger.error(...args);
  }

  protected warn(...args: any): void {
    this._logger.warn(...args);
  }

  protected info(...args: any): void {
    this._logger.info(...args);
  }

  protected startupMsg(...args: any): void {
    this._logger.startupMsg(...args);
  }

  protected shutdownMsg(...args: any): void {
    this._logger.shutdownMsg(...args);
  }

  protected debug(...args: any): void {
    this._logger.debug(...args);
  }

  protected trace(...args: any): void {
    this._logger.trace(...args);
  }

  protected force(...args: any): void {
    this._logger.force(...args);
  }
}

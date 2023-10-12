// imports here
import { logger } from "./logger.js";

// BSPlugin class here
export class BSPlugin {
  // Constructor here
  constructor(
    private _name: string,
    private _version: string,
  ) {
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
    logger.fatal(this._name, ...args);
  }

  protected error(...args: any): void {
    logger.error(this._name, ...args);
  }

  protected warn(...args: any): void {
    logger.warn(this._name, ...args);
  }

  protected info(...args: any): void {
    logger.info(this._name, ...args);
  }

  protected startupMsg(...args: any): void {
    logger.startupMsg(this._name, ...args);
  }

  protected shutdownMsg(...args: any): void {
    logger.shutdownMsg(this._name, ...args);
  }

  protected debug(...args: any): void {
    logger.debug(this._name, ...args);
  }

  protected trace(...args: any): void {
    logger.trace(this._name, ...args);
  }

  protected force(...args: any): void {
    logger.force(this._name, ...args);
  }
}

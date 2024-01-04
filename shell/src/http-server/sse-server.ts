// imports here
import * as http from "node:http";

export type SseServerOptions = {
  retryInterval?: number; // In seconds
  pingInterval?: number; // In seconds
  pingEventName?: string;
};

// SseServer class here
export class SseServer {
  private _res: http.ServerResponse;
  private _lastEventId?: string;
  private _pingSeqNum: number;

  constructor(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    opts: SseServerOptions,
  ) {
    let retryInterval = opts.retryInterval ?? 0;
    let pingInterval = opts.pingInterval ?? 0;

    this._res = res;
    this._lastEventId = <string>req.headers["last-event-id"];
    this._pingSeqNum = 0;

    // Set up the basics first
    req.socket.setKeepAlive(true);
    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Cache-Control", "no-cache");
    res.statusCode = 200;

    // Check if we should set a new delay interval
    if (retryInterval > 0) {
      this.setRetry(retryInterval);
    }

    // Check if we should setup a heartbeat ping
    if (pingInterval > 0) {
      let event = opts.pingEventName ?? "ping";

      // Setup a timer to send the heartbeat
      let interval = setInterval(() => {
        this.sendData(this._pingSeqNum, { event });
        // Don't forget to increment the ping seq num
        this._pingSeqNum += 1;
      }, pingInterval * 1000);

      // Make sure to stop the timer if the connection closes
      res.addListener("close", () => {
        clearInterval(interval);
      });
    }
  }

  get lastEventId(): string | undefined {
    return this._lastEventId;
  }

  setRetry(delay: number): void {
    this._res.write(`retry: ${delay}\n\n`);
  }

  sendData(
    data: object | unknown[] | string | number,
    options: {
      event?: string;
      id?: number;
    },
  ): void {
    if (options?.event !== undefined) {
      this._res.write(`event: ${options.event}\n`);
    }

    if (options?.id !== undefined) {
      this._res.write(`id: ${options.id}\n`);
    }

    // Rem an array is an object!
    if (typeof data === "object") {
      this._res.write(`data: ${JSON.stringify(data)}\n\n`);
    } else {
      this._res.write(`data: ${data}\n\n`);
    }
  }

  close(): void {
    this._res.end();
  }
}

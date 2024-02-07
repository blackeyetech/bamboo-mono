import * as HttpProxy from "http-proxy";
import { bs, ServerResponse } from "@bs-core/shell";

import * as http from "node:http";

await bs.addHttpServer("lo", 9000, {});

const router = bs.httpServer().addRouter("/appman");

router.all(
  "/",
  async (req, res) => {
    // We have to return a Promise because
    return new Promise((resolve, reject) => {
      const proxy = HttpProxy.default.createProxyServer({
        target: "http://127.0.0.1:9001",
        selfHandleResponse: true,
      });

      proxy.on("error", (e: Error, _: http.IncomingMessage) => {
        bs.error("Error happened while proxying - (%s)", e);

        reject();
      });

      // We have to handle the response

      proxy.on(
        "proxyRes",
        (
          proxyRes: http.IncomingMessage,
          _: http.IncomingMessage,
          res: http.ServerResponse,
        ) => {
          const serverRes = res as ServerResponse;
          let body: any = [];

          proxyRes.on("data", (chunk: any) => {
            body.push(chunk);
          });

          proxyRes.on("end", () => {
            body = Buffer.concat(body).toString();
            for (let header in proxyRes.headers) {
              serverRes.setHeader(header, proxyRes.headers[header] as string);
            }

            serverRes.body = body;

            resolve();
          });
        },
      );

      proxy.web(req, res);
    });
  },

  {
    generateMatcher: () => {
      return () => {
        return { matchedInfo: {}, params: {} };
      };
    },
  },
);

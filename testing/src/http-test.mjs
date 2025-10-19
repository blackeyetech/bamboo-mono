import { bs } from "@bs-core/shell";
import * as crypto from "node:crypto";
// import { performance } from "node:perf_hooks";

bs.info("Https no servers yet? %j", bs.httpServerReady());
const server = await bs.addHttpServer({
  networkInterface: "lo",
  networkPort: 8088,
  loggerTag: "HttpMan",
  baseUrl: "/kfn",
});
bs.info("Https no servers yet? %j", bs.httpServerReady());

server.router().get("/test", (req, res) => {
  bs.info("%j", req.headers);
  bs.info(req.getBearerToken());
  bs.info("qry %j", req.urlObj.searchParams.get("kfn"));
});

let secret1 = Buffer.from("Hello world!");

const key1 = crypto.randomBytes(32);
const res1 = bs.encryptSecret(secret1, key1);

const dec1 = bs.decryptSecret(res1, key1);
bs.info("%s - %j", typeof dec1, dec1);

let secret2 = "Hello world!";
const key2 = crypto.randomBytes(32);
const res2 = bs.encryptSecret(secret2, key2);

const dec2 = bs.decryptSecret(res2, key2);
bs.info("%s - %j", typeof dec2, dec2);

bs.request("http://127.0.0.1:8088", `/api/test?kfn=oo`, {
  bearerToken: "XXXX",
}).catch((e) => {
  bs.error("%s", e);
});

bs.info("%s", server.router("/api").basePath);
// if (res !== null) {
//   const start = performance.now();

//   for (let i = 0; i < 1000; i++) {
//     // bs.info("%j", bs.decryptSecret(res, Buffer.alloc(32, 1)));
//     bs.decryptSecret(res, Buffer.alloc(32, 1));
//     bs.decryptSecret(res, Buffer.alloc(32, 1));
//     bs.decryptSecret(res, Buffer.alloc(32, 1));
//   }

//   bs.info("Time: %d", performance.now() - start);
// }

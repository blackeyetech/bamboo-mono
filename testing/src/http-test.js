import { bs } from "@bs-core/shell";
// import { performance } from "node:perf_hooks";

const server = await bs.addHttpServer({
  networkInterface: "lo",
  networkPort: 8088,
  loggerTag: "HttpMan",
});

server.router().get("/test", (req, res) => {
  res.json = req.getBearerToken();
});

// let secret = "Hello world!";

// bs.info("%d", secret.length);

// const res = bs.encryptSecret(secret, Buffer.alloc(32, 1));

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

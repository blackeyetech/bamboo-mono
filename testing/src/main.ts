import {
  bs,
  ReqAborted,
  ReqError,
  HttpServer,
  Middleware,
  EndpointCallback,
  HttpError,
} from "@bs-core/shell";

// import * as http from "node:http";

// process.on("uncaughtException", (e) => {
//   sh.error("caught %s)", e);
//   // sh.exit(1);
// });

bs.setStopHandler(async () => {
  bs.shutdownMsg("Bye 1!");
});

bs.setFinallyHandler(async () => {
  bs.shutdownMsg("Bye 2!");
});

bs.info("Hello world");

// let b = $.getConfigBool({ config: "XXX", defaultVal: true });
// $.info("Bool (%j)", b);
// let s = $.getConfigStr({ config: "XXX", defaultVal: "" });
// $.info("String (%j)", s);
let n = bs.getConfigStr("XXX", "Noine", { cmdLineFlag: "x" });
bs.info("XXX (%j)", n);

// let s: string;
// let error = async () => {
// console.log(s.length);
// };

// await error().catch((e) => console.log(e));

let res = await bs
  .request("https://httpbin.org", "/bearer", {
    method: "GET",
    timeout: 3,
  })
  .catch((e) => {
    if (e instanceof ReqAborted) {
      bs.info(e.message);
    } else if (e instanceof ReqError) {
      bs.error("%s: %s", e.status, e.message);
    }
  });

bs.info("%j", res);

// for (let header of res.headers.entries()) {
//   sh.info("Header: %s: %s", header[0], header[1]);
// }

// let answer = await BambooShell.question("Hit return to continue?");
// sh.info("You are doing %s", answer);

// sh.shutdownError();

bs.trace("Traced!");

let middleware1: Middleware = async (_1, _2, next) => {
  let now = new Date().valueOf();
  bs.info("in the middle of one");
  // details.body = Buffer.from("howdy");
  await next();
  let time = new Date().valueOf() - now;
  bs.info("finished the middle one - %s", time);
  // throw new HttpError(500, "middleware error help me!");
};

let middleware2: Middleware = async (_1, _2, next) => {
  bs.info("in the middle of two");
  await next();
  bs.info("finished the middle two");
};

await bs.addHttpServer("lo", 8080, {
  loggerTag: "HttpMan1",
  defaultMiddlewareList: [
    HttpServer.body(),
    HttpServer.json(),
    middleware1,
    middleware2,
  ],
});

let httpMan2 = await bs.addHttpServer("lo", 8081, {
  loggerTag: "HttpMan2",
  defaultMiddlewareList: [HttpServer.body(), HttpServer.json(), middleware2],
});
// httpMan.healthcheck(() => {
//   sh.info("Helllo!!!");
//   return false;
// });
// // sh.sleep(2);

// // sh.httpMan.addMiddleware(async (req, res, details, next) => {
// //   sh.info("in the middle of three");
// //   // await sh.sleep(5);
// //   await next();
// //   sh.info("finished the middle three");
// // });

// const User = z.object({
//   a: z.string(),
//   b: z.string(),
// });

bs.info(httpMan2.baseUrl);

bs.httpServer(0)?.endpoint(
  "POST",
  "/test/:id",
  (_, res) => {
    // // res.setHeader("Access-Control-Allow-Origin", "*");

    // // sh.info("q=%s", details.url.searchParams.get("q"));
    // // sh.info("r=%s", details.url.searchParams.get("r"));
    // // sh.info("id=%s", details.params.id);
    // sh.info("body=%s", details.middlewareProps.body);
    // sh.info("jsonBody=%s", details.middlewareProps.json);
    // // sh.info("headers=%s", req.headers);

    // if (details.params.id === "1") {
    //   throw new HttpError(400, "fool!");
    // }

    res.statusCode = 200;
    res.json = { hello: "kieran" };
  },

  {
    middlewareList: [middleware1, middleware2],
    corsOptions: {
      enable: true,
      headersAllowed: "*",
      originsAllowed: ["https://test-cors.org"],
      credentialsAllowed: true,
    },
  },
);

let pong: EndpointCallback = (req, res) => {
  bs.info("pinged");
  for (let header in req.headers) {
    bs.info("Header: %s: %s", header, req.headers[header]);
  }

  if (req.sseServer === undefined) {
    return;
  }

  // res.setHeader("Access-Control-Allow-Origin", "*");
  let i = 1;
  bs.info("last event id: %s", req.sseServer?.lastEventId);

  res.addListener("close", () => {
    console.log("closed!");
  });
  setInterval(
    () => {
      i += 1;
      req.sseServer?.sendData(i, { id: i });
    },
    1000,
    res,
    bs,
  );
};

bs.httpServer(0)?.endpoint("GET", "/ping", pong, {
  sseServerOptions: { pingInterval: 10, pingEventName: "ev1" },
});

bs.httpServer(0)?.endpoint("GET", "/html", async (_, res) => {
  res.html = "<html><p>Hello from 1</p></html>";
});

bs.httpServer(0)?.endpoint("GET", "/text", async (_, res) => {
  throw new HttpError(500, "endpoint error help me!");

  res.text = "Hello";
});

bs.httpServer(0)?.endpoint(
  "GET",
  "/test",
  async (_, res) => {
    res.text = "";
  },
  { defaultMiddlewares: false },
);

bs.httpServer(0)?.endpoint("GET", "/json", (_, res) => {
  res.json = { url: "login" };
});

bs.httpServer(0)?.endpoint("GET", "/test2", async (_, res) => {
  res.statusCode = 201;
  res.end();
});

bs.httpServer(0)?.addHealthcheck(async () => false);

await bs.sleep(5);

bs.setRestartHandler(async () => {
  bs.info("We are restarting!!!");

  httpMan2 = await bs.addHttpServer("lo", 8081, {
    loggerTag: "HttpMan2",
    defaultMiddlewareList: [HttpServer.body(), HttpServer.json(), middleware2],
  });
});

// bs.restart();

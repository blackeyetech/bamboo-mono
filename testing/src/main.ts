import {
  bs,
  ReqAborted,
  ReqError,
  HttpServer,
  Middleware,
  EndpointCallback,
  HttpError,
} from "@bs-core/shell";

import { Jira, JiraConfig } from "@bs-plugins/jira";
import { Template } from "@bs-plugins/template";

import helmet from "helmet";

// import * as http from "node:http";
async function init() {
  let options: JiraConfig = { password: "", server: "", user: "" };
  bs.addPlugin("t1", Jira, options);
  bs.addPlugin("t2", Jira, options);
  bs.addPlugin("t3", Jira, options);
  bs.addPlugin("t4", Template);

  let httpMan1 = await bs.addHttpServer("lo", 8080, {
    loggerTag: "HttpMan1",
    staticFileServer: {
      path: "/home/parallels/dev/src/oit/mdrp/frontend/bootstrap3",
      extraContentTypes: { world: "application/octect" },
    },
  });

  httpMan1.use(HttpServer.body());
  httpMan1.use(HttpServer.json());
  httpMan1.use(
    HttpServer.cors({
      headersAllowed: "*",
      originsAllowed: "*",
      credentialsAllowed: false,
    }),
  );
  httpMan1.use(HttpServer.expressWrapper(helmet()));
  httpMan1.use(
    HttpServer.secHeaders({
      headers: [
        { name: "x-test1", value: "kewl" },
        { name: "x-test2", value: "kewler" },
      ],
    }),
  );

  bs.save("hs", httpMan1);

  bs.httpServer().endpoint(
    "PUT",
    "/api/test/:id",
    (req, res) => {
      bs.info(req.body);
      bs.info("%j", req.json);
      res.json = { hello: "kieran" };
    },

    {
      middlewareList: [
        HttpServer.csrf({
          checkType: "naive-double-submit-cookie",
          cookie: "X-CSRF-HEADER",
        }),
        // HttpServer.cors({
        //   headersAllowed: "*",
        //   originsAllowed: "*",
        //   credentialsAllowed: false,
        // }),
      ],
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

  bs.httpServer().endpoint("GET", "/api/ping", pong, {
    sseServerOptions: { pingInterval: 10, pingEventName: "ev1" },
  });

  let hs = <HttpServer>bs.retrieve("hs");
  hs.get(
    "/api/html",
    async (_, res) => {
      res.body = "<html><p>Hello from 1</p></html>";
      res.setHeader("content-type", "text/html; charset=utf-8");

      res.serverTimingsMetrics.push({ name: "html", duration: 3.33 });
    },
    {
      middlewareList: [middleware2, middleware2],
    },
  );

  bs.httpServer().get("/api/text", async (_1, _2) => {
    throw new HttpError(500, "endpoint error help me!");
  });

  bs.httpServer().get(
    "/api/test",
    async (_, res) => {
      res.body = "";
    },
    { defaultMiddlewares: false },
  );

  bs.httpServer().endpoint(
    "GET",
    "/api/json",
    (req, res) => {
      console.log(req.url);
      res.statusCode = 201;
      res.json = { url: "login" };
    },
    { etag: false },
  );

  bs.httpServer().addHealthcheck(async () => false);
}

bs.setStopHandler(async () => {
  bs.shutdownMsg("Bye 1!");
});

bs.setFinallyHandler(async () => {
  bs.shutdownMsg("Bye 2!");
});

bs.trace("(%s) (%s)", "hello", "world");

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

// let middleware1: Middleware = async (_1, _2, next) => {
//   let now = new Date().valueOf();
//   bs.info("in the middle of one");
//   // details.body = Buffer.from("howdy");
//   await next();
//   let time = new Date().valueOf() - now;
//   bs.info("finished the middle one - %s", time);
//   throw new HttpError(500, "middleware error help me!");
// };

let middleware2: Middleware = async (_1, _2, next) => {
  bs.info("in the middle of two");
  await next();
  bs.info("finished the middle two");
};

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

await bs.sleep(2);

bs.save("test1", 1);
let test1 = bs.retrieve("test1");
bs.info("test1 is %j", test1);

bs.save("test1", "hello");
test1 = bs.retrieve("test1");
bs.info("test1 is %j", test1);

// bs.restart();

bs.setRestartHandler(init);
await init();

let t1 = bs.plugin("t1");
bs.info(t1.name);
let t2 = bs.plugin("t2");
bs.info(t2.name);
let t3 = bs.plugin("t3");
bs.info(t3.name);
let t4 = bs.plugin("t4");
bs.info(t4.name);

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

// import * as http from "node:http";
async function init() {
  let jOptions: JiraConfig = { password: "", server: "", user: "" };
  bs.addPlugin("t1", Jira, jOptions);
  bs.addPlugin("t2", Jira, jOptions);
  bs.addPlugin("t3", Jira, jOptions);
  bs.addPlugin("t4", Template);

  let httpMan1 = await bs.addHttpServer("lo", 8080);

  httpMan1.use(HttpServer.body({}));
  httpMan1.use(HttpServer.json());
  httpMan1.use(
    HttpServer.cors({
      headersAllowed: "*",
      originsAllowed: "*",
      credentialsAllowed: false,
    }),
  );
  httpMan1.use(
    HttpServer.secHeaders({
      headers: [
        { name: "x-test1", value: "kewl" },
        { name: "x-test2", value: "kewler" },
        { name: "X-Frame-Options", value: "DENY" },
      ],
    }),
  );

  bs.save("hs", httpMan1);

  bs.httpServer().endpoint(
    "PUT",
    "/test/:id",
    (req, res) => {
      bs.info(req.body);
      bs.info("%j", req.json);
      res.json = { hello: req.params["id"] };
    },

    {
      middlewareList: [
        // HttpServer.csrf({
        //   checkType: "naive-double-submit-cookie",
        //   cookie: "X-CSRF-HEADER",
        // }),
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

  bs.httpServer().get("/ping", pong, {
    sseServerOptions: { pingInterval: 10, pingEventName: "ev1" },
  });

  let hs = <HttpServer>bs.retrieve("hs");
  hs.get(
    "/html",
    async (_, res) => {
      res.body = "<html><p>Hello from 1</p></html>";
      res.setHeader("content-type", "text/html; charset=utf-8");

      res.serverTimingsMetrics.push({ name: "html", duration: 3.33 });
    },
    {
      middlewareList: [middleware2, middleware2],
    },
  );

  hs.post(
    "/json",
    async (req, res) => {
      bs.info("received %j", req.body?.toString());
      bs.info("%j", req.headers);
      res.serverTimingsMetrics.push({ name: "json", duration: 3.33 });
    },
    {
      middlewareList: [HttpServer.body()],
    },
  );

  bs.httpServer()
    .route("/text")
    .get(async (_1, _2) => {
      throw new HttpError(500, "get endpoint error help me!");
    })
    .put(async (_1, _2) => {
      throw new HttpError(500, "put endpoint error help me!");
    })
    .del(async (_1, _2) => {
      throw new HttpError(500, "del endpoint error help me!");
    });

  let router = bs.httpServer().router("/newp", {
    notFoundHandler: async (_, res) => {
      res.statusCode = 404;
      res.write("Not found sucker!");
      res.end();
    },
  });
  // bs.httpServer().router("/newp/d");

  router
    .route("/text")
    .get(async (_1, res) => {
      res.body = "Hello newp";
    })
    .put(async (_1, _2) => {
      throw new HttpError(500, "put endpoint error help me!");
    })
    .del(async (_1, _2) => {
      throw new HttpError(500, "del endpoint error help me!");
    });

  bs.httpServer().get(
    "/test",
    async (_, res) => {
      res.body = "";
    },
    { useDefaultMiddlewares: false },
  );

  bs.httpServer().endpoint(
    "GET",
    "/json",
    (req, res) => {
      console.log(req.url);
      res.statusCode = 201;
      res.json = { url: "login" };
    },
    { etag: false },
  );

  bs.httpServer().endpoint(
    "GET",
    "/auth/json",
    (req, res) => {
      console.log(req.url);
      res.statusCode = 201;
      res.json = { url: "json" };
    },
    { etag: false },
  );

  bs.httpServer().addHealthcheck(async () => {
    bs.info("Healthy!");
    return true;
  });
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

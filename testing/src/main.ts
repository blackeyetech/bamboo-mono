import {
  bs,
  ReqAborted,
  ReqError,
  HttpServer,
  Middleware,
  EndpointCallback,
  HttpError,
  HttpRedirect,
  Router,
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

  let httpMan1 = await bs.addHttpServer("127.0.0.1", 8080, {
    //healthcheckPath: "/",
    // defaultRouterBasePath: "/",
    staticFileServer: {
      path: "/home/parallels/dev/src/urlbase/appman",
      immutableRegExp: /^.+\.min\.[a-zA-Z0-9-]+$/,
    },
    startInMaintenanceMode: false,
    maintenanceRoute: "/api/main",
  });

  httpMan1.use(Router.body({}));
  httpMan1.use(Router.json());
  httpMan1.use(
    Router.cors({
      headersAllowed: "*",
      originsAllowed: "*",
      credentialsAllowed: false,
    }),
  );
  httpMan1.use(
    Router.secHeaders({
      useDefaultHeaders: true,
      headers: [
        { name: "x-test1", value: "kewl" },
        { name: "x-test2", value: "kewler" },
        { name: "X-Frame-Options", value: "DENY" },
      ],
    }),
  );

  bs.save("hs", httpMan1);

  bs.httpServer().endpoint(
    "GET",
    "/test/:id",
    (req, res) => {
      bs.info(req.body);
      bs.info("%j", req.json);
      res.json = { hello: req.params["id"] };

      res.setCookies([{ name: "test1", value: "test" }]);
      res.setCookies([{ name: "test2", value: "test" }]);
      res.setCookies([{ name: "test3", value: "test" }]);
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

  bs.httpServer().endpoint("GET", "/set-cookie", (req, res) => {
    bs.info(req.body);
    bs.info("%j", req.json);
    res.json = { hello: req.params["id"] };

    res.setCookies([{ name: "test1", value: "test" }]);
    res.setCookies([{ name: "test2", value: "test" }]);
    res.setCookies([{ name: "test3", value: "test" }]);
  });

  bs.httpServer().endpoint("GET", "/clear-cookies", (req, res) => {
    bs.info(req.body);
    bs.info("%j", req.json);
    res.json = { hello: req.params["id"] };

    res.clearCookies(["test1", "test2"]);
  });

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
      res.setHeader("Content-Type", "text/html; charset=utf-8");

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
      middlewareList: [Router.body()],
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

  // let router = bs.httpServer().addRouter("/newp", {
  //   notFoundHandler: async (_, res) => {
  //     res.statusCode = 404;
  //     res.write("Not found sucker!");
  //     res.end();
  //   },
  // });
  // // bs.httpServer().router("/newp/d");

  // router
  //   .route("/text")
  //   .get(
  //     async (_1, res) => {
  //       res.body = '{ msg: "Hello newp" }';
  //     },
  //     { etag: false },
  //   )
  //   .put(async (_1, _2) => {
  //     throw new HttpError(500, "put endpoint error help me!");
  //   })
  //   .del(async (_1, _2) => {
  //     throw new HttpError(500, "del endpoint error help me!");
  //   });

  bs.httpServer().post(
    "/test",
    async (_, res) => {
      res.body = "Happy Days";
    },
    {
      useDefaultMiddlewares: false,
      middlewareList: [
        Router.csrf({
          checkType: "signed-double-submit-cookie",
          secret: "secret",
          methods: ["GET", "POST", "PUT", "DELETE"],
        }),
      ],
    },
  );

  bs.httpServer().get(
    "/redirect1",
    async (_, res) => {
      res.redirect(
        "/somewhere/over/the/rainbow",
        302,
        "Hey, you, get off of my cloud!",
      );
    },
    { useDefaultMiddlewares: false },
  );

  bs.httpServer().get(
    "/redirect2",
    async (_, _2) => {
      throw new HttpRedirect(302, "/somewhere/different");
    },
    { useDefaultMiddlewares: false },
  );
  bs.httpServer().get(
    "/no-redirect",
    async (_, _2) => {
      throw new HttpError(404, "no redirect");
    },
    { useDefaultMiddlewares: false },
  );

  let router = bs.httpServer().addRouter("/api2", { minCompressionSize: 1000 });

  let arr: any[] = [];
  for (let i = 0; i < 100000; i++) {
    arr.push({ url: "json", el: i });
  }
  router.endpoint(
    "GET",
    "/json",
    (req, res) => {
      console.log(req.url);

      res.json = arr;
    },
    { etag: false },
  );
  bs.httpServer().endpoint(
    "GET",
    "/api/json2",
    async (req, res) => {
      console.log(req.url);
      await bs.sleep(3);
      res.json = { url: "json2" };
    },
    { etag: false },
  );

  bs.httpServer().endpoint(
    "GET",
    "/auth/json",
    async (req, res) => {
      console.log(req.headers);
      res.statusCode = 201;
      res.json = { url: "json" };
    },
    { etag: true },
  );

  bs.httpServer().addHealthcheck(async () => {
    bs.info("Healthy!");
    await bs.sleep(3);
    return false;
  });

  bs.httpServer().endpoint(
    "GET",
    "/main-on",
    (req, res) => {
      console.log(req.url);
      res.body = "<p>On</p>";
      bs.httpServer().maintenanceModeOn = true;
    },
    { etag: true },
  );
  bs.httpServer().endpoint(
    "GET",
    "/main-on",
    (req, res) => {
      console.log(req.url);
      res.body = "<p>Off</p>";
      bs.httpServer().maintenanceModeOn = false;
    },
    { etag: true },
  );
  bs.httpServer().endpoint(
    "GET",
    "/main",
    (req, res) => {
      console.log(req.url);
      res.body = "<p>You been served</p>";
    },
    { etag: true },
  );

  bs.httpServer().endpoint(
    "ALL",
    "/all",
    (req, res) => {
      console.log(req.url);
      res.body = "<p>All been served</p>";
    },
    { etag: true },
  );

  let newRouter = bs.httpServer().addRouter("/all");
  newRouter.endpoint(
    "ALL",
    "",
    (req, res) => {
      console.log(req.url);
      res.body = "<p>Ya'll been served</p>";
    },
    {
      etag: true,
      generateMatcher: (_: string) => {
        return (url: URL) => {
          return { matchedInfo: url.pathname, params: {} };
        };
      },
    },
  );
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

bs.update("test1", "hello");
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

bs.getConfigStr("xxxx", "oo", { silent: true });

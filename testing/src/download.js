import { bs, Router } from "@bs-core/shell";

import { PassThrough } from "node:stream";

const httpServer = await bs.addHttpServer("127.0.0.1", 8080);

const file = `
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
Greetings people of Earth, prepare to die!
`;

httpServer.get(
  "/download",
  async (_, res) => {
    let i = 0;
    i.startsWitth();
    res.streamRes = {
      fileName: "alien-contact.txt",
      body: new PassThrough().end(file),
    };
  },
  {
    middlewareList: [Router.cors({ originsAllowed: "*" })],
  },
);

httpServer.get(
  "/get",
  async (_, res) => {
    res.json = "Hello";
  },
  {
    // middlewareList: [Router.cors({ originsAllowed: "*" })],
  },
);

httpServer.get(
  "/get-sleep",
  async (_, res) => {
    await bs.sleep(30);
    res.json = { g: "Hello" };
  },
  {
    // middlewareList: [Router.cors({ originsAllowed: "*" })],
  },
);

httpServer.get(
  "/get-error",
  async (_, res) => {
    res.statusCode = 503;
  },
  {
    // middlewareList: [Router.cors({ originsAllowed: "*" })],
  },
);

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

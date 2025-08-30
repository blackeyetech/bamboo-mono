import { bs } from "@bs-core/shell";

await bs.addHttpServer({
  networkInterface: "lo",
  networkPort: 8088,
  loggerTag: "HttpMan",
});

bs.request("http://127.0.0.1:8081", "/healthcheck");

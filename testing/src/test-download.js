import { bs, Router } from "@bs-core/shell";

let res = await bs
  .request("http://127.0.0.1:8080", "/api/get", {
    timeout: 10,
    retries: 1,
  })
  .catch((e) => {
    bs.error("Error (%s)", e);
    return null;
  });

if (res !== null) {
  bs.info("%s", res.body);
}

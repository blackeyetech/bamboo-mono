// imports here
import { BSPlugin } from "@bs-core/shell";

import * as pg from "pg";

// Types here
export type PostgreSqlConfig = {
  database: string;
  user: string;
  password: string;

  host?: string;
  port?: number;
  ssl?: boolean;
  old?: boolean;
};

export type PostgreSqlCreateOptions = {
  client?: pg.PoolClient;
  id?: string;
};

export type PostgreSqlReadOptions = {
  client?: pg.PoolClient;

  fields?: string[];
  criteria?: Record<string, any>;
  orderBy?: string[];
  descending?: boolean;
  groupBy?: string[];
  format?: "json" | "array";
  distinct?: boolean;
};

export type PostgreSqlUpdateOptions = {
  client?: pg.PoolClient;
  criteria?: Record<string, any>;
};

export type PostgreSqlDeleteOptions = {
  client?: pg.PoolClient;
  criteria?: Record<string, any>;
};

export class PostgresSqlError {
  severity: string;
  code: string;
  detail: string;
  message: string;

  constructor(severity: string, code: string, detail: string, message: string) {
    this.severity = severity;
    this.code = code;
    this.detail = detail;
    this.message = message;
  }
}

// PostgreSql class here
export class PostgreSql extends BSPlugin {
  // Properties here
  private _pool: pg.Pool;

  constructor(name: string, postgresqlConfig: PostgreSqlConfig) {
    super(
      name,
      // NOTE: PLUGIN_VERSION is replaced with package.json#version by a
      // rollup plugin at build time
      "PLUGIN_VERSION",
    );

    let config = {
      host: "localhost",
      port: 5432,
      ssl: false,
      old: false,

      ...postgresqlConfig,
    };

    this._pool = new pg.Pool({
      database: config.database,
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      ssl: config.old ? config.ssl : { rejectUnauthorized: config.ssl },
    });

    // Set up a default error handler for the pool
    this._pool.on("error", (e) => {
      this.error("Uknown error occured - (%s)", e);
    });
  }

  // Protected methods here
  protected async stop(): Promise<void> {
    this.info("Stopping ...");
    this.info("Closing the pool ...");

    await this._pool.end().catch((e) => {
      this.error(e.message);
      return;
    });

    this.info("Pool closed!");
    this.info("Stopped!");
  }

  // Private methods here
  private isServerReady(
    resolve: (ready: boolean) => void,
    reject: (ready: boolean) => void,
  ): void {
    // Lets check if we can query the time
    const sql = "SELECT now();";

    this._pool
      .query(sql)
      .then(() => {
        this.info("Started!");
        this.info("Pool ready!");

        resolve(true);
      })
      .catch((e) => {
        // If we get an "ECONNREFUSED" that means the DB has not started
        if (e.code === "ECONNREFUSED") {
          this.info("DB not ready yet. Trying again in 5 seconds ...");

          setTimeout(() => {
            this.isServerReady(resolve, reject);
          }, 5000);
        } else {
          this.error("DB returned the following error: (%s)", e);
          reject(false);
        }
      });
  }

  // Public methods here
  async start(): Promise<boolean> {
    this.info("Starting ...");

    return new Promise((resolve, reject) => {
      this.isServerReady(resolve, reject);
    });
  }

  // In case the user wants to add the DB status to the healthchecks
  async healthCheck(): Promise<boolean> {
    // Lets check if we can query the time
    const sql = "SELECT now();";

    let e: Error | undefined;

    await this._pool.query(sql).catch((err) => {
      e = err;
      this.error(err);
    });

    if (e === undefined) {
      return true;
    } else {
      return false;
    }
  }

  async create(
    collection: string,
    fields: Record<string, any>,
    options?: PostgreSqlCreateOptions,
  ): Promise<any[]> {
    let fieldsStr = "";
    let valuesStr = "";
    let values = [];

    let position = 1;

    for (const f in fields) {
      if (position > 1) {
        fieldsStr += ",";
        valuesStr += ",";
      }

      fieldsStr += f;
      valuesStr += `$${position}`;
      values.push(fields[f]);

      position++;
    }

    let text = `INSERT INTO ${collection} (${fieldsStr}) VALUES (${valuesStr})`;
    if (options?.id !== undefined) {
      text += ` RETURNING ${options.id}`;
    }

    let query: pg.QueryConfig = { text, values };

    this.debug("create() query: %j", query);

    let client = options?.client === undefined ? this._pool : options.client;

    let res = await client.query(query).catch((e) => {
      this.error("'%s' happened for query (%j)", e, query);
      throw new PostgresSqlError(e.severity, e.code, e.detail, e.toString());
    });

    return res.rows;
  }

  async read(
    collection: string,
    readOptions: PostgreSqlReadOptions = {},
  ): Promise<any[]> {
    let opts = {
      fields: ["*"],

      criteria: {},
      format: "json",
      distinct: false,
      orderBy: [],
      descending: false,
      groupBy: [],

      ...readOptions,
    };

    let text = "";

    if (opts.distinct) {
      text = `SELECT DISTINCT ${opts.fields.join()} FROM ${collection}`;
    } else {
      text = `SELECT ${opts.fields.join()} FROM ${collection}`;
    }

    let values = [];

    if (Object.keys(opts.criteria).length > 0) {
      text += " WHERE ";

      let position = 1;
      for (const c in opts.criteria) {
        if (position > 1) {
          text += " AND ";
        }

        const val = opts.criteria[c];

        if (Array.isArray(val) && val.length > 0) {
          let inText = "";

          for (let i = 0; i < val.length; i++) {
            if (i > 0) {
              inText += ",";
            }

            inText += `$${position}`;

            values.push(val[i]);
            position++;
          }

          text += `${c} IN (${inText})`;
        } else if (typeof val === "object") {
          text += `${c}${val.op}$${position}`;
          values.push(val.val);
          position++;
        } else {
          text += `${c}=$${position}`;
          values.push(val);
          position++;
        }
      }
    }

    if (opts.groupBy.length > 0) {
      text += ` GROUP BY ${opts.groupBy.join()}`;
    }

    if (opts.orderBy.length > 0) {
      text += ` ORDER BY ${opts.orderBy.join()}`;
      text += opts.descending ? " DESC" : " ASC";
    }

    let client = opts.client === undefined ? this._pool : opts.client;

    if (opts.format === "array") {
      let query: pg.QueryArrayConfig = { values, text, rowMode: "array" };
      this.debug("read() query: (%j)", query);

      let res = await client.query(query).catch((e) => {
        // TODO: Improve error handling
        this.error("'%s' happened for query (%j)", e, query);
        throw new Error("Something wrong with your request!");
      });

      let rows = res.fields.map((f) => f.name);
      return [rows, ...res.rows];
    }

    let query: pg.QueryConfig = { values, text };
    this.debug("read() query: (%j)", query);

    let res = await client.query(query).catch((e) => {
      this.error("'%s' happened for query (%j)", e, query);
      throw new PostgresSqlError(e.severity, e.code, e.detail, e.toString());
    });

    return res.rows;
  }

  async update(
    collection: string,
    fields: Record<string, any>,
    updateOptions: PostgreSqlUpdateOptions = {},
  ): Promise<number> {
    let opts = {
      criteria: {},

      ...updateOptions,
    };

    let fieldStr = "";
    let values = [];

    let position = 1;

    for (const f in fields) {
      if (position > 1) {
        fieldStr += ",";
      }

      fieldStr += `${f}=$${position}`;
      values.push(fields[f]);

      position++;
    }

    let text = `UPDATE ${collection} SET ${fieldStr}`;

    if (Object.keys(opts.criteria).length > 0) {
      let where = "";
      for (const c in opts.criteria) {
        if (where.length !== 0) {
          where += " AND ";
        }

        where += `${c}=$${position}`;
        values.push(opts.criteria[c]);
        position++;
      }

      text += ` WHERE ${where}`;
    }

    let query: pg.QueryConfig = { text, values };
    this.debug("update() query: %j", query);

    let client = opts.client === undefined ? this._pool : opts.client;

    let res = await client.query(query).catch((e) => {
      this.error("'%s' happened for query (%j)", e, query);
      throw new PostgresSqlError(e.severity, e.code, e.detail, e.toString());
    });

    return res.rowCount ?? 0;
  }

  async delete(
    collection: string,
    deleteOptions: PostgreSqlDeleteOptions = {},
  ): Promise<number> {
    let opts = {
      criteria: {},

      ...deleteOptions,
    };

    let text = `DELETE FROM ${collection}`;
    let values = [];

    let position = 1;

    if (Object.keys(opts.criteria).length > 0) {
      let where = "";
      for (const c in opts.criteria) {
        if (where.length !== 0) {
          where += " AND ";
        }

        where += `${c}=$${position}`;
        values.push(opts.criteria[c]);
        position++;
      }

      text += ` WHERE ${where}`;
    }

    let query: pg.QueryConfig = { text, values };
    this.debug("delete() query: %j", query);

    let client = opts.client === undefined ? this._pool : opts.client;

    let res = await client.query(query).catch((e) => {
      this.error("'%s' happened for query (%j)", e, query);
      throw new PostgresSqlError(e.severity, e.code, e.detail, e.toString());
    });

    return res.rowCount ?? 0;
  }

  async query(query: string, client?: pg.PoolClient): Promise<any[]> {
    let pgClient = client === undefined ? this._pool : client;

    let res = await pgClient.query(query).catch((e) => {
      this.error("'%s' happened for query (%j)", e, query);
      throw new PostgresSqlError(e.severity, e.code, e.detail, e.toString());
    });

    return res.rows;
  }

  async exec(query: string, client?: pg.PoolClient): Promise<number> {
    this.debug("query() query: %j", query);

    let pgClient = client === undefined ? this._pool : client;

    let res = await pgClient.query(query).catch((e) => {
      this.error("'%s' happened for query (%j)", e, query);
      throw new PostgresSqlError(e.severity, e.code, e.detail, e.toString());
    });

    return res.rowCount ?? 0;
  }

  async connect(): Promise<pg.PoolClient> {
    return await this._pool.connect();
  }

  async release(client: pg.PoolClient): Promise<void> {
    await client.release();
  }

  async begin(client: pg.PoolClient): Promise<void> {
    await client.query("BEGIN;");
  }

  async commit(client: pg.PoolClient): Promise<void> {
    await client.query("COMMIT;");
  }

  async rollback(client: pg.PoolClient): Promise<void> {
    await client.query("ROLLBACK;");
  }
}

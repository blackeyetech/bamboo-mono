// imports here
import { BSPlugin } from "@bs-core/shell";

import * as mssql from "mssql";

// export { mssql.MSSQLError }
interface CustomMsRequest extends mssql.Request {
  arrayRowMode?: boolean | undefined;
}

interface CustomMsIResult<T> extends mssql.IResult<T> {
  columns?: mssql.IColumnMetadata[];
}

// Types here
export type SqlServerConfig = {
  database: string;
  user: string;
  password: string;
  server?: string;
  port?: number;
  appName?: string;
};

export type CNMSSqlConvertValuesOptions = {
  nullCurrencyValue?: number;
  dateFormat?: string;
};

export type CNMSSqlCreateOptions = {
  convertValuesOpts?: CNMSSqlConvertValuesOptions;
};

export type CNMSSqlUpdateOptions = {
  convertValuesOpts?: CNMSSqlConvertValuesOptions;
};

export type CNMSSqlReadOptions = {
  orderBy?: string[];
  orderByDesc?: string[];
  groupBy?: string[];
  format?: "json" | "array";
  distinct?: boolean;
};

export type CNMSSqlCreateParams = {
  collection: string;
  fields: { [key: string]: any };
  id?: string;
  opts?: CNMSSqlCreateOptions;
  transaction?: mssql.Transaction;
};

export type CNMSSqlReadParams = {
  collection: string;
  fields?: string[];
  criteria?: { [key: string]: any };
  opts?: CNMSSqlReadOptions;
  transaction?: mssql.Transaction;
};

export type CNMSSqlUpdateParams = {
  collection: string;
  fields: { [key: string]: any };
  criteria: { [key: string]: any };
  opts?: CNMSSqlUpdateOptions;
  transaction?: mssql.Transaction;
};

export type CNMSSqlDeleteParams = {
  collection: string;
  criteria: { [key: string]: any };
  transaction?: mssql.Transaction;
};

export type ColumnDetails = {
  index: number;
  name: string;
  length: number;
  type: (() => mssql.ISqlType) | mssql.ISqlType;
  udt?: any;
  scale?: number | undefined;
  precision?: number | undefined;
  nullable: boolean;
  caseSensitive: boolean;
  identity: boolean;
  readOnly: boolean;
};

// Config consts here

// Default configs here

// SqlServer class here
export class SqlServer extends BSPlugin {
  // Properties here
  private _pool: mssql.ConnectionPool | undefined;

  private _user: string;
  private _password: string;
  private _database: string;
  private _dbSever: string;
  private _port: number;
  private _appName: string;

  constructor(name: string, sqlServerConfig: SqlServerConfig) {
    super(
      name,

      // NOTE: PLUGIN_VERSION is replaced with package.json#version by a
      // rollup plugin at build time
      "PLUGIN_VERSION",
    );

    let config = {
      server: "localhost",
      port: 1433,
      appName: "appShApp",

      ...sqlServerConfig,
    };

    this._user = config.user;
    this._password = config.password;
    this._database = config.database;
    this._dbSever = config.server;
    this._port = config.port;
    this._appName = config.appName;
  }

  // Private methods here
  private async isServerReady(
    resolve: (ready: boolean) => void,
    reject: (ready: boolean) => void,
  ): Promise<void> {
    // Make sure we haven't already created the pool
    if (this._pool === undefined) {
      try {
        this._pool = await new mssql.ConnectionPool({
          user: this._user,
          password: this._password,
          database: this._database,
          server: this._dbSever,
          port: this._port,
          arrayRowMode: false,
          options: {
            encrypt: false, // true for azure
            trustServerCertificate: true, // true for self-signed certs
            appName: this._appName,
          },
        }).connect();
      } catch (e) {
        this.error("DB returned the following error: (%j)", e);
        setTimeout(() => {
          this.isServerReady(resolve, reject);
        }, 5000);
      }

      if (this._pool !== undefined) {
        this._pool.on("error", (err) => {
          console.log("sql errors", err);
        });

        this.info("Pool is open for business");
      }
    }

    if (this._pool !== undefined) {
      // Make sure we can connect to the DB
      let ok = await this.healthCheck();

      if (ok) {
        this.info("MS-SQL DB ready");
        this.info("Started!");
        resolve(true);
      }
    }
  }

  // Protected methods here
  protected async stop(): Promise<void> {
    this.info("Stopping ...");

    if (this._pool !== undefined) {
      this.info("Closing the pool ...");

      await this._pool.close().catch((e) => {
        this.error(e.message);
        return;
      });

      this.info("Pool closed!");
    }

    this.info("Stopped!");
  }

  async start(): Promise<boolean> {
    this.info("Starting ...");
    this.info("Opening the Pool ...");

    return new Promise((resolve, reject) => {
      this.isServerReady(resolve, reject);
    });
  }

  async healthCheck(): Promise<boolean> {
    if (this._pool === undefined) {
      return false;
    }

    // Lets check if we can query the time
    const sql = "SELECT getdate();";

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

  convertValueToSqlType(
    type: (() => mssql.ISqlType) | mssql.ISqlType,
    value: string,
    opts?: CNMSSqlConvertValuesOptions,
  ): any {
    switch (type) {
      // Boolean
      case mssql.Bit:
        switch (typeof value) {
          case "number":
            return value === 0 ? 0 : 1;
          case "boolean":
            return value ? 1 : 0;
          case "string":
            switch (value.toUpperCase()) {
              case "Y":
              case "YES":
              case "TRUE":
              case "T":
              case "1":
                return true;
              case "N":
              case "NO":
              case "FALSE":
              case "F":
              case "0":
                return false;
              default:
                // Return actual value and let it throw an error
                return value;
            }

          default:
            // Return actual value and let it throw an error
            return value;
        }

      // Integer
      case mssql.Int:
      case mssql.BigInt:
      case mssql.TinyInt:
      case mssql.SmallInt:
        if (value.length) {
          return parseInt(value, 10);
        }

        return null;
      // Float
      case mssql.Float:
        if (value.length) {
          return parseFloat(value);
        }

        return null;

      // Money
      case mssql.SmallMoney:
      case mssql.Money:
        if (value.length) {
          return parseFloat(value);
        } else if (opts?.nullCurrencyValue !== undefined) {
          return opts.nullCurrencyValue;
        }

        return null;

      // Text
      case mssql.VarChar:
      case mssql.Char:
      case mssql.Text:
      case mssql.NVarChar:
      case mssql.NChar:
      case mssql.NText:
        return value;

      // Dates
      case mssql.Date:
      case mssql.DateTime:
        if (value.length) {
          return value;
        }

        return null;

      default:
        // Return actual value and let it throw an error
        return value;
    }
  }

  async getTableColumns(collection: string): Promise<mssql.IColumnMetadata> {
    let request: CustomMsRequest = new mssql.Request(this._pool);
    // This will return the colum details
    request.arrayRowMode = true;
    // We don't want any results so ensure nothing comes back (1=0)
    let query = `SELECT * FROM ${collection} WHERE 1 = 0;`;

    let res: CustomMsIResult<any> = await request.query(query);

    // This is an object of positional columns with each column being
    // denoted by the position (ie. this is an array). Convert this
    // to a proper object
    let cols: mssql.IColumnMetadata = {};

    if (res.columns !== undefined) {
      for (let pos in res.columns[0]) {
        cols[res.columns[0][pos].name] = res.columns[0][pos];
      }
    }

    return cols;
  }

  async create(params: CNMSSqlCreateParams): Promise<any> {
    let cols = await this.getTableColumns(params.collection);

    let fieldsStr = "";
    let valuesStr = "";

    let request: mssql.Request;

    if (params.transaction !== undefined) {
      request = new mssql.Request(params.transaction);
    } else {
      request = new mssql.Request(this._pool);
    }

    let position = 1;
    for (const f in params.fields) {
      if (position > 1) {
        fieldsStr += ",";
        valuesStr += ",";
      }

      fieldsStr += f;
      valuesStr += `@${f}`;

      request.input(
        f,
        cols[f].type,
        this.convertValueToSqlType(
          cols[f].type,
          params.fields[f],
          params?.opts?.convertValuesOpts,
        ),
      );
      position++;
    }

    let query = "";

    if (params.id !== undefined) {
      query = `INSERT INTO ${params.collection} (${fieldsStr}) OUTPUT INSERTED.${params.id} VALUES (${valuesStr})`;
    } else {
      query = `INSERT INTO ${params.collection} (${fieldsStr}) VALUES (${valuesStr})`;
    }

    let res = await request.query(query);

    if (params.id !== undefined) {
      return res.recordset[0][params.id];
    }
  }

  async read(params: CNMSSqlReadParams) {
    if (params.fields === undefined) params.fields = ["*"];
    if (params.criteria === undefined) params.criteria = {};
    if (params.opts === undefined) params.opts = {};

    if (params.opts.format === undefined) params.opts.format = "json";
    if (params.opts.distinct === undefined) params.opts.distinct = false;
    if (params.opts.orderBy === undefined) params.opts.orderBy = [];
    if (params.opts.groupBy === undefined) params.opts.groupBy = [];
    if (params.opts.orderByDesc === undefined) params.opts.orderByDesc = [];

    let query = "";
    let request: CustomMsRequest;

    if (params.transaction !== undefined) {
      request = new mssql.Request(params.transaction);
    } else {
      request = new mssql.Request(this._pool);
    }

    if (params.opts.format === "array") {
      request.arrayRowMode = true;
    }

    if (params.opts.distinct) {
      query = `SELECT DISTINCT ${params.fields.join()} FROM ${
        params.collection
      }`;
    } else {
      query = `SELECT ${params.fields.join()} FROM ${params.collection}`;
    }

    if (Object.keys(params.criteria).length > 0) {
      query += " WHERE ";

      let position = 1;
      for (const c in params.criteria) {
        if (position > 1) {
          query += " AND ";
        }

        const val = params.criteria[c];

        if (typeof val === "object") {
          request.input(c, val.val);
          query += `${c}${val.op}@${c}`;
          position++;
        } else {
          request.input(c, val);
          query += `${c}=@${c}`;
          position++;
        }
      }
    }

    if (params.opts.groupBy.length > 0) {
      query += ` GROUP BY ${params.opts.groupBy.join()}`;
    }
    if (params.opts.orderBy.length > 0) {
      query += ` ORDER BY ${params.opts.orderBy.join()}`;
      query += " ASC";
    }
    if (params.opts.orderByDesc.length > 0) {
      if (params.opts.orderBy.length > 0) {
        query += `, ${params.opts.orderByDesc.join()} DESC`;
      } else {
        query += ` ORDER BY ${params.opts.orderByDesc.join()} DESC`;
      }
    }

    let res: CustomMsIResult<any> = await request.query(query);

    if (params.opts.format === "array") {
      if (res.columns !== undefined) {
        this.info("%j", res.columns[0]);
        let cols: string[] = [];
        for (let col in res.columns[0]) {
          cols.push(res.columns[0][col].name);
        }
        return [cols, ...res.recordset];
      }
    }

    return res.recordset;
  }

  async update(params: CNMSSqlUpdateParams) {
    let cols = await this.getTableColumns(params.collection);

    let fieldStr = "";
    let position = 1;
    let request: mssql.Request;

    if (params.transaction !== undefined) {
      request = new mssql.Request(params.transaction);
    } else {
      request = new mssql.Request(this._pool);
    }

    for (const f in params.fields) {
      if (position > 1) {
        fieldStr += ",";
      }

      // Make sure the field param doesnt clash with a criteria param -
      // so add a "-__1" at the end of it and hope it doesn't clash!!
      request.input(`${f}__1`, params.fields[f]);
      fieldStr += `${f}=@${f}__1`;

      position++;
    }

    let query = `UPDATE ${params.collection} SET ${fieldStr}`;

    if (Object.keys(params.criteria).length > 0) {
      query += " WHERE ";

      let position = 1;
      for (const c in params.criteria) {
        if (position > 1) {
          query += " AND ";
        }

        const val = params.criteria[c];

        if (typeof val === "object") {
          request.input(
            c,
            cols[c].type,
            this.convertValueToSqlType(
              cols[c].type,
              val.val,
              params?.opts?.convertValuesOpts,
            ),
          );

          query += `${c}${val.op}@${c}`;
          position++;
        } else {
          request.input(
            c,
            cols[c].type,
            this.convertValueToSqlType(
              cols[c].type,
              val,
              params?.opts?.convertValuesOpts,
            ),
          );

          query += `${c}=@${c}`;
          position++;
        }
      }
    }

    let res = await request.query(query);

    return res.rowsAffected[0];
  }

  async delete(params: CNMSSqlDeleteParams) {
    let query = `DELETE FROM ${params.collection}`;

    let request: mssql.Request;

    if (params.transaction !== undefined) {
      request = new mssql.Request(params.transaction);
    } else {
      request = new mssql.Request(this._pool);
    }

    if (Object.keys(params.criteria).length > 0) {
      query += " WHERE ";

      let position = 1;
      for (const c in params.criteria) {
        if (position > 1) {
          query += " AND ";
        }

        const val = params.criteria[c];

        if (typeof val === "object") {
          request.input(c, val.val);
          query += `${c}${val.op}@${c}`;
          position++;
        } else {
          request.input(c, val);
          query += `${c}=@${c}`;
          position++;
        }
      }
    }

    let res = await request.query(query);

    return res.rowsAffected[0];
  }

  async query(query: string, transaction?: mssql.Transaction): Promise<any> {
    let request: mssql.Request;

    if (transaction !== undefined) {
      request = new mssql.Request(transaction);
    } else {
      request = new mssql.Request(this._pool);
    }

    let res = await request.query(query);

    return res.recordset;
  }

  async exec(query: string, transaction?: mssql.Transaction): Promise<number> {
    let request: mssql.Request;

    if (transaction !== undefined) {
      request = new mssql.Request(transaction);
    } else {
      request = new mssql.Request(this._pool);
    }

    let res = await request.query(query);

    return res.rowsAffected[0];
  }

  async begin(): Promise<mssql.Transaction> {
    let transaction = new mssql.Transaction(this._pool);
    await transaction.begin();

    return transaction;
  }

  async commit(transaction: mssql.Transaction): Promise<void> {
    await transaction.commit();
  }

  async rollback(transaction: mssql.Transaction): Promise<void> {
    await transaction.rollback();
  }
}

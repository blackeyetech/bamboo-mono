// imports here
import { BSPlugin } from "@bs-core/shell";

import ldap from "ldapjs";

// Types here

// Config consts here
export type LdapConfig = {
  adServer: string;
  userDnBase: string;
  serviceDn: string;
  servicePassword: string;
};

// Default configs here
const ATTRIB_DN = "distinguishedName";

// Ldap class here
export class Ldap extends BSPlugin {
  // Properties here
  private _adServer: string;
  private _userDnBase: string;
  private _serviceDn: string;
  private _servicePassword: string;

  private _usingLdaps: boolean;
  private _tryingToBindServiceAccount: boolean;
  private _serviceHeartBeatTimeout?: NodeJS.Timeout;
  private _serviceLdapClient?: ldap.Client;

  constructor(name: string, config: LdapConfig) {
    super(
      name,
      // NOTE: PLUGIN_VERSION is replaced with package.json#version by a
      // rollup plugin at build time
      "PLUGIN_VERSION",
    );

    this._adServer = config.adServer;
    this._userDnBase = config.userDnBase;
    this._serviceDn = config.serviceDn;
    this._servicePassword = config.servicePassword;

    // Check if we are using LDAPS.
    // NOTE: If not then we will use startTls when making any connection
    if (this._adServer.match(/^ldaps:/)) {
      this.startupMsg("Using LDAPS");
      this._usingLdaps = true;
    } else {
      this.startupMsg("Using LDAP with startTls()");
      this._usingLdaps = false;
    }

    this._tryingToBindServiceAccount = false;
  }

  // Protected methods here
  async stop(): Promise<void> {
    // Check if we started the heart beat timer
    if (this._serviceHeartBeatTimeout !== undefined) {
      // Then stop the heart beat timer
      clearInterval(this._serviceHeartBeatTimeout);
    }

    // Check if a service connection has been started
    if (this._serviceLdapClient !== undefined) {
      // Unbind the service account and shut down
      await this.ldapUnbind(this._serviceLdapClient, this._serviceDn);
      this._serviceLdapClient.destroy();
    }
  }

  // Private methods here
  private async bindServiceAccount(
    resolve?: (started: boolean) => void,
  ): Promise<void> {
    // Try to bind to the service account

    // First flag that we are trying to do this
    this._tryingToBindServiceAccount = true;

    // Then try to bind
    let bound = await this.tryToBindServiceAccount();

    // We successfully bound to the service account if bound is true
    if (bound) {
      // Don't forget to reset the flag
      this._tryingToBindServiceAccount = false;

      // And resolve if we have something to resolve
      if (resolve !== undefined) {
        resolve(true);
      }
    } else {
      // It failed so log it and then try again in 5 seconds
      this.error(
        "Failed to bind to service account. Will try again in 5 secs ...",
      );
      setTimeout(() => {
        this.bindServiceAccount(resolve);
      }, 5000);
    }
  }

  private async tryToBindServiceAccount(): Promise<boolean> {
    this.info("Trying to bind to the service account ...");

    // Create a connection for the service account
    this._serviceLdapClient = await this.ldapConnect(
      this._serviceDn,
      true,
    ).catch((e) => {
      this.error("ldapConnect return an error (%s)", e);
      return undefined; // This is to stop a TS warning ...
    });

    // We failed to create the connection if the client is undefined
    if (this._serviceLdapClient === undefined) {
      this.error("Couldn't create a connection for the service account");
      return false;
    }

    // Attempt to bind to the service a/c
    let bound = await this.ldapBind(
      this._serviceLdapClient,
      this._serviceDn,
      this._servicePassword,
    );

    // We failed to bind if bound is not defined
    if (bound === false) {
      this.error("Couldn't create a bind for the service account");
      this._serviceLdapClient = undefined;
      return false;
    }

    this.info("Bound to service account");

    // Set up an interval timer for 1 min to keep the service connction alive
    // Capture the interval timer so we can stop it later
    this._serviceHeartBeatTimeout = setInterval(() => {
      // Call this as a keep alive ...
      this.trace("Executing keepalive for service connection.");
      this.ldapUserSearch("just.a.keepalive@service").catch(() => {});
    }, 60 * 1000);

    // If we are here then all is good so return a success
    return true;
  }

  // Public methods here
  async start() {
    // Return a Promise so we can attempt multiple retries to to the
    // bind service account
    return new Promise((resolve) => {
      this.bindServiceAccount(resolve);
    });
  }

  async userAuthenticate(
    user: string,
    password: string,
    userAttribute: string = "sAMAccountName",
  ): Promise<boolean> {
    // Search for the user first to find their DN
    let attribs = await this.ldapUserSearch(user, userAttribute).catch(
      () => {},
    );

    // If there are no attribs returned then the user does not have an account
    if (attribs === undefined) {
      this.warn(
        "User (%s) not found with userAttribute (%s)",
        user,
        userAttribute,
      );
      return false;
    }

    // We need a temp connection to use to attempt to bind the user with the
    // supplied password
    let client = await this.ldapConnect(user, false).catch(() => {});
    if (client === undefined) {
      return false;
    }
    let userDn = <string>attribs[ATTRIB_DN]; // This will be there because we asked for it!
    let bound = await this.ldapBind(client, userDn, password).catch(() => {});

    // Tidy up before you do anything else
    await this.ldapUnbind(client, user);
    client.destroy();

    // The user creds were valid if bound is true
    if (bound === true) {
      return true;
    }

    return false;
  }

  async ldapConnect(
    user: string,
    isServiceConnection: boolean,
  ): Promise<ldap.Client | undefined> {
    // Create the LDAP client first
    let client = ldap.createClient({
      url: [this._adServer],
    });

    // Since createClient returns an event emitter, return a Promise to handle it
    return new Promise((resolve, reject) => {
      // Setup handlers for events "error" and "connect"
      client.on("error", (err) => {
        this.error(
          "There was and error creating the LDAP client for (%s): (%s)",
          user,
          err,
        );
        reject();
      });

      client.on("connect", async () => {
        this.debug("Connected");

        // Start TLS - can only do this if we are not using LDAPS
        if (this._usingLdaps === false) {
          let started = await this.startTls(client);
          if (started === false) {
            client.destroy();
            reject();
          }
        }

        resolve(client);
      });

      // Set up some basic logging for each of the events
      let events = [
        "connectRefused",
        "connectTimeout",
        "connectError",
        "setupError",
        "socketTimeout",
        "resultError",
        "timeout",
        "destroy",
        "end",
        "close",
        "idle",
      ];

      let reconnectEvents = [
        "close",
        "connectError",
        "connectRefused",
        "connectTimeout",
      ];

      for (let event of events) {
        client.on(event, async (e) => {
          // Check if this is a service connect AND the event means we need
          // to re-connect AND we are not currently trying to bind to the
          // service account
          if (
            isServiceConnection &&
            reconnectEvents.includes(event) &&
            this._tryingToBindServiceAccount === false
          ) {
            // If the connection closes we need to clear the existing interval timer
            // and create a new bind
            clearInterval(this._serviceHeartBeatTimeout);
            this._serviceLdapClient?.destroy();
            this.bindServiceAccount();
          }
          this.debug(
            "Event (%s) generated for user (%s): (%s)",
            event,
            user,
            e,
          );
        });
      }
    });
  }

  async ldapBind(
    client: ldap.Client,
    userDn: string,
    password: string,
  ): Promise<boolean> {
    // ldapjs allows you to successfully bind a user with no password (this is
    // AD specific behavior) - but we won't allow that so check for it first
    if (password === undefined || password.length === 0) {
      this.warn("User with DN (%s) entered an empty password!", userDn);
      return false;
    }

    // Since bind requires a callback return a Promise to handle it
    return new Promise((resolve) => {
      client.bind(userDn, password, (e) => {
        if (e !== null) {
          this.error(
            "There was and error binding the LDAP user (%s): (%s)",
            userDn,
            e,
          );

          // [InvalidCredentialsError]: 80090308: LdapErr: DSID-0C090439, comment: AcceptSecurityContext error, data 52e, v4563

          if (e instanceof ldap.InvalidCredentialsError) {
            this.warn("User with DN (%s) entered invalid password!", userDn);
          }

          resolve(false);
        } else {
          this.debug("User (%s) is bound!", userDn);
          resolve(true);
        }
      });
    });
  }

  async ldapUnbind(client: ldap.Client, userCn: string): Promise<void> {
    // Since unbind requires a callback return a Promise to handle it
    return new Promise((resolve) => {
      client.unbind(() => {
        this.debug("User (%s) is unbound!", userCn);
        resolve();
      });
    });
  }

  async startTls(client: ldap.Client): Promise<boolean> {
    const opts = {
      rejectUnauthorized: false,
    };

    // Since starttls requires a callback return a Promise to handle it
    return new Promise((resolve) => {
      client.starttls(opts, null, (e) => {
        if (e !== null) {
          this.error("Start TLS generated an error (%s)", e);
          resolve(false);
        } else {
          this.info("LDAP TLS is started!");
          resolve(true);
        }
      });
    });
  }

  async ldapUserSearch(
    user: string,
    userAttribute: string = "sAMAccountName",
  ): Promise<Record<string, string | number>> {
    // Atributes to get back from LDAP search - always get "dn"
    let attributes = [ATTRIB_DN];

    // We will always be searching by the users email
    const opts: ldap.SearchOptions = {
      filter: `(${userAttribute}=${user})`, // Search for the user
      scope: "sub", // Search the sub directories from the base
      attributes,
    };

    return new Promise((resolve, reject) => {
      // Since search requires a callback return a Promise to handle it
      this._serviceLdapClient?.search(this._userDnBase, opts, (e, res) => {
        if (e !== null) {
          this.error(
            "There was and error searching for mail (%s): (%s)",
            user,
            e,
          );
          reject();
        }

        let results: Record<string, string | number> = {};

        // Setup handlers for events "searchEntry", "error" and "end"
        res.on("searchEntry", (entry) => {
          // Don't resolve yet, the "end" event will be called last
          for (let attrib of attributes) {
            let found = entry.attributes.find((el) => el.type === ATTRIB_DN);
            if (found !== undefined) {
              // SearchEntry doesn't have a "values" property defined
              // so this is a temp work around
              let tmpAttributes = <any>found;
              results[attrib] = tmpAttributes.values[0];
            }
          }
          this.debug("Attribs for (%s) are (%s)", user, results);
        });

        res.on("error", (e) => {
          // Don't reject  yet, the "end" event will be called last
          this.error(
            "There was and error searching for user (%s) with user attribute (%s): (%s)",
            user,
            ATTRIB_DN,
            e.message,
          );
        });

        res.on("end", () => {
          // If ATTRIB_DM was not found then the user does not exist - so reject
          if (results[ATTRIB_DN] === undefined) {
            reject();
          }

          // Otherwise we found them!!
          resolve(results);
        });
      });
    });
  }
}

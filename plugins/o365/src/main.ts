// imports here
import { bs, BSPlugin } from "@bs-core/shell";

import * as MSGraph from "@microsoft/microsoft-graph-types";

import querystring from "node:querystring";

// Types here
export type O365Config = {
  appId: string;
  clientSecret: string;
  tenantId: string;
  grantType?: string;
  resource?: string;

  tokenGracePeriod?: number; // In minutes
};

type MSGraphTokenResponse = {
  token_type: string;
  scope: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
};

type MessageAttachment = {
  name: string;
  contentType: string;
  contentB64: string;
};

// Misc consts here
const EMAIL_REF_GUID = `String {a75e89ac-9033-49c0-a4fc-52d83c8468ac} Name app-sh-o365-ref-code`;

// O365 class here
export class O365 extends BSPlugin {
  // Properties here
  private _appId: string;
  private _clientSecret: string;
  private _tenantId: string;
  private _grantType: string;
  private _resource: string;

  private _tokenGracePeriod: number;
  private _tokenTimeout: NodeJS.Timeout | undefined;
  private _token: string | null;

  constructor(name: string, o365Config: O365Config) {
    super(
      name,
      // NOTE: PLUGIN_VERSION is replaced with package.json#version by a
      // rollup plugin at build time
      "PLUGIN_VERSION",
    );

    let config = {
      grantType: "client_credentials",
      resource: "https://graph.microsoft.com",
      tokenGracePeriod: 5,

      ...o365Config,
    };

    this._appId = config.appId;
    this._clientSecret = config.clientSecret;
    this._tenantId = config.tenantId;
    this._grantType = config.grantType;
    this._resource = config.resource;
    this._tokenGracePeriod = config.tokenGracePeriod * 60 * 1000; // Convert to ms;

    this._token = null;
  }

  // Protected methods here

  // Private methods here

  // Public methods here
  async login(): Promise<void> {
    this.info("Logging in and getting new token now!");

    let data = {
      client_id: this._appId,
      client_secret: this._clientSecret,
      scope: `${this._resource}/.default`,
      grant_type: this._grantType,
    };

    let res = await bs
      .request(
        "https://login.microsoftonline.com",
        `/${this._tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: querystring.stringify(data),
        },
      )
      .catch((e) => {
        this.error("Error while getting new token - (%s)", e);

        // Make sure to explicitly set the token to undefined
        this._token = null;
        // Try again in 1 minute
        this.info("Will try and get new token again in 1 min");
        this._tokenTimeout = setTimeout(() => this.login(), 60 * 1000);
      });

    if (res !== undefined) {
      let body = <MSGraphTokenResponse>res.body;
      this._token = body.access_token;
      let renewIn = body.expires_in * 1000 - this._tokenGracePeriod;

      this._tokenTimeout = setTimeout(() => this.login(), renewIn);

      this.info(
        "Will get new token again in (%s) mins",
        Math.round(renewIn / 1000 / 60),
      );
    }
  }

  async logout(): Promise<void> {
    this.info("Logging out and clearing timer!");

    if (this._tokenTimeout !== undefined) {
      clearTimeout(this._tokenTimeout);
    }

    this._token = null;

    return;
  }

  async stop(): Promise<void> {
    await this.logout();
  }

  async loggedIn(): Promise<boolean> {
    if (this._token === null) {
      return false;
    }

    return true;
  }

  async sendOutlookMessage(
    toRecipients: string[],
    ccRecipients: string[],
    bccRecipients: string[],
    fromUser: string,
    subject: string,
    content: string,
    contentType: "text" | "html",
    refCode?: string,
    attachments?: MessageAttachment[],
  ): Promise<boolean> {
    // Just make sure we are logged in first
    if (this._token === null) {
      this.warn(
        "Not logged into O365 therefore can't send any mails at the moment!",
      );
      return false;
    }

    let message: MSGraph.Message = {
      subject,
      body: {
        contentType,
        content,
      },
    };

    // A refCode allows us to fin this message again if we need to
    if (refCode !== undefined) {
      message.singleValueExtendedProperties = [
        {
          id: EMAIL_REF_GUID,
          value: refCode,
        },
      ];
    }

    message.toRecipients = [];

    for (let recipient of toRecipients) {
      message.toRecipients.push({
        emailAddress: {
          address: recipient,
        },
      });
    }

    message.ccRecipients = [];

    for (let recipient of ccRecipients) {
      message.ccRecipients.push({
        emailAddress: {
          address: recipient,
        },
      });
    }

    message.bccRecipients = [];

    for (let recipient of bccRecipients) {
      message.bccRecipients.push({
        emailAddress: {
          address: recipient,
        },
      });
    }

    message.attachments = [];

    if (attachments !== undefined) {
      for (let attachment of attachments) {
        let aObj = {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.name,
          contentType: attachment.contentType,
          contentBytes: attachment.contentB64,
          contentId: "",
          isInline: false,
        };

        message.attachments.push(aObj);
      }
    }

    let res = await bs
      .request(this._resource, `/v1.0/users/${fromUser}/sendMail`, {
        method: "POST",
        body: { message },
        bearerToken: this._token,
      })
      .catch((e) => {
        this.error("Error while sending email (%j) - (%s)", message, e);
      });

    if (res === undefined || res.statusCode !== 202) {
      return false;
    }

    return true;
  }
}

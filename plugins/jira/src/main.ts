// imports here
import { BSPlugin, ReqRes } from "@bs-core/shell";

// Types here
export type AuthDetails = {
  username: string;
  password: string;
};

export type JiraConfig = {
  server: string;
  user: string;
  password: string;

  sessionRefreshPeriod?: number; // In mins
};

export type FieldDict = {
  byName: Record<string, { id: string; type: string; itemType: string }>;
  byId: Record<string, { name: string; type: string; itemType: string }>;
};

export type DashboardsOject = {
  name: string;
  values: [number, string][];
};

export type FiltersOject = {
  name: string;
  values: [number, string][];
};

export type JqlResults = {
  startAt: number;
  maxResults: number;
  total: number;
  issues: {
    key: string;
  }[];
};

// Config consts here

// Misc constants here
export const JiraResources: Record<string, string> = {
  session: "/rest/auth/1/session",
  field: "/rest/api/2/field",
  project: "/rest/api/2/project",
  issue: "/rest/api/2/issue",
  createmeta: "/rest/api/2/issue/createmeta",
  components: "/rest/api/2/project",
  search: "/rest/api/2/search",
  user: "/rest/api/2/user",
  group: "/rest/api/2/group",
};

const SCRIPTRUNNER_DASHBOARDS_N_FILTERS_URL =
  "rest/scriptrunner/latest/canned/com.onresolve.scriptrunner.canned.jira.admin.ChangeSharedEntityOwnership";

// Jira class here
export class Jira extends BSPlugin {
  // Properties here
  private _server: string;
  private _user: string;
  private _password: string;
  private _sessionId: string | null;

  private _sessionRefreshPeriod: number;
  private _timeout?: NodeJS.Timeout;

  private _fieldDict: FieldDict | null;

  private _sessionHeader: Record<string, string>; // Used if logged in
  private _basicAuthHeader: Record<string, string>; // Used if not logged in

  constructor(name: string, jiraConfig: JiraConfig) {
    super(
      name,
      // NOTE: PLUGIN_VERSION is replaced with package.json#version by a
      // rollup plugin at build time
      "PLUGIN_VERSION",
    );

    let config = {
      sessionRefreshPeriod: 60,

      ...jiraConfig,
    };

    this._server = config.server;
    this._user = config.user;
    this._password = config.password;
    this._sessionId = null;
    this._fieldDict = null;

    this._sessionRefreshPeriod = config.sessionRefreshPeriod * 60 * 1000; // Convert to ms

    this._sessionHeader = {};

    let token = Buffer.from(`${this._user}:${this._password}`).toString(
      "base64",
    );
    this._basicAuthHeader = { Authorization: `Basic ${token}` };
  }

  // Private methods here

  // Public methods here
  public async login(auth?: AuthDetails): Promise<void> {
    let res = await this.request(this._server, JiraResources.session, {
      method: "POST",
      body: {
        username: auth !== undefined ? auth.username : this._user,
        password: auth !== undefined ? auth.password : this._password,
      },
    });

    type sessionType = { session: { value: string } };

    let session = <sessionType>res.body;
    this._sessionId = session.session.value;

    this._sessionHeader = { cookie: `JSESSIONID=${this._sessionId}` };

    // Start a timer to automatically renew the session ID
    this._timeout = setTimeout(() => {
      this.info("Refreshing session ID!");
      this.login();
    }, this._sessionRefreshPeriod);
  }

  public async logout(): Promise<void> {
    if (this._sessionId === null) {
      return;
    }

    // Stop the timer first!
    clearInterval(this._timeout);

    await this.request(this._server, JiraResources.session, {
      method: "DELETE",
      headers: {
        cookie: `JSESSIONID=${this._sessionId}`,
      },
    });

    // Reset the session ID so we know we are not logged in
    this._sessionId = null;
    this._sessionHeader = {};
  }

  public async getFieldDict(useCurrent: boolean = true): Promise<FieldDict> {
    // Check to see if the field dict is populated AND the user
    // wants to use the current field dict
    if (this._fieldDict !== null && useCurrent) {
      return this._fieldDict;
    }

    let res = await this.request(this._server, JiraResources.field, {
      method: "GET",
      headers:
        this._sessionId === null ? this._basicAuthHeader : this._sessionHeader,
    });

    this._fieldDict = { byId: {}, byName: {} };

    if (Array.isArray(res.body)) {
      for (let field of res.body) {
        this._fieldDict.byName[field.name] = {
          id: field.id,
          type: field.schema !== undefined ? field.schema.type : "Unknown",
          itemType: field.schema !== undefined ? field.schema.items : "Unknown",
        };
        this._fieldDict.byId[field.id] = {
          name: field.name,
          type: field.schema !== undefined ? field.schema.type : "Unknown",
          itemType: field.schema !== undefined ? field.schema.items : "Unknown",
        };
      }
    }

    return this._fieldDict;
  }

  public async getAllowedFieldValues(
    projectKey: string,
    issueType: string,
    fieldName: string,
  ): Promise<string[]> {
    let searchParams = {
      expand: "projects.issuetypes.fields",
      projectKeys: projectKey,
      issuetypeNames: issueType,
    };

    let res = await this.request(this._server, JiraResources.createmeta, {
      method: "GET",
      searchParams,
      headers:
        this._sessionId === null ? this._basicAuthHeader : this._sessionHeader,
    });

    // Convert field name to field ID
    let dict = await this.getFieldDict();
    let fieldInfo = dict.byName[fieldName];

    if (fieldInfo === undefined) {
      throw Error(`Unknown field ${fieldName}`);
    }

    let field = res.body.projects[0].issuetypes[0].fields[fieldInfo.id];

    if (field === undefined || field.allowedValues === undefined) {
      return [];
    }

    let allowed: string[] = [];

    for (let info of field.allowedValues) {
      allowed.push(info.value);
    }

    return allowed;
  }

  public async getComponents(
    projectKey: string,
  ): Promise<{ [key: string]: string }> {
    let res = await this.request(
      this._server,
      `${JiraResources.components}/${projectKey}/components`,
      {
        method: "GET",
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );

    let components: { [key: string]: string } = {};

    for (let component of res.body) {
      components[component.name] = component.id;
    }

    return components;
  }

  public async getProjects(component?: string): Promise<any[]> {
    let res = await this.request(this._server, JiraResources.project, {
      method: "GET",
      headers:
        this._sessionId === null ? this._basicAuthHeader : this._sessionHeader,
      searchParams: { expand: "lead" },
    });

    // This is not the full interface but all we need here
    interface Project {
      projectCategory: { name: string };
    }

    let projects = <Project[]>res.body;

    if (component !== undefined) {
      return projects.filter((el) => el.projectCategory.name === component);
    }

    return projects;
  }

  // TODO: add getProject

  public async updateProject(
    project: string,
    body: Record<string, string>,
  ): Promise<void> {
    await this.request(this._server, `${JiraResources.project}/${project}`, {
      method: "PUT",
      headers:
        this._sessionId === null ? this._basicAuthHeader : this._sessionHeader,
      body,
    });
  }

  public async updateProjectLead(project: string, lead: string) {
    await this.updateProject(project, { lead });
  }

  public async createIssue(
    projectKey: string,
    issueType: string,
    component: string,
    fields: Record<string, any>,
  ): Promise<string> {
    let components = await this.getComponents(projectKey);

    let issue: Record<string, any> = {
      fields: {
        project: { key: projectKey },
        issuetype: { name: issueType },
        components: [{ id: components[component] }],
      },
    };

    // Convert any field names to field IDs
    let dict = await this.getFieldDict();

    for (let fname in fields) {
      let fid = dict.byName[fname]?.id;

      if (fid !== undefined) {
        issue.fields[fid] = fields[fname];
      } else {
        issue.fields[fname] = fields[fname];
      }
    }

    let res = await this.request(this._server, JiraResources.issue, {
      method: "POST",
      body: issue,
      headers:
        this._sessionId === null ? this._basicAuthHeader : this._sessionHeader,
    });

    return res.body.key;
  }

  public async updateIssue(
    key: string,
    fields: Record<string, any>,
    notifyUsers: boolean = true,
  ): Promise<string> {
    let issue: Record<string, any> = {
      fields: {},
    };

    // Convert any field names to field IDs
    let dict = await this.getFieldDict();

    for (let fname in fields) {
      let fid = dict.byName[fname]?.id;

      if (fid !== undefined) {
        issue.fields[fid] = fields[fname];
      } else {
        issue.fields[fname] = fields[fname];
      }
    }

    let res = await this.request(
      this._server,
      `${JiraResources.issue}/${key}`,
      {
        method: "PUT",
        body: issue,
        searchParams: notifyUsers ? undefined : { notifyUsers: "false" },
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );

    return res.body.key;
  }

  public async getIssue(idOrKey: string): Promise<any> {
    let res = await this.request(
      this._server,
      `${JiraResources.issue}/${idOrKey}`,
      {
        method: "GET",
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );

    let issue: { [key: string]: any } = {};

    // Convert any field IDs to field name
    let dict = await this.getFieldDict();

    for (let fid in res.body.fields) {
      let fname = dict.byId[fid]?.name;

      if (fname !== undefined) {
        issue[fname] = res.body.fields[fid];
      } else {
        issue[fid] = res.body.fields[fid];
      }
    }

    // Add id to list of fields
    issue["id"] = res.body.id;

    return issue;
  }

  public async issueReporter(
    key: string,
    reporter: string,
    notifyUsers: boolean = true,
  ): Promise<void> {
    await this.updateIssue(key, { reporter: { name: reporter } }, notifyUsers);
  }

  public async assignIssue(
    key: string,
    assignee: string,
    notifyUsers: boolean = true,
  ): Promise<void> {
    await this.updateIssue(
      key,
      {
        assignee: {
          name: assignee,
        },
      },
      notifyUsers,
    );
  }

  public async updateLabels(
    key: string,
    action: "add" | "remove",
    labels: string[],
    notifyUsers: boolean = true,
  ): Promise<string> {
    let issue: { update: { labels: any[] } } = {
      update: {
        labels: [],
      },
    };

    issue.update.labels = [];

    for (let label of labels) {
      issue.update.labels.push({ [action]: label });
    }

    let res = await this.request(
      this._server,
      `${JiraResources.issue}/${key}`,
      {
        method: "PUT",
        body: issue,
        searchParams: notifyUsers ? undefined : { notifyUsers: "false" },
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );

    return res.body.key;
  }

  public async addComment(idOrKey: string, comment: string): Promise<void> {
    await this.request(
      this._server,
      `${JiraResources.issue}/${idOrKey}/comment`,
      {
        method: "POST",
        body: {
          body: comment,
        },
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );
  }

  public async addWatcher(idOrKey: string, watcher: string): Promise<void> {
    await this.request(
      this._server,
      `${JiraResources.issue}/${idOrKey}/watchers`,
      {
        method: "POST",
        body: watcher,
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );
  }

  public async removeWatcher(idOrKey: string, watcher: string): Promise<void> {
    await this.request(
      this._server,
      `${JiraResources.issue}/${idOrKey}/watchers`,
      {
        method: "DELETE",
        body: watcher,
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
        searchParams: { username: watcher },
      },
    );
  }

  public async getTransitions(
    idOrKey: string,
  ): Promise<Record<string, string>> {
    let res = await this.request(
      this._server,
      `${JiraResources.issue}/${idOrKey}/transitions`,
      {
        method: "GET",
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );

    let transitions: Record<string, string> = {};

    for (let transition of res.body.transitions) {
      transitions[transition.name] = transition.id;
    }

    return transitions;
  }

  public async doTransition(
    idOrKey: string,
    transitionIdOrName: string,
    fields?: string[],
    comment?: string,
  ): Promise<void> {
    // transition may be the Transition ID or name so check
    let availableTransitions = await this.getTransitions(idOrKey);
    let transitionId = availableTransitions[transitionIdOrName];

    if (transitionId === undefined) {
      transitionId = transitionIdOrName;
    }

    let dfields: Record<string, Record<string, string>> = {};

    let dict = await this.getFieldDict();

    if (fields !== undefined) {
      // Convert any field names to field IDs
      await this.getFieldDict();

      for (let fname in fields) {
        let fid = dict.byName[fname]?.id;

        if (fid !== undefined) {
          dfields[fid] = { name: fields[fname] };
        } else {
          dfields[fname] = { name: fields[fname] };
        }
      }
    }

    let dcomment = { comment: [{ add: { body: comment } }] };

    let body = {
      update: comment === undefined ? undefined : dcomment,
      fields: fields === undefined || fields.length === 0 ? undefined : dfields,
      transition: { id: transitionId },
    };

    await this.request(
      this._server,
      `${JiraResources.issue}/${idOrKey}/transitions`,
      {
        method: "POST",
        body,
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );
  }

  public async runJql(jql: string): Promise<string[]> {
    let issues: string[] = [];
    let startAt = 0;
    let maxResults = 1000; // 1000 is the max you can get

    while (true) {
      let res = await this.request(this._server, JiraResources.search, {
        method: "GET",
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
        searchParams: {
          jql,
          startAt: startAt.toString(),
          maxResults: maxResults.toString(),
          fields: "key",
        },
      }).catch((e) => {
        this.error(e);
      });

      if (res === undefined) {
        break;
      }

      // Append the results to what we already have
      let results = <JqlResults>res.body;
      for (let issue of results.issues) {
        issues.push(issue.key);
      }

      // Increment by maxResults
      startAt += maxResults;

      // If we are beyond the total then we have everything so break,
      // otherwise go again
      if (startAt > results.total) {
        break;
      }
    }

    return issues;
  }

  public async getUserDashboardIds(userId: string): Promise<number[]> {
    let res = await this.request(
      this._server,
      `/${SCRIPTRUNNER_DASHBOARDS_N_FILTERS_URL}/params`,
      {
        method: "POST",
        body: {
          FIELD_FROM_USER_ID: userId,
        },
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );

    let dashboardIds: number[] = [];

    let data = <DashboardsOject[]>res.body;

    for (let obj of data) {
      if (obj.name === "FIELD_DASHBOARD_IDS") {
        for (let value of obj.values) {
          dashboardIds.push(value[0]);
        }
      }
    }

    return dashboardIds;
  }

  public async getUserFilterIds(userId: string): Promise<string[]> {
    let res = await this.request(
      this._server,
      `/${SCRIPTRUNNER_DASHBOARDS_N_FILTERS_URL}/params`,
      {
        method: "POST",
        body: {
          FIELD_FROM_USER_ID: userId,
        },
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );

    let filterIds: string[] = [];

    let data = <FiltersOject[]>res.body;

    for (let obj of data) {
      if (obj.name === "FIELD_FILTER_IDS") {
        for (let value of obj.values) {
          filterIds.push(value[0].toString());
        }
      }
    }

    return filterIds;
  }

  public async migrateDashboards(
    fromUserId: string,
    toUserId: string,
    dashboardIds: number[],
  ): Promise<void> {
    await this.request(
      this._server,
      `/${SCRIPTRUNNER_DASHBOARDS_N_FILTERS_URL}`,
      {
        method: "POST",
        body: {
          FIELD_FROM_USER_ID: fromUserId,
          FIELD_TO_USER_ID: toUserId,
          FIELD_DASHBOARD_IDS: dashboardIds,
          FIELD_FILTER_IDS: [],
        },
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );
  }

  public async migrateFilters(
    fromUserId: string,
    toUserId: string,
    filterIds: string[],
  ): Promise<void> {
    await this.request(
      this._server,
      `/${SCRIPTRUNNER_DASHBOARDS_N_FILTERS_URL}`,
      {
        method: "POST",
        body: {
          FIELD_FROM_USER_ID: fromUserId,
          FIELD_TO_USER_ID: toUserId,
          FIELD_DASHBOARD_IDS: [],
          FIELD_FILTER_IDS: filterIds,
        },
        headers:
          this._sessionId === null
            ? this._basicAuthHeader
            : this._sessionHeader,
      },
    );
  }

  public async getUser(
    user: string,
    byKey: boolean,
    includeGroups: boolean = false,
  ): Promise<any> {
    let searchParams: Record<string, string> = {};
    if (byKey) {
      searchParams["key"] = user;
    } else {
      searchParams["username"] = user;
    }

    if (includeGroups) {
      searchParams["expand"] = "groups";
    }

    let res = await this.request(this._server, JiraResources.user, {
      method: "GET",
      searchParams,
      headers:
        this._sessionId === null ? this._basicAuthHeader : this._sessionHeader,
    });

    return res.body;
  }

  public async addUserToGroup(user: string, group: string): Promise<Object> {
    let res = await this.request(this._server, `${JiraResources.group}/user`, {
      method: "POST",
      searchParams: { groupname: group },
      headers:
        this._sessionId === null ? this._basicAuthHeader : this._sessionHeader,
      body: { name: user },
    });

    return res.body;
  }

  public async getUserGroups(user: string): Promise<string[]> {
    let details = await this.getUser(user, false, true);

    let groups: string[] = [];
    let groupItems = details?.groups?.items;

    if (groups !== undefined) {
      for (let group of groupItems) {
        groups.push(group.name);
      }
    }

    return groups;
  }

  public async addUserToApplication(
    user: string,
    applicationKey: string,
  ): Promise<void> {
    await this.request(this._server, `${JiraResources.user}/application`, {
      method: "POST",
      searchParams: { username: user, applicationKey: applicationKey },
      headers:
        this._sessionId === null ? this._basicAuthHeader : this._sessionHeader,
      body: {},
    }).catch((e) => {
      this.error("Received errors (%j)", e);
    });
  }

  public async restApiCall(
    method: "GET" | "PUT" | "POST" | "DELETE" | "PATCH",
    path: string,
    body: any,
  ): Promise<ReqRes> {
    let res = await this.request(this._server, path, {
      method,
      headers:
        this._sessionId === null ? this._basicAuthHeader : this._sessionHeader,
      body,
    });

    return res;
  }
}

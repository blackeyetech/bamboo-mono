// imports here
import * as fs from "node:fs";

// Config consts here
const CFG_ENV_FILE = "ENV_FILE";

// Private variables here
let _envFileStore: Map<string, string> = new Map(); // Store for env file vars
let _messages: Set<string> = new Set();

// Types here
export type Options = {
  config: string;
  type: "String" | "Boolean" | "Number";

  defaultVal?: string | boolean | number;
  cmdLineFlag?: string;
  silent?: boolean;
  redact?: boolean;
};

export class ConfigError {
  constructor(public message: string) {}
}

// Private methods here
function convertConfigValue(
  value: string,
  type: "String" | "Boolean" | "Number",
): number | string | boolean {
  switch (type) {
    case "Number":
      return parseInt(value);
    case "Boolean":
      // Only accept y/Y to mean true
      if (value.toUpperCase() === "Y") {
        return true;
      }
      return false;
    default:
      // All that is left is String and this is already a string!
      return value;
  }
}

function checkCli(options: Options): undefined | string {
  // Ignore the first 2 params (node bin and executable file)
  let cliParams = process.argv.slice(2);

  // The convention used for config params on the command line is:
  // Convert to lowercase, replace '_' with '-' and prepend "--"
  let cliParam = `--${options.config.toLowerCase().replaceAll("_", "-")}`;

  // Command line flags are just prepended with a '-'
  let cmdLineFlag =
    options.cmdLineFlag !== undefined ? `-${options.cmdLineFlag}` : "";

  // If the param/flag is assigned a value on the cli it has the format:
  //   --param=value or -flag=value
  // If the flag is present but has not been assigned a value this
  // implies it is true, i.e "Y"
  let regExp: RegExp;

  if (options.cmdLineFlag === undefined) {
    // No flag specified so only look for the param and an assigned value
    regExp = new RegExp(`^${cliParam}=(.+)$`);
  } else {
    // Look for param and an assigned value or cmd line flag
    regExp = new RegExp(`^${cliParam}=(.+)$|^${cmdLineFlag}$`);
  }

  // Step through each cli params until you find a match
  for (let i = 0; i < cliParams.length; i++) {
    let match = cliParams[i].match(regExp);

    let strValue: string;
    let paramOrFlag: string;

    // Continue if there was no match
    if (match === null) {
      continue;
    }

    // If a value was supplied it will be match[1] => parm
    if (match[1] !== undefined) {
      // This means we found the param
      strValue = match[1];
      paramOrFlag = cliParam;
    } else {
      // This means we found the flag - assign it a value of "Y" to indicate
      // the flag was specified
      strValue = "Y";
      paramOrFlag = cmdLineFlag;
    }

    // Placeholde to get rid of compiler error - remove when logging is added back
    paramOrFlag;

    // We found it, now lets check if we can or should log that we found it
    // NOTE: If we log it we want to indicate is was found on the CLI
    if (!options.silent) {
      _messages.add(
        `CLI parameter/flag (${paramOrFlag}) = (${
          options.redact ? "redacted" : strValue
        })`,
      );
    }

    return strValue;
  }

  // If we are here then we found diddly squat!
  return;
}

function init() {
  // Check if the user has specified a .env file
  let envFile = <string>configMan.get({
    config: CFG_ENV_FILE,
    type: "String",
    defaultVal: "",
  });

  if (envFile.length === 0) {
    return;
  }

  let lines: string[] = [];

  try {
    // Read env file and split it into lines ...
    let contents = fs.readFileSync(envFile, "utf8");
    // ... makes sure if works for DOS and linux files!
    lines = contents.split(/\r?\n/);
  } catch (e) {
    throw new ConfigError(
      `The following error occured when trying to open the env file (${envFile}) - (${e})`,
    );
  }

  // Iterate through each line
  for (let line of lines) {
    // If the line is commented out or blank then skip it
    if (line.startsWith("#") || line.length === 0) {
      continue;
    }

    // Don't use split() here because the value may contain an "="
    let index = line.indexOf("=");

    // Check if there was an equal in the line - if not then skip this line
    if (index === -1) {
      continue;
    }

    // Get the key/value pair - make sure to trim them as well
    let key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    // Check if the value is delimited with single or double quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      // Strip them away
      value = value.slice(1, value.length - 1);
    }

    // Stick them in the env file store
    // NOTE: Make key upper case to match env vars
    _envFileStore.set(key.toUpperCase(), value);
  }
}

// Public methods here
export const configMan = Object.freeze({
  get: (configOptions: Options): string | number | boolean => {
    // Setup the defaults
    let options: Options = {
      ...{
        silent: false,
        redact: false,
      },
      ...configOptions,
    };

    // Check the CLI first, i.e. CLI has higher precedence then env vars
    let strValue = checkCli(options);

    if (strValue === undefined) {
      // OK it's not in the CLI so lets check the env vars
      // NOTE: Always convert to upper case for env vars
      let evar = options.config.toUpperCase();
      strValue = process.env[evar];

      if (strValue !== undefined) {
        // We found it, now lets check if we can or should log that we found it
        // NOTE: If we log it we want to indicate is was found in an env var
        if (!options.silent) {
          _messages.add(
            `Env var (${evar}) = (${options.redact ? "redacted" : strValue})`,
          );
        }
      }
    }

    if (strValue === undefined) {
      // OK it's not in the env vars either so check the env file store
      // NOTE: Always convert to upper case when checking the env file store
      let evar = options.config.toUpperCase();
      strValue = _envFileStore.get(evar);

      if (strValue !== undefined) {
        // We found it, now lets check if we can or should log that we found it
        // NOTE: If we log it we want to indicate it was found in the env file
        if (!options.silent) {
          _messages.add(
            `Env var from env file (${evar}) = (${
              options.redact ? "redacted" : strValue
            })`,
          );
        }
      }
    }

    let value: string | number | boolean;

    // If the value was not found in the env vars then use default provided
    // NOTE: The default SHOULd have the correct type so do not do a conversion
    if (strValue === undefined) {
      // If the default was not provided then the config WAS required
      if (options.defaultVal === undefined) {
        // In this scenario we need to throw an error
        throw new ConfigError(
          `Config parameter (${options.config}) not set on the CLI or as an env var!`,
        );
      }

      // Otherwise use the default value
      value = options.defaultVal;

      // We found it, now lets check if we can or should log that we found it
      // NOTE: If we log it we want to indicate is the default value
      if (!options.silent) {
        _messages.add(
          `Default value used for (${options.config}) = (${
            options.redact ? "redacted" : value
          })`,
        );
      }
    } else {
      // If we are here we still need to convert the string value
      value = convertConfigValue(strValue, options.type);
    }

    return value;
  },

  getMessages: (): IterableIterator<[string, string]> => {
    return _messages.entries();
  },

  clearMessages: (): void => {
    _messages.clear();
  },
});

// Initialisation code for the module here
init();

/**
 * Config manager module. Provides functions to retrieve config values from various sources like
 * CLI, environment variables, and env file. Includes utility functions to handle config value
 * lookup, type conversion, error handling etc.
 */

// imports here
import * as fs from "node:fs";

// Config consts here

// The env var that contains the name of the .env file
const CFG_ENV_FILE = "ENV_FILE";

// Private variables here

// Stores the parsed contents of the .env file as key-value pairs
let _envFileStore: Map<string, string>;

// Stores the messages generated during configuration.
// NOTE: This is used because the configuration manager is used by Logger.
let _messageStore: Set<string>;

// Types here

/**
 * Type defines the options for retrieving a configuration value.
 *
 * @param cmdLineFlag - An optional command line flag.
 * @param silent - An optional flag to silence logging the retrieval.
 * @param redact - An optional flag to redact the value in logs.
 */
export type ConfigOptions = {
  cmdLineFlag?: string;
  silent?: boolean;
  redact?: boolean;
};

/**
 * Enumeration of supported configuration value types.
 * Can be used when retrieving a config value to specify the expected type.
 */
export enum ConfigType {
  String = "String",
  Number = "Number",
  Boolean = "Boolean",
}
/**
 * Represents an error that occurred while retrieving a config value
 */
export class ConfigError {
  public message: string;

  constructor(message: string) {
    this.message = message;
  }
}

// Private methods here

/**
 * Converts a string configuration value to the specified type.
 * Supported types are number, boolean, and string.
 * Numbers are parsed as integers. Booleans accept 'Y' or 'y' as true, everything else is false.
 * Strings are returned unchanged.
 */
function convertValue(
  value: string,
  type: ConfigType,
): number | string | boolean {
  //Check the type
  switch (type) {
    case ConfigType.Number:
      return parseInt(value);

    case ConfigType.Boolean:
      // Only accept y/Y to mean true
      if (value.toUpperCase() === "Y") {
        return true;
      }
      // Everything else is false
      return false;

    default:
      // All that is left is String and this is already a string!
      return value;
  }
}

/**
 * This checks the command line for the given config option.
 * Returns the value if found, undefined otherwise.
 */
function checkCli(config: string, options: ConfigOptions): undefined | string {
  // Ignore the first 2 params (node bin and executable file)
  let cliParams = process.argv.slice(2);

  // The convention used for config params on the command line is:
  // Convert to lowercase, replace '_' with '-' and prepend "--"
  let cliParam = `--${config.toLowerCase().replaceAll("_", "-")}`;

  // Command line flags are just prepended with a '-'
  let cmdLineFlag =
    options.cmdLineFlag !== undefined ? `-${options.cmdLineFlag}` : "";

  // If the param is assigned a value on the cli it has the format:
  //   --param=value
  // otherwise the format is and it implies true:
  //   --parm or -flag

  let regExp: RegExp;

  if (options.cmdLineFlag === undefined) {
    // No flag specified so only look for the param and an assigned value
    regExp = new RegExp(`^${cliParam}=(.+)$`);
  } else {
    // Look for param and an assigned value or cmd line flag
    regExp = new RegExp(`^${cliParam}=(.+)$|^${cliParam}$|^${cmdLineFlag}$`);
  }

  // Step through each cli params until you find a match
  for (let i = 0; i < cliParams.length; i++) {
    let match = cliParams[i].match(regExp);

    let strValue: string;
    let paramOrFlag: string;

    if (match === null) {
      // There was no match so look at the next param
      continue;
    }

    // If a value was supplied then match[1] will contain a value
    if (match[1] !== undefined) {
      paramOrFlag = match[0];
      strValue = match[1];
    } else {
      paramOrFlag = match[0];
      // The presence of the flag/param without a value implies a true value
      strValue = "Y";
    }

    // Check if we can or should log that we found it
    // NOTE: If we log it we want to indicate is was found on the CLI
    if (!options.silent) {
      _messageStore.add(
        `CLI parameter/flag (${paramOrFlag}) = (${
          options.redact ? "redacted" : strValue
        })`,
      );
    }

    return strValue;
  }

  // If we are here then we found feck all!
  return;
}

/**
 * Gets a configuration value from the command line, environment variables,
 * or a default value. Checks the command line first, then environment
 * variables, then the parameters from the .env file and finally falls back
 * to the default value if provided.
 *
 * Converts the string value to the expected type.
 * Throws an error if the config is not found and there is no default value.
 */
function get(
  config: string,
  type: ConfigType,
  defaultVal?: string | boolean | number,
  configOptions?: ConfigOptions,
): string | number | boolean {
  // Set up the defaults if not provided
  let options: ConfigOptions = {
    silent: false,
    redact: false,

    ...configOptions,
  };

  // Check the CLI first, i.e. CLI has higher precedence then env vars
  let strValue = checkCli(config, options);

  if (strValue === undefined) {
    // OK it's not in the CLI so lets check the env vars, env var has higher
    // prescedence then the .env file
    // NOTE: Always convert to upper case for env vars
    let evar = config.toUpperCase();
    strValue = process.env[evar];

    if (strValue !== undefined) {
      // We found it, now lets check if we can or should log that we found it
      // NOTE: If we log it we want to indicate is was found in an env var
      if (!options.silent) {
        _messageStore.add(
          `Env var (${evar}) = (${options.redact ? "redacted" : strValue})`,
        );
      }
    }
  }

  if (strValue === undefined) {
    // OK it's not in the env vars either so check the env file store
    // NOTE: Always convert to upper case when checking the env file store
    let evar = config.toUpperCase();
    strValue = _envFileStore.get(evar);

    if (strValue !== undefined) {
      // We found it, now lets check if we can or should log that we found it
      // NOTE: If we log it we want to indicate it was found in the env file
      if (!options.silent) {
        _messageStore.add(
          `Env var from env file (${evar}) = (${
            options.redact ? "redacted" : strValue
          })`,
        );
      }
    }
  }

  let value: string | number | boolean;

  // If the value was not found in the env vars then use default provided
  // NOTE: The default SHOULD have the correct type so do not do a conversion
  if (strValue === undefined) {
    // If the default was not provided then the config WAS required
    if (defaultVal === undefined) {
      // In this scenario we need to throw an error
      throw new ConfigError(
        `Config parameter (${config}) not set on the CLI or as an env var!`,
      );
    }

    // Otherwise use the default value
    value = defaultVal;

    // We found it, now lets check if we can or should log that we found it
    // NOTE: If we log it we want to indicate is the default value
    if (!options.silent) {
      _messageStore.add(
        `Default value used for (${config}) = (${
          options.redact ? "redacted" : value
        })`,
      );
    }
  } else {
    // If we are here we still need to convert the string value
    value = convertValue(strValue, type);
  }

  return value;
}

/**
 * Initializes the configuration manager
 */
function init() {
  // Initialise the stores
  _envFileStore = new Map();
  _messageStore = new Set();

  // Check if the user has specified a .env file
  let envFile = configMan.getStr(CFG_ENV_FILE, "");

  if (envFile.length === 0) {
    return;
  }

  let lines: string[] = [];

  try {
    _messageStore.add(`Reading config info from .env file (${envFile})`);

    // Read env file and split it into lines ...
    let contents = fs.readFileSync(envFile, "utf8");
    // ... makes sure if works for DOS and linux files!
    lines = contents.split(/\r?\n/);
  } catch (e) {
    throw new ConfigError(
      `The following error occured when trying to open the .env file (${envFile}) - (${e})`,
    );
  }

  // Iterate through each line
  for (let line of lines) {
    // If the line is commented out or blank then skip it
    if (line.length === 0 || line.startsWith("#")) {
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

    // Stick it in the env file store
    // NOTE: Make key upper case to match env vars conventions
    _envFileStore.set(key.toUpperCase(), value);

    _messageStore.add(`Added (${key.toUpperCase()}) to the env file store`);
  }
}

// Public methods here

/**
 * Exports a frozen configMan object that contains the configuration manager functions.
 * Freezing the object prevents modifications to the exported API.
 */
export const configMan = Object.freeze({
  /**
   * Retrieves a string config value with a default value if not set.
   *
   * @param config - The name of the config parameter to retrieve.
   * @param defaultVal - A default value if the config is not set. NOTE: This must be of the correct type.
   * @param configOptions - The config options.
   */
  getStr: (
    config: string,
    defaultVal?: string,
    options?: ConfigOptions,
  ): string => {
    return get(config, ConfigType.String, defaultVal, options) as string;
  },

  /**
   * Retrieves a boolean config value with a default value if not set.
   *
   * @param config - The name of the config parameter to retrieve.
   * @param defaultVal - A default value if the config is not set. NOTE: This must be of the correct type.
   * @param configOptions - The config options.
   */
  getBool: (
    config: string,
    defaultVal?: boolean,
    options?: ConfigOptions,
  ): boolean => {
    return get(config, ConfigType.Boolean, defaultVal, options) as boolean;
  },

  /**
   * Retrieves a number config value with a default value if not set.
   *
   * @param config - The name of the config parameter to retrieve.
   * @param defaultVal - A default value if the config is not set. NOTE: This must be of the correct type.
   * @param configOptions - The config options.
   */
  getNum: (
    config: string,
    defaultVal?: number,
    options?: ConfigOptions,
  ): number => {
    return get(config, ConfigType.Number, defaultVal, options) as number;
  },

  /**
   * Returns an iterable iterator over the messages stored in the message store.
   */
  getMessages: (): IterableIterator<[string, string]> => {
    return _messageStore.entries();
  },

  /** Clears all messages from the message store. */
  clearMessages: (): void => {
    _messageStore.clear();
  },
});

// Time to kick this puppy!
init();

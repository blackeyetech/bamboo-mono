/**
 * Config manager module. Provides functions to retrieve config values from various sources like
 * CLI, environment variables, and env file. Includes utility functions to handle config value
 * lookup, type conversion, error handling etc.
 */

// imports here
import * as fs from "node:fs";

// Types here

// The types a config value can have
type CfgType = number | boolean | string | Record<string, any> | any[];

// Config consts here

// The env var that contains the name of the .env file
const CFG_ENV_FILE = "ENV_FILE";

// The env var that contains the name of the cfg file
const CFG_CFG_FILE = "CFG_FILE";

// Private variables here

// Stores the parsed contents of the .env file as key-value pairs
let _envFileStore: Map<string, string>;

// Stores the parsed contents of the cfg file as an object
let _cfgFileStore: Map<string, CfgType>;

// Stores the messages generated during configuration.
// NOTE: This is used because the configuration manager is used by Logger
// and it becomes a chicken/egg situation when initialising the Logger
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
  Object = "Object",
  Array = "Array",
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
 * Converts a string value to the specified configuration type.
 *
 * NOTE: This is not used for the config files so we dont check
 * for Object or Array types.
 *
 * @param value - The string value to convert.
 * @param type - The expected configuration type.
 * @returns The converted value as a number, string, or boolean.
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
      // Only accept Y or TRUE (case insensitive) to mean true
      if (value.toUpperCase() === "Y" || value.toUpperCase() === "TRUE") {
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
 * Checks the command line arguments for a configuration value matching the
 * specified configuration key.
 *
 * @param config - The configuration key to look for in the command line arguments.
 * @param type - The expected type of the configuration value.
 * @param options - Additional options for configuring the behavior of the function.
 * @returns The configuration value from the command line arguments, converted to the specified type, or `null` if the configuration value is not found.
 */
function checkCli(
  config: string,
  type: ConfigType,
  options: ConfigOptions,
): null | CfgType {
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

  let value: string | undefined;

  // Step through each cli params until you find a match
  for (let i = 0; i < cliParams.length; i++) {
    let match = cliParams[i].match(regExp);

    let paramOrFlag: string;

    if (match === null) {
      // There was no match so look at the next param
      continue;
    }

    // If a value was supplied then match[1] will contain a value
    if (match[1] !== undefined) {
      paramOrFlag = match[0];
      value = match[1];
    } else {
      paramOrFlag = match[0];
      // The presence of the flag/param without a value implies a true value
      value = "Y";
    }

    // Check if we can or should log that we found it
    // NOTE: If we log it we want to indicate is was found on the CLI
    if (!options.silent) {
      _messageStore.add(
        `CLI parameter/flag (${paramOrFlag}) = (${
          options.redact ? "redacted" : value
        })`,
      );
    }

    // We are done so break out of the loop
    break;
  }

  // Return null if we have no value
  if (value === undefined) {
    return null;
  }

  return convertValue(value, type);
}

/**
 * Retrieves a configuration value from an environment variable.
 *
 * @param config - The configuration key to retrieve from the environment.
 * @param type - The expected type of the configuration value.
 * @param options - Additional options for configuring the behavior of the function.
 * @returns The configuration value converted to the specified type, or `null` if the environment variable is not set.
 */
function checkEnvVar(
  config: string,
  type: ConfigType,
  options: ConfigOptions,
): null | CfgType {
  // NOTE: Always convert to upper case for env vars
  let evar = config.toUpperCase();
  let value = process.env[evar];

  // Return null if we have no value
  if (value === undefined) {
    return null;
  }

  // If we are here then we found it, now lets check if we can or should
  // log that we found it
  // NOTE: If we log it we want to indicate is was found in an env var
  if (!options.silent) {
    _messageStore.add(
      `Env var (${evar}) = (${options.redact ? "redacted" : value})`,
    );
  }

  return convertValue(value, type);
}

/**
 * Retrieves a configuration value from an environment file store.
 *
 * @param config - The configuration key to retrieve from the environment file.
 * @param type - The expected type of the configuration value.
 * @param options - Additional options for configuring the behavior of the function.
 * @returns The configuration value converted to the specified type, or `null` if the configuration is not found in the environment file.
 */
function checkEnvFile(
  config: string,
  type: ConfigType,
  options: ConfigOptions,
): null | CfgType {
  // NOTE: Always convert to upper case when checking the env file store
  let evar = config.toUpperCase();
  let value = _envFileStore.get(evar);

  // Return null if we have no value
  if (value === undefined) {
    return null;
  }

  // If we are here then we found it, now lets check if we can or should
  // log that we found it
  // NOTE: If we log it we want to indicate it was found in the env file
  if (!options.silent) {
    _messageStore.add(
      `Env var from env file (${evar}) = (${
        options.redact ? "redacted" : value
      })`,
    );
  }

  return convertValue(value, type);
}

/**
 * Retrieves a configuration value from a configuration file store.
 *
 * @param config - The configuration key to retrieve from the configuration file.
 * @param options - Additional options for configuring the behavior of the function.
 * @returns The configuration value, or `null` if the configuration is not found in the configuration file.
 */
function checkCfgFile(config: string, options: ConfigOptions): null | CfgType {
  let value = _cfgFileStore.get(config);

  // Return null if we have no value
  if (value === undefined) {
    return null;
  }

  // If we are here then we found it, now lets check if we can or should
  // log that we found it
  // NOTE: If we log it we want to indicate it was found in the cfg file
  if (!options.silent) {
    _messageStore.add(
      `Config from cfg file (${config}) = (${
        options.redact ? "redacted" : JSON.stringify(value)
      })`,
    );
  }

  // No need for any convertions, just return the value
  return value;
}

/**
 * Retrieves a configuration value from various sources, with the following precedence:
 * 1. Command-line arguments
 * 2. Environment variables
 * 3. Environment file (.env)
 * 4. Configuration file
 *
 * If the configuration value is not found in any of these sources, a default value can be provided.
 *
 * @param config - The configuration key to retrieve.
 * @param type - The expected type of the configuration value.
 * @param defaultVal - The default value to use if the configuration is not found.
 * @param configOptions - Additional options for configuring the behavior of the function.
 * @returns The configuration value, or the default value if the configuration is not found.
 * @throws {ConfigError} If the configuration is required and not found.
 */
function get(
  config: string,
  type: ConfigType,
  defaultVal?: CfgType,
  configOptions?: ConfigOptions,
): CfgType {
  // Set up the defaults if not provided
  let options: ConfigOptions = {
    silent: false,
    redact: false,

    ...configOptions,
  };

  // Check the CLI first, i.e. CLI has higher precedence then env vars
  // of the cfg file
  let value = checkCli(config, type, options);
  if (value !== null) {
    return value;
  }

  // OK it's not in the CLI so lets check the env vars, env var has higher
  // precedence then the .env file
  value = checkEnvVar(config, type, options);
  if (value !== null) {
    return value;
  }

  // OK it's not in the env vars either so check the env file store
  value = checkEnvFile(config, type, options);
  if (value !== null) {
    return value;
  }

  // OK it's not in the env file store either so check the cfg store
  value = checkCfgFile(config, options);
  if (value !== null) {
    return value;
  }

  // If we are here then the value was not found - use default provided
  // NOTE: The default SHOULD have the correct type so do not do a conversion
  if (defaultVal === undefined) {
    // If the default was not provided then the config WAS required. In this
    // scenario we need to throw an error
    throw new ConfigError(`Config parameter (${config}) not found!`);
  }

  // Lets check if we can or should log the default value
  // NOTE: If we log it we want to indicate is the default value
  if (!options.silent) {
    _messageStore.add(
      `Default value used for (${config}) = (${
        options.redact ? "redacted" : defaultVal
      })`,
    );
  }

  return defaultVal;
}

/**
 * Reads the contents of the specified .env file and adds the key-value
 * pairs to the _envFileStore.
 *
 * @param envFile - The path to the .env file to read.
 * @throws {ConfigError} If an error occurs while reading the .env file.
 */
function parseEnvFile(envFile: string): void {
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

/**
 * Reads the contents of a cfg file and adds the key-value pairs to the
 * configuration store.
 *
 * @param cfgFile - The path to the configuration file to read.
 * @throws {ConfigError} If an error occurs while reading or parsing the configuration file.
 */
function readCfgFile(cfgFile: string): void {
  let contents: string;

  try {
    _messageStore.add(`Reading config info from cfg file (${cfgFile})`);

    // Read the cfg file
    contents = fs.readFileSync(cfgFile, "utf8");
  } catch (e) {
    throw new ConfigError(
      `The following error occured when trying to open the cfg file (${cfgFile}) - (${e})`,
    );
  }

  try {
    _messageStore.add("Adding the cfg file contents to the cfg store");

    _cfgFileStore = new Map(Object.entries(JSON.parse(contents)));
  } catch (e) {
    throw new ConfigError(
      `The following error occured when trying to add (${contents}) to the cfg store - (${e})`,
    );
  }
}

/**
 * Initializes the configuration manager by setting up the necessary stores and
 * parsing any specified environment and configuration files.
 *
 * The function first initializes the `_envFileStore`, `_cfgFileStore`, and
 * `_messageStore` stores. It then checks if a `.env` file has been specified
 * in the configuration and, if so, calls the `parseEnvFile` function to parse
 * the contents of the file and add the key-value pairs to the `_envFileStore`.
 *
 * Next, the function checks if a configuration file has been specified in the
 * configuration and, if so, calls the `readCfgFile` function to read the
 * contents of the file and add the key-value pairs to the `_cfgFileStore`.
 *
 * This function is typically called during the initialization of the
 * application to ensure that the configuration manager is properly set up and
 * ready to use.
 */
function init(): void {
  // Initialise the stores
  _envFileStore = new Map();
  _cfgFileStore = new Map();
  _messageStore = new Set();

  // Check if the user has specified a .env file
  let envFile = configMan.getStr(CFG_ENV_FILE, "");

  if (envFile.length > 0) {
    parseEnvFile(envFile);
  } else {
    _messageStore.add("No .env file specified");
  }

  // Check if the user has specified a cfg file
  // NOTE: The cfg file config CAN be specified in the .env file since it
  // has already been parsed
  let cfgFile = configMan.getStr(CFG_CFG_FILE, "");

  if (cfgFile.length > 0) {
    readCfgFile(cfgFile);
  } else {
    _messageStore.add("No cfg file specified");
  }
}

// Public methods here

/**
 * Provides a set of functions for retrieving configuration values from various
 * sources, including environment variables and configuration files.
 *
 * The `configMan` object is a frozen object that contains the following methods:
 *
 * - `getStr(config: string, defaultVal?: string, options?: ConfigOptions): string`
 *   - Retrieves a string configuration value with a default value if not set.
 * - `getBool(config: string, defaultVal?: boolean, options?: ConfigOptions): boolean`
 *   - Retrieves a boolean configuration value with a default value if not set.
 * - `getNum(config: string, defaultVal?: number, options?: ConfigOptions): number`
 *   - Retrieves a number configuration value with a default value if not set.
 * - `getMessages(): IterableIterator<[string, string]>`
 *   - Retrieves an iterator over the key-value pairs of the message store.
 * - `clearMessages(): void`
 *   - Clears all messages stored in the message store.`
 *
 * NOTE: Freezing the object prevents modifications to the exported API.
 */
export const configMan = Object.freeze({
  /**
   * Retrieves a string configuration value with a default value if not set.
   *
   * @param config - The name of the config parameter to retrieve.
   * @param defaultVal - A default value if the config is not set. NOTE: This must be of the correct type.
   * @param configOptions - The config options.
   * @returns The string configuration value, or the default value if not set.
   */
  getStr: (
    config: string,
    defaultVal?: string,
    options?: ConfigOptions,
  ): string => {
    return get(config, ConfigType.String, defaultVal, options) as string;
  },

  /**
   * Retrieves a boolean configuration value with a default value if not set.
   *
   * @param config - The name of the config parameter to retrieve.
   * @param defaultVal - A default value if the config is not set. NOTE: This must be of the correct type.
   * @param configOptions - The config options.
   * @returns The boolean configuration value, or the default value if not set.
   */
  getBool: (
    config: string,
    defaultVal?: boolean,
    options?: ConfigOptions,
  ): boolean => {
    return get(config, ConfigType.Boolean, defaultVal, options) as boolean;
  },

  /**
   * Retrieves a number configuration value with a default value if not set.
   *
   * @param config - The name of the config parameter to retrieve.
   * @param defaultVal - A default value if the config is not set. NOTE: This must be of the correct type.
   * @param configOptions - The config options.
   * @returns The number configuration value, or the default value if not set.
   */
  getNum: (
    config: string,
    defaultVal?: number,
    options?: ConfigOptions,
  ): number => {
    return get(config, ConfigType.Number, defaultVal, options) as number;
  },

  /**
   * Retrieves an object configuration value with a default value if not set.
   *
   * @param config - The name of the config parameter to retrieve.
   * @param defaultVal - A default value if the config is not set. NOTE: This must be of the correct type.
   * @param configOptions - The config options.
   * @returns The object configuration value, or the default value if not set.
   */
  getObject: (
    config: string,
    defaultVal?: Record<string, any>,
    options?: ConfigOptions,
  ): Record<string, any> => {
    return get(config, ConfigType.Object, defaultVal, options) as Record<
      string,
      any
    >;
  },

  /**
   * Retrieves an array configuration value with a default value if not set.
   *
   * @param config - The name of the config parameter to retrieve.
   * @param defaultVal - A default value if the config is not set. NOTE: This must be of the correct type.
   * @param configOptions - The config options.
   * @returns The array configuration value, or the default value if not set.
   */
  getArray: (
    config: string,
    defaultVal?: any[],
    options?: ConfigOptions,
  ): any[] => {
    return get(config, ConfigType.Array, defaultVal, options) as any[];
  },

  /**
   * Retrieves an iterator over the key-value pairs of the message store.
   *
   * @returns An iterator over the key-value pairs of the message store.
   */
  getMessages: (): IterableIterator<[string, string]> => {
    return _messageStore.entries();
  },

  /**
   * Clears all messages stored in the message store.
   */
  clearMessages: (): void => {
    _messageStore.clear();
  },
});

// Time to kick this puppy!
init();

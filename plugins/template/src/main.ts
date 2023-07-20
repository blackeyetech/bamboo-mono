// imports here
import { BSPlugin } from "@bs-core/shell";

// Types here

// Config consts here

// Default configs here

// Template class here
export class Template extends BSPlugin {
  constructor(name: string, _: any) {
    super(
      name,
      // NOTE: PLUGIN_VERSION is replaced with package.json#version by a
      // rollup plugin at build time
      "PLUGIN_VERSION",
    );
  }

  // Protected methods here

  // Private methods here

  // Public methods here
}

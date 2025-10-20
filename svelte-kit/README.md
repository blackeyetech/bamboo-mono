[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

In order to use the adapter you must setup the a few things.

- svelte.config.ts

Setup your Svelte config file to look like below. This will start of the HTTP
server on the interafce a port specified, it will also handle CSP headers for
prerendered files and set the base patht to be _/base_. Change as required.

This will also set up Svelte to add a CSP header for SSR generated HTML

```
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@bs-core/svelte-kit';
import { bs } from '@bs-core/shell';

const HTTP_IF = bs.getConfigStr('HTTP_IF');
const HTTP_PORT = bs.getConfigStr('HTTP_PORT');

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			networkInterface: HTTP_IF,
			networkPort: HTTP_PORT,
			staticFileServer: {
				cspHeader: {
					inlineScriptHashes: true
				}
			}
		}),
		paths: {
			base: '/base',
			relative: false
		},
		csp: {
			mode: 'auto',
			directives: {
				'script-src': ['self']
			}
		}
	}
};

export default config;
```

- vite.config.js

You Vite config file shold look like this to use the adapter in dev mode:

```
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

import { viteDevPlugin } from '@bs-core/svelte-kit';

export default defineConfig({
	plugins: [sveltekit(), viteDevPlugin()]
});
```

- hooks.server.ts

If you have a backend and want to tie it up then set up an init hook for
the server, something like below.

The convention is to put your backend code in the dir _src/backend_ and to
export an init function called _start_ from a file called _setup.ts_
NOTE: setup.ts gets complied to _setup.js_

What will happen here is when the server is started then the function setup
will be called allowing you to setup your endpoints

```
import type { ServerInit } from '@sveltejs/kit';
import { start } from '$lib/server/backend/setup.js';

export const init: ServerInit = async () => {
	await start();
};
```

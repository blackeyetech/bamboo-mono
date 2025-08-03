# @bs-core/shell

## 1.21.9

### Patch Changes

- Added retries to request()
- Default timeout is now 60 seconds
- Default retries is 3
- Default baseDelay is 500 ms

## 1.21.8

### Patch Changes

- Added responseTime to the trace logging for a HTTP request

## 1.21.7

### Patch Changes

- You can now specify the domain when clearing a cookie

## 1.21.6

### Patch Changes

- Fixed issue where an invalid URL was not handled

## 1.21.5

### Patch Changes

- - Removed ContentType from StaticFileServer
  - Refactored ServerRequest and ServerResponse
  - Refactored Router
  - Can now stream a response
  - Updated scripts in all package,json files to use pnpm instead of npm

## 1.21.4

### Patch Changes

- - HttpServer is now checking the SSR routes before the static file routes

## 1.21.3

### Patch Changes

- Fixed issue with default values in ServerResponse.redirect()

## 1.21.2

### Patch Changes

- Changed the reqHandler to accept enhanced req and res objects

## 1.21.1

### Patch Changes

- Chanegd ServerRequest and SeverResponse to types so that the Astro adapter can work in dev mode

## 1.21.0

### Minor Changes

- Fixed some code smells
- Removed maintence mode code
- Added new properties to ServerRequest: handled, checkApiRoues, checkSsrRoutes, checkStaticFiles, handle404
- Removed NoFoundHandlers and references to them from the Router and StaticFileServer classes

## 1.20.4

### Patch Changes

- Added setLatencyMetric static method to Router

## 1.20.3

### Patch Changes

- Added the correct middleware for setLatencyMetricName

## 1.20.2

### Patch Changes

- Added middleware to set the Server-Timing header
- Now setting static file server main metric name

## 1.20.1

### Patch Changes

- Can now set main Server Timing Metric name
- Now sending multiple Server Timing Metrics

## 1.20.0

### Minor Changes

- You can now add a description to Server Timing Metrics
- You can now add the Server-Timing header from a HTTP response to the
  Server Timing Metrics
- You can now add Server Timing Metrics to a request. If a request has a
  Server-Timing header then if will be prepended to the Server-Timing header
  for the response
- The request() method now sets the responseTime of the ReqRes object

## 1.19.0

### Minor Changes

- You can not spwecify an array of Regexp or string patterns for static immutable files

## 1.18.1

### Patch Changes

- You can now set the domain on a cookie

## 1.18.0

### Minor Changes

- Can now use a cfg file to provide structure JSON data

## 1.17.3

### Patch Changes

- Added proxied flag to ServerResponse to indicate a response
  came frorm a proxy and the transfer-encoding/content-encoding
  header and the content-length headers should not be set

## 1.17.2

### Patch Changes

- Fixed issue where browser closes the conection and causes an exception

## 1.17.1

### Patch Changes

- Refactored security header middleware so it can be used by the static file server
- Added security headers to static file server
- Now streaming gzipped HTTP responses
- Cleaned up ServerResponse redirect() to be more in line with the rest of the code

## 1.17.0

### Minor Changes

- Addded dontCompressResponse() middleware

## 1.16.18

### Patch Changes

- Added compression to Routers

## 1.16.17

### Patch Changes

- Added memory cahcing and compress to static file server

## 1.16.16

### Patch Changes

- Now checking for an unknown method type

## 1.16.15

### Patch Changes

- Now handling HEAD method

## 1.16.14

### Patch Changes

- Fixed issue where you could not call setCookie() multiple times

## 1.16.13

### Patch Changes

- Added signed-double-submit-cookie CSRF check to csrf middleware

## 1.16.12

### Patch Changes

- Removed terser and sourceMaps from shell, astro and all plugins

## 1.16.11

### Patch Changes

- Added HttpRedirect class

## 1.16.10

### Patch Changes

- Fixed windows issue with routes and you can now specify an IP address for an interface

## 1.16.9

### Patch Changes

- Added check to ensure "Content-Length" is not set if "Transfer-Encoding" is set to "chunked"

## 1.16.8

### Patch Changes

- Minor change to how the HttpSever matches against a router

## 1.16.7

### Patch Changes

- Added catch all to HTTP Router endpoints with the new method all()

## 1.16.6

### Patch Changes

- Added maintenance mode to HttpServer
- Updated CORS middleware

## 1.16.5

### Patch Changes

- Changed Static File Server immutable RegExp option to be a RegExp or a string

## 1.16.4

### Patch Changes

- Fixed issue when the immutable regex on the static file server

## 1.16.3

### Patch Changes

- Added check to see if this.\_immutableRegex is undefined

## 1.16.2

### Patch Changes

- Tidy up of locations for transpiled JS files

## 1.16.1

### Patch Changes

- Changed bundling to include TS source maps
- - Renamed HttpServer.addRouter() to HttpServer.router() to conform with all of the other methods (had changed to addRouter but that was not consistent)
  - The built in middelware is now static methods of the Router class as opposed to the HttpServer class

## 1.16.0

### Minor Changes

- Minor internal refactoring

## 1.15.0

### Minor Changes

- Updated dependencies
- Now bundling sourcemaps with package

## 1.14.2

### Patch Changes

- Now exporting Router

## 1.14.1

### Patch Changes

- Fixed healthcheck returning too soon because it was not set up as an async call

## 1.14.0

### Minor Changes

- - Removed ServerRequest parameter from redirect() method

## 1.13.2

### Patch Changes

- Changed default option for endpoints to use the default middleware of the router

## 1.13.1

### Patch Changes

- Renamed HttpServer.router() to HttpServer.addRouter() to conform with all of the other methods
- Now checking to see if the path supplied to endpoint() already contains the bastPath
- The following HttpServer methods now return the Router object to allow for chaining:

  - use()
  - del()
  - get()
  - patch()
  - post()
  - put()
  - endpoint()

## 1.13.0

### Minor Changes

- Normalised all header spellings to use upper case
- Moved setServerTimingHeader() to be part of ServerResponse
- Added redirection() functionality to ServerResponse

## 1.12.2

### Patch Changes

- Added check to ensure HTTP response body is a string or Buffer

## 1.12.1

### Patch Changes

- Changed RouterMatchFunc to take a URL instead of a path

## 1.12.0

### Minor Changes

- Added RouterMatch property for endpoints. Defaults to the original path-to-regexp
- Changed EndpointOptions.defaultMiddlewares to EndpointOptions.useDefaultMiddlewares

## 1.11.0

### Minor Changes

- Changed order of addHttpServer default parameters

## 1.10.0

### Minor Changes

- Added Router to HttpServer and new Route functionality

## 1.9.1

### Patch Changes

- Added check to ensure etag errors are caught and reported
- Changed timeout types to match the correct types

## 1.9.0

### Minor Changes

- Internal refactoring:

  - Removed ConfigMan Types and replaced them with strings
  - Changed ConfigMan env file store to a map()
  - Removed setLogger() from BSPlugin and added it to the constructor
  - Split out BSPlugin into it's own file
  - Removed logger from ConfigMan and added a buffer for passing messages
  - Changed Logger from being a class to being a module
  - HttpServer now requires a name. The default is "Main"
  - Added a defaultContentType to the StaticFile server
  - Moved HttpError and setServerTimingHeader to req-res.ts
  - Improved how body middleware is processing the body
  - Improved how etag is generated

## 1.8.0

### Minor Changes

- Removed need for apiBaseUrl in HttpServer config

## 1.7.3

### Patch Changes

- HttpSererv apiBasePaths is now an array

## 1.7.2

### Patch Changes

- Added urlObj back

## 1.7.1

### Patch Changes

- added default values for security headers middleware

## 1.7.0

### Minor Changes

- General refactor, moved cookie methods into ServerRequest/ServerResponse adn new security header middleware

## 1.6.1

### Patch Changes

- Replace setGlobal()/setConst() with save() and gteGlobal()/getConst() with retrieve()

## 1.6.0

### Minor Changes

- Added CSFR check middleware

## 1.5.0

### Minor Changes

- Added new helper functions for adding endpoints: del(), get(), patch(), post() and put()
- Added new method use() to add default middleware to the HTTP server
- Added SSR handler
- Added static file handler
- Added Etag and Server-Timing headers to API endpoints
- Moved CORS functionality into a middleware
- Added a wrapper that allows you to use most Express middlewares

## 1.4.0

### Minor Changes

- Can now delimit a env file config value using double or single quotes.
  This means you can have leading or trailing to spaces in a vlaue if required.

### Patch Changes

- Fixed typos in README file
- Refactored the resetHandler logic
- Now throws an error if a plugin name requested using plugin() does not exist

  Now throws an error if a HTTP Server requested using httpServer() does not exist

## 1.3.3

### Patch Changes

- Changed addPlugin() to return the new plugin so the user doesn't have
  to call plugin() immediately after adding the plugin

## 1.3.2

### Patch Changes

- Made some small changes to how plugins work internally. This is a change
  required for the updated plugins.

## 1.3.1

### Patch Changes

- Changed how plugins get added because it was causing issues

## 1.3.0

### Minor Changes

- Added global store and const store to bs to allow for convenient passing of
  globals and consts. The following methods have been added to bs:

  - setGlobal()
  - getGlobal()
  - setConst()
  - getConst()

## 1.2.1

### Patch Changes

- Update to display github repo for bamboo-mono

## 1.2.0

### Minor Changes

- Added new functionality to all an App useing Bamboo Shell to be restarted using
  a SIGHUP. This includes the ability to set a restart handler for the app.

  Calling bs.restart() will now restart the app

## 1.1.0

### Minor Changes

- The following additions were made:

  - Added getHttpServer()
  - Added getPlugin()

  Also fixed an issue with prettier adding and removing trailing commas
  when using prettier v3

## 1.0.1

### Patch Changes

- Now automatically adding HTTP headers for error messages

## 1.0.0

### Major Changes

- Initial release of Bamboo Shell!

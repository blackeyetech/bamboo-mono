# @bs-core/shell

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

- - Added RouterMatch property for endpoints. Defauls to the original path-to-regexp
  - Changed EndpointOptions.defaultMiddlewares to EndpointOptions.useDefaultMiddlewares

## 1.11.0

### Minor Changes

- Changed order of addHttpServer default parameters

## 1.10.0

### Minor Changes

- Added Router to HttpServer and new Route functionality

## 1.9.1

### Patch Changes

- 24cc99e: Following fixes made:

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

- Removed need for apiBaseUrl in HttpSErver config

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

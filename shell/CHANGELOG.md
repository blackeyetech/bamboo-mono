# @bs-core/shell

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

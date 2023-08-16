# @bs-core/shell

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

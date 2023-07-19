# @bs-core/shell

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

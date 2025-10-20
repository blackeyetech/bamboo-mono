# Bamboo Shell Framework - Getting Started Guide

Bamboo Shell is a Node.js framework that provides a shell-like wrapper for building applications with built-in HTTP server capabilities, plugin system, and configuration management.

## Installation

### Prerequisites

- Node.js >= 18.0.0
- pnpm package manager

### Install from npm

```bash
npm install @bs-core/shell
# or
pnpm add @bs-core/shell
```

### Install from source (development)

```bash
git clone https://github.com/blackeyetech/bamboo-mono.git
cd bamboo-mono
pnpm install
pnpm run build
```

## Quick Start

### Basic Application

Create a new file `app.js`:

```javascript
import { bs } from "@bs-core/shell";

// Simple hello world endpoint
async function createApp() {
  // Create HTTP server on localhost:3000
  const server = await bs.addHttpServer("127.0.0.1", 3000);

  // Add a basic GET endpoint
  server.get("/hello", (req, res) => {
    res.json = { message: "Hello, World!" };
  });

  // Add health check
  server.addHealthcheck(async () => {
    bs.info("Health check passed!");
    return true;
  });

  bs.info("Server started on http://127.0.0.1:3000");
}

// Initialize the app
await createApp();
```

Run your application:

```bash
node app.js
```

Visit http://127.0.0.1:3000/hello to see your app in action.

### More Advanced Example

```javascript
import { bs, Router } from "@bs-core/shell";

async function createAdvancedApp() {
  // Create HTTP server with configuration
  const server = await bs.addHttpServer("127.0.0.1", 3000, {
    staticFileServer: {
      path: "./public", // Serve static files from public directory
      immutableRegExp: ["^.+\\.min\\.[a-zA-Z0-9-]+$"],
    },
  });

  // Add global middleware
  server.use(
    Router.cors({
      headersAllowed: "*",
      originsAllowed: "*",
      credentialsAllowed: false,
    }),
  );

  server.use(
    Router.secHeaders({
      useDefaultHeaders: true,
    }),
  );

  // Basic routes
  server.get("/", (req, res) => {
    res.body = "<h1>Welcome to Bamboo Shell!</h1>";
    res.setHeader("Content-Type", "text/html");
  });

  // Route with parameters
  server.get("/users/:id", (req, res) => {
    const userId = req.params.id;
    res.json = {
      userId: userId,
      message: `Hello user ${userId}!`,
    };
  });

  // POST endpoint with JSON body parsing
  server.post(
    "/users",
    (req, res) => {
      res.json = {
        message: "User created",
        data: req.json,
      };
    },
    {
      middlewareList: [Router.body(), Router.json()],
    },
  );

  // Route with custom middleware
  server.get(
    "/protected",
    (req, res) => {
      res.json = { message: "This is protected!" };
    },
    {
      middlewareList: [
        async (req, res, next) => {
          bs.info("Custom middleware executed");
          await next();
        },
      ],
    },
  );

  // Health check
  server.addHealthcheck(async () => {
    return true;
  });

  bs.info("Advanced server started on http://127.0.0.1:3000");
}

// Graceful shutdown handlers
bs.setStopHandler(async () => {
  bs.info("Application stopping...");
});

bs.setFinallyHandler(async () => {
  bs.info("Application stopped!");
});

await createAdvancedApp();
```

## Key Features

### 1. HTTP Server

Create HTTP servers with built-in routing:

```javascript
// Create server
const server = await bs.addHttpServer("0.0.0.0", 8080);

// Add endpoints
server.get("/api/users", handler);
server.post("/api/users", handler);
server.put("/api/users/:id", handler);
server.delete("/api/users/:id", handler);

// Route groups
const apiRouter = server.addRouter("/api");
apiRouter.get("/status", statusHandler);
```

### 2. Configuration Management

Access configuration values with fallbacks:

```javascript
const port = bs.getConfigNum("PORT", 3000);
const dbUrl = bs.getConfigStr("DATABASE_URL", "localhost");
const debug = bs.getConfigBool("DEBUG", false);
```

### 3. Logging

Built-in structured logging:

```javascript
bs.info("Application started");
bs.warn("Warning message");
bs.error("Error occurred: %s", error.message);
bs.debug("Debug info: %j", debugObject);
```

### 4. Plugin System

Extend functionality with plugins:

```javascript
import { Template } from "@bs-plugins/template";

// Add plugin
bs.addPlugin("template", Template);

// Use plugin
const templatePlugin = bs.plugin("template");
```

### 5. Middleware

Add request/response processing:

```javascript
// Global middleware
server.use(Router.cors({ originsAllowed: "*" }));

// Endpoint-specific middleware
server.get("/endpoint", handler, {
  middlewareList: [Router.body(), customMiddleware],
});
```

### 6. Request Handling

Make HTTP requests:

```javascript
const response = await bs.request("https://api.example.com", "/users", {
  method: "GET",
  timeout: 5000,
});

bs.info("Response: %j", response);
```

## Project Structure

```
your-app/
├── package.json
├── app.js              # Main application file
├── config/            # Configuration files
├── routes/            # Route handlers
├── middleware/        # Custom middleware
├── plugins/           # Custom plugins
└── public/            # Static files
```

## Configuration

Bamboo Shell supports multiple configuration sources:

- Environment variables
- Command line flags
- Configuration files
- Default values

```javascript
// Get config with command line flag support
const apiKey = bs.getConfigStr("API_KEY", "", {
  cmdLineFlag: "api-key",
});

// Silent config retrieval (no logging)
const secret = bs.getConfigStr("SECRET", "", {
  silent: true,
});
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Development build
pnpm run build-dev

# Production build
pnpm run build-prod

# Format code
pnpm run format-ts
```

## Next Steps

- Explore the [plugin system](./plugins/) for extending functionality
- Check out [examples](./testing/src/main.ts) for more advanced usage patterns
- Read the [API documentation](./shell/src/main.ts) for complete feature reference

## License

MIT License - see [LICENSE](./LICENSE) file for details.

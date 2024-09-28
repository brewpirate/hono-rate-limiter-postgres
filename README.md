# <code>🔥hono-rate-limiter-postgres🔥</code>

A [`PostgreSQL`](https://www.postgresql.org/) store for the
[`hono-rate-limiter`](https://github.com/rhinobase/hono-rate-limiter)
middleware. 



## Installation

From the npm registry:

```sh
# Using npm
> npm install --save hono-rate-limiter-postgres
# Using yarn or pnpm
> yarn/pnpm add hono-rate-limiter-postgres
```
### dependencies
[postgres-pool](https://www.npmjs.com/package/postgres-pool)

## Usage

Functional examples for using `rate-limit-postgresql` are found in the
[following repository](https://github.com/adrianprelipcean/express-rate-limit-postgresql-examples)

```js
import { rateLimiter } from "hono-rate-limiter";
import PostgresStore from "hono-rate-limiter-postgres";

const limiter = rateLimiter({
	store: new PostgresStore({
		config: {
			user: 'postgres',
			password: 'postgres',
			host: 'localhost',
			database: 'rate-limit',
			port: 5432,
		},
		prefix: 'aggregated_store',
		type: 'summary' || 'detailed' 
	}),
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
	standardHeaders: "draft-6", // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
	keyGenerator: (c) => "<unique_key>", // Method to generate custom identifiers for clients.
})

// Apply the rate limiting middleware to all requests.
app.use(limiter);
```

## Configuration

### Config
The database configuration as specified in the PoolOptionsExplicit
 [node-postgres](https://node-postgres.com/apis/client) configuration.

### Prefix
The unique name of the session (persisted in the database). Used by the double-count check to avoid false-positives when a key is counted twice, but with different prefixes.

### Types of Postgres Stores

There are two different types of Postgres Stores:

1. `summary`

| key          | session_id | count |
| ------------ | ---------- | ----- |
| <unique_key> | 1          | 3     |
| <unique_key> | 1          | 1     |

2. `detailed`

| id  | key          | session_id | event_time                |
| --- | ------------ | ---------- | ------------------------- |
| 1   | <unique_key> | 1          | 2023-09-13T07:40:09+00:00 |
| 2   | <unique_key> | 1          | 2023-09-13T07:40:10+00:00 |
| 3   | <unique_key> | 1          | 2023-09-13T07:40:11+00:00 |
| 4   | <unique_key> | 1          | 2023-09-13T07:40:11+00:00 |

> Note: The database uses UUID as a data type for IDs, the tables contain
> integers as IDs to keep illustration simple.

## Credits
`hono-rate-limiter-postgres` is refactor of [rate-limit-postgresql](https://github.com/express-rate-limit/rate-limit-postgresql) with some changes
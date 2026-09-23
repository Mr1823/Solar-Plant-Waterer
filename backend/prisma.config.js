import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * The CLI (migrate, db pull, studio) needs a DIRECT connection — Supabase's
 * session-mode pooler on port 5432. The transaction-mode pooler on 6543 is
 * for the running app and cannot carry migrations, because pgbouncer in
 * transaction mode does not keep the session state DDL relies on.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DIRECT_URL'),
  },
});

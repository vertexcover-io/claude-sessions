import { hash } from "@node-rs/argon2";
import postgres from "postgres";

const email = process.env.SEED_EMAIL ?? "aman@local.test";
const password = process.env.SEED_PASSWORD ?? "claude-sessions-dev";
const role = "admin";

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });

const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
if (existing.length > 0) {
  await sql`UPDATE users SET password_hash = ${passwordHash}, role = ${role} WHERE email = ${email}`;
  console.log(`updated user ${email} (${existing[0].id})`);
} else {
  const rows =
    await sql`INSERT INTO users (email, password_hash, role) VALUES (${email}, ${passwordHash}, ${role}) RETURNING id`;
  console.log(`created user ${email} (${rows[0].id})`);
}
await sql.end();

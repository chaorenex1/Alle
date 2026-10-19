import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "../db/schema";
import { generateMailToken, hashMailToken, normalizeMailScopes, parseMailScopes } from "../token";

export const tokenRoutes = new Hono<{ Bindings: Env }>();

function toPublicToken(row: typeof schema.mailTokens.$inferSelect) {
	return {
		id: row.id,
		name: row.name,
		token_prefix: row.token_prefix,
		scopes: parseMailScopes(row.scopes),
		account_id: row.account_id,
		created_at: row.created_at,
		last_used_at: row.last_used_at,
	};
}

tokenRoutes.get("/", async (c) => {
	const db = drizzle(c.env.DB, { schema });
	const rows = await db
		.select()
		.from(schema.mailTokens)
		.orderBy(desc(schema.mailTokens.created_at))
		.all();

	return c.json({ items: rows.map(toPublicToken) });
});

tokenRoutes.post("/", async (c) => {
	const body = await c.req.json<{ name?: string; scopes?: unknown; account_id?: string | null }>().catch(() => null);
	if (!body) return c.json({ error: "请求体不是合法 JSON。" }, 400);

	const name = body.name?.trim().slice(0, 80) || "";
	if (!name) return c.json({ error: "令牌名称不能为空。" }, 400);

	const scopes = normalizeMailScopes(body.scopes);
	if (!scopes) return c.json({ error: "权限只能是 send 或 read。" }, 400);

	const db = drizzle(c.env.DB, { schema });
	const accountId = body.account_id?.trim() || null;
	if (accountId) {
		const account = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
		if (!account) return c.json({ error: "绑定的邮箱不存在。" }, 404);
	}

	const token = generateMailToken();
	// 令牌前缀用于面板上识别是哪一把，完整值不入库。
	const tokenPrefix = token.slice(0, 12);
	const item = {
		id: crypto.randomUUID(),
		name,
		token_hash: await hashMailToken(token),
		token_prefix: tokenPrefix,
		scopes: scopes.join(","),
		account_id: accountId,
		created_at: Math.floor(Date.now() / 1000),
		last_used_at: null,
	};
	await db.insert(schema.mailTokens).values(item).run();

	return c.json({ item: toPublicToken(item), token }, 201);
});

tokenRoutes.delete("/:id", async (c) => {
	const db = drizzle(c.env.DB, { schema });
	const id = c.req.param("id");
	const row = await db.select({ id: schema.mailTokens.id }).from(schema.mailTokens).where(eq(schema.mailTokens.id, id)).get();
	if (!row) return c.json({ error: "令牌不存在。" }, 404);

	await db.delete(schema.mailTokens).where(eq(schema.mailTokens.id, id)).run();
	return c.json({ ok: true, deleted_id: id });
});

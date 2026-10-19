import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "../db/schema";
import { OutboundError, parseRecipients, sendMail } from "../email/outbound";
import { normalizeMailAddress } from "../mailDomain";
import { hashMailToken, hasMailScope } from "../token";

type TokenRow = typeof schema.mailTokens.$inferSelect;

export const v1Routes = new Hono<{ Bindings: Env; Variables: { token: TokenRow } }>();

// 外部接口用 Bearer 令牌鉴权，和面板的 Cookie 会话互不影响。
v1Routes.use("*", async (c, next) => {
	const header = (c.req.header("authorization") || "").trim();
	const raw = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() || (c.req.header("x-api-key") || "").trim();
	if (!raw) return c.json({ error: "缺少 Bearer 令牌。" }, 401);

	const db = drizzle(c.env.DB, { schema });
	const token = await db
		.select()
		.from(schema.mailTokens)
		.where(eq(schema.mailTokens.token_hash, await hashMailToken(raw)))
		.get();
	if (!token) return c.json({ error: "令牌无效。" }, 401);

	if (token.account_id) {
		const account = await db
			.select({ id: schema.accounts.id })
			.from(schema.accounts)
			.where(eq(schema.accounts.id, token.account_id))
			.get();
		if (!account) return c.json({ error: "令牌绑定的邮箱已不存在。" }, 403);
	}

	await db
		.update(schema.mailTokens)
		.set({ last_used_at: Math.floor(Date.now() / 1000) })
		.where(eq(schema.mailTokens.id, token.id))
		.run();

	c.set("token", token);
	await next();
});

v1Routes.post("/messages", async (c) => {
	const token = c.get("token");
	if (!hasMailScope(token.scopes, "send")) return c.json({ error: "该令牌没有发件权限。" }, 403);

	const body = await c.req.json<{
		from?: string;
		to?: unknown;
		subject?: string;
		text?: string;
		html?: string;
		reply_to?: string;
	}>().catch(() => null);
	if (!body) return c.json({ error: "请求体不是合法 JSON。" }, 400);

	const db = drizzle(c.env.DB, { schema });
	let account: typeof schema.accounts.$inferSelect | undefined;
	if (token.account_id) {
		account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, token.account_id)).get();
		if (!account) return c.json({ error: "令牌绑定的邮箱已不存在。" }, 403);
		if (body.from && normalizeMailAddress(body.from) !== account.email) {
			return c.json({ error: `该令牌只能使用 ${account.email} 发件。` }, 403);
		}
	} else {
		const from = body.from ? normalizeMailAddress(body.from) : null;
		if (!from) return c.json({ error: "缺少 from（发件邮箱地址）。" }, 400);
		account = await db.select().from(schema.accounts).where(eq(schema.accounts.email, from)).get();
		if (!account) return c.json({ error: `发件邮箱未登记：${from}` }, 404);
	}

	try {
		const item = await sendMail(c.env, {
			account,
			to: parseRecipients(body.to),
			subject: body.subject ?? "",
			text: body.text,
			html: body.html,
			replyTo: body.reply_to,
		});
		return c.json({ item }, 201);
	} catch (error) {
		if (error instanceof OutboundError) {
			return c.json({ error: error.message }, error.status as 400 | 404 | 502 | 503);
		}
		throw error;
	}
});

v1Routes.get("/messages", async (c) => {
	const token = c.get("token");
	if (!hasMailScope(token.scopes, "read")) return c.json({ error: "该令牌没有读信权限。" }, 403);

	const db = drizzle(c.env.DB, { schema });
	const accountEmail = c.req.query("account")?.trim().toLowerCase() || null;
	const direction = c.req.query("direction")?.trim().toLowerCase() || null;
	const keyword = c.req.query("q")?.trim() || null;
	const cursorValue = c.req.query("cursor");
	const cursor = cursorValue ? Number.parseInt(cursorValue, 10) : null;
	const limitValue = Number.parseInt(c.req.query("limit") || "20", 10);
	const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 20;

	if (cursorValue && (!Number.isInteger(cursor) || !cursor || cursor <= 0)) {
		return c.json({ error: "cursor 不合法。" }, 400);
	}
	if (direction && direction !== "in" && direction !== "out") {
		return c.json({ error: "direction 只能是 in 或 out。" }, 400);
	}

	const conditions: SQL[] = [];
	if (accountEmail) {
		if (token.account_id) {
			const bound = await db.select({ email: schema.accounts.email }).from(schema.accounts).where(eq(schema.accounts.id, token.account_id)).get();
			if (bound?.email !== accountEmail) return c.json({ error: "该令牌只能读取绑定邮箱。" }, 403);
		}
		conditions.push(eq(schema.accounts.email, accountEmail));
	} else if (token.account_id) {
		conditions.push(eq(schema.emails.account_id, token.account_id));
	}
	if (direction) conditions.push(eq(schema.emails.direction, direction));
	if (cursor) conditions.push(sql`emails.rowid < ${cursor}`);
	if (keyword) {
		const search = or(
			like(schema.emails.subject, `%${keyword}%`),
			like(schema.emails.from_address, `%${keyword}%`),
			like(schema.emails.recipient, `%${keyword}%`),
		);
		if (search) conditions.push(search);
	}

	const rows = await db
		.select({
			cursor: sql<number>`emails.rowid`,
			email: schema.emails,
			account: schema.accounts.email,
		})
		.from(schema.emails)
		.innerJoin(schema.accounts, eq(schema.emails.account_id, schema.accounts.id))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(sql`emails.rowid`))
		.limit(limit + 1)
		.all();

	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	return c.json({
		items: page.map((row) => ({
			id: row.email.id,
			account: row.account,
			direction: row.email.direction,
			from: row.email.from_address,
			from_name: row.email.from_name,
			to: row.email.recipient,
			subject: row.email.subject,
			sent_at: row.email.sent_at,
			read: row.email.read,
			snippet: row.email.body ? row.email.body.replace(/\s+/g, " ").trim().slice(0, 160) || null : null,
		})),
		next_cursor: hasMore ? String(page[page.length - 1].cursor) : null,
		has_more: hasMore,
	});
});

v1Routes.get("/messages/:id", async (c) => {
	const token = c.get("token");
	if (!hasMailScope(token.scopes, "read")) return c.json({ error: "该令牌没有读信权限。" }, 403);

	const db = drizzle(c.env.DB, { schema });
	const row = await db
		.select({ email: schema.emails, account: schema.accounts })
		.from(schema.emails)
		.innerJoin(schema.accounts, eq(schema.emails.account_id, schema.accounts.id))
		.where(eq(schema.emails.id, c.req.param("id")))
		.get();
	if (!row) return c.json({ error: "邮件不存在。" }, 404);
	if (token.account_id && row.email.account_id !== token.account_id) {
		return c.json({ error: "该令牌只能读取绑定邮箱。" }, 403);
	}

	const attachments = await db
		.select({
			id: schema.attachments.id,
			filename: schema.attachments.filename,
			mimetype: schema.attachments.mimetype,
			size: schema.attachments.size,
			content_id: schema.attachments.content_id,
			disposition: schema.attachments.disposition,
		})
		.from(schema.attachments)
		.where(eq(schema.attachments.email_id, row.email.id))
		.all();

	return c.json({
		item: {
			...row.email,
			account: row.account.email,
			attachments,
		},
	});
});

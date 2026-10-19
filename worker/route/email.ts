import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "../db/schema";
import { OutboundError, parseRecipients, sendMail } from "../email/outbound";
import { normalizeMailAddress } from "../mailDomain";

export const emailRoutes = new Hono<{ Bindings: Env }>();

async function getEmailRecord(db: ReturnType<typeof drizzle>, id: string) {
	const row = await db
		.select({
			email: schema.emails,
			account: schema.accounts,
		})
		.from(schema.emails)
		.innerJoin(schema.accounts, eq(schema.emails.account_id, schema.accounts.id))
		.where(eq(schema.emails.id, id))
		.get();
	if (!row) return null;
	return {
		...row.email,
		snippet: row.email.body ? row.email.body.replace(/\s+/g, " ").trim().slice(0, 160) || null : null,
		account: row.account,
	};
}

emailRoutes.get("/", async (c) => {
	const cursorValue = c.req.query("cursor");
	const cursor = cursorValue ? Number.parseInt(cursorValue, 10) : null;
	const accountId = c.req.query("account_id") || null;
	const keyword = c.req.query("q")?.trim() || null;

	if (cursorValue && (!Number.isInteger(cursor) || !cursor || cursor <= 0)) {
		return c.json({ error: "Invalid email list cursor." }, 400);
	}

	const conditions: SQL[] = [];
	if (accountId) conditions.push(eq(schema.emails.account_id, accountId));
	if (cursor) conditions.push(sql`emails.rowid < ${cursor}`);
	if (keyword) {
		const search = or(
			like(schema.emails.subject, `%${keyword}%`),
			like(schema.emails.from_name, `%${keyword}%`),
			like(schema.emails.from_address, `%${keyword}%`),
			like(schema.emails.recipient, `%${keyword}%`),
		);
		if (search) conditions.push(search);
	}

	const db = drizzle(c.env.DB, { schema });
	const rows = await db
		.select({
			cursor: sql<number>`emails.rowid`,
			id: schema.emails.id,
			from_name: schema.emails.from_name,
			sent_at: schema.emails.sent_at,
			subject: schema.emails.subject,
			read: schema.emails.read,
			recipient: schema.emails.recipient,
			direction: schema.emails.direction,
		})
		.from(schema.emails)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(sql`emails.rowid`), desc(schema.emails.id))
		.limit(41)
		.all();

	const hasMore = rows.length > 40;
	const page = hasMore ? rows.slice(0, 40) : rows;
	const nextCursor = hasMore ? String(page[page.length - 1].cursor) : null;

	return c.json({
		items: page.map((email) => ({
			id: email.id,
			from_name: email.from_name,
			sent_at: email.sent_at,
			subject: email.subject,
			read: email.read,
			recipient: email.recipient,
			direction: email.direction,
		})),
		next_cursor: nextCursor,
		has_more: hasMore,
	});
});

// 从已登记的邮箱发信；发送成功后同样落库，面板里能看到这封已发送邮件。
emailRoutes.post("/send", async (c) => {
	const body = await c.req.json<{
		account_id?: string;
		from?: string;
		to?: unknown;
		subject?: string;
		text?: string;
		html?: string;
		reply_to?: string;
	}>().catch(() => null);
	if (!body) return c.json({ error: "请求体不是合法 JSON。" }, 400);

	const db = drizzle(c.env.DB, { schema });
	const account = body.account_id
		? await db.select().from(schema.accounts).where(eq(schema.accounts.id, body.account_id.trim())).get()
		: body.from
			? await db.select().from(schema.accounts).where(eq(schema.accounts.email, normalizeMailAddress(body.from) ?? "")).get()
			: undefined;
	if (!account) return c.json({ error: "发件邮箱未登记。" }, 404);

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
		if (error instanceof OutboundError) return c.json({ error: error.message }, error.status as 400 | 404 | 502 | 503);
		throw error;
	}
});

emailRoutes.get("/:id/attachments/:attachmentId", async (c) => {
	const emailId = c.req.param("id");
	const attachmentId = c.req.param("attachmentId");
	const db = drizzle(c.env.DB, { schema });
	const attachment = await db
		.select()
		.from(schema.attachments)
		.where(and(
			eq(schema.attachments.id, attachmentId),
			eq(schema.attachments.email_id, emailId),
		))
		.get();

	if (!attachment) return c.json({ error: "Attachment not found." }, 404);

	const object = await c.env.ATTACHMENTS.get(attachment.object_key);
	if (!object?.body) return c.json({ error: "Attachment file not found." }, 404);

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("content-length", String(attachment.size));
	headers.set("etag", object.httpEtag);
	headers.set(
		"content-disposition",
		`${attachment.disposition === "inline" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
	);

	return new Response(object.body, { headers });
});

emailRoutes.get("/:id", async (c) => {
	const db = drizzle(c.env.DB, { schema });
	const item = await getEmailRecord(db, c.req.param("id"));

	if (!item) return c.json({ error: "Email not found." }, 404);

	const attachments = await db
		.select()
		.from(schema.attachments)
		.where(eq(schema.attachments.email_id, c.req.param("id")))
		.all();

	return c.json({
		item: {
			...item,
			attachments,
		},
	});
});

emailRoutes.patch("/:id/read", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json<{ read: 0 | 1 }>();
	if (body.read !== 0 && body.read !== 1) {
		return c.json({ error: "Invalid email read flag." }, 400);
	}

	const db = drizzle(c.env.DB, { schema });
	await db
		.update(schema.emails)
		.set({ read: body.read })
		.where(eq(schema.emails.id, id))
		.run();

	const item = await getEmailRecord(db, id);
	if (!item) return c.json({ error: "Email not found." }, 404);

	return c.json({ item });
});

emailRoutes.delete("/", async (c) => {
	const ids = [...new Set((await c.req.json<{ ids: string[] }>()).ids.map((id) => id.trim()).filter(Boolean))];
	if (ids.length === 0) return c.json({ error: "Email ids are required." }, 400);

	const db = drizzle(c.env.DB, { schema });
	const attachmentRows = await db
		.select({
			object_key: schema.attachments.object_key,
		})
		.from(schema.attachments)
		.where(inArray(schema.attachments.email_id, ids))
		.all();

	const deleted = await db.delete(schema.emails).where(inArray(schema.emails.id, ids)).run();

	if (attachmentRows.length > 0) {
		try {
			// 附件行会随着邮件删除而级联消失，但 R2 里的二进制对象必须单独删。
			await c.env.ATTACHMENTS.delete(attachmentRows.map((row) => row.object_key));
		} catch (error) {
			console.error("批量删除邮件后清理 R2 失败", {
				ids,
				error,
			});
		}
	}

	return c.json({
		ok: true,
		deleted_count: deleted.meta?.changes || 0,
	});
});

emailRoutes.delete("/:id", async (c) => {
	const db = drizzle(c.env.DB, { schema });
	const emailId = c.req.param("id");
	const item = await db
		.select()
		.from(schema.emails)
		.where(eq(schema.emails.id, emailId))
		.get();

	if (!item) return c.json({ error: "Email not found." }, 404);

	const attachmentRows = await db
		.select({
			object_key: schema.attachments.object_key,
		})
		.from(schema.attachments)
		.where(eq(schema.attachments.email_id, emailId))
		.all();

	await db.delete(schema.emails).where(eq(schema.emails.id, emailId)).run();

	if (attachmentRows.length > 0) {
		try {
			// 先删数据库再删对象可以保证列表状态立即生效，R2 清理失败只留下可补偿的脏对象。
			await c.env.ATTACHMENTS.delete(attachmentRows.map((row) => row.object_key));
		} catch (error) {
			console.error("删除邮件后清理 R2 失败", {
				id: emailId,
				error,
			});
		}
	}

	return c.json({
		ok: true,
		deleted_count: 1,
	});
});

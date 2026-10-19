import { asc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "../db/schema";
import { MAIL_DOMAIN, isMailDomainAddress, normalizePrefix } from "../mailDomain";

export const accountRoutes = new Hono<{ Bindings: Env }>();

accountRoutes.get("/", async (c) => {
	const db = drizzle(c.env.DB, { schema });
	const items = await db
		.select()
		.from(schema.accounts)
		.orderBy(asc(schema.accounts.sort_order), asc(schema.accounts.id))
		.all();
	const routeRows = await db
		.select({ account_id: schema.mailRoutes.account_id, prefix: schema.mailRoutes.prefix })
		.from(schema.mailRoutes)
		.orderBy(asc(schema.mailRoutes.prefix))
		.all();
	const prefixesByAccount = new Map<string, string[]>();
	for (const row of routeRows) {
		prefixesByAccount.set(row.account_id, [...(prefixesByAccount.get(row.account_id) ?? []), row.prefix]);
	}

	return c.json({
		items: items.map((item) => ({ ...item, prefixes: prefixesByAccount.get(item.id) ?? [] })),
		mailDomain: MAIL_DOMAIN,
	});
});

// 匿名收集关闭后，邮箱地址只能从面板登记：只接受自己邮箱域名下的地址，重复登记返回冲突。
accountRoutes.post("/", async (c) => {
	const body = await c.req.json<{ email?: string; remark?: string | null }>().catch(() => ({ email: undefined, remark: undefined }));
	const email = body.email?.trim().toLowerCase() || "";
	if (!isMailDomainAddress(email)) {
		return c.json({ error: `邮箱地址必须形如 xxx@${MAIL_DOMAIN}。` }, 400);
	}

	const db = drizzle(c.env.DB, { schema });
	const existing = await db
		.select({ id: schema.accounts.id })
		.from(schema.accounts)
		.where(eq(schema.accounts.email, email))
		.get();
	if (existing) return c.json({ error: "该邮箱地址已存在。" }, 409);

	// 新登记的邮箱排到列表末尾，和原来的建号顺序保持一致。
	const nextSortOrder = (await db
		.select({ value: sql<number>`COALESCE(MAX(${schema.accounts.sort_order}), -1) + 1` })
		.from(schema.accounts)
		.get())?.value ?? 0;
	const item = {
		id: crypto.randomUUID(),
		email,
		remark: body.remark?.trim().slice(0, 200) || email,
		sort_order: nextSortOrder,
	};
	await db.insert(schema.accounts).values(item).run();

	return c.json({ item }, 201);
});

accountRoutes.get("/:id", async (c) => {
	const accountId = c.req.param("id");
	const db = drizzle(c.env.DB, { schema });
	const item = await db
		.select()
		.from(schema.accounts)
		.where(eq(schema.accounts.id, accountId))
		.get();

	if (!item) return c.json({ error: "Account not found." }, 404);
	const prefixes = (await db
		.select({ prefix: schema.mailRoutes.prefix })
		.from(schema.mailRoutes)
		.where(eq(schema.mailRoutes.account_id, accountId))
		.orderBy(asc(schema.mailRoutes.prefix))
		.all()).map((row) => row.prefix);
	return c.json({ item: { ...item, prefixes } });
});

accountRoutes.put("/sort", async (c) => {
	const items = (await c.req.json<Array<{ id: string; sort_order: number }>>()).map((item) => ({
		id: item.id.trim(),
		sort_order: item.sort_order,
	}));
	if (items.length === 0) return c.json({ items: [] });

	const ids = new Set<string>();
	for (const item of items) {
		if (!Number.isInteger(item.sort_order)) {
			return c.json({ error: "Invalid account sort_order." }, 400);
		}
		if (ids.has(item.id)) {
			return c.json({ error: "Duplicate account sort id." }, 400);
		}
		ids.add(item.id);
	}

	const db = drizzle(c.env.DB, { schema });
	const rows = await db
		.select({
			id: schema.accounts.id,
		})
		.from(schema.accounts)
		.where(inArray(schema.accounts.id, items.map((item) => item.id)))
		.all();

	if (rows.length !== items.length) {
		const existingIds = new Set(rows.map((row) => row.id));
		return c.json({
			error: "Some accounts were not found.",
			ids: items.filter((item) => !existingIds.has(item.id)).map((item) => item.id),
		}, 404);
	}

	// 先校验整批账号是否存在，再写排序，避免前几条已更新、后几条才发现是非法 id。
	for (const item of items) {
		await db
			.update(schema.accounts)
			.set({ sort_order: item.sort_order })
			.where(eq(schema.accounts.id, item.id))
			.run();
	}

	return c.json({
		items: await db
			.select()
			.from(schema.accounts)
			.where(inArray(schema.accounts.id, items.map((item) => item.id)))
			.orderBy(asc(schema.accounts.sort_order), asc(schema.accounts.id))
			.all(),
	});
});

accountRoutes.put("/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json<{ remark?: string | null; prefixes?: string[] }>().catch(() => null);
	if (!body) return c.json({ error: "请求体不是合法 JSON。" }, 400);

	const db = drizzle(c.env.DB, { schema });
	const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
	if (!account) return c.json({ error: "Account not found." }, 404);

	if (body.remark !== undefined) {
		await db
			.update(schema.accounts)
			.set({ remark: body.remark?.trim().slice(0, 200) || null })
			.where(eq(schema.accounts.id, id))
			.run();
	}

	if (body.prefixes !== undefined) {
		const requestedPrefixes: string[] = [];
		for (const rawPrefix of body.prefixes) {
			const prefix = normalizePrefix(String(rawPrefix ?? ""));
			if (!prefix) return c.json({ error: `收信前缀不合法：${rawPrefix}` }, 400);
			if (!requestedPrefixes.includes(prefix)) requestedPrefixes.push(prefix);
		}

		// 一个前缀只能指向一个邮箱，先挡掉被别人占用的。
		if (requestedPrefixes.length > 0) {
			const conflicts = await db
				.select({ prefix: schema.mailRoutes.prefix, account_id: schema.mailRoutes.account_id })
				.from(schema.mailRoutes)
				.where(inArray(schema.mailRoutes.prefix, requestedPrefixes))
				.all();
			const taken = conflicts.filter((row) => row.account_id !== id).map((row) => row.prefix);
			if (taken.length > 0) {
				return c.json({ error: `前缀已被其他邮箱占用：${taken.join(", ")}` }, 409);
			}
		}

		const currentRoutes = await db
			.select({ id: schema.mailRoutes.id, prefix: schema.mailRoutes.prefix })
			.from(schema.mailRoutes)
			.where(eq(schema.mailRoutes.account_id, id))
			.all();
		for (const route of currentRoutes) {
			if (requestedPrefixes.includes(route.prefix)) continue;
			await db.delete(schema.mailRoutes).where(eq(schema.mailRoutes.id, route.id)).run();
		}
		for (const prefix of requestedPrefixes) {
			if (currentRoutes.some((route) => route.prefix === prefix)) continue;
			await db.insert(schema.mailRoutes).values({
				id: crypto.randomUUID(),
				prefix,
				account_id: id,
				created_at: Math.floor(Date.now() / 1000),
			}).run();
		}
	}

	const item = await db
		.select()
		.from(schema.accounts)
		.where(eq(schema.accounts.id, id))
		.get();

	if (!item) return c.json({ error: "Account not found." }, 404);
	const prefixes = (await db
		.select({ prefix: schema.mailRoutes.prefix })
		.from(schema.mailRoutes)
		.where(eq(schema.mailRoutes.account_id, id))
		.orderBy(asc(schema.mailRoutes.prefix))
		.all()).map((route) => route.prefix);
	return c.json({ item: { ...item, prefixes } });
});

accountRoutes.delete("/:id", async (c) => {
	const db = drizzle(c.env.DB, { schema });
	const accountId = c.req.param("id");
	const account = await db
		.select()
		.from(schema.accounts)
		.where(eq(schema.accounts.id, accountId))
		.get();

	if (!account) return c.json({ error: "Account not found." }, 404);

	const attachmentRows = await db
		.select({
			object_key: schema.attachments.object_key,
		})
		.from(schema.attachments)
		.innerJoin(schema.emails, eq(schema.attachments.email_id, schema.emails.id))
		.where(eq(schema.emails.account_id, accountId))
		.all();

	// 数据库级联会删掉 emails 和 attachments 行，但 R2 对象不会跟着删。
	// 这里先删账号主记录，让列表状态立即生效；随后再按账号前缀兜底扫一遍桶，
	// 这样不仅能删掉当前数据库里还能查到的附件对象，也能把历史残留的脏对象一起清掉。
	await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId)).run();

	const objectKeys = new Set(attachmentRows.map((row) => row.object_key));
	try {
		let cursor: string | undefined;
		for (;;) {
			const page = await c.env.ATTACHMENTS.list({
				prefix: `attachments/${accountId}/`,
				cursor,
			});
			for (const object of page.objects) objectKeys.add(object.key);
			if (!page.truncated) break;
			cursor = page.cursor;
		}

		const keys = [...objectKeys];
		for (let index = 0; index < keys.length; index += 1000) {
			await c.env.ATTACHMENTS.delete(keys.slice(index, index + 1000));
		}
	} catch (error) {
		console.error("删除账号后清理 R2 失败", {
			id: accountId,
			objectKeys: [...objectKeys],
			error,
		});
	}

	return c.json({
		ok: true,
		deleted_id: accountId,
	});
});

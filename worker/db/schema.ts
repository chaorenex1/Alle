import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
	id: text("id").primaryKey(),
	email: text("email").notNull(),
	remark: text("remark"),
	sort_order: integer("sort_order").notNull().default(0),
});

export const emails = sqliteTable("emails", {
	id: text("id").primaryKey(),
	account_id: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
	subject: text("subject"),
	from_name: text("from_name"),
	from_address: text("from_address"),
	delivered_to: text("delivered_to"),
	recipient: text("recipient"),
	cc: text("cc"),
	bcc: text("bcc"),
	sent_at: integer("sent_at"),
	body: text("body"),
	raw_headers: text("raw_headers"),
	read: integer("read").notNull().default(0),
	// in = 收到，out = 从这个邮箱发出；已发送邮件同样落在所属账号下。
	direction: text("direction").notNull().default("in"),
});

// 收信前缀分流：任意前缀的来信可以落到指定邮箱，代替为每个前缀单独建账号。
export const mailRoutes = sqliteTable("mail_routes", {
	id: text("id").primaryKey(),
	prefix: text("prefix").notNull().unique(),
	account_id: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
	created_at: integer("created_at").notNull(),
});

// 外部调用令牌：只存哈希，scopes 形如 "send,read"，account_id 为空表示不限邮箱。
export const mailTokens = sqliteTable("mail_tokens", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	token_hash: text("token_hash").notNull().unique(),
	token_prefix: text("token_prefix").notNull(),
	scopes: text("scopes").notNull(),
	account_id: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
	created_at: integer("created_at").notNull(),
	last_used_at: integer("last_used_at"),
});

export const attachments = sqliteTable("attachments", {
	id: text("id").primaryKey(),
	email_id: text("email_id").notNull().references(() => emails.id, { onDelete: "cascade" }),
	object_key: text("object_key").notNull(),
	filename: text("filename").notNull(),
	mimetype: text("mimetype").notNull(),
	size: integer("size").notNull(),
	content_id: text("content_id"),
	disposition: text("disposition"),
});

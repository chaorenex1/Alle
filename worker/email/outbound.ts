import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { normalizeMailAddress } from "../mailDomain";

// Cloudflare Email Sending 的 send_email 绑定；未配置时下面会给出明确提示。
type SendEmailBinding = {
	send(message: {
		from: string;
		to: string | string[];
		subject: string;
		text?: string;
		html?: string;
		reply_to?: string;
	}): Promise<unknown>;
};

export class OutboundError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "OutboundError";
		this.status = status;
	}
}

const MAX_RECIPIENTS = 20;
const MAX_SUBJECT = 500;
const MAX_BODY = 1_000_000;
const ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getSendBinding(env: Env): SendEmailBinding | null {
	return (env as Env & { EMAIL?: SendEmailBinding }).EMAIL ?? null;
}

export function parseRecipients(input: unknown): string[] {
	const list = Array.isArray(input)
		? input
		: typeof input === "string"
			? input.split(/[,;\s]+/)
			: [];
	const seen = new Set<string>();
	const recipients: string[] = [];
	for (const raw of list) {
		if (typeof raw !== "string" || !raw.trim()) continue;
		const email = normalizeMailAddress(raw);
		if (!email || !ADDRESS_PATTERN.test(email)) {
			throw new OutboundError(400, `收件人地址无效：${raw.trim()}`);
		}
		if (seen.has(email)) continue;
		seen.add(email);
		recipients.push(email);
	}
	if (recipients.length === 0) throw new OutboundError(400, "至少需要一个收件人。");
	if (recipients.length > MAX_RECIPIENTS) throw new OutboundError(400, `收件人最多 ${MAX_RECIPIENTS} 个。`);
	return recipients;
}

export async function sendMail(env: Env, input: {
	account: { id: string; email: string };
	to: string[];
	subject: string;
	text?: string | null;
	html?: string | null;
	replyTo?: string | null;
}): Promise<{ id: string }> {
	const subject = input.subject.trim();
	if (!subject) throw new OutboundError(400, "主题不能为空。");
	if (subject.length > MAX_SUBJECT) throw new OutboundError(400, `主题最多 ${MAX_SUBJECT} 个字符。`);

	const text = input.text?.trim() ?? "";
	const html = input.html?.trim() ?? "";
	if (!text && !html) throw new OutboundError(400, "正文不能为空。");
	if (text.length > MAX_BODY || html.length > MAX_BODY) throw new OutboundError(400, "正文过长。");

	const replyTo = input.replyTo?.trim() || null;
	if (replyTo && !ADDRESS_PATTERN.test(replyTo)) throw new OutboundError(400, "回复地址无效。");

	const binding = getSendBinding(env);
	if (!binding) {
		throw new OutboundError(503, "EMAIL 绑定未配置：在 wrangler.jsonc 添加 send_email 绑定并重新部署后才能发信。");
	}

	try {
		await binding.send({
			from: input.account.email,
			to: input.to,
			subject,
			...(text ? { text } : {}),
			...(html ? { html } : {}),
			...(replyTo ? { reply_to: replyTo } : {}),
		});
	} catch (error) {
		throw new OutboundError(502, `发送失败：${error instanceof Error ? error.message : String(error)}`);
	}

	// 发送成功后同样落到所属邮箱，面板里按时间就能看到；read=1 表示不需要再读。
	const db = drizzle(env.DB, { schema });
	const id = crypto.randomUUID();
	await db.insert(schema.emails).values({
		id,
		account_id: input.account.id,
		subject,
		from_name: null,
		from_address: input.account.email,
		delivered_to: input.account.email,
		recipient: input.to.join(", "),
		cc: null,
		bcc: null,
		sent_at: Math.floor(Date.now() / 1000),
		body: html || text,
		raw_headers: null,
		read: 1,
		direction: "out",
	}).run();

	return { id };
}

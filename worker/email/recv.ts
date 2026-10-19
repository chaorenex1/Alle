import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import PostalMime from "postal-mime";
import * as schema from "../db/schema";
import { MAIL_DOMAIN, isMailDomainAddress, localPartOf, stripSubaddress } from "../mailDomain";

type ParsedAddress = {
	name?: string | null;
	address?: string | null;
};

type ParsedAttachment = {
	filename?: string | null;
	mimeType?: string | null;
	content?: string | ArrayBuffer | ArrayBufferView;
	contentId?: string | null;
	disposition?: string | null;
};

type ParsedEmail = {
	deliveredTo?: string | null;
	from?: ParsedAddress | ParsedAddress[] | null;
	to?: ParsedAddress[] | null;
	cc?: ParsedAddress[] | null;
	bcc?: ParsedAddress[] | null;
	subject?: string | null;
	html?: string | null;
	text?: string | null;
	attachments?: ParsedAttachment[] | null;
};

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (!value || seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
}

function headerValue(headers: Headers, name: string): string | null {
	const value = headers.get(name);
	return value?.trim() || null;
}

function extractEmailAddresses(value: string | null | undefined): string[] {
	if (!value) return [];
	const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
	return uniqueStrings((matches || []).map(normalizeEmail));
}

function formatAddressList(value: ParsedAddress | ParsedAddress[] | null | undefined): string | null {
	const formatted = (!value ? [] : Array.isArray(value) ? value : [value])
		.map((item) => {
			const address = item.address?.trim();
			const name = item.name?.trim();
			if (name && address) return `${name} <${address}>`;
			return address || name || "";
		})
		.filter(Boolean);
	return formatted.length > 0 ? formatted.join(", ") : null;
}

function attachmentSize(content: string | ArrayBuffer | ArrayBufferView | undefined): number {
	if (!content) return 0;
	if (typeof content === "string") return new TextEncoder().encode(content).byteLength;
	if (content instanceof ArrayBuffer) return content.byteLength;
	if (ArrayBuffer.isView(content)) return content.byteLength;
	return 0;
}

function sanitizeFilename(value: string | null | undefined): string {
	const trimmed = value?.trim() || "untitled";
	let sanitized = "";
	for (const char of trimmed) {
		const code = char.charCodeAt(0);
		// Windows 文件名不能包含保留符号，ASCII 控制字符也要统一替换，避免对象 key 和下载文件名出现非法值。
		sanitized += code <= 31 || char === "/" || char === "\\" || char === ":" || char === "*" || char === "?" || char === "\"" || char === "<" || char === ">" || char === "|" ? "_" : char;
	}
	return sanitized;
}

function normalizeEmailSentAt(value: string | null | undefined): number {
	const sentAt = value ? new Date(value).getTime() : Date.now();
	return Math.floor((Number.isNaN(sentAt) ? Date.now() : sentAt) / 1000);
}

function errorSummary(error: unknown): { name: string; message: string; stack?: string } {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	return {
		name: typeof error,
		message: String(error),
	};
}

// 把所有可能表示收件人的头按优先级收集起来，交给调用方按域名过滤；
// 不能在第一个非空头就返回，否则转发邮件带进来的原邮箱会把真正的收件地址挡掉。
function getAccountCandidates(message: ForwardableEmailMessage, parsed: ParsedEmail): string[] {
	const sources = [
		headerValue(message.headers, "duck-original-to"),
		headerValue(message.headers, "x-original-to"),
		headerValue(message.headers, "original-recipient"),
		headerValue(message.headers, "x-github-recipient-address"),
		headerValue(message.headers, "destinations"),
		headerValue(message.headers, "resent-to"),
		headerValue(message.headers, "to"),
		formatAddressList(parsed.to),
		message.to,
		parsed.deliveredTo || null,
		headerValue(message.headers, "delivered-to"),
		headerValue(message.headers, "x-forwarded-to"),
		headerValue(message.headers, "x-envelope-to"),
		headerValue(message.headers, "cc"),
		headerValue(message.headers, "bcc"),
		formatAddressList(parsed.cc),
		formatAddressList(parsed.bcc),
	];
	const emails: string[] = [];
	for (const source of sources) emails.push(...extractEmailAddresses(source));
	return uniqueStrings(emails);
}

// 账号地址优先（完整地址，其次去掉 +detail），再按收信前缀分流到指定邮箱。
async function resolveAccount(db: ReturnType<typeof drizzle>, candidates: string[]) {
	const addressVariants: string[] = [];
	for (const candidate of candidates) {
		addressVariants.push(candidate);
		const stripped = stripSubaddress(candidate);
		if (stripped !== candidate) addressVariants.push(stripped);
	}

	const matchedAccounts = await db
		.select({ id: schema.accounts.id, email: schema.accounts.email })
		.from(schema.accounts)
		.where(inArray(schema.accounts.email, uniqueStrings(addressVariants)))
		.all();
	for (const variant of addressVariants) {
		const hit = matchedAccounts.find((item) => item.email === variant);
		if (hit) return hit;
	}

	const prefixes = uniqueStrings(
		candidates
			.map((candidate) => localPartOf(stripSubaddress(candidate)))
			.filter((prefix): prefix is string => Boolean(prefix)),
	);
	if (prefixes.length === 0) return null;

	const routes = await db
		.select({ prefix: schema.mailRoutes.prefix, account_id: schema.mailRoutes.account_id })
		.from(schema.mailRoutes)
		.where(inArray(schema.mailRoutes.prefix, prefixes))
		.all();
	for (const prefix of prefixes) {
		const route = routes.find((item) => item.prefix === prefix);
		if (!route) continue;
		const account = await db
			.select({ id: schema.accounts.id, email: schema.accounts.email })
			.from(schema.accounts)
			.where(eq(schema.accounts.id, route.account_id))
			.get();
		if (account) return account;
	}
	return null;
}

export async function emailHandler(
	message: ForwardableEmailMessage,
	env: Env,
	ctx: ExecutionContext
): Promise<void> {
	void ctx;
	try {
		if (message.rawSize <= 0) throw new Error(`Invalid email size: ${message.rawSize}`);
		if (message.rawSize > 25 * 1024 * 1024) throw new Error(`Email too large: ${message.rawSize}`);

		const reader = message.raw.getReader();
		let content = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			content += new TextDecoder().decode(value);
		}

		const parsed = await PostalMime.parse(content) as ParsedEmail;
		const db = drizzle(env.DB, { schema });
		// 只认自己域名下的收件地址；自动转发头里带的原邮箱（Gmail 等）不再作为账号。
		const candidateEmails = getAccountCandidates(message, parsed).filter(isMailDomainAddress);

		// 匿名收集已关闭：收件地址不属于自己邮箱域名的直接拒收，不再按发件人随手写下的地址建号。
		if (candidateEmails.length === 0) {
			message.setReject(`Rejected: recipient must be an @${MAIL_DOMAIN} address.`);
			return;
		}

		// 账号地址优先，其次按收信前缀分流；两者都没命中才拒收。
		const matchedAccount = await resolveAccount(db, candidateEmails);

		// 匿名收集已关闭：未登记的地址不再自动建号，必须在面板里先添加邮箱地址。
		if (!matchedAccount) {
			message.setReject("Rejected: recipient is not registered.");
			return;
		}

		const emailId = crypto.randomUUID();
		const fromItems = !parsed.from ? [] : Array.isArray(parsed.from) ? parsed.from : [parsed.from];
		const fromAddress = fromItems.find((item) => item.address?.trim())?.address?.trim();
		const normalizedFromAddress = fromAddress ? normalizeEmail(fromAddress) : null;
		const fromName = fromItems.find((item) => item.name?.trim())?.name?.trim() || (normalizedFromAddress ? normalizedFromAddress.split("@")[0] : null);
		const uploadedKeys: string[] = [];
		const attachmentRows = [];

		// 附件文件本体先存 R2，数据库里只保存元数据和对象 key。
		for (const attachment of parsed.attachments || []) {
			const attachmentId = crypto.randomUUID();
			const filename = sanitizeFilename(attachment.filename);
			const mimetype = attachment.mimeType?.trim() || "application/octet-stream";
			const objectKey = `attachments/${matchedAccount.id}/${emailId}/${attachmentId}/${filename}`;
			await env.ATTACHMENTS.put(objectKey, attachment.content || "", {
				httpMetadata: { contentType: mimetype },
			});
			uploadedKeys.push(objectKey);
			attachmentRows.push({
				id: attachmentId,
				email_id: emailId,
				object_key: objectKey,
				filename,
				mimetype,
				size: attachmentSize(attachment.content),
				content_id: attachment.contentId?.trim() || null,
				disposition: attachment.disposition?.trim() || null,
			});
		}

		const emailValues = {
			id: emailId,
			account_id: matchedAccount.id,
			subject: parsed.subject?.trim() || null,
			from_name: fromName,
			from_address: normalizedFromAddress,
			delivered_to: matchedAccount.email,
			recipient: headerValue(message.headers, "to") || formatAddressList(parsed.to),
			cc: headerValue(message.headers, "cc") || formatAddressList(parsed.cc),
			bcc: headerValue(message.headers, "bcc") || formatAddressList(parsed.bcc),
			sent_at: normalizeEmailSentAt(headerValue(message.headers, "date")),
			body: parsed.html || parsed.text || null,
			raw_headers: JSON.stringify(Array.from(message.headers.entries())),
			read: 0 as const,
			direction: "in" as const,
		};

		let insertedEmail = false;
		try {
			await db.insert(schema.emails).values(emailValues).run();
			insertedEmail = true;

			if (attachmentRows.length > 0) {
				await db.insert(schema.attachments).values(attachmentRows).run();
			}
		} catch (error) {
			// 邮件行和附件元数据要么都成功，要么尽量回滚已写入的数据和对象。
			if (insertedEmail) {
				try {
					await db.delete(schema.emails).where(eq(schema.emails.id, emailId)).run();
				} catch {
					// 删除回滚失败只影响清理，不应该吞掉原始入库错误。
				}
			}
			if (uploadedKeys.length > 0) {
				try {
					await env.ATTACHMENTS.delete(uploadedKeys);
				} catch {
					// 对象清理失败同样只做记录保留，让外层继续按原始失败处理。
				}
			}
			throw error;
		}
	} catch (error) {
		console.error("邮件接收失败", {
			envelopeFrom: message.from || null,
			envelopeTo: message.to || null,
			rawSize: message.rawSize,
			error: errorSummary(error),
		});
		message.setReject("Failed to process inbound email.");
	}
}

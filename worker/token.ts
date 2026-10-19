// 外部调用令牌：明文只在创建时返回一次，库里只留 SHA-256 和前缀。
export type MailScope = "send" | "read";

export const MAIL_SCOPES: MailScope[] = ["send", "read"];

export function generateMailToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	const body = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return `alle_${body}`;
}

export async function hashMailToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseMailScopes(raw: string): MailScope[] {
	const values = new Set(raw.split(",").map((scope) => scope.trim().toLowerCase()));
	return MAIL_SCOPES.filter((scope) => values.has(scope));
}

export function normalizeMailScopes(input: unknown): MailScope[] | null {
	if (!Array.isArray(input) || input.length === 0) return null;
	const values = new Set<string>();
	for (const raw of input) values.add(String(raw ?? "").trim().toLowerCase());
	for (const value of values) {
		if (value !== "send" && value !== "read") return null;
	}
	return MAIL_SCOPES.filter((scope) => values.has(scope));
}

export function hasMailScope(raw: string, scope: MailScope): boolean {
	return parseMailScopes(raw).includes(scope);
}

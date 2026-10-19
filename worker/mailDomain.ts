// 收信只认自己的域名：地址形如 xxx@chaorenex1.com，其他域名一律拒收。
export const MAIL_DOMAIN = "chaorenex1.com";

// 收信前缀（本地部分）允许的字符，分流规则和账号登记共用。
const PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export function normalizeMailAddress(input: string): string | null {
	const normalized = input.trim().toLowerCase();
	const at = normalized.indexOf("@");
	if (at <= 0) return null;
	if (normalized.slice(0, at).includes("@")) return null;
	return normalized;
}

export function isMailDomainAddress(email: string): boolean {
	const normalized = normalizeMailAddress(email);
	if (!normalized) return false;
	return normalized.slice(normalized.indexOf("@") + 1) === MAIL_DOMAIN;
}

// RFC 5233 子地址：user+detail@domain 归到 user@domain，便于按前缀归类。
export function stripSubaddress(email: string): string {
	const normalized = normalizeMailAddress(email);
	if (!normalized) return email.trim().toLowerCase();
	const at = normalized.indexOf("@");
	const local = normalized.slice(0, at);
	const plus = local.indexOf("+");
	return plus > 0 ? `${local.slice(0, plus)}@${normalized.slice(at + 1)}` : normalized;
}

export function localPartOf(email: string): string | null {
	const normalized = normalizeMailAddress(email);
	if (!normalized) return null;
	return normalized.slice(0, normalized.indexOf("@"));
}

export function normalizePrefix(input: string): string | null {
	const prefix = input.trim().toLowerCase();
	return PREFIX_PATTERN.test(prefix) ? prefix : null;
}

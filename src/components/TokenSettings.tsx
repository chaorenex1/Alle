import { useAccountsQuery } from "@/api/account";
import { ApiError } from "@/api/client";
import {
	useCreateMailTokenMutation,
	useDeleteMailTokenMutation,
	useMailTokensQuery,
	type MailScope,
} from "@/api/tokens";
import { Check, Copy, LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";

const SCOPE_LABELS: Record<MailScope, string> = {
	send: "发信",
	read: "读信",
};

export default function TokenSettings() {
	const tokensQuery = useMailTokensQuery();
	const accountsQuery = useAccountsQuery();
	const createToken = useCreateMailTokenMutation();
	const deleteToken = useDeleteMailTokenMutation();
	const accounts = accountsQuery.data?.items ?? [];
	const [name, setName] = useState("");
	const [scopes, setScopes] = useState<MailScope[]>(["send", "read"]);
	const [accountId, setAccountId] = useState("");
	const [issued, setIssued] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const canSubmit = Boolean(name.trim() && scopes.length > 0) && !createToken.isPending;

	async function submit() {
		setError(null);
		try {
			const result = await createToken.mutateAsync({
				name: name.trim(),
				scopes,
				account_id: accountId || null,
			});
			setIssued(result.token);
			setCopied(false);
			setName("");
		} catch (mutationError) {
			setError(mutationError instanceof ApiError ? mutationError.message : "创建令牌失败，请稍后重试。");
		}
	}

	async function copyIssued() {
		if (!issued) return;
		try {
			await navigator.clipboard.writeText(issued);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		} catch {
			setError("复制失败，请手动选中令牌复制。");
		}
	}

	return (
		<div className="space-y-4">
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (canSubmit) void submit();
				}}
				className="rounded-xl bg-secondary/70 p-4"
			>
				<p className="mb-3 text-xs leading-5 text-muted-foreground">
					令牌给外部脚本调用 /api/v1 用：发信、读信。令牌只在创建时显示一次，库里只存哈希。
				</p>
				<div className="grid gap-2 sm:grid-cols-2">
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="令牌名称，如 n8n 自动回复"
						disabled={createToken.isPending}
						className="h-10 w-full rounded-lg bg-card px-3 text-sm font-medium text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
					/>
					<select
						value={accountId}
						onChange={(event) => setAccountId(event.target.value)}
						disabled={createToken.isPending}
						className="h-10 w-full appearance-none rounded-lg bg-card px-3 text-sm font-medium text-foreground outline-none transition-shadow focus:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
					>
						<option value="">不限邮箱</option>
						{accounts.map((account) => (
							<option key={account.id} value={account.id}>
								{account.remark?.trim() || account.email}
							</option>
						))}
					</select>
				</div>
				<div className="mt-3 flex items-center justify-between gap-3">
					<div className="flex items-center gap-3">
						{(["send", "read"] as MailScope[]).map((scope) => (
							<label key={scope} className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-foreground">
								<input
									type="checkbox"
									checked={scopes.includes(scope)}
									onChange={() =>
										setScopes((current) =>
											current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
										)
									}
									disabled={createToken.isPending}
									className="size-3.5 accent-foreground"
								/>
								{SCOPE_LABELS[scope]}
							</label>
						))}
					</div>
					<button
						type="submit"
						disabled={!canSubmit}
						className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-bold text-background transition-opacity outline-none hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{createToken.isPending && <LoaderCircle size={14} className="animate-spin" />}
						创建
					</button>
				</div>
				{error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
			</form>

			{issued && (
				<div className="rounded-xl border border-chart-3/40 bg-chart-3/10 p-4">
					<p className="mb-2 text-xs font-bold text-foreground">新令牌（只显示这一次）</p>
					<div className="flex items-start gap-2">
						<code className="min-w-0 flex-1 break-all rounded-lg bg-card px-3 py-2 text-xs leading-5 text-foreground">{issued}</code>
						<button
							type="button"
							onClick={() => void copyIssued()}
							className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-foreground px-2.5 text-xs font-bold text-background outline-none hover:opacity-90"
						>
							{copied ? <Check size={13} /> : <Copy size={13} />}
							{copied ? "已复制" : "复制"}
						</button>
					</div>
					<pre className="mt-3 overflow-x-auto rounded-lg bg-card px-3 py-2 text-[11px] leading-5 text-muted-foreground">{`curl -X POST ${window.location.origin}/api/v1/messages \\
  -H "Authorization: Bearer ${issued}" \\
  -H "content-type: application/json" \\
  -d '{"from":"hello@chaorenex1.com","to":"someone@example.com","subject":"hi","text":"hello"}'`}</pre>
				</div>
			)}

			<div className="space-y-2">
				{(tokensQuery.data ?? []).map((token) => (
					<div key={token.id} className="flex items-center justify-between gap-3 rounded-xl bg-secondary/70 px-4 py-3">
						<div className="min-w-0">
							<div className="truncate text-sm font-bold text-foreground">{token.name}</div>
							<div className="mt-0.5 text-xs text-muted-foreground">
								{token.token_prefix}… · {token.scopes.map((scope) => SCOPE_LABELS[scope]).join(" / ")}
								{token.account_id ? " · 绑定邮箱" : " · 不限邮箱"}
								{token.last_used_at ? ` · 最近使用 ${new Date(token.last_used_at * 1000).toLocaleString()}` : " · 未使用"}
							</div>
						</div>
						<button
							type="button"
							onClick={() => {
								if (window.confirm(`删除令牌「${token.name}」？使用它的脚本会立即失效。`)) {
									deleteToken.mutate(token.id);
								}
							}}
							disabled={deleteToken.isPending}
							className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-card hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Trash2 size={15} />
						</button>
					</div>
				))}
				{tokensQuery.isSuccess && (tokensQuery.data ?? []).length === 0 && (
					<div className="flex h-16 items-center justify-center text-sm font-medium text-muted-foreground">还没有令牌</div>
				)}
			</div>
		</div>
	);
}

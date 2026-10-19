import { useAccountsQuery, useUpdateAccountMutation, type Account } from "@/api/account";
import { ApiError } from "@/api/client";
import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";

function AccountRow({ account }: { account: Account }) {
	const updateAccount = useUpdateAccountMutation();
	const [remark, setRemark] = useState(account.remark ?? "");
	const [prefixes, setPrefixes] = useState(account.prefixes.join(", "));
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	async function save() {
		setError(null);
		setSaved(false);
		try {
			await updateAccount.mutateAsync({
				id: account.id,
				body: {
					remark: remark.trim() || null,
					prefixes: prefixes.split(/[,\s]+/).map((prefix) => prefix.trim()).filter(Boolean),
				},
			});
			setSaved(true);
			window.setTimeout(() => setSaved(false), 1600);
		} catch (mutationError) {
			setError(mutationError instanceof ApiError ? mutationError.message : "保存失败，请稍后重试。");
		}
	}

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
			className="rounded-xl bg-secondary/70 p-4"
		>
			<div className="mb-3 truncate text-sm font-bold text-foreground">{account.email}</div>
			<div className="grid gap-2 sm:grid-cols-2">
				<input
					value={remark}
					onChange={(event) => setRemark(event.target.value)}
					placeholder="说明 / 用途"
					disabled={updateAccount.isPending}
					className="h-10 w-full rounded-lg bg-card px-3 text-sm font-medium text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
				/>
				<input
					value={prefixes}
					onChange={(event) => setPrefixes(event.target.value)}
					placeholder="收信前缀，如 support, billing"
					disabled={updateAccount.isPending}
					className="h-10 w-full rounded-lg bg-card px-3 text-sm font-medium text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
				/>
			</div>
			<div className="mt-3 flex items-center justify-between gap-3">
				<p className="text-xs leading-5 text-muted-foreground">前缀命中后，发到 前缀@域名 的邮件会落到这个邮箱；多个前缀用逗号分隔。</p>
				<button
					type="submit"
					disabled={updateAccount.isPending}
					className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-bold text-background transition-opacity outline-none hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{updateAccount.isPending ? <LoaderCircle size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
					{saved ? "已保存" : "保存"}
				</button>
			</div>
			{error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
		</form>
	);
}

export default function MailboxSettings() {
	const accountsQuery = useAccountsQuery();
	const accounts = accountsQuery.data?.items ?? [];

	if (accountsQuery.isPending) {
		return <div className="flex h-24 items-center justify-center text-sm font-medium text-muted-foreground">加载中</div>;
	}
	if (accounts.length === 0) {
		return <div className="flex h-24 items-center justify-center text-sm font-medium text-muted-foreground">还没有登记邮箱</div>;
	}

	return (
		<div className="space-y-3">
			{accounts.map((account) => (
				<AccountRow key={account.id} account={account} />
			))}
		</div>
	);
}

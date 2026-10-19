import { useCreateAccountMutation } from "@/api/account";
import { ApiError } from "@/api/client";
import { LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import Modal from "@/components/Modal";

// 邮箱前缀：只允许常见地址字符，首尾不能是分隔符，避免拼出 xxx..yyy@ 这类地址。
const LOCAL_PART_REGEX = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?$/;

export default function AddMailboxDialog({
	mailDomain,
	onClose,
	onCreated,
}: {
	mailDomain: string;
	onClose: () => void;
	onCreated: (accountId: string) => void;
}) {
	const [localPart, setLocalPart] = useState("");
	const [remark, setRemark] = useState("");
	const [error, setError] = useState<string | null>(null);
	const createAccount = useCreateAccountMutation();
	const normalizedLocalPart = localPart.trim().toLowerCase();
	const canSubmit = LOCAL_PART_REGEX.test(normalizedLocalPart) && !createAccount.isPending;

	return (
		<Modal onClose={onClose} disabled={createAccount.isPending}>
			<form
				onMouseDown={(event) => event.stopPropagation()}
				onSubmit={async (event) => {
					event.preventDefault();
					if (!canSubmit) return;
					setError(null);
					try {
						const account = await createAccount.mutateAsync({
							email: `${normalizedLocalPart}@${mailDomain}`,
							remark: remark.trim() || null,
						});
						onCreated(account.id);
					} catch (mutationError) {
						setError(mutationError instanceof ApiError ? mutationError.message : "添加邮箱失败，请稍后重试。");
					}
				}}
				className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl"
			>
				<div className="mb-6 flex items-start justify-between gap-4">
					<div>
						<h2 className="text-xl font-black tracking-tight text-foreground">添加邮箱</h2>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">
							只有这里登记过的地址才会收信；往其他地址或别的域名发来的邮件会被直接拒收。
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={createAccount.isPending}
						className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
					>
						<X size={16} />
					</button>
				</div>
				<label className="group flex items-center rounded-xl bg-secondary px-2 py-2 transition-all hover:bg-muted focus-within:bg-card focus-within:shadow-md">
					<input
						autoFocus
						value={localPart}
						onChange={(event) => setLocalPart(event.target.value)}
						placeholder="邮箱前缀"
						disabled={createAccount.isPending}
						className="h-11 min-w-0 flex-1 bg-transparent px-3 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
					/>
					<span className="shrink-0 pr-3 text-sm font-medium text-muted-foreground">@{mailDomain}</span>
				</label>
				<input
					value={remark}
					onChange={(event) => setRemark(event.target.value)}
					placeholder="说明（用途标记，可留空）"
					disabled={createAccount.isPending}
					className="mt-3 h-11 w-full rounded-xl bg-secondary px-4 text-sm font-medium text-foreground outline-none transition-all placeholder:text-muted-foreground hover:bg-muted focus:bg-card focus:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
				/>
				{error && <p className="mt-3 text-sm font-medium text-destructive">{error}</p>}
				<button
					type="submit"
					disabled={!canSubmit}
					className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-chart-3 text-sm font-bold text-white transition-colors outline-none hover:bg-chart-3/90 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
				>
					{createAccount.isPending && <LoaderCircle size={16} className="animate-spin" />}
					添加
				</button>
			</form>
		</Modal>
	);
}

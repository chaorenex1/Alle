import type { Account } from "@/api/account";
import { useSendEmailMutation } from "@/api/email";
import { ApiError } from "@/api/client";
import { LoaderCircle, Send, X } from "lucide-react";
import { useState } from "react";
import Modal from "@/components/Modal";

export default function ComposeDialog({
	accounts,
	defaultAccountId,
	onClose,
	onSent,
}: {
	accounts: Account[];
	defaultAccountId: string | null;
	onClose: () => void;
	onSent: (accountId: string) => void;
}) {
	const sendEmail = useSendEmailMutation();
	const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
	const [to, setTo] = useState("");
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);

	// 发件邮箱按列表顺序渲染，说明优先显示，和侧边栏保持一致。
	const canSubmit = Boolean(accountId && to.trim() && subject.trim() && body.trim()) && !sendEmail.isPending;

	return (
		<Modal onClose={onClose} disabled={sendEmail.isPending}>
			<form
				onMouseDown={(event) => event.stopPropagation()}
				onSubmit={async (event) => {
					event.preventDefault();
					if (!canSubmit) return;
					setError(null);
					try {
						await sendEmail.mutateAsync({
							account_id: accountId,
							to: to.trim(),
							subject: subject.trim(),
							text: body,
						});
						onSent(accountId);
					} catch (mutationError) {
						setError(mutationError instanceof ApiError ? mutationError.message : "发送失败，请稍后重试。");
					}
				}}
				className="w-full max-w-xl rounded-2xl bg-card p-6 shadow-xl"
			>
				<div className="mb-5 flex items-start justify-between gap-4">
					<div>
						<h2 className="text-xl font-black tracking-tight text-foreground">写邮件</h2>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">从已登记的邮箱发出，发送成功后会出现在该邮箱的邮件列表里。</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={sendEmail.isPending}
						className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
					>
						<X size={16} />
					</button>
				</div>

				<label className="mb-3 flex items-center gap-3 rounded-xl bg-secondary px-4 py-1 transition-all hover:bg-muted focus-within:bg-card focus-within:shadow-md">
					<span className="shrink-0 text-xs font-bold tracking-wide text-muted-foreground">发件</span>
					<select
						value={accountId}
						onChange={(event) => setAccountId(event.target.value)}
						disabled={sendEmail.isPending}
						className="h-11 min-w-0 flex-1 appearance-none bg-transparent text-sm font-medium text-foreground outline-none"
					>
						{accounts.map((account) => (
							<option key={account.id} value={account.id}>
								{account.remark?.trim() || account.email}（{account.email}）
							</option>
						))}
					</select>
				</label>

				<input
					value={to}
					onChange={(event) => setTo(event.target.value)}
					placeholder="收件人，多个用逗号分隔"
					disabled={sendEmail.isPending}
					className="mb-3 h-11 w-full rounded-xl bg-secondary px-4 text-sm font-medium text-foreground outline-none transition-all placeholder:text-muted-foreground hover:bg-muted focus:bg-card focus:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
				/>
				<input
					value={subject}
					onChange={(event) => setSubject(event.target.value)}
					placeholder="主题"
					disabled={sendEmail.isPending}
					className="mb-3 h-11 w-full rounded-xl bg-secondary px-4 text-sm font-medium text-foreground outline-none transition-all placeholder:text-muted-foreground hover:bg-muted focus:bg-card focus:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
				/>
				<textarea
					value={body}
					onChange={(event) => setBody(event.target.value)}
					placeholder="正文"
					rows={8}
					disabled={sendEmail.isPending}
					className="w-full resize-none rounded-xl bg-secondary px-4 py-3 text-sm leading-6 font-medium text-foreground outline-none transition-all placeholder:text-muted-foreground hover:bg-muted focus:bg-card focus:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
				/>

				{error && <p className="mt-3 text-sm font-medium text-destructive">{error}</p>}

				<button
					type="submit"
					disabled={!canSubmit}
					className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-chart-3 text-sm font-bold text-white transition-colors outline-none hover:bg-chart-3/90 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
				>
					{sendEmail.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}
					发送
				</button>
			</form>
		</Modal>
	);
}

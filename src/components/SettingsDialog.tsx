import MailboxSettings from "@/components/MailboxSettings";
import TokenSettings from "@/components/TokenSettings";
import { KeyRound, Mail, X } from "lucide-react";
import { useState } from "react";
import Modal from "@/components/Modal";

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
	const [tab, setTab] = useState<"mailboxes" | "tokens">("mailboxes");

	return (
		<Modal onClose={onClose}>
			<div
				onMouseDown={(event) => event.stopPropagation()}
				className="flex max-h-[86vh] w-full max-w-2xl flex-col rounded-2xl bg-card p-6 shadow-xl"
			>
				<div className="mb-5 flex items-start justify-between gap-4">
					<div>
						<h2 className="text-xl font-black tracking-tight text-foreground">设置</h2>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">邮箱说明与收信前缀、外部调用令牌。</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground"
					>
						<X size={16} />
					</button>
				</div>

				<div className="mb-5 flex gap-1 rounded-xl bg-secondary p-1">
					<button
						type="button"
						onClick={() => setTab("mailboxes")}
						className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors outline-none ${tab === "mailboxes" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
					>
						<Mail size={14} />
						邮箱
					</button>
					<button
						type="button"
						onClick={() => setTab("tokens")}
						className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors outline-none ${tab === "tokens" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
					>
						<KeyRound size={14} />
						令牌
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto pr-1">
					{tab === "mailboxes" ? <MailboxSettings /> : <TokenSettings />}
				</div>
			</div>
		</Modal>
	);
}

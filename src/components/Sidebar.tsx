import { PointerActivationConstraints } from "@dnd-kit/dom";
import { PointerSensor, DragDropProvider } from "@dnd-kit/react";
import { isSortableOperation, useSortable } from "@dnd-kit/react/sortable";
import { useAccountsQuery, useUpdateAccountSortMutation, type Account } from "@/api/account";
import AddMailboxDialog from "@/components/AddMailboxDialog";
import ComposeDialog from "@/components/ComposeDialog";
import SettingsDialog from "@/components/SettingsDialog";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox, LayoutDashboard, PenLine, Plus, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "@/store/useAppStore";

const accountSortSensors = [
	// Keep the sortable element on the whole row so DOM reordering moves the tooltip together.
	// Use the avatar button as the handle, but force a delay even on the handle so short taps
	// still open the mailbox and only a long press starts the drag operation.
	PointerSensor.configure({
		activationConstraints: [new PointerActivationConstraints.Delay({ value: 280, tolerance: 8 })],
	}),
];

function SortableAccountButton({
	account,
	activeAccount,
	index,
	onSelectAccount,
	disabled,
}: {
	account: Account;
	activeAccount: string;
	index: number;
	onSelectAccount: (accountId: string) => void;
	disabled: boolean;
}) {
	const label = account.remark?.trim() || account.email;
	const isActive = activeAccount === account.id;
	const { ref, handleRef, isDragging, isDropTarget } = useSortable({
		id: account.id,
		index,
		group: "sidebar-accounts",
		sensors: accountSortSensors,
		disabled,
	});

	return (
		<div ref={ref} className={`flex w-max items-center gap-4 md:pointer-events-auto ${isDragging ? "z-20" : ""}`}>
			<button
				ref={handleRef}
				type="button"
				onClick={() => onSelectAccount(account.id)}
				className={`peer flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out outline-none touch-none select-none ${isDragging ? "scale-110 shadow-[0_12px_32px_rgba(15,23,42,0.28)]" : ""} ${isDropTarget && !isDragging ? "scale-105" : ""} ${isActive ? "bg-card ring-2 ring-inset " : ""}${[
					isActive ? "text-chart-1 ring-chart-1" : "bg-chart-1/12 text-chart-1",
					isActive ? "text-chart-2 ring-chart-2" : "bg-chart-2/12 text-chart-2",
					isActive ? "text-chart-3 ring-chart-3" : "bg-chart-3/12 text-chart-3",
					isActive ? "text-chart-4 ring-chart-4" : "bg-chart-4/12 text-chart-4",
				][index % 4]}`}
			>
				<span className={`text-lg leading-none tracking-tighter ${isActive ? "font-bold" : "font-semibold"}`}>
					{Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(label))[0]?.segment?.toUpperCase()}
				</span>
			</button>
			<div className="pointer-events-none hidden translate-x-[-10px] whitespace-nowrap rounded-sm bg-foreground px-3.5 py-2 text-xs font-medium text-background opacity-0 transition-all duration-300 peer-hover:translate-x-0 peer-hover:opacity-100 peer-focus-visible:translate-x-0 peer-focus-visible:opacity-100 md:block">
				{label}
			</div>
		</div>
	);
}

export default function Sidebar() {
	const activeAccount = useAppStore((state) => state.activeAccount);
	const setActiveAccount = useAppStore((state) => state.setActiveAccount);
	const accountsQuery = useAccountsQuery();
	const accounts = accountsQuery.data?.items ?? [];
	const mailDomain = accountsQuery.data?.mailDomain ?? "";
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isAddingMailbox, setIsAddingMailbox] = useState(false);
	const [isComposing, setIsComposing] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [orderedAccounts, setOrderedAccounts] = useState(accounts);
	const queryClient = useQueryClient();
	const updateAccountSortMutation = useUpdateAccountSortMutation();

	useEffect(() => {
		setOrderedAccounts(accounts);
	}, [accounts]);

	return (
		<aside className="relative z-20 flex h-full w-20 shrink-0 flex-col items-center pt-6 md:pt-10">
			<div className="mb-6 flex flex-col items-center gap-2 top-0.5 md:mb-8 md:top-1.5">
				<div className="relative">
					<button
						type="button"
						onClick={async () => {
							if (isRefreshing) return;
							setIsRefreshing(true);
							try {
								await Promise.all([
									queryClient.invalidateQueries({ queryKey: ["accounts"] }),
									queryClient.invalidateQueries({ queryKey: ["emails"] }),
								]);
							} finally {
								setIsRefreshing(false);
							}
						}}
						className="peer flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground"
					>
						<RefreshCw size={18} strokeWidth={2} className={isRefreshing ? "animate-spin text-foreground" : ""} />
					</button>
					<div className="pointer-events-none absolute left-full top-1/2 ml-4 hidden -translate-y-1/2 translate-x-[-10px] whitespace-nowrap rounded-sm bg-foreground px-3.5 py-2 text-xs font-medium text-background opacity-0 transition-all duration-300 peer-hover:translate-x-0 peer-hover:opacity-100 peer-focus-visible:translate-x-0 peer-focus-visible:opacity-100 md:block">
						刷新
					</div>
				</div>
				<div className="relative">
					<button
						type="button"
						onClick={() => setIsComposing(true)}
						disabled={accounts.length === 0}
						className="peer flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
					>
						<PenLine size={18} strokeWidth={2} />
					</button>
					<div className="pointer-events-none absolute left-full top-1/2 ml-4 hidden -translate-y-1/2 translate-x-[-10px] whitespace-nowrap rounded-sm bg-foreground px-3.5 py-2 text-xs font-medium text-background opacity-0 transition-all duration-300 peer-hover:translate-x-0 peer-hover:opacity-100 peer-focus-visible:translate-x-0 peer-focus-visible:opacity-100 md:block">
						写邮件
					</div>
				</div>
				<div className="relative">
					<button
						type="button"
						onClick={() => setIsAddingMailbox(true)}
						disabled={!mailDomain}
						className="peer flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
					>
						<Plus size={18} strokeWidth={2} />
					</button>
					<div className="pointer-events-none absolute left-full top-1/2 ml-4 hidden -translate-y-1/2 translate-x-[-10px] whitespace-nowrap rounded-sm bg-foreground px-3.5 py-2 text-xs font-medium text-background opacity-0 transition-all duration-300 peer-hover:translate-x-0 peer-hover:opacity-100 peer-focus-visible:translate-x-0 peer-focus-visible:opacity-100 md:block">
						添加邮箱
					</div>
				</div>
			</div>
			<nav className="flex min-h-0 flex-1 flex-col items-center gap-5 md:gap-6">
				<div className="relative">
					<button
						type="button"
						onClick={() => setActiveAccount("dashboard")}
						className={`peer flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300 ease-out outline-none ${activeAccount === "dashboard" ? "bg-card ring-2 ring-inset ring-chart-3" : "bg-chart-3/12"} text-chart-3`}
					>
						<LayoutDashboard size={20} strokeWidth={activeAccount === "dashboard" ? 2.5 : 2} />
					</button>
					<div className="pointer-events-none absolute left-full top-1/2 ml-4 hidden -translate-y-1/2 translate-x-[-10px] whitespace-nowrap rounded-sm bg-foreground px-3.5 py-2 text-xs font-medium text-background opacity-0 transition-all duration-300 peer-hover:translate-x-0 peer-hover:opacity-100 peer-focus-visible:translate-x-0 peer-focus-visible:opacity-100 md:block">
						概览
					</div>
				</div>
				<div className="relative">
					<button
						type="button"
						onClick={() => setActiveAccount("all")}
						className={`peer flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300 ease-out outline-none ${activeAccount === "all" ? "bg-card ring-2 ring-inset ring-chart-5" : "bg-chart-5/12"} text-chart-5`}
					>
						<Inbox size={20} strokeWidth={activeAccount === "all" ? 2.5 : 2} />
					</button>
					<div className="pointer-events-none absolute left-full top-1/2 ml-4 hidden -translate-y-1/2 translate-x-[-10px] whitespace-nowrap rounded-sm bg-foreground px-3.5 py-2 text-xs font-medium text-background opacity-0 transition-all duration-300 peer-hover:translate-x-0 peer-hover:opacity-100 peer-focus-visible:translate-x-0 peer-focus-visible:opacity-100 md:block">
						全部
					</div>
				</div>
				<div className="relative min-h-0 w-12 flex-1">
					<DragDropProvider
						onDragEnd={async (event) => {
							const { operation } = event;
							if (event.canceled || !isSortableOperation(operation)) return;

							const { source, target } = operation;
							if (!source || !target) return;
							const sourceIndex = orderedAccounts.findIndex((account) => account.id === source.id);
							const targetIndex = orderedAccounts.findIndex((account) => account.id === target.id);
							// dnd-kit keeps the projected destination on source.index. Fall back to the
							// hovered target slot when the library leaves source.index unchanged.
							const nextIndex = source.index === sourceIndex ? targetIndex : source.index;
							if (sourceIndex === -1 || targetIndex === -1 || nextIndex === sourceIndex) return;

							const nextAccounts = [...orderedAccounts];
							const [movedAccount] = nextAccounts.splice(sourceIndex, 1);
							if (!movedAccount) return;
							nextAccounts.splice(nextIndex, 0, movedAccount);
							setOrderedAccounts(nextAccounts);

							try {
								await updateAccountSortMutation.mutateAsync(nextAccounts.map((account, sort_order) => ({ id: account.id, sort_order })));
							} catch {
								setOrderedAccounts(accounts);
								await queryClient.invalidateQueries({ queryKey: ["accounts"] });
							}
						}}
					>
						<div className={`absolute inset-y-0 left-0 flex w-max flex-col gap-5 overflow-y-auto py-1 md:pointer-events-none md:gap-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${updateAccountSortMutation.isPending ? "opacity-70" : ""}`}>
							{orderedAccounts.map((account, index) => (
								<SortableAccountButton
									key={account.id}
									account={account}
									activeAccount={activeAccount}
									index={index}
									onSelectAccount={setActiveAccount}
									disabled={updateAccountSortMutation.isPending}
								/>
							))}
						</div>
					</DragDropProvider>
				</div>
			</nav>
			<div className="relative mt-auto pt-4">
				<button
					type="button"
					onClick={() => setIsSettingsOpen(true)}
					className="peer flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground"
				>
					<Settings2 size={18} strokeWidth={2} />
				</button>
				<div className="pointer-events-none absolute left-full top-1/2 ml-4 hidden -translate-y-1/2 translate-x-[-10px] whitespace-nowrap rounded-sm bg-foreground px-3.5 py-2 text-xs font-medium text-background opacity-0 transition-all duration-300 peer-hover:translate-x-0 peer-hover:opacity-100 peer-focus-visible:translate-x-0 peer-focus-visible:opacity-100 md:block">
					设置
				</div>
			</div>
			{isAddingMailbox && mailDomain && (
				<AddMailboxDialog
					mailDomain={mailDomain}
					onClose={() => setIsAddingMailbox(false)}
					onCreated={(accountId) => {
						setIsAddingMailbox(false);
						setActiveAccount(accountId);
					}}
				/>
			)}
			{isComposing && (
				<ComposeDialog
					accounts={accounts}
					defaultAccountId={accounts.some((account) => account.id === activeAccount) ? activeAccount : null}
					onClose={() => setIsComposing(false)}
					onSent={(accountId) => {
						setIsComposing(false);
						setActiveAccount(accountId);
						void queryClient.invalidateQueries({ queryKey: ["emails"] });
					}}
				/>
			)}
			{isSettingsOpen && <SettingsDialog onClose={() => setIsSettingsOpen(false)} />}
		</aside>
	);
}

import { useAccountsQuery, useUpdateAccountMutation } from "@/api/account";
import { useDeleteEmailMutation, useEmailQuery, useEmailsInfiniteQuery, useUpdateEmailReadMutation } from "@/api/email";
import MailAttachmentList from "@/components/MailAttachmentList";
import MailShadowHtml from "@/components/MailShadowHtml";
import { parseRawHeaders } from "@/lib/rawHeaders";
import { useAppStore } from "@/store/useAppStore";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Circle, Info, Search, Trash2, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

export default function MailboxPane() {
	const activeAccount = useAppStore((state) => state.activeAccount);
	const accountsQuery = useAccountsQuery();
	const account = activeAccount === "all" ? null : accountsQuery.data?.items.find((item) => item.id === activeAccount) || null;
	const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [editingRemark, setEditingRemark] = useState(false);
	const [remarkDraft, setRemarkDraft] = useState(account?.remark ?? "");
	const deferredSearchQuery = useDeferredValue(searchQuery);
	const scrollRef = useRef<HTMLDivElement>(null);
	const updateRead = useUpdateEmailReadMutation();
	const updateAccount = useUpdateAccountMutation();
	const deleteEmail = useDeleteEmailMutation();
	const emailQuery = useEmailQuery(selectedEmailId);
	const searchText = deferredSearchQuery.trim();
	const listQuery = useEmailsInfiniteQuery(
		account?.id ?? null,
		searchText,
		activeAccount === "all" || accountsQuery.isSuccess && Boolean(account),
	);
	const {
		data: emailsData,
		fetchNextPage,
		hasNextPage,
		isError: isListError,
		isFetchingNextPage,
		isPending: isListPending,
	} = listQuery;
	const emails = useMemo(() => emailsData?.pages.flatMap((page) => page.items) ?? [], [emailsData]);
	const getEmailItemKey = useCallback((index: number) => emails[index]?.id ?? "loading-more", [emails]);
	const virtualizer = useVirtualizer({
		count: hasNextPage ? emails.length + 1 : emails.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 88,
		getItemKey: getEmailItemKey,
		overscan: 8,
	});
	const virtualItems = virtualizer.getVirtualItems();
	useEffect(() => {
		setSelectedEmailId(null);
		setEditingRemark(false);
	}, [activeAccount]);

	useEffect(() => {
		if (editingRemark) return;
		setRemarkDraft(account?.remark ?? "");
	}, [account?.id, account?.remark, editingRemark]);

	useEffect(() => {
		scrollRef.current?.scrollTo({ top: 0 });
	}, [account?.id, deferredSearchQuery]);

	useEffect(() => {
		const lastItem = virtualItems.at(-1);
		if (!lastItem || !hasNextPage || isFetchingNextPage) return;
		if (lastItem.index < emails.length - 1) return;
		void fetchNextPage();
	}, [emails.length, fetchNextPage, hasNextPage, isFetchingNextPage, virtualItems]);

	const email = emailQuery.data;
	const parsedHeaders = email ? parseRawHeaders(email.raw_headers) : null;
	const routeNodes: string[] = [];

	if (parsedHeaders) {
		for (const route of parsedHeaders.routes) {
			for (const value of [route.from, route.to]) {
				const normalized = value.trim();
				if (!normalized || routeNodes[routeNodes.length - 1] === normalized) continue;
				routeNodes.push(normalized);
			}
		}
	}

	return (
		<main className="relative flex h-full min-w-0 flex-1">
			<section className="flex h-full min-w-0 flex-1 flex-col bg-background/60 md:basis-1/3 md:flex-none">
				<div className="flex shrink-0 flex-col gap-4 px-4 pb-4 pt-6 md:pt-10 md:gap-5">
					<div className="h-10 md:h-12">
						<input
							type="text"
							value={editingRemark ? remarkDraft : activeAccount === "all" ? "全部邮件" : account?.remark || account?.email || "收件箱"}
							readOnly={!account || !editingRemark}
							onFocus={() => {
								if (!account || editingRemark) return;
								setEditingRemark(true);
								setRemarkDraft(account.remark ?? "");
							}}
							onChange={(event) => setRemarkDraft(event.target.value)}
							onBlur={() => {
								if (!account || updateAccount.isPending) return;
								const nextRemark = remarkDraft.trim() || null;
								if (nextRemark === account.remark) {
									setEditingRemark(false);
									setRemarkDraft(account.remark ?? "");
									return;
								}
								updateAccount.mutate({ id: account.id, body: { remark: nextRemark } }, { onSuccess: () => setEditingRemark(false) });
							}}
							onKeyDown={(event) => {
								if (event.nativeEvent.isComposing) return;
								if (event.key === "Escape") {
									setEditingRemark(false);
									setRemarkDraft(account?.remark ?? "");
									return;
								}
								if (event.key !== "Enter") return;
								event.currentTarget.blur();
							}}
							placeholder={account?.email || "备注"}
							className={`h-full w-full min-w-0 appearance-none rounded-lg px-3 py-0 text-xl leading-none font-bold tracking-tight text-foreground outline-none transition-colors md:text-2xl ${editingRemark ? "bg-secondary focus:bg-muted" : "bg-transparent"} ${account ? "cursor-text" : ""}`}
						/>
					</div>
					<div className="group relative flex items-center">
						<Search size={16} className="pointer-events-none absolute left-4 text-muted-foreground transition-colors group-focus-within:text-foreground" />
						<input
							type="text"
							placeholder="搜索邮件..."
							value={searchQuery}
							onChange={(event) => setSearchQuery(event.target.value)}
							className="w-full rounded-lg bg-secondary py-3 pl-10 pr-4 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground hover:bg-muted md:py-3.5 md:pl-11"
						/>
					</div>
				</div>
				<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 md:px-4 md:pb-10 [&::-webkit-scrollbar]:hidden">
					{isListPending ? (
						<div className="flex h-40 items-center justify-center text-sm font-medium text-muted-foreground">邮件加载中</div>
					) : isListError ? (
						<div className="flex h-40 items-center justify-center text-sm font-medium text-muted-foreground">邮件加载失败</div>
					) : emails.length === 0 ? (
						<div className="flex h-40 items-center justify-center text-sm font-medium text-muted-foreground">
							{searchText ? "未找到相关邮件" : "暂无邮件"}
						</div>
					) : (
						<div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
							{virtualItems.map((virtualRow) => {
								const listEmail = emails[virtualRow.index];
								if (!listEmail) {
									return (
										<div
											key="loading-more"
											className="absolute left-0 top-0 flex w-full items-center justify-center py-4 text-sm font-medium text-muted-foreground"
											style={{ transform: `translateY(${virtualRow.start}px)` }}
										>
											{isFetchingNextPage ? "加载更多邮件..." : ""}
										</div>
									);
								}

								const isSelected = selectedEmailId === listEmail.id;
								const now = new Date();
								const sentAt = new Date(listEmail.sent_at * 1000);

								return (
									<div
										key={listEmail.id}
										ref={virtualizer.measureElement}
										className="absolute left-0 top-0 w-full py-0.5"
										data-index={virtualRow.index}
										style={{ transform: `translateY(${virtualRow.start}px)` }}
									>
										<div
											onClick={() => {
												setSelectedEmailId(listEmail.id);
												if (listEmail.read === 0) updateRead.mutate({ id: listEmail.id, read: 1 });
											}}
											className={`group cursor-pointer rounded-xl p-4 transition-all duration-200 outline-none md:p-5 ${isSelected ? "bg-card shadow-sm" : "hover:bg-secondary"}`}
										>
											<div className="mb-1.5 flex items-center justify-between gap-3">
												<span className={`truncate text-sm tracking-wide ${listEmail.read === 0 ? "font-bold text-foreground" : "font-medium text-secondary-foreground"}`}>
													{listEmail.direction === "out" ? `发给 ${listEmail.recipient || "未知收件人"}` : listEmail.from_name || "未知发件人"}
												</span>
												<div className="flex shrink-0 items-center gap-1.5">
													{listEmail.read === 0 && <Circle size={8} className="fill-current text-chart-1" />}
													<span className={`text-xs ${isSelected ? "text-muted-foreground" : "text-muted-foreground/70"}`}>
														{sentAt.toLocaleString(
															undefined,
															sentAt.toDateString() === now.toDateString()
																? { hour: "2-digit", minute: "2-digit" }
																: sentAt.getFullYear() === now.getFullYear()
																	? { month: "numeric", day: "numeric" }
																	: { year: "numeric", month: "numeric", day: "numeric" },
														)}
													</span>
												</div>
											</div>
											<h3 className={`pr-2 text-sm leading-snug md:pr-4 ${listEmail.read === 0 ? "font-bold text-foreground" : "font-medium text-foreground"}`}>
												{listEmail.subject || "(无主题)"}
											</h3>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</section>
			{!selectedEmailId ? (
				<article className="absolute inset-y-0 right-0 z-30 flex w-full min-w-0 pointer-events-none translate-x-full flex-col rounded-l-3xl bg-card shadow-xl transition-transform duration-300 ease-out md:static md:basis-2/3 md:flex-none md:pointer-events-auto md:translate-x-0 md:shadow-sm">
					<div className="flex flex-1 items-center justify-center text-sm font-medium tracking-widest text-muted-foreground uppercase">
						未选择邮件
					</div>
				</article>
			) : emailQuery.isPending ? (
				<article className="absolute inset-y-0 right-0 z-30 flex w-full min-w-0 translate-x-0 flex-col rounded-l-3xl bg-card shadow-xl transition-transform duration-300 ease-out md:static md:basis-2/3 md:flex-none md:pointer-events-auto md:translate-x-0 md:shadow-sm">
					<div className="flex flex-1 items-center justify-center text-sm font-medium text-muted-foreground">
						邮件加载中
					</div>
				</article>
			) : emailQuery.isError || !email || !parsedHeaders ? (
				<article className="absolute inset-y-0 right-0 z-30 flex w-full min-w-0 translate-x-0 flex-col rounded-l-3xl bg-card shadow-xl transition-transform duration-300 ease-out md:static md:basis-2/3 md:flex-none md:pointer-events-auto md:translate-x-0 md:shadow-sm">
					<div className="flex flex-1 items-center justify-center text-sm font-medium text-muted-foreground">
						邮件加载失败
					</div>
				</article>
			) : (
				<article className="absolute inset-y-0 right-0 z-30 flex w-full min-w-0 translate-x-0 flex-col rounded-l-3xl bg-card shadow-xl transition-transform duration-300 ease-out md:static md:basis-2/3 md:flex-none md:pointer-events-auto md:translate-x-0 md:shadow-sm">
					<header className="flex shrink-0 items-start justify-between p-4 px-1 md:px-4 md:items-center">
						<div className="flex min-w-0 items-start">
							<button
								type="button"
								onClick={() => setSelectedEmailId(null)}
								className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground md:hidden"
							>
								<X size={18} strokeWidth={2} />
							</button>
							<div className="min-w-0">
								<div className="mb-1 truncate text-base leading-tight font-semibold tracking-tight text-foreground">
									{email.from_name || email.from_address || email.account.remark || email.account.email}
								</div>
								<div className="truncate text-xs leading-tight text-muted-foreground">
									{email.from_address || email.account.email}
								</div>
							</div>
						</div>
						<div className="relative flex shrink-0 items-center">
							<button
								type="button"
								className="peer flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus:text-foreground"
							>
								<Info size={18} strokeWidth={1.5} />
							</button>
							<section className="pointer-events-none absolute top-full right-0 z-40 mt-1 w-64 max-w-[calc(100vw-2rem)] opacity-0 transition duration-150 ease-out peer-hover:pointer-events-auto peer-hover:opacity-100 peer-focus:pointer-events-auto peer-focus:opacity-100 hover:pointer-events-auto hover:opacity-100">
								<div className="max-h-180 overflow-auto rounded-3xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
									{parsedHeaders.rows.length ? (
										<div className="space-y-2">
											{parsedHeaders.rows.map((row) => (
												<div key={row.label} className="rounded-xl border border-border/60 bg-card/45 px-3 py-2.5">
													<div className="text-[10px] leading-4 font-semibold tracking-[0.16em] text-muted-foreground uppercase">
														{row.label}
													</div>
													<div className="mt-1.5 space-y-1 text-[11px] leading-5 break-all text-foreground">
														{row.values.map((value) => (
															<div key={value}>{value}</div>
														))}
													</div>
												</div>
											))}
										</div>
									) : (
										<div className="rounded-2xl border border-dashed border-border/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
											未解析出常见结构化字段
										</div>
									)}
									<div className={`${parsedHeaders.rows.length ? "mt-2 border-t border-border/60 pt-2" : "mt-2"}`}>
										{routeNodes.length ? (
											<div className="space-y-1.5">
												{routeNodes.map((node, index) => (
													<div key={`${node}-${index}`} className="rounded-lg border border-border/55 bg-popover/70 px-2.5 py-1.5 text-[11px] leading-5 font-medium break-all text-foreground">
														{node}
													</div>
												))}
											</div>
										) : (
											<div className="rounded-2xl border border-dashed border-border/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
												未发现可解析的转发路径
											</div>
										)}
									</div>
								</div>
							</section>
							<button
								type="button"
								onClick={() => {
									if (deleteEmail.isPending) return;
									deleteEmail.mutate({ id: email.id }, { onSuccess: () => setSelectedEmailId(null) });
								}}
								className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
								disabled={deleteEmail.isPending}
							>
								<Trash2 size={18} strokeWidth={1.5} className={deleteEmail.isPending ? "animate-pulse" : ""} />
							</button>
						</div>
					</header>
					<div className="mx-2 mb-2 flex min-h-0 flex-1 flex-col">
						<h1 className="mx-2 mb-2 text-xl font-black tracking-tight text-foreground">
							{email.subject || "(无主题)"}
						</h1>
						<section className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border/80 bg-card/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
							<MailShadowHtml key={email.id} id={email.id} body={email.body} attachments={email.attachments} />
						</section>
						<MailAttachmentList emailId={email.id} attachments={email.attachments} className="mt-5 shrink-0 border-t border-border/70 pt-5" />
					</div>
				</article>
			)}
		</main>
	);
}

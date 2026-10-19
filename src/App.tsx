import { useEffect } from "react";
import type { AccountsPayload } from "@/api/account";
import { apiRequest, queryClient } from "@/api/client";
import { prefetchEmailsInfiniteQuery } from "@/api/email";
import { hideBootLoading } from "@/lib/bootLoading";
import type { Stats } from "@/api/stats";
import Dashboard from "@/components/Dashboard";
import MailboxPane from "@/components/MailboxPane";
import Sidebar from "@/components/Sidebar";
import { useAppStore } from "@/store/useAppStore";

export default function App() {
	const activeAccount = useAppStore((state) => state.activeAccount);
	const setActiveAccount = useAppStore((state) => state.setActiveAccount);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const currentActiveAccount = useAppStore.getState().activeAccount;
				const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
				const statsPromise = queryClient.fetchQuery({
					queryKey: ["stats", todayStart],
					queryFn: () => apiRequest<Stats>(`/api/stats?today_start=${todayStart}`),
				});
				const { items: accounts } = await queryClient.fetchQuery({
					queryKey: ["accounts", "list"] as const,
					queryFn: async ({ signal }) => await apiRequest<AccountsPayload>("/api/accounts", { signal }),
				});
				if (cancelled) return;
				const nextActiveAccount = currentActiveAccount !== "dashboard" && currentActiveAccount !== "all" && !accounts.some((account) => account.id === currentActiveAccount)
					? "dashboard"
					: currentActiveAccount;
				if (nextActiveAccount !== currentActiveAccount) setActiveAccount("dashboard");
				if (nextActiveAccount !== "dashboard") await prefetchEmailsInfiniteQuery(nextActiveAccount === "all" ? null : nextActiveAccount);
				await statsPromise;
			} catch {
			} finally {
				if (cancelled) return;
				// 启动顺序固定在这里一次做完：先拿账号列表，再清掉失效账号，再预取首屏邮件，
				// 最后等统计也就绪后再放开页面。这样刷新时不会先露出旧视图，再跳回 dashboard。
				hideBootLoading();
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [setActiveAccount]);

	return (
		<div className="flex h-svh w-screen overflow-hidden bg-background font-sans text-foreground selection:bg-primary selection:text-primary-foreground">
			<Sidebar />
			{activeAccount === "dashboard" ? (
				<Dashboard />
			) : (
				<MailboxPane />
			)}
		</div>
	);
}

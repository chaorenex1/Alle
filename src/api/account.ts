import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./client";

export type Account = {
	id: string;
	email: string;
	remark: string | null;
	sort_order: number;
	// 收信前缀：任意前缀@域名 的来信会落到这个邮箱。
	prefixes: string[];
};

export type UpdateAccountInput = {
	remark?: string | null;
	prefixes?: string[];
};

export type CreateAccountInput = {
	email: string;
	remark?: string | null;
};

export type SortAccountInput = {
	id: string;
	sort_order: number;
};

export type AccountsPayload = {
	items: Account[];
	// 收信只接受该域名下的地址，面板用它拼出完整邮箱地址。
	mailDomain: string;
};

function withItems(updater: (items: Account[]) => Account[]) {
	queryClient.setQueryData(["accounts", "list"] as const, (previous: AccountsPayload | undefined) =>
		previous ? { ...previous, items: updater(previous.items) } : previous,
	);
}

function sortAccounts(items: Account[]) {
	return [...items].sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
}

export function useAccountsQuery() {
	return useQuery({
		queryKey: ["accounts", "list"] as const,
		queryFn: async ({ signal }) => await apiRequest<AccountsPayload>("/api/accounts", { signal }),
		refetchOnMount: 'always',
	});
}

export function useAccountQuery(id: string | null | undefined) {
	return useQuery({
		queryKey: ["accounts", "detail", id || ""] as const,
		queryFn: async ({ signal }) => (await apiRequest<{ item: Account }>(`/api/accounts/${id}`, { signal })).item,
		enabled: Boolean(id),
	});
}

export function useUpdateAccountSortMutation() {
	return useMutation({
		mutationFn: async (items: SortAccountInput[]) =>
			(await apiRequest<{ items: Account[] }>("/api/accounts/sort", {
				method: "PUT",
				body: items,
			})).items,
		onSuccess: (items) => {
			// The sort API only sends back the rows whose sort_order changed. Merge them into the
			// cached full list first, then sort with the same fields the backend uses, otherwise
			// untouched accounts would disappear from the sidebar cache after a drag operation.
			// 排序接口只回 id/email/remark/sort_order，没有 prefixes，所以只把新的 sort_order 合进缓存，
			// 否则拖一次就会把收信前缀从列表里冲掉。
			withItems((current) =>
				sortAccounts(current.map((account) => {
					const updated = items.find((item) => item.id === account.id);
					return updated ? { ...account, sort_order: updated.sort_order } : account;
				})),
			);
		},
	});
}

export function useCreateAccountMutation() {
	return useMutation({
		mutationFn: async ({ email, remark }: CreateAccountInput) =>
			(await apiRequest<{ item: Account }>("/api/accounts", { method: "POST", body: { email, remark } })).item,
		onSuccess: (item) => {
			queryClient.setQueryData(["accounts", "detail", item.id] as const, item);
			void queryClient.invalidateQueries({ queryKey: ["accounts"] as const });
			void queryClient.invalidateQueries({ queryKey: ["stats"] as const });
		},
	});
}

export function useUpdateAccountMutation() {
	return useMutation({
		mutationFn: async ({ id, body }: { id: string; body: UpdateAccountInput }) =>
			(await apiRequest<{ item: Account }>(`/api/accounts/${id}`, {
				method: "PUT",
				body,
			})).item,
		onSuccess: (item) => {
			queryClient.setQueryData(["accounts", "detail", item.id] as const, item);
			withItems((current) => sortAccounts(current.map((account) => (account.id === item.id ? item : account))));
			// Mail details embed the joined account record, so email caches need a refresh after
			// changing the account remark; otherwise the detail pane can keep stale labels.
			queryClient.invalidateQueries({ queryKey: ["emails"] });
		},
	});
}

export function useDeleteAccountMutation() {
	return useMutation({
		mutationFn: ({ id }: { id: string }) =>
			apiRequest<{ ok: true; deleted_id: string }>(`/api/accounts/${id}`, { method: "DELETE" }),
		onSuccess: ({ deleted_id }) => {
			queryClient.removeQueries({ queryKey: ["accounts", "detail", deleted_id] as const });
			withItems((current) => current.filter((item) => item.id !== deleted_id));
			queryClient.invalidateQueries({ queryKey: ["emails"] });
			queryClient.invalidateQueries({ queryKey: ["stats"] });
		},
	});
}

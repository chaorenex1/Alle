import { useInfiniteQuery, useMutation, useQuery, type InfiniteData } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./client";
import type { Account } from "./account";

export type EmailAttachment = {
	id: string;
	email_id: string;
	object_key: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id: string | null;
	disposition: string | null;
};

export type EmailListItem = {
	id: string;
	subject: string | null;
	from_name: string | null;
	sent_at: number;
	read: number;
	recipient: string | null;
	direction: "in" | "out";
};

export type EmailRecord = {
	id: string;
	account_id: string;
	subject: string | null;
	from_name: string | null;
	from_address: string | null;
	delivered_to: string | null;
	recipient: string | null;
	cc: string | null;
	bcc: string | null;
	sent_at: number;
	read: number;
	snippet: string | null;
	body: string | null;
	raw_headers: string | null;
	direction: "in" | "out";
	account: Account;
};

export type EmailDetail = EmailRecord & {
	attachments: EmailAttachment[];
};

type EmailListResponse = {
	items: EmailListItem[];
	next_cursor: string | null;
	has_more: boolean;
};

type DeleteEmailResponse = {
	ok: true;
	deleted_count: number;
};

export function prefetchEmailsInfiniteQuery(accountId: string | null) {
	return queryClient.prefetchInfiniteQuery({
		queryKey: ["emails", "list", accountId || "", ""] as const,
		initialPageParam: null as string | null,
		queryFn: ({ pageParam, signal }) => {
			const search = new URLSearchParams();
			if (accountId) search.set("account_id", accountId);
			if (pageParam) search.set("cursor", pageParam);
			return apiRequest<EmailListResponse>(`/api/emails?${search.toString()}`, { signal });
		},
		getNextPageParam: (lastPage: EmailListResponse) => lastPage.next_cursor,
	});
}

export function useEmailsInfiniteQuery(accountId: string | null, q = "", enabled = true) {
	const searchText = q.trim();
	return useInfiniteQuery({
		queryKey: ["emails", "list", accountId || "", searchText] as const,
		enabled,
		initialPageParam: null as string | null,
		queryFn: ({ pageParam, signal }) => {
			const search = new URLSearchParams();
			if (accountId) search.set("account_id", accountId);
			if (searchText) search.set("q", searchText);
			if (pageParam) search.set("cursor", pageParam);
			return apiRequest<EmailListResponse>(`/api/emails?${search.toString()}`, { signal });
		},
		getNextPageParam: (lastPage: EmailListResponse) => lastPage.next_cursor,
	});
}

export function useEmailQuery(id: string | null | undefined) {
	return useQuery({
		queryKey: ["emails", "detail", id || ""] as const,
		queryFn: async () => (await apiRequest<{ item: EmailDetail }>(`/api/emails/${id}`)).item,
		enabled: Boolean(id),
	});
}

export function useUpdateEmailReadMutation() {
	return useMutation({
		mutationFn: async ({ id, read }: { id: string; read: 0 | 1 }) =>
			(await apiRequest<{ item: EmailRecord }>(`/api/emails/${id}/read`, {
				method: "PATCH",
				body: { read },
			})).item,
		onSuccess: (item) => {
			queryClient.setQueryData(["emails", "detail", item.id] as const, (previous: EmailDetail | undefined) =>
				previous ? { ...item, attachments: previous.attachments } : previous
			);
			queryClient.invalidateQueries({ queryKey: ["emails"] as const });
			queryClient.invalidateQueries({ queryKey: ["stats"] });
		},
	});
}

export function useDeleteEmailMutation() {
	return useMutation({
		mutationFn: ({ id }: { id: string }) =>
			apiRequest<DeleteEmailResponse>(`/api/emails/${id}`, { method: "DELETE" }),
		onSuccess: (_, variables) => {
			queryClient.removeQueries({ queryKey: ["emails", "detail", variables.id] as const });
			queryClient.setQueriesData(
				{
					predicate: (query) =>
						Array.isArray(query.queryKey) &&
						query.queryKey[0] === "emails" &&
						query.queryKey[1] === "list",
				},
				(previous: InfiniteData<EmailListResponse> | undefined) =>
					previous
						? {
							...previous,
							pages: previous.pages.map((page) => ({
								...page,
								items: page.items.filter((item) => item.id !== variables.id),
							})),
						}
						: previous,
			);
			queryClient.invalidateQueries({ queryKey: ["emails"] as const });
			queryClient.invalidateQueries({ queryKey: ["stats"] });
		},
	});
}

export type SendEmailInput = {
	account_id: string;
	to: string;
	subject: string;
	text: string;
	html?: string;
	reply_to?: string;
};

export function useSendEmailMutation() {
	return useMutation({
		mutationFn: async (input: SendEmailInput) =>
			(await apiRequest<{ item: { id: string } }>("/api/emails/send", { method: "POST", body: input })).item,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["emails"] });
			await queryClient.invalidateQueries({ queryKey: ["stats"] });
		},
	});
}

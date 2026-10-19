import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./client";

export type MailScope = "send" | "read";

export type MailToken = {
	id: string;
	name: string;
	token_prefix: string;
	scopes: MailScope[];
	account_id: string | null;
	created_at: number;
	last_used_at: number | null;
};

export function useMailTokensQuery() {
	return useQuery({
		queryKey: ["mail-tokens", "list"] as const,
		queryFn: async ({ signal }) => (await apiRequest<{ items: MailToken[] }>("/api/tokens", { signal })).items,
	});
}

export function useCreateMailTokenMutation() {
	return useMutation({
		mutationFn: async (input: { name: string; scopes: MailScope[]; account_id: string | null }) =>
			await apiRequest<{ item: MailToken; token: string }>("/api/tokens", { method: "POST", body: input }),
		onSuccess: (data) => {
			queryClient.setQueryData<MailToken[]>(["mail-tokens", "list"] as const, (previous) => [
				data.item,
				...(previous?.filter((item) => item.id !== data.item.id) ?? []),
			]);
		},
	});
}

export function useDeleteMailTokenMutation() {
	return useMutation({
		mutationFn: async (id: string) =>
			apiRequest<{ ok: true; deleted_id: string }>(`/api/tokens/${id}`, { method: "DELETE" }),
		onSuccess: ({ deleted_id }) => {
			queryClient.setQueryData<MailToken[]>(["mail-tokens", "list"] as const, (previous) =>
				previous?.filter((item) => item.id !== deleted_id),
			);
		},
	});
}

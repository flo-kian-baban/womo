import { trpc } from "@/lib/trpc";
import { useCallback, useMemo } from "react";

export function useAuth() {
  const utils = trpc.useUtils();

  const checkQuery = trpc.auth.check.useQuery(undefined, {
    retry: 1,
    retryDelay: 1000,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.check.setData(undefined, { authenticated: false });
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Ignore errors on logout
    } finally {
      utils.auth.check.setData(undefined, { authenticated: false });
      await utils.auth.check.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    return {
      loading: checkQuery.isLoading,
      isAuthenticated: checkQuery.data?.authenticated ?? false,
      error: checkQuery.error ?? logoutMutation.error ?? null,
    };
  }, [
    checkQuery.data,
    checkQuery.error,
    checkQuery.isLoading,
    logoutMutation.error,
  ]);

  return {
    ...state,
    refresh: () => checkQuery.refetch(),
    logout,
  };
}

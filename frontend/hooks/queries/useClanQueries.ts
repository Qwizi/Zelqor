import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getClans,
  getMyClan,
  getClan,
  createClan,
  updateClan,
  dissolveClan,
  getClanMembers,
  leaveClan,
  kickMember,
  promoteMember,
  demoteMember,
  transferLeadership,
  invitePlayer,
  getMyInvitations,
  acceptInvitation,
  declineInvitation,
  joinClan,
  getClanJoinRequests,
  acceptJoinRequest,
  declineJoinRequest,
  getClanTreasury,
  donateGold,
  withdrawGold,
  declareWar,
  acceptWar,
  declineWar,
  joinWar,
  getClanWars,
  getWarParticipants,
  getClanLeaderboard,
  getClanStats,
  getClanActivityLog,
  getClanChat,
  sendClanChatMessage,
  type ClanOut,
  type ClanDetailOut,
  type MyClanResponse,
  type ClanMembershipOut,
  type ClanInvitationOut,
  type ClanJoinRequestOut,
  type ClanWarOut,
  type ClanWarParticipantOut,
  type ClanLeaderboardEntry,
  type ClanStats,
  type ClanActivityLogOut,
  type ClanChatMessageOut,
  type PaginatedResponse,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { requireToken } from "@/lib/queryClient";

// ── Queries ──

export function useClans(search?: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<ClanOut>>({
    queryKey: queryKeys.clans.list(search, limit, offset),
    queryFn: () => getClans(requireToken(), search, limit, offset),
    staleTime: 30_000,
  });
}

export function useMyClan() {
  return useQuery<MyClanResponse>({
    queryKey: queryKeys.clans.my(),
    queryFn: () => getMyClan(requireToken()),
    staleTime: 30_000,
  });
}

export function useClan(clanId: string) {
  return useQuery<ClanDetailOut>({
    queryKey: queryKeys.clans.detail(clanId),
    queryFn: () => getClan(requireToken(), clanId),
    enabled: !!clanId,
    staleTime: 30_000,
  });
}

export function useClanMembers(clanId: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<ClanMembershipOut>>({
    queryKey: queryKeys.clans.members(clanId, limit, offset),
    queryFn: () => getClanMembers(requireToken(), clanId, limit, offset),
    enabled: !!clanId,
    staleTime: 30_000,
  });
}

export function useMyInvitations(limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<ClanInvitationOut>>({
    queryKey: queryKeys.clans.invitations(limit, offset),
    queryFn: () => getMyInvitations(requireToken(), limit, offset),
    staleTime: 30_000,
  });
}

export function useClanJoinRequests(clanId: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<ClanJoinRequestOut>>({
    queryKey: queryKeys.clans.joinRequests(clanId, limit, offset),
    queryFn: () => getClanJoinRequests(requireToken(), clanId, limit, offset),
    enabled: !!clanId,
    staleTime: 30_000,
  });
}

export function useClanTreasury(clanId: string) {
  return useQuery<{ treasury_gold: number; tax_percent: number }>({
    queryKey: queryKeys.clans.treasury(clanId),
    queryFn: () => getClanTreasury(requireToken(), clanId),
    enabled: !!clanId,
    staleTime: 30_000,
  });
}

export function useClanWars(clanId: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<ClanWarOut>>({
    queryKey: queryKeys.clans.wars(clanId, limit, offset),
    queryFn: () => getClanWars(requireToken(), clanId, limit, offset),
    enabled: !!clanId,
    staleTime: 30_000,
  });
}

export function useWarParticipants(warId: string) {
  return useQuery<ClanWarParticipantOut[]>({
    queryKey: queryKeys.clans.warParticipants(warId),
    queryFn: () => getWarParticipants(requireToken(), warId),
    enabled: !!warId,
    staleTime: 30_000,
  });
}

export function useClanLeaderboard(sort?: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<ClanLeaderboardEntry>>({
    queryKey: queryKeys.clans.leaderboard(sort, limit, offset),
    queryFn: () => getClanLeaderboard(requireToken(), sort, limit, offset),
    staleTime: 30_000,
  });
}

export function useClanStats(clanId: string) {
  return useQuery<ClanStats>({
    queryKey: queryKeys.clans.stats(clanId),
    queryFn: () => getClanStats(requireToken(), clanId),
    enabled: !!clanId,
    staleTime: 30_000,
  });
}

export function useClanActivityLog(clanId: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<ClanActivityLogOut>>({
    queryKey: queryKeys.clans.activityLog(clanId, limit, offset),
    queryFn: () => getClanActivityLog(requireToken(), clanId, limit, offset),
    enabled: !!clanId,
    staleTime: 30_000,
  });
}

export function useClanChat(clanId: string, limit?: number, offset?: number) {
  return useQuery<PaginatedResponse<ClanChatMessageOut>>({
    queryKey: queryKeys.clans.chat(clanId, limit, offset),
    queryFn: () => getClanChat(requireToken(), clanId, limit, offset),
    enabled: !!clanId,
    staleTime: 10_000,
  });
}

// ── Mutations ──

export function useCreateClan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; tag: string; description?: string; color?: string; is_public?: boolean }) =>
      createClan(requireToken(), data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useUpdateClan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, data }: { clanId: string; data: Record<string, unknown> }) =>
      updateClan(requireToken(), clanId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useDissolveClan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clanId: string) => dissolveClan(requireToken(), clanId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useLeaveClan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clanId: string) => leaveClan(requireToken(), clanId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useKickMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, userId }: { clanId: string; userId: string }) =>
      kickMember(requireToken(), clanId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function usePromoteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, userId }: { clanId: string; userId: string }) =>
      promoteMember(requireToken(), clanId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useDemoteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, userId }: { clanId: string; userId: string }) =>
      demoteMember(requireToken(), clanId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useTransferLeadership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, userId }: { clanId: string; userId: string }) =>
      transferLeadership(requireToken(), clanId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useInvitePlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, userId }: { clanId: string; userId: string }) =>
      invitePlayer(requireToken(), clanId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => acceptInvitation(requireToken(), invitationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useDeclineInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => declineInvitation(requireToken(), invitationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useJoinClan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, message }: { clanId: string; message?: string }) =>
      joinClan(requireToken(), clanId, message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useAcceptJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => acceptJoinRequest(requireToken(), requestId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useDeclineJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => declineJoinRequest(requireToken(), requestId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useDonateGold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, amount }: { clanId: string; amount: number }) =>
      donateGold(requireToken(), clanId, amount),
    onSuccess: (_data, { clanId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.treasury(clanId) });
      qc.invalidateQueries({ queryKey: queryKeys.clans.detail(clanId) });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.wallet() });
    },
  });
}

export function useWithdrawGold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, amount, reason }: { clanId: string; amount: number; reason?: string }) =>
      withdrawGold(requireToken(), clanId, amount, reason),
    onSuccess: (_data, { clanId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.treasury(clanId) });
      qc.invalidateQueries({ queryKey: queryKeys.clans.detail(clanId) });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.wallet() });
    },
  });
}

export function useDeclareWar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, targetId, data }: { clanId: string; targetId: string; data: { players_per_side?: number; wager_gold?: number } }) =>
      declareWar(requireToken(), clanId, targetId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useAcceptWar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (warId: string) => acceptWar(requireToken(), warId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useDeclineWar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (warId: string) => declineWar(requireToken(), warId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useJoinWar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (warId: string) => joinWar(requireToken(), warId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.all });
    },
  });
}

export function useSendClanChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clanId, content }: { clanId: string; content: string }) =>
      sendClanChatMessage(requireToken(), clanId, content),
    onSuccess: (_data, { clanId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.clans.chat(clanId) });
    },
  });
}

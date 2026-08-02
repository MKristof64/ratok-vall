export type GuestAuth = {
  authenticated: true;
  kind: "guest";
  account: null;
};

export type AccountAuth = {
  authenticated: true;
  kind: "account";
  account: {
    id: string;
    email: string;
  };
};

export type AuthState = GuestAuth | AccountAuth;

export interface AccountRoom {
  code: string;
  title: string;
  status: "collecting" | "playing" | "finished";
  revealTargetNames: boolean;
  participantCount: number;
  submissionCount: number;
  updatedAt: string;
  inviteUrlPath?: string;
  hostUrlPath?: string;
}

export interface AccountRoomsResponse {
  rooms: AccountRoom[];
}

export function isAuthState(value: unknown): value is AuthState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AuthState>;
  return (
    candidate.authenticated === true &&
    (candidate.kind === "guest" ||
      (candidate.kind === "account" &&
        Boolean(candidate.account) &&
        typeof candidate.account?.id === "string" &&
        typeof candidate.account?.email === "string"))
  );
}

// RoleContext — keeps the active demo role in URL search params
// (`?as=manager`) so reloads or shared links preserve the viewpoint.
// React Router edition: uses useSearchParams instead of next/navigation.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import type { Role } from "@/data";

const ROLE_QS = "as";
const ALL_ROLES: Role[] = ["intern", "manager", "hr", "exec"];
export const DEFAULT_ROLE: Role = "intern";

function parseRole(s: string | null): Role {
  return ALL_ROLES.includes(s as Role) ? (s as Role) : DEFAULT_ROLE;
}

type RoleCtx = {
  role: Role;
  setRole: (next: Role) => void;
};

const Ctx = createContext<RoleCtx | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const role = parseRole(params.get(ROLE_QS));

  const setRole = useCallback((next: Role) => {
    const sp = new URLSearchParams(params);
    if (next === DEFAULT_ROLE) sp.delete(ROLE_QS);
    else sp.set(ROLE_QS, next);
    setParams(sp, { replace: true });
  }, [params, setParams]);

  const value = useMemo(() => ({ role, setRole }), [role, setRole]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRole(): RoleCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRole must be used inside <RoleProvider>");
  return v;
}

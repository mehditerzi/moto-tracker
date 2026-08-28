import "express";
import type { OrgMode, OrgRole } from "@mototracker/shared";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string | null;
      };
      /**
       * Set by `requireOrgRole` (lib/orgAccess.ts) once the caller's active
       * membership in the requested organization has been verified, so handlers
       * behind that guard never re-query it.
       */
      orgMembership?: {
        orgId: string;
        role: OrgRole;
        mode: OrgMode;
        name: string;
      };
    }
  }
}
